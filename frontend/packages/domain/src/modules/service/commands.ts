// Команды «Обращений» (service.js 19.10:235–368 `serviceApi`, 10 команд). Синхронные функции над БД
// текущей организации; задержку, сеть и `view` добавляет адаптер (`cmd` эталона, 420 мс).
//
// Отличия от эталона (решения по умолчанию, бриф W7.30):
// - право проверяется с объектом-направлением (PD-53): роль в «Грузоперевозках» не даёт кнопок
//   в «Массаже»; недоступное направление и жалоба на самого себя — `not_found`, не `forbidden`;
// - компенсацию в ответе может назначить только тот, у кого есть «Решать» в направлении (PD-60,
//   Q-W4.00-service-6); неизвестная компенсация отклоняется (в эталоне сервер не проверял);
// - перенос в другое направление пересчитывает сроки от создания по типу и календарю нового
//   направления, остановленные остаются остановленными (PD-60, Q-W4.00-service-11);
// - проверки идут до изменений: при ошибке обращение не меняется частично;
// - неизвестный статус перехода — `validation` вместо падения адаптера.
import { ApiError } from '../../core/errors/index.ts';
import type { ModuleCtx } from '../../core/module.ts';
import type { CoreDb, Verb } from '../../core/types/index.ts';
import { canIn, ownerOf, seesDir } from './access.ts';
import { COMPENSATIONS, flowError, outcomesFor, SVC_PRIO, SVC_ST } from './dictionaries.ts';
import { dayLabel } from './format.ts';
import { resumeTimers, slaFor } from './sla.ts';
import type {
  Direction,
  RequestKind,
  RequestMessage,
  RequestStatus,
  ServiceRequest,
  ServiceSlice,
  Sla,
} from './types.ts';

export interface ReplyInput {
  /** `note` — внутренняя заметка; иначе ответ клиенту в канал обращения. */
  kind: 'reply' | 'note';
  text: string;
  compensation?: string;
}

export interface CallRequestInput {
  dir: string;
  kind: string;
  name: string;
  phone: string;
  org?: string;
  /** Привязка свободным текстом: «Рейс Р-196». */
  link?: string;
  text: string;
}

export interface ServiceApi {
  svcReply(id: string, input: ReplyInput): string;
  svcTransition(id: string, to: RequestStatus, opts?: { outcome?: string }): string;
  svcAssign(id: string, name: string | null): void;
  svcPriority(id: string, priority: string): void;
  svcMove(id: string, directionId: string): string;
  svcCreate(input: CallRequestInput): string;
  svcShowPhone(id: string): void;
  svcShare(id: string, text: string): void;
  svcAddTask(id: string, title: string): string;
  svcRating(ratingId: string, action: 'seen' | 'complaint'): string | null;
}

/** Задержки mock-адаптера: `cmd(fn, ms = 420)` эталона. */
export const SERVICE_DELAYS: Readonly<Record<keyof ServiceApi, number>> = {
  svcReply: 420,
  svcTransition: 420,
  svcAssign: 420,
  svcPriority: 420,
  svcMove: 420,
  svcCreate: 420,
  svcShowPhone: 420,
  svcShare: 420,
  svcAddTask: 420,
  svcRating: 420,
};

export const SERVICE_METHODS = Object.keys(SERVICE_DELAYS) as readonly (keyof ServiceApi)[];

const VERB: Partial<Record<Verb, string>> = {
  view: 'Видеть',
  create: 'Заводить',
  edit: 'Отвечать',
  review: 'Решать',
};

/** Фиксированный телефон жалобы из оценки (S:361): подделка ПДн эталона, Q-W7.30-3. */
export const UNKNOWN_PHONE = '+7 900 000-00-00';

const titleOf = (t: string): string => {
  const s = (
    String(t)
      .trim()
      .split(/[.!?\n]/)[0] ?? ''
  ).trim();
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
};

type ServiceDb = CoreDb & { service?: ServiceSlice | null };

export function serviceCommands(ctx: ModuleCtx): ServiceApi {
  const db = (): ServiceDb => ctx.getDb();
  const actor = (): string => ctx.getActor() ?? '';
  const meName = (): string => db().members.find((m) => m.id === actor())?.name ?? '—';
  const now = (): number => ctx.clock.now().getTime();

  const S = (): ServiceSlice => {
    const s = db().service;
    if (!s) throw new ApiError('not_found', 'В организации нет направлений обращений');
    return s;
  };
  const verbError = (verb: Verb): ApiError =>
    new ApiError('forbidden', 'Нет права «' + (VERB[verb] ?? verb) + '» в обращениях');
  /** Право в направлении с объектом (PD-53). */
  const needIn = (d: Direction, verb: Verb): void => {
    if (!canIn(db(), actor(), d, verb)) throw verbError(verb);
  };
  /** Обращение, видимое участнику: иначе 404 (чужое направление и жалоба на самого себя). */
  const req = (id: string): { r: ServiceRequest; d: Direction } => {
    const r = S().requests.find((x) => x.id === id);
    const d = r && S().directions.find((x) => x.id === r.dir);
    if (!r || !d || !seesDir(db(), actor(), d) || r.about === actor()) {
      throw new ApiError('not_found', 'Обращение не найдено');
    }
    return { r, d };
  };
  const msg = (r: ServiceRequest, kind: RequestMessage['kind'], text: string, x = {}): void => {
    r.messages.push({ id: 'msg' + S().seq++, kind, at: now(), text, ...x });
  };

  return {
    svcReply(id, { kind, text, compensation }) {
      const { r, d } = req(id);
      const note = kind === 'note';
      needIn(d, note ? 'view' : 'edit');
      if (r.status === 'closed') throw new ApiError('validation', 'Обращение закрыто');
      const t = String(text || '').trim();
      if (t.length < 2) {
        throw new ApiError('validation', note ? 'Напишите текст заметки' : 'Напишите текст ответа');
      }
      if (compensation) {
        needIn(d, 'review');
        if (!COMPENSATIONS.includes(compensation)) {
          throw new ApiError('validation', 'Неизвестная компенсация');
        }
      }
      const at = now();
      const by = meName();
      msg(r, note ? 'note' : 'public', t, { by, channel: note ? null : r.channel });
      if (!note) {
        if (r.sla.first && !r.sla.first.stopped) r.sla.first.stopped = at;
        if (r.status === 'new') r.status = 'work';
        if (!r.assignee) r.assignee = by;
      }
      if (compensation) {
        r.compensation = compensation;
        msg(
          r,
          'system',
          'Компенсация: ' +
            compensation +
            (compensation.startsWith('Возврат')
              ? ' — предложение операции отправлено в кассу, основание ' + r.key
              : ' — сохранена в карточке клиента'),
        );
      }
      return r.key;
    },

    svcTransition(id, to, opts = {}) {
      const { r, d } = req(id);
      if (!Object.hasOwn(SVC_ST, to)) throw new ApiError('validation', 'Неизвестный статус');
      const bad = flowError(r.status, to);
      if (bad) throw new ApiError('transition', bad);
      needIn(d, to === 'resolved' || to === 'closed' ? 'review' : 'edit');
      const at = now();
      const by = meName();
      if (to === 'resolved') {
        if (!outcomesFor(r).includes(opts.outcome ?? '')) {
          throw new ApiError('validation', 'Выберите итог решения');
        }
        if (r.status === 'wait') resumeTimers(r, d.cal, at);
        r.outcome = opts.outcome as string;
        r.resolvedAt = at;
        for (const k of ['first', 'resolve', 'legal'] as const) {
          const x = r.sla[k];
          if (x && !x.stopped) x.stopped = at;
        }
        msg(
          r,
          'system',
          'Решено · ' +
            r.outcome +
            ' · ' +
            by +
            '. Клиенту отправлен вопрос «Довольны ли решением?»',
        );
      } else if (to === 'wait') {
        r.pausedAt = at;
        msg(
          r,
          'system',
          'Ждёт клиента · ' +
            by +
            ' — срок на паузе' +
            (r.sla.legal ? ', срок по закону идёт' : ''),
        );
      } else if (to === 'work') {
        if (r.status === 'wait') resumeTimers(r, d.cal, at);
        if (r.status === 'resolved') {
          r.outcome = null;
          r.resolvedAt = null;
          for (const k of ['resolve', 'legal'] as const) {
            const x = r.sla[k];
            if (x) x.stopped = null;
          }
          msg(r, 'system', 'Возвращено в работу · ' + by);
        } else msg(r, 'system', 'Взято в работу · ' + by);
        if (!r.assignee) r.assignee = by;
      } else msg(r, 'system', 'Закрыто · ' + by);
      r.status = to;
      return r.key;
    },

    svcAssign(id, name) {
      const { r, d } = req(id);
      needIn(d, 'edit');
      const ok = !name || db().members.some((m) => m.name === name && seesDir(db(), m.id, d));
      if (!ok) {
        throw new ApiError(
          'validation',
          name + ' не видит направление «' + d.name + '» — назначить нельзя',
        );
      }
      r.assignee = name || null;
      msg(r, 'system', name ? 'Исполнитель: ' + name : 'Исполнитель снят');
    },

    svcPriority(id, priority) {
      const { r, d } = req(id);
      needIn(d, 'edit');
      if (!Object.hasOwn(SVC_PRIO, priority)) {
        throw new ApiError('validation', 'Неизвестный приоритет');
      }
      const p = priority as keyof typeof SVC_PRIO;
      r.priority = p;
      msg(r, 'system', 'Приоритет: ' + SVC_PRIO[p].toLowerCase());
    },

    svcMove(id, directionId) {
      const { r, d: from } = req(id);
      needIn(from, 'edit');
      const to = S().directions.find((x) => x.id === directionId);
      if (!to || to.id === r.dir) throw new ApiError('validation', 'Выберите другое направление');
      if (!seesDir(db(), actor(), to) || !canIn(db(), actor(), to, 'edit')) {
        throw new ApiError('forbidden', 'Нет доступа к направлению «' + to.name + '»');
      }
      const old = r.key;
      r.dir = to.id;
      r.key = to.key + '-' + to.next++;
      r.oldKeys = [...(r.oldKeys ?? []), old];
      if (!S().types.some((t) => t.dir === to.id && t.kind === r.kind)) r.kind = 'question';
      const ty = S().types.find((t) => t.dir === to.id && t.kind === r.kind);
      if (ty) {
        const next: Sla = slaFor(to.cal, ty, r.at);
        for (const k of ['first', 'resolve', 'legal'] as const) {
          const stopped = r.sla[k]?.stopped;
          const x = next[k];
          if (stopped && x) x.stopped = stopped;
        }
        r.sla = next;
      }
      msg(
        r,
        'system',
        'Перенесено из «' +
          from.name +
          '» в «' +
          to.name +
          '»: ' +
          old +
          ' → ' +
          r.key +
          '. Клиент получил новый номер, старый ведёт сюда',
      );
      return r.key;
    },

    svcCreate({ dir, kind, name, phone, org, link, text }) {
      if (!ctx.can.canAny(db(), actor(), 'service', 'create').ok) throw verbError('create');
      const d = S().directions.find((x) => x.id === dir);
      if (!d || !seesDir(db(), actor(), d))
        throw new ApiError('validation', 'Выберите направление');
      needIn(d, 'create');
      const ty = S().types.find((t) => t.dir === d.id && t.kind === kind);
      if (!ty) throw new ApiError('validation', 'Выберите тип обращения');
      if (String(name || '').trim().length < 2)
        throw new ApiError('validation', 'Укажите имя клиента');
      if (String(phone || '').replace(/\D/g, '').length < 10) {
        throw new ApiError('validation', 'Телефон — не меньше 10 цифр');
      }
      if (String(text || '').trim().length < 5)
        throw new ApiError('validation', 'Опишите, что случилось');
      const at = now();
      const by = meName();
      const id0 = 'r-' + S().seq++;
      const r: ServiceRequest = {
        id: id0,
        key: d.key + '-' + d.next++,
        dir: d.id,
        kind: ty.kind,
        title: titleOf(text),
        status: 'work',
        priority: ty.kind === 'complaint' || ty.kind === 'claim' ? 'high' : 'normal',
        assignee: by,
        at,
        channel: 'phone',
        client: {
          name: name.trim(),
          ...(org?.trim() ? { org: org.trim() } : {}),
          phone: phone.trim(),
          since: 'Новый клиент',
        },
        link: String(link || '').trim()
          ? { label: (link as string).trim(), lines: ['Привязано вручную при звонке'] }
          : null,
        sla: slaFor(d.cal, ty, at),
        labels: [],
        tasks: [],
        shown: [actor()],
        messages: [],
      };
      r.messages.push(
        { id: 'msg' + S().seq++, kind: 'system', at, text: 'Заведено по звонку · ' + by },
        {
          id: 'msg' + S().seq++,
          kind: 'client',
          at,
          text: text.trim(),
          by: name.trim(),
          channel: 'phone',
        },
      );
      S().requests.unshift(r);
      return r.id;
    },

    svcShowPhone(id) {
      const { r, d } = req(id);
      if (!ownerOf(db(), actor()) && d.lead !== actor()) {
        throw new ApiError(
          'forbidden',
          'Телефон клиента показывают руководителю направления и владельцу: нужно право «Контакты клиентов»',
        );
      }
      r.shown = [...new Set([...(r.shown ?? []), actor()])];
      msg(r, 'system', 'Телефон клиента показан: ' + meName());
    },

    svcShare(id, text) {
      const { r, d } = req(id);
      needIn(d, 'review');
      if (!r.about) throw new ApiError('validation', 'Обращение не касается сотрудника');
      if (r.status !== 'resolved' && r.status !== 'closed') {
        throw new ApiError('validation', 'Поделиться выводом можно после решения');
      }
      const t = String(text || '').trim();
      if (t.length < 5) throw new ApiError('validation', 'Напишите вывод для сотрудника');
      r.shared = { text: t, at: now(), by: meName() };
      msg(
        r,
        'system',
        'Вывод отправлен сотруднику: ' + (r.aboutName ?? '') + ' · без контактов клиента',
      );
      ctx.emit('Вывод по обращению ' + r.key + ': ' + t, [r.about]);
    },

    svcAddTask(id, title) {
      const { r, d } = req(id);
      needIn(d, 'edit');
      const t = String(title || '').trim();
      if (t.length < 3) throw new ApiError('validation', 'Тема задачи — не короче 3 символов');
      const tid = 'T-' + S().seq++;
      r.tasks.push({ id: tid, title: t, status: 'Новая' });
      msg(r, 'system', 'Создана задача ' + tid + ' «' + t + '» · клиент её не видит');
      return tid;
    },

    svcRating(ratingId, action) {
      const x = S().ratings.find((y) => y.id === ratingId);
      const d = x && S().directions.find((y) => y.id === x.dir);
      if (!x || !d || !seesDir(db(), actor(), d))
        throw new ApiError('not_found', 'Оценка не найдена');
      if (action === 'seen') {
        needIn(d, 'edit');
        x.status = 'seen';
        return null;
      }
      needIn(d, 'create');
      const ty = S().types.find((t) => t.dir === d.id && t.kind === 'complaint');
      if (!ty) throw new ApiError('validation', 'Выберите тип обращения');
      const at = now();
      const by = meName();
      const kind: RequestKind = 'complaint';
      const r: ServiceRequest = {
        id: 'r-' + S().seq++,
        key: d.key + '-' + d.next++,
        dir: d.id,
        kind,
        title: titleOf(x.comment || x.reasons.join(', ')),
        status: 'work',
        priority: x.score <= 2 ? 'high' : 'normal',
        assignee: by,
        at,
        channel: 'sms',
        fromRating: x.score,
        client: { name: x.client, phone: UNKNOWN_PHONE, since: 'Клиент из опроса ' + x.id },
        link: { label: x.work, lines: ['Оценка ' + x.score + ' из 5 · ' + dayLabel(x.at)] },
        sla: slaFor(d.cal, ty, at),
        labels: [],
        tasks: [],
        messages: [],
      };
      r.messages.push(
        {
          id: 'msg' + S().seq++,
          kind: 'rating',
          at: x.at,
          text: x.comment,
          by: x.client,
          score: x.score,
          reasons: x.reasons,
          contact: false,
        },
        {
          id: 'msg' + S().seq++,
          kind: 'system',
          at,
          text:
            'Жалоба открыта из низкой оценки · ' +
            by +
            '. Клиент не просил связаться — первым ответом позвоните или напишите',
        },
      );
      S().requests.unshift(r);
      x.status = 'request';
      x.request = r.key;
      return r.id;
    },
  };
}
