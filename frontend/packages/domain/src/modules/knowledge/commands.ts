// Команды «Базы знаний» (knowledge.js 14.10:317–515; api.js:785–845). Синхронные функции над БД
// текущей организации; задержку, сеть и `view` добавляет адаптер (`cmd` эталона).
//
// Отличия от эталона (бриф W4.30 §10):
// - PD-53: `kbCreateSpace` — право «База знаний · Настраивать» роли области, покрывающей область
//   пространства (`can` ядра); роль пространства его не даёт;
// - KB-01: запись `relation` в списке доступа — только из шаблона: уже стоящая у узла или связь
//   «Прораб объекта» своего раздела объекта (её можно вернуть после сброса доступа);
// - KB-03: `kbAck` пишет журнал подтверждений `ack.log`;
// - KB-06: создание и перенос — не глубже шести уровней;
// - PD-60: назначение со сроком `until` после срока не действует (дата — часы домена);
// - прораб объекта в `kbRunSection` — по id (`foremanIdOf` ядра), а не по ФИО;
// - время — часы домена (`Clock`, Москва), а не `new Date()` и `KB_TODAY`.
import { can } from '../../core/access/can.ts';
import { ddmmHHMM, ddmmyyyy, hhmm, type Clock } from '../../core/clock.ts';
import { entryKey, foremanIdOf, objOf } from '../../core/entries.ts';
import { ApiError } from '../../core/errors/index.ts';
import type { ModuleCtx } from '../../core/module.ts';
import type { Member } from '../../core/types/index.ts';
import { isKbOwner, kbAccess, kbEntryHas, kbLeads, kbSpaceMy } from './access.ts';
import {
  KB_ACCESS,
  KB_BODY_MAX,
  KB_KINDS,
  KB_MAX_DEPTH,
  KB_MODES,
  KB_REQUEST_DAYS,
  KB_ROLE_ORDER,
  KB_RUNS_KEPT,
  KB_STATUS,
  KB_TEMPLATES,
} from './dictionaries.ts';
import { kbImpact } from './impact.ts';
import { entryLabel } from './labels.ts';
import { kbEditors, kbNode, makeSection, type KbSectionObject } from './sections.ts';
import { dval, kbDepth, kbHeight, kbPath, kbSubtree, nodeOf } from './tree.ts';
import type {
  KbCan,
  KbAccessEntry,
  KbKind,
  KbMode,
  KbNode,
  KbOpts,
  KbRule,
  KbRun,
  KbSpace,
  KbSpaceAccess,
  KbStatus,
  KbTenantDb,
  KnowledgeSlice,
} from './types.ts';

export interface KbCreateSpaceInput {
  name: string;
  access: KbSpaceAccess;
  template?: string;
  icon?: string;
  color?: string;
  unit?: string | null;
  /** Номера узлов шаблона, которые создать (по умолчанию — все). */
  nodes?: number[];
}

export interface KbPublishInput {
  /** Базовая версия правки; без неё конфликт не проверяется. */
  base?: number;
  body?: string;
  title?: string;
  steps?: string[];
  /** Попросить аудиторию ознакомиться с новой версией. */
  ack?: boolean;
}

export interface KbSetAccessInput {
  mode: KbMode;
  list?: readonly KbAccessEntry[];
  applyOwn?: boolean;
}

export interface KbColumnInput {
  name: string;
  type?: string;
}

export interface KbTableInput {
  title: string;
  columns: KbColumnInput[];
}

export interface KbCreatePageInput {
  title: string;
  body: string;
  access?: 'all' | 'owner';
  table?: KbTableInput;
}

export type KnowledgeApi = {
  kbCreateSpace(spec: KbCreateSpaceInput): { id: string };
  kbCreateNode(
    spaceId: string,
    parentId: string | null,
    kind: KbKind,
    title: string,
  ): { id: string };
  kbPublish(id: string, spec: KbPublishInput): { v: number; asked: number };
  kbSetStatus(id: string, status: KbStatus): { status: KbStatus };
  kbSetAccess(id: string, spec: KbSetAccessInput): { pages: number; lose: number };
  kbMove(id: string, parentId: string | null): { ok: true };
  kbArchive(id: string, on: boolean): { ok: true };
  kbAck(id: string): { done: number };
  kbRequest(id: string, can: KbCan): { id: string };
  kbDecide(reqId: string, approve: boolean): { status: 'approved' | 'denied' };
  kbSetMember(spaceId: string, memberId: string, roleId: string | null): { ok: true };
  kbToggleRule(ruleId: string): { on: boolean };
  kbCheckReview(spaceId: string): { due: number };
  kbRunSection(objId: string): { created: boolean; id?: string };
  saveKbPage(pageId: string, body: string, baseVersion: number): number;
  createKbPage(
    spaceId: string,
    spec: KbCreatePageInput,
  ): { id: string; table: { id: string; columns: string[] } | null };
  createKbTable(pageId: string, spec: KbTableInput): { id: string; columns: string[] };
};

/** Задержки mock-адаптера, мс (`cmd(fn, ms)` эталона). */
export const KB_DELAYS: Readonly<Record<keyof KnowledgeApi, number>> = {
  kbCreateSpace: 380,
  kbCreateNode: 300,
  kbPublish: 380,
  kbSetStatus: 250,
  kbSetAccess: 380,
  kbMove: 300,
  kbArchive: 300,
  kbAck: 250,
  kbRequest: 300,
  kbDecide: 300,
  kbSetMember: 300,
  kbToggleRule: 250,
  kbCheckReview: 350,
  kbRunSection: 380,
  saveKbPage: 400,
  createKbPage: 350,
  createKbTable: 250,
};

export const KB_METHODS = Object.keys(KB_DELAYS) as readonly (keyof KnowledgeApi)[];

const DAY_MS = 86_400_000;
const LIST_WHO: readonly string[] = ['member', 'group', 'role', 'relation'];
const LIST_CAN: readonly string[] = ['view', 'edit'];

/** Дата через `n` дней по часам домена, `ДД.ММ.ГГГГ`. */
const plusDays = (c: Clock, n: number): string =>
  ddmmyyyy({ now: () => new Date(c.now().getTime() + n * DAY_MS) });

export function knowledgeCommands(ctx: ModuleCtx): KnowledgeApi {
  const D = (): KbTenantDb => ctx.getDb();
  const me = (): string => ctx.getActor() ?? '';
  const today = (): string => ddmmyyyy(ctx.clock);
  const opts = (): KbOpts => ({ today: today() });
  const memberOf = (id: string): Member | undefined => D().members.find((m) => m.id === id);
  const meName = (): string => memberOf(me())?.name ?? '—';
  const nid = (p: string): string => ctx.ids.next(p);

  const K = (): KnowledgeSlice => {
    const k = D().knowledge;
    if (!k?.v2) throw new ApiError('not_found', 'База знаний не подключена');
    return k;
  };
  const node = (id: string | null | undefined): KbNode => {
    const n = nodeOf(K(), id);
    if (!n) throw new ApiError('not_found', 'Страница не найдена или недоступна');
    return n;
  };
  const spaceOf = (id: string): KbSpace => {
    const s = K().spaces.find((x) => x.id === id);
    if (!s) throw new ApiError('not_found', 'Пространство не найдено');
    return s;
  };
  const acc = (n: KbNode) => kbAccess(D(), me(), n, opts());
  const my = (sp: KbSpace) => kbSpaceMy(D(), me(), sp, opts());
  const owners = (): string[] =>
    D()
      .members.filter((m) => isKbOwner(D(), m.id))
      .map((m) => m.id);
  const needLead = (sp: KbSpace): void => {
    if (!my(sp).lead) {
      throw new ApiError('forbidden', 'Это может руководитель пространства или владелец бизнеса');
    }
  };
  const needView = (n: KbNode): void => {
    if (!acc(n).view) throw new ApiError('not_found', 'Страница не найдена или недоступна');
  };
  const needEdit = (n: KbNode): void => {
    needView(n);
    if (!acc(n).edit) throw new ApiError('forbidden', 'Нет права править «' + n.title + '»');
  };
  const log = (space: string, rule: string, res: KbRun['res'], text: string): void => {
    const runs = (K().runs ??= []);
    runs.unshift({ id: nid('krr-'), space, rule, at: ddmmHHMM(ctx.clock), res, text });
    runs.length = Math.min(runs.length, KB_RUNS_KEPT);
  };
  const ruleOn = (space: string, kind: KbRule['kind']): KbRule | undefined =>
    (K().rules ?? []).find((r) => r.space === space && r.kind === kind && r.on);
  const title = (t: unknown): string => {
    const s = String(t ?? '').trim();
    if (s.length < 2) throw new ApiError('validation', 'Название — не короче 2 символов');
    if (s.length > 120) throw new ApiError('validation', 'Название — не длиннее 120 символов');
    return s;
  };
  const nextPos = (space: string, parent: string | null | undefined): number =>
    K()
      .pages.filter((p) => p.space === space && (p.parent ?? null) === (parent ?? null))
      .reduce((m, p) => Math.max(m, p.pos ?? 0), 0) + 1;
  const needDepth = (levels: number): void => {
    if (levels > KB_MAX_DEPTH) {
      throw new ApiError('validation', 'Не больше шести уровней вложенности');
    }
  };
  const audience = (n: KbNode, sp: KbSpace): Member[] => {
    const a = n.ack?.audience;
    if (!a) return [];
    return D().members.filter(
      (m) =>
        m.status === 'active' &&
        kbAccess(D(), m.id, n, opts()).view &&
        (a.who === 'all' || kbEntryHas(D(), m.id, a, sp)),
    );
  };
  /**
   * Связи с записью CRM, которые даёт узлу шаблон (KB-01): уже стоящие в списке и связь «Прораб
   * объекта» раздела объекта (`makeSection`) — для самого раздела и его подстраниц. Так связь можно
   * вернуть после «Как у родителя» или `applyOwn` папки: `kbRunSection` раздел не пересоздаёт.
   */
  const templateRelations = (n: KbNode): Set<string> => {
    const keys = new Set((n.list ?? []).filter((x) => x.who === 'relation').map(entryKey));
    const obj = kbPath(K(), n).find((x) => x.obj)?.obj;
    if (obj) keys.add(entryKey({ who: 'relation', ref: 'foreman', obj }));
    return keys;
  };
  const checkList = (list: readonly KbAccessEntry[] | undefined, n: KbNode): KbAccessEntry[] =>
    (list ?? []).map((e) => {
      if (!LIST_WHO.includes(e.who) || !LIST_CAN.includes(e.can)) {
        throw new ApiError('validation', 'Неверная запись в списке доступа');
      }
      const db = D();
      if (e.who === 'member' && !memberOf(e.ref ?? '')) {
        throw new ApiError('validation', 'Сотрудник не найден');
      }
      if (e.who === 'group' && !db.groups?.some((g) => g.id === e.ref)) {
        throw new ApiError('validation', 'Группа не найдена');
      }
      if (e.who === 'role' && !db.roles.some((r) => r.id === e.ref)) {
        throw new ApiError('validation', 'Роль не найдена');
      }
      if (e.who === 'relation' && !templateRelations(n).has(entryKey(e))) {
        throw new ApiError('validation', 'Связь с записью CRM задаётся шаблоном раздела');
      }
      return {
        who: e.who,
        ref: e.ref,
        can: e.can,
        ...(e.unit ? { unit: e.unit } : {}),
        ...(e.obj ? { obj: e.obj } : {}),
      };
    });

  /** Публикация новой версии (`kbPublish`); `strict` — базовая версия обязательна (`saveKbPage`). */
  const publish = (id: string, s: KbPublishInput, strict = false): { v: number; asked: number } => {
    const n = node(id);
    needEdit(n);
    const last = n.versions[n.versions.length - 1] ?? { v: 0 };
    if ((strict || s.base) && last.v !== s.base) {
      throw new ApiError(
        'conflict',
        'Страницу уже изменили (v' + last.v + '). Обновите и повторите правку.',
      );
    }
    const body = String(s.body ?? '');
    if (body.length > KB_BODY_MAX) {
      throw new ApiError('validation', 'Текст — не длиннее 20 000 символов');
    }
    if (strict && !body.trim()) throw new ApiError('validation', 'Текст страницы пустой');
    n.title = title(s.title || n.title);
    if (n.kind === 'diagram' && s.steps) {
      n.diagram = {
        out: [],
        ...n.diagram,
        steps: s.steps
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 8),
      };
    }
    const v = last.v + 1;
    n.versions.push({ v, at: today(), by: meName(), body: strict ? body.trim() : body });
    if (n.status === 'draft' || n.status === 'outdated') n.status = 'active';
    let asked = 0;
    if (s.ack && n.ack) {
      const sp = spaceOf(n.space);
      n.ack = { ...n.ack, v, done: [] };
      const who = audience(n, sp).map((m) => m.id);
      asked = who.length;
      if (who.length) {
        ctx.emit('Новая версия «' + n.title + '» v' + v + ' — подтвердите, что ознакомились', who);
      }
      const rule = ruleOn(n.space, 'ack');
      if (rule) {
        log(
          n.space,
          rule.id,
          'ok',
          '«' + n.title + '» v' + v + ': попросили ознакомиться — ' + asked + ' чел.',
        );
      }
    }
    return { v, asked };
  };

  const assertActive = (): void => {
    const db = D();
    const t = db.platform?.tenants.find((x) => x.id === db.tenantId);
    if (t && (t.status === 'restricted' || t.status === 'suspended')) {
      throw new ApiError(
        'subscription_restricted',
        'Пробный период завершён: новые операции недоступны. История доступна для чтения.',
      );
    }
  };
  /** Столбцы таблицы (api.js:810–814, 837–840) — проверка до выдачи id. */
  const checkColumns = (columns: readonly KbColumnInput[] | undefined): KbColumnInput[] => {
    const cols = (columns ?? []).map((c) => ({
      name: String(c.name ?? '').trim(),
      type: c.type || 'text',
    }));
    if (!cols.length) throw new ApiError('validation', 'Добавьте хотя бы один столбец');
    if (cols.some((c) => !c.name)) throw new ApiError('validation', 'У столбца нет названия');
    if (new Set(cols.map((c) => c.name.toLowerCase())).size !== cols.length) {
      throw new ApiError('validation', 'Названия столбцов повторяются');
    }
    return cols;
  };
  const tableTitle = (t: unknown): string => {
    const s = String(t ?? '').trim();
    if (s.length < 2) throw new ApiError('validation', 'Название таблицы — не короче 2 символов');
    return s;
  };

  return {
    kbCreateSpace(spec) {
      const db = D();
      const s = spec ?? ({} as KbCreateSpaceInput);
      K();
      const allowed =
        isKbOwner(db, me()) || can(db, me(), 'knowledge', 'settings', s.unit || null).ok;
      if (!allowed) {
        throw new ApiError(
          'forbidden',
          'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»',
        );
      }
      const name = title(s.name);
      if (K().spaces.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
        throw new ApiError('validation', 'Пространство «' + name + '» уже есть');
      }
      if (!Object.hasOwn(KB_ACCESS, s.access)) {
        throw new ApiError('validation', 'Выберите уровень доступа');
      }
      const tpl =
        KB_TEMPLATES.find((t) => t.id === s.template) ??
        (KB_TEMPLATES[KB_TEMPLATES.length - 1] as (typeof KB_TEMPLATES)[number]);
      const sp: KbSpace = {
        id: nid('sp-'),
        name,
        icon: s.icon || tpl.icon,
        color: s.color || '#2B5479',
        unit: s.unit || null,
        access: s.access,
        template: tpl.id,
      };
      K().spaces.push(sp);
      let top: string | null = null;
      let pos = 0;
      let kpos = 0;
      const pick = new Set(s.nodes ?? tpl.nodes.map((_x, i) => i));
      tpl.nodes.forEach((x, i) => {
        if (!x.in && !pick.has(i)) top = null;
        if (!pick.has(i)) return;
        const parent = x.in ? top : null;
        const n = kbNode(nid('kb-'), sp.id, parent, x.in ? ++kpos : ++pos, x.k, x.t, {
          body: x.body || '',
          at: today(),
          by: meName(),
          owner: me(),
        });
        if (x.role) {
          n.mode = 'listed';
          n.list = [
            { who: 'role', ref: x.role, ...(sp.unit ? { unit: sp.unit } : {}), can: 'view' },
            kbEditors(),
          ];
        }
        if (x.ack) n.ack = { v: 1, audience: { who: 'all' }, done: [] };
        if (!x.in) {
          top = n.id;
          kpos = 0;
        }
        K().pages.push(n);
      });
      if (!isKbOwner(db, me())) {
        db.assignments.push({
          id: nid('akb-'),
          member: me(),
          role: 'r-kb-lead',
          scope: { type: 'space', id: sp.id },
        });
      }
      return { id: sp.id };
    },

    kbCreateNode(spaceId, parentId, kind, t) {
      const sp = spaceOf(spaceId);
      const name = title(t);
      if (!Object.hasOwn(KB_KINDS, kind) || kind === 'file' || kind === 'link') {
        throw new ApiError('validation', 'Выберите тип: страница, папка или схема');
      }
      if (parentId) {
        const p = node(parentId);
        needView(p);
        if (p.space !== sp.id) {
          throw new ApiError('validation', 'Родитель — из другого пространства');
        }
        if (!acc(p).create) {
          throw new ApiError('forbidden', 'Нет права создавать страницы внутри «' + p.title + '»');
        }
        needDepth(kbDepth(K(), p) + 1);
      } else if (!my(sp).create) {
        throw new ApiError('forbidden', 'Нет права создавать страницы в пространстве');
      }
      const n = kbNode(nid('kb-'), sp.id, parentId || null, nextPos(sp.id, parentId), kind, name, {
        body: '',
        at: today(),
        by: meName(),
        owner: me(),
        status: kind === 'folder' ? 'active' : 'draft',
      });
      if (kind === 'diagram') n.diagram = { steps: ['Начало', 'Шаг', 'Готово'], out: [] };
      K().pages.push(n);
      return { id: n.id };
    },

    kbPublish: (id, spec) => publish(id, spec ?? {}),

    kbSetStatus(id, status) {
      const n = node(id);
      needEdit(n);
      if (!Object.hasOwn(KB_STATUS, status)) throw new ApiError('validation', 'Неизвестный статус');
      n.status = status;
      return { status };
    },

    kbSetAccess(id, spec) {
      const n = node(id);
      needLead(spaceOf(n.space));
      const s = spec ?? ({} as KbSetAccessInput);
      if (!Object.hasOwn(KB_MODES, s.mode)) {
        throw new ApiError('validation', 'Выберите, кто видит страницу');
      }
      const list = s.mode === 'inherit' ? [] : checkList(s.list, n);
      const imp = kbImpact(D(), id, { mode: s.mode, list, applyOwn: !!s.applyOwn }, opts());
      n.mode = s.mode;
      n.list = list;
      if (s.applyOwn) {
        for (const x of kbSubtree(K(), n)) {
          if (x.id !== n.id && x.mode && x.mode !== 'inherit') {
            x.mode = 'inherit';
            x.list = [];
          }
        }
      }
      const who = list
        .map((e) => entryLabel(D(), e) + ' — ' + (e.can === 'edit' ? 'правит' : 'читает'))
        .join(', ');
      (n.history ??= []).unshift({
        at: today() + ' ' + hhmm(ctx.clock),
        by: meName(),
        text: 'Доступ: ' + KB_MODES[s.mode].label + (list.length ? ' · ' + who : ''),
      });
      return { pages: imp.pages, lose: imp.loseView.length };
    },

    kbMove(id, parentId) {
      const n = node(id);
      needEdit(n);
      if (parentId) {
        const p = node(parentId);
        needView(p);
        if (p.space !== n.space) {
          throw new ApiError('validation', 'Переносить можно только внутри пространства');
        }
        if (kbPath(K(), p).some((x) => x.id === n.id)) {
          throw new ApiError('validation', 'Нельзя перенести страницу внутрь её же подстраницы');
        }
        if (!acc(p).create) {
          throw new ApiError('forbidden', 'Нет права добавлять страницы в «' + p.title + '»');
        }
        needDepth(kbDepth(K(), p) + kbHeight(K(), n));
      }
      n.parent = parentId || null;
      n.pos = nextPos(n.space, parentId);
      return { ok: true };
    },

    kbArchive(id, on) {
      const n = node(id);
      const m = my(spaceOf(n.space));
      if (!(m.lead || m.edit) || !acc(n).view) {
        throw new ApiError(
          'forbidden',
          'Архивировать может редактор или руководитель пространства',
        );
      }
      if (on && !n.parent && n.title === 'Обзор') {
        throw new ApiError('validation', 'Главную страницу пространства архивировать нельзя');
      }
      for (const x of kbSubtree(K(), n, true)) x.archived = !!on;
      return { ok: true };
    },

    kbAck(id) {
      const n = node(id);
      needView(n);
      const ack = n.ack;
      if (!ack) throw new ApiError('validation', 'Ознакомление со страницей не запрошено');
      if (!audience(n, spaceOf(n.space)).some((m) => m.id === me())) {
        throw new ApiError('validation', 'Ознакомление запрошено у другой роли');
      }
      if (!ack.done.includes(me())) {
        ack.done.push(me());
        (ack.log ??= []).push({ member: me(), v: ack.v, at: ddmmHHMM(ctx.clock) });
      }
      return { done: ack.done.length };
    },

    kbRequest(id, want) {
      const n = node(id);
      const a = acc(n);
      needView(n);
      if (want === 'edit' && a.edit)
        throw new ApiError('validation', 'Вы уже можете править страницу');
      const requests = (K().requests ??= []);
      if (requests.some((r) => r.node === id && r.member === me() && r.status === 'open')) {
        throw new ApiError('validation', 'Запрос уже отправлен');
      }
      const r = {
        id: nid('kq-'),
        node: id,
        space: n.space,
        member: me(),
        can: (want === 'edit' ? 'edit' : 'view') as KbCan,
        at: ddmmHHMM(ctx.clock),
        status: 'open' as const,
      };
      requests.unshift(r);
      const sp = spaceOf(n.space);
      const to = [...kbLeads(D(), sp, opts()).map((m) => m.id), ...owners()];
      ctx.emit(
        meName() +
          ' просит ' +
          (r.can === 'edit' ? 'право правки' : 'доступ') +
          ' к «' +
          n.title +
          '»',
        [...new Set(to)],
      );
      return { id: r.id };
    },

    kbDecide(reqId, approve) {
      const r = (K().requests ?? []).find((x) => x.id === reqId && x.status === 'open');
      if (!r) throw new ApiError('not_found', 'Запрос не найден или уже решён');
      const n = node(r.node);
      needLead(spaceOf(n.space));
      if (approve) {
        if (r.can === 'edit') {
          if (!n.mode || n.mode === 'inherit') {
            n.mode = 'edit';
            n.list = [kbEditors()];
          }
          const list = (n.list ??= []);
          if (!list.some((e) => e.who === 'member' && e.ref === r.member)) {
            list.push({ who: 'member', ref: r.member, can: 'edit' });
          } else {
            n.list = list.map((e) =>
              e.who === 'member' && e.ref === r.member ? { ...e, can: 'edit' } : e,
            );
          }
        } else {
          D().assignments.push({
            id: nid('akb-'),
            member: r.member,
            role: 'r-kb-reader',
            scope: { type: 'page', id: n.id },
            until: plusDays(ctx.clock, KB_REQUEST_DAYS),
            via: 'запрос доступа',
          });
        }
      }
      r.status = approve ? 'approved' : 'denied';
      r.by = meName();
      ctx.emit((approve ? 'Одобрен' : 'Отклонён') + ' запрос к «' + n.title + '»', [r.member]);
      return { status: r.status };
    },

    kbSetMember(spaceId, memberId, roleId) {
      const sp = spaceOf(spaceId);
      const db = D();
      needLead(sp);
      if (!memberOf(memberId)) throw new ApiError('validation', 'Выберите сотрудника');
      if (roleId && !KB_ROLE_ORDER.includes(roleId)) {
        throw new ApiError('validation', 'Выберите роль пространства');
      }
      if (isKbOwner(db, memberId)) {
        throw new ApiError('validation', 'Владелец бизнеса видит всё без назначения');
      }
      if (memberId === me() && roleId !== 'r-kb-lead' && !isKbOwner(db, me())) {
        throw new ApiError('validation', 'Свою роль руководителя снимает владелец бизнеса');
      }
      db.assignments = db.assignments.filter(
        (a) => !(a.member === memberId && a.scope.type === 'space' && a.scope.id === sp.id),
      );
      if (roleId) {
        db.assignments.push({
          id: nid('akb-'),
          member: memberId,
          role: roleId,
          scope: { type: 'space', id: sp.id },
        });
      }
      return { ok: true };
    },

    kbToggleRule(ruleId) {
      const r = (K().rules ?? []).find((x) => x.id === ruleId);
      if (!r) throw new ApiError('not_found', 'Правило не найдено');
      needLead(spaceOf(r.space));
      r.on = !r.on;
      return { on: r.on };
    },

    kbCheckReview(spaceId) {
      const sp = spaceOf(spaceId);
      needLead(sp);
      const r = ruleOn(sp.id, 'review');
      if (!r) throw new ApiError('validation', 'Правило «Пора пересмотреть» выключено');
      const now = dval(today());
      const due = K().pages.filter(
        (p) =>
          p.space === sp.id &&
          !p.archived &&
          p.reviewBy &&
          dval(p.reviewBy) <= now &&
          p.status !== 'outdated',
      );
      for (const p of due) {
        p.status = 'outdated';
        ctx.emit(
          'Пора пересмотреть «' + p.title + '»: срок был ' + p.reviewBy,
          p.owner ? [p.owner] : [],
        );
        log(
          sp.id,
          r.id,
          'ok',
          '«' +
            p.title +
            '»: срок пересмотра ' +
            p.reviewBy +
            ', уведомлён владелец ' +
            (memberOf(p.owner ?? '')?.name ?? ''),
        );
      }
      if (!due.length)
        log(sp.id, r.id, 'stopped', 'Остановлено условием: сроки пересмотра не наступили');
      return { due: due.length };
    },

    kbRunSection(objId) {
      const sp = spaceOf('sp-rep');
      needLead(sp);
      const r = ruleOn('sp-rep', 'section');
      if (!r) throw new ApiError('validation', 'Правило выключено');
      const o = objOf(D(), objId) as (KbSectionObject & { foremanId?: string | null }) | undefined;
      if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (nodeOf(K(), 'kb-o-' + o.id)) {
        log(sp.id, r.id, 'stopped', o.name + ': остановлено условием — раздел уже есть');
        return { created: false };
      }
      const folder = K().pages.find(
        (p) => p.space === 'sp-rep' && p.kind === 'folder' && p.title === 'Объекты' && !p.parent,
      );
      if (!folder) throw new ApiError('validation', 'В пространстве нет папки «Объекты»');
      makeSection(D(), o, folder.id);
      const fid = foremanIdOf(D(), o.id);
      const foreman = o.foreman || (fid ? memberOf(fid)?.name : undefined);
      if (foreman) {
        log(
          sp.id,
          r.id,
          'ok',
          o.name + ': создан раздел и 5 подстраниц, доступ получил прораб ' + foreman,
        );
      } else {
        log(
          sp.id,
          r.id,
          'warn',
          o.name +
            ': прораб не назначен — раздел создан, доступ пока у редакторов. Назначат прораба — он получит доступ сам',
        );
      }
      if (fid) ctx.emit('Создан раздел объекта «' + o.name + '» в базе знаний', [fid]);
      return { created: true, id: 'kb-o-' + o.id };
    },

    // Наследие ядра (api.js:785): правка через `kbPublish` с обязательной базовой версией.
    saveKbPage: (pageId, body, baseVersion) =>
      publish(pageId, { base: baseVersion, body: String(body ?? '') }, true).v,

    createKbPage(spaceId, spec) {
      assertActive();
      const db = D();
      const sp = K().spaces.find((x) => x.id === spaceId);
      if (!sp) throw new ApiError('validation', 'Выберите раздел Базы знаний');
      if (!my(sp).create) {
        throw new ApiError('forbidden', 'Нет права создавать страницы в пространстве');
      }
      const s = spec ?? ({} as KbCreatePageInput);
      const name = String(s.title ?? '').trim();
      if (name.length < 3) {
        throw new ApiError('validation', 'Название страницы — не короче 3 символов');
      }
      if (
        K().pages.some((p) => p.space === spaceId && p.title.toLowerCase() === name.toLowerCase())
      ) {
        throw new ApiError(
          'validation',
          'В разделе «' + sp.name + '» уже есть страница «' + name + '»',
        );
      }
      const access = s.access === 'owner' ? 'owner' : 'all';
      if (access === 'owner' && !isKbOwner(db, me())) {
        throw new ApiError(
          'validation',
          'Страницу «Только владелец» может создать только владелец',
        );
      }
      const body = String(s.body ?? '').trim();
      if (!body) throw new ApiError('validation', 'Текст страницы пустой');
      const t = s.table
        ? { title: tableTitle(s.table.title), cols: checkColumns(s.table.columns) }
        : null;
      const id = nid('kb-');
      K().pages.push(
        kbNode(id, sp.id, null, nextPos(sp.id, null), 'page', name, {
          owner: me(),
          access,
          // KB-07: «Только владелец» → «Только выбранные».
          mode: access === 'owner' ? 'listed' : 'inherit',
          versions: [{ v: 1, at: today(), by: meName(), body }],
        }),
      );
      let table: { id: string; columns: string[] } | null = null;
      if (t) {
        const row = {
          id: nid('kt-'),
          page: id,
          title: t.title,
          columns: t.cols.map((c) => ({ id: nid('c-'), name: c.name, type: c.type ?? 'text' })),
          rows: [],
        };
        (K().tables ??= []).push(row);
        table = { id: row.id, columns: row.columns.map((c) => c.id) };
      }
      ctx.emit(
        'В разделе «' +
          sp.name +
          '» создана страница «' +
          name +
          '»' +
          (t ? ' с таблицей «' + t.title + '»' : ''),
        owners(),
      );
      return { id, table };
    },

    createKbTable(pageId, spec) {
      assertActive();
      const p = nodeOf(K(), pageId);
      if (!p || !acc(p).view) throw new ApiError('not_found', 'Страница не найдена');
      if (!acc(p).edit) throw new ApiError('forbidden', 'Нет права править «' + p.title + '»');
      const name = tableTitle(spec?.title);
      const T = (K().tables ??= []);
      if (T.some((x) => x.page === pageId && x.title.toLowerCase() === name.toLowerCase())) {
        throw new ApiError('validation', 'На странице уже есть таблица «' + name + '»');
      }
      const cols = checkColumns(spec?.columns).map((c) => ({
        id: nid('c-'),
        name: c.name,
        type: c.type ?? 'text',
      }));
      const t = { id: nid('kt-'), page: pageId, title: name, columns: cols, rows: [] };
      T.push(t);
      ctx.emit('На странице «' + p.title + '» создана таблица «' + name + '»', owners());
      return { id: t.id, columns: cols.map((c) => c.id) };
    },
  };
}
