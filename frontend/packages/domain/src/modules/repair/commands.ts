// Команды «Ремонта и стройки» (api.js 14.10/19.10:895–967, docs/19): отметка прораба уходит на
// приёмку, факт меняется после принятия; допработа — от прораба, статус ведёт офис из сметы.
// Синхронные функции над БД организации; задержку, сеть, `view` добавляет адаптер.
//
// Отличия от эталона (решения по умолчанию, бриф W6.10 §10):
// - `acceptWorkLog` проверяет подписку (`assertActive`): по документу при ограниченной подписке
//   новые операции закрыты, а в эталоне приёмка проходила (расхождение №3 разбора DoR);
// - `returnWorkLog` — возврат отметки с обязательной причиной (RS-09, Q-W4.00-repair-3): статус
//   «Возвращён», факт и материалы не меняются, прораб получает событие;
// - `assignForeman` не назначает прораба объекту-черновику (Q-W4.00-repair-16);
// - прораб объекта определяется по `foremanId` (ядро `entries`), а не только по ФИО;
// - несуществующие отметка и срез ремонта — `not_found` вместо падения адаптера.
import { hhmm } from '../../core/clock.ts';
import { REASON } from '../../core/dictionaries.ts';
import { foremanIdOf } from '../../core/entries.ts';
import { ApiError } from '../../core/errors/index.ts';
import { num } from '../../core/format.ts';
import type { ModuleCtx } from '../../core/module.ts';
import type { Member, Verb } from '../../core/types/index.ts';
import { CHANGE_STATUSES } from './dictionaries.ts';
import type {
  ChangeOrder,
  ChangeStatus,
  RepairDb,
  RepairObject,
  RepairSlice,
  RepairWork,
  WorkLog,
} from './types.ts';

export interface WorkLogInput {
  obj?: string;
  work: string;
  volume: number | string;
  crew: string[];
  material?: string;
  materialQty?: number | string;
  /** Число приложенных фото. */
  photos: number;
}

export interface ProposeChangeInput {
  obj: string;
  title: string;
  volume?: number | string;
  unit?: string;
  note?: string;
  photos: number;
}

export interface SetChangeExtra {
  /** Номер допсоглашения. */
  agreement?: number | string;
  /** Причина отклонения. */
  reason?: string;
}

export type RepairApi = {
  addWorkLog(input: WorkLogInput): string;
  acceptWorkLog(logId: string): void;
  returnWorkLog(logId: string, reason: string): void;
  assignForeman(objId: string, memberId: string): void;
  proposeChange(input: ProposeChangeInput): string;
  setChange(ids: string[], status: ChangeStatus, extra?: SetChangeExtra): void;
};

/** Задержки mock-адаптера, мс (`cmd(fn, ms)` эталона). */
export const REPAIR_DELAYS: Readonly<Record<keyof RepairApi, number>> = {
  addWorkLog: 450,
  acceptWorkLog: 350,
  returnWorkLog: 350,
  assignForeman: 400,
  proposeChange: 350,
  setChange: 300,
};

export const REPAIR_METHODS = Object.keys(REPAIR_DELAYS) as readonly (keyof RepairApi)[];

const toNumber = (v: unknown): number => Number(String(v ?? '').replace(',', '.'));

export function repairCommands(ctx: ModuleCtx): RepairApi {
  const db = (): RepairDb => ctx.getDb() as RepairDb;
  const actor = (): string => ctx.getActor() ?? '';
  const me = (): Member | undefined => db().members.find((m) => m.id === actor());
  const now = (): string => hhmm(ctx.clock);
  const slice = (): RepairSlice => {
    const r = db().repair;
    if (!r) throw new ApiError('not_found', 'Модуль «Ремонт и стройка» не установлен');
    return r;
  };
  const owners = (): string[] =>
    db()
      .members.filter((m) => ctx.can.grants(db(), m.id).some((g) => g.roleObj.all))
      .map((m) => m.id);
  const assertActive = (): void => {
    const t = db().platform?.tenants.find((x) => x.id === db().tenantId);
    if (t && (t.status === 'restricted' || t.status === 'suspended')) {
      throw new ApiError(
        'subscription_restricted',
        'Пробный период завершён: новые операции недоступны. История доступна для чтения.',
      );
    }
  };
  const assertCan = (verb: Verb): void => {
    const r = ctx.can.can(db(), actor(), 'repair', verb);
    if (!r.ok) throw new ApiError(r.reason, REASON[r.reason].text);
  };
  const objectOf = (id: string | undefined): RepairObject | undefined =>
    slice().objects.find((o) => o.id === id);
  /** Прораб объекта: участник, связанный с ним по id (или по ФИО у сида эталона). */
  const isForemanOf = (o: RepairObject): boolean => {
    const m = me();
    return !!m && foremanIdOf(db(), o.id) === m.id;
  };
  const foremanIds = (o: RepairObject | undefined): string[] => {
    const id = o ? foremanIdOf(db(), o.id) : undefined;
    return id ? [id] : [];
  };

  return {
    addWorkLog(input) {
      assertActive();
      assertCan('create');
      const s = slice();
      const w: RepairWork | undefined = s.works.find(
        (x) => x.id === input.work && (!input.obj || x.obj === input.obj),
      );
      if (!w) throw new ApiError('validation', 'Выберите работу этого объекта');
      const o = objectOf(w.obj);
      if (!o || !me() || !isForemanOf(o)) {
        throw new ApiError('no_scope', 'Отметку по объекту отправляет его прораб');
      }
      if (o.stage === 'Сдан') {
        throw new ApiError('conflict', 'Объект сдан: новые отметки не принимаются');
      }
      const v = toNumber(input.volume);
      if (!Number.isFinite(v) || v <= 0) {
        throw new ApiError('validation', 'Объём должен быть больше нуля');
      }
      if (w.fact + v > w.plan * 1.1) {
        throw new ApiError(
          'validation',
          'Объём превышает план более чем на 10%: осталось ' + num(w.plan - w.fact) + ' ' + w.unit,
        );
      }
      if (!input.crew?.length) throw new ApiError('validation', 'Отметьте работников');
      if (!input.photos) throw new ApiError('validation', 'Добавьте хотя бы одно фото');
      const id = ctx.ids.next('WL-', 10);
      const qty = toNumber(input.materialQty);
      const log: WorkLog = {
        id,
        obj: o.id,
        at: now(),
        work: w.id,
        volume: v,
        crew: [...input.crew],
        materials: input.material && qty > 0 ? [[input.material, qty]] : [],
        photos: input.photos,
        status: 'На проверке',
        by: me()?.name ?? '',
      };
      s.logs.unshift(log);
      ctx.emit(
        'Прораб отметил «' +
          w.name +
          '» · ' +
          o.name +
          ': ' +
          num(v) +
          ' ' +
          w.unit +
          ' — нужна приёмка',
        owners(),
      );
      return id;
    },

    acceptWorkLog(logId) {
      assertActive();
      assertCan('review');
      const s = slice();
      const l = s.logs.find((x) => x.id === logId);
      if (!l) throw new ApiError('not_found', 'Отметка не найдена');
      if (l.status !== 'На проверке') throw new ApiError('conflict', 'Отметка уже обработана');
      l.status = 'Принят';
      const w = s.works.find((x) => x.id === l.work);
      if (w) w.fact += l.volume;
      for (const [id, q] of l.materials) {
        const mt = s.materials.find((x) => x.id === id);
        if (mt) mt.qty = Math.max(0, mt.qty - q);
      }
    },

    returnWorkLog(logId, reason) {
      assertActive();
      assertCan('review');
      const s = slice();
      const l = s.logs.find((x) => x.id === logId);
      if (!l) throw new ApiError('not_found', 'Отметка не найдена');
      const why = String(reason ?? '').trim();
      if (!why) throw new ApiError('validation', 'Укажите причину возврата');
      if (l.status !== 'На проверке') throw new ApiError('conflict', 'Отметка уже обработана');
      l.status = 'Возвращён';
      l.reason = why;
      const w = s.works.find((x) => x.id === l.work);
      ctx.emit(
        'Отметка ' + l.id + ' · ' + (w?.name ?? '—') + ' возвращена: ' + why,
        foremanIds(objectOf(l.obj)),
      );
    },

    assignForeman(objId, memberId) {
      assertActive();
      assertCan('edit');
      const o = objectOf(objId);
      if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (o.foreman) throw new ApiError('conflict', 'Прораб уже назначен: ' + o.foreman);
      if (o.draft) {
        throw new ApiError(
          'conflict',
          'Объект ещё не активирован: прораб назначается после договора',
        );
      }
      const m = db().members.find((x) => x.id === memberId && x.status === 'active');
      if (!m) throw new ApiError('validation', 'Сотрудник не найден или не активен');
      o.foreman = m.name;
      o.foremanId = m.id;
      ctx.emit('Вы назначены прорабом объекта «' + o.name + '»', [m.id]);
    },

    proposeChange(input) {
      assertActive();
      assertCan('create');
      const s = slice();
      const o = objectOf(input.obj);
      if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (!me() || !isForemanOf(o)) {
        throw new ApiError('no_scope', 'Допработу по объекту предлагает его прораб');
      }
      if (o.draft) {
        throw new ApiError(
          'conflict',
          'До договора допработ нет: правки вносятся новой версией сметы',
        );
      }
      if (o.stage === 'Сдан') {
        throw new ApiError('conflict', 'Объект сдан: допработы по нему не принимаются');
      }
      const title = String(input.title ?? '').trim();
      const v = toNumber(input.volume);
      if (title.length < 3) throw new ApiError('validation', 'Опишите, что нужно сделать');
      if (!(v > 0)) throw new ApiError('validation', 'Укажите объём больше нуля');
      if (!(input.photos > 0)) throw new ApiError('validation', 'Приложите хотя бы одно фото');
      const id = 'ДР-' + (s.changes.length + 1);
      const c: ChangeOrder = {
        id,
        obj: o.id,
        at: now(),
        by: me()?.name ?? '',
        title,
        volume: v,
        unit: input.unit || 'шт',
        note: String(input.note ?? '').trim(),
        photos: input.photos,
        status: 'proposed',
      };
      s.changes.unshift(c);
      ctx.emit(
        'Прораб предложил допработу «' + title + '» · ' + o.name + ' — нужна оценка',
        owners(),
      );
      return id;
    },

    setChange(ids, status, extra = {}) {
      assertActive();
      assertCan('edit');
      if (!CHANGE_STATUSES.includes(status)) {
        throw new ApiError('validation', 'Неизвестный статус допработы');
      }
      const s = slice();
      const list = s.changes.filter((c) => (ids ?? []).includes(c.id));
      if (!list.length) throw new ApiError('not_found', 'Допработа не найдена');
      const fin = list.find(
        (c) => (c.status === 'signed' || c.status === 'rejected') && c.status !== status,
      );
      if (fin) {
        throw new ApiError(
          'conflict',
          'Допработа ' + fin.id + ' уже ' + (fin.status === 'signed' ? 'подписана' : 'отклонена'),
        );
      }
      for (const c of list) {
        if (c.status === status) continue;
        const o = objectOf(c.obj);
        const fm = foremanIds(o);
        c.status = status;
        if (extra.agreement) c.agreement = extra.agreement;
        if (status === 'rejected') {
          c.reason = extra.reason || 'Без причины';
          ctx.emit('Допработа ' + c.id + ' «' + c.title + '» отклонена: ' + c.reason, fm);
        }
        if (status === 'signed') {
          s.works.push({
            id: 'w-' + c.id,
            obj: c.obj,
            name: c.title,
            unit: c.unit,
            plan: c.volume,
            fact: 0,
          });
          ctx.emit(
            'Допсоглашение' +
              (c.agreement ? ' № ' + String(c.agreement) : '') +
              ' подписано: «' +
              c.title +
              '» добавлена в работы · ' +
              (o?.name ?? ''),
            fm,
          );
        }
      }
    },
  };
}
