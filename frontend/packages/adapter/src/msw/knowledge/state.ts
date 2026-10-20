// «База знаний» сценарного сервера (W4.04, контрактный PR 3 этапа 4; W4.31, W4.32): срез БЗ организации — БД домена
// W4.30 (`@ortus/domain/modules`, стадия сида `knowledge` с ролями пространств), команды и проверки доступа домена
// (`knowledgeCommands`, `kbAccess`, `kbView`), проекция в схемы контракта. Роли и назначения пространств живут только
// здесь: access API их не отдаёт (Q-W4.00-knowledge-21, Q-W4.30-16 вариант б), шлюз берёт их ключи для x-scope БЗ
// (`registerScopedKeys`). Отличия от Go-модуля W4.31 — в отчёте W4.04: люди и роли среза — снимок сида при первом
// обращении (статус участника берётся из состояния сервера), id новых объектов — `<префикс>w<N>`.
import type { components } from '@ortus/api-client';
import {
  ACCESS,
  ApiError,
  type Clock,
  ddmmyyyy,
  type DomainEvent,
  type IdGen,
  type ModuleCtx,
  type TaskPort,
} from '@ortus/domain';
import {
  createKnowledgeModule,
  createPilotModules,
  kbAccess,
  kbAreaLabel,
  kbDval,
  kbEntryHas,
  kbKids,
  kbLeads,
  type KbNode,
  type KbOpts,
  kbPath,
  type KbSectionObject,
  type KbSpace,
  kbSpaceMy,
  type KbTenantDb,
  knowledgeCommands,
  knowledgeHook,
  type KnowledgeApi,
  type KnowledgeSlice,
} from '@ortus/domain/modules';
import { createSeed, FUTURE_STAGE_HOOKS, seedUuid } from '@ortus/domain/seed';

import { contract } from '../contract/index.ts';
import { registerScopedKeys, type TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { Org } from '../core/state.ts';

type S = components['schemas'];

export interface KbState {
  db: KbTenantDb;
  /** Счётчик id новых объектов (`<префикс>w<N>`). */
  seq: number;
  /** Ревизии пространств (KnowledgeSpace.revision) и доступа узлов (KnowledgeNodeAccess.revision). */
  spaceRev: Record<string, number>;
  accessRev: Record<string, number>;
}

type WithKb = Org & { knowledge?: KbState };

/** Роль пространства домена → шаблон роли каталога (KB-02: без «Автора»). */
export const ROLE_TEMPLATE: Readonly<Record<string, S['KnowledgeSpaceRole']['role']>> = {
  'r-kb-lead': 'kb_space_lead',
  'r-kb-editor': 'kb_space_editor',
  'r-kb-reader': 'kb_space_reader',
};
export const TEMPLATE_ROLE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ROLE_TEMPLATE).map(([k, v]) => [v, k]),
);

/**
 * Объекты ремонта «Альты» эталона (extra-data.js:81–101, design-2026-10-19) — то, что БЗ читает из `repair.objects`:
 * связь «прораб объекта» (KB-01) и правило «Раздел объекта». Модуля «Ремонт и стройка» в домене до этапа 6 нет
 * (`db.repair` сида пуст), поэтому срез БЗ сценарного сервера получает их здесь; с модулем этапа 6 — из его сида.
 */
type RepairObject = KbSectionObject & { stage: string };
const ALTA_REPAIR_OBJECTS: readonly RepairObject[] = [
  {
    id: 'obj-42',
    name: 'ЖК Речной · квартира 42',
    address: 'Москва, ул. Речная, 5, кв. 42',
    stage: 'Черновая отделка',
    area: '51 м², 2 комнаты',
    kind: 'капитальный ремонт',
    contract: 'договор № 42',
    due: '27.11',
    client: 'Ольга Смирнова',
    foreman: 'Алексей Соколов',
    access: [
      ['door_front', 'Подъезд 2, этаж 9, домофон 42К'],
      ['elevator', 'Грузовой лифт до 20:00, материалы заносить со двора'],
      ['key', 'Ключи у прораба, запасной комплект в офисе'],
      ['volume_up', 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00'],
    ],
  },
  {
    id: 'obj-38',
    name: 'ЖК Северный парк · квартира 117',
    address: 'Москва, Дмитровское ш., 107к2, кв. 117',
    stage: 'Чистовая отделка',
    area: '74 м², 3 комнаты',
    kind: 'капитальный ремонт',
    contract: 'договор № 38',
    due: '17.10',
    client: 'Игорь Лебедев',
    foreman: 'Алексей Соколов',
    access: [
      ['door_front', 'Подъезд 1, этаж 14, домофон 117В'],
      ['elevator', 'Грузовой лифт по записи у консьержа'],
      ['key', 'Ключи у консьержа под подпись'],
      ['volume_up', 'Шумные работы: будни 10:00–19:00'],
    ],
  },
  {
    id: 'obj-31',
    name: 'Профсоюзная, 64 · квартира 210',
    address: 'Москва, Профсоюзная ул., 64к1, кв. 210',
    stage: 'Чистовая отделка',
    area: '38 м², 1 комната',
    kind: 'косметический ремонт',
    contract: 'договор № 31',
    due: '09.10',
    client: 'Наталья Осипова',
    foreman: 'Алексей Соколов',
    access: [
      ['door_front', 'Подъезд 3, этаж 5, код домофона 210'],
      ['key', 'Ключи у заказчика, встреча по звонку'],
    ],
  },
  {
    id: 'obj-45',
    name: 'Кофейня на Покровке',
    address: 'Москва, ул. Покровка, 17, стр. 1',
    stage: 'Подготовка',
    area: '64 м², зал и кухня',
    kind: 'коммерческий ремонт',
    contract: 'договор № 45',
    due: '20.12',
    client: 'ООО «Зерно»',
    foreman: null,
    access: [
      ['door_front', 'Вход со двора, ворота открывает управляющий'],
      ['volume_up', 'Шумные работы: будни 9:00–19:00, по согласованию с управляющей компанией'],
    ],
  },
  {
    id: 'obj-27',
    name: 'Дом на Лесной · Мытищи',
    address: 'Мытищи, ул. Лесная, 14',
    stage: 'Сдан',
    area: '142 м², 2 этажа',
    kind: 'ремонт под ключ',
    contract: 'договор № 27',
    due: '15.09',
    client: 'Андрей Кузнецов',
    foreman: 'Алексей Соколов',
    access: [['key', 'Ключи переданы заказчику 12.09']],
  },
  {
    id: 'obj-50',
    name: 'Дом 120 м², Истра',
    address: 'Истра, ул. Садовая, 8',
    stage: 'Замер',
    area: '120 м², 2 этажа',
    kind: 'ремонт под ключ',
    client: 'Сергей Павлов',
    foreman: null,
    access: [
      ['key', 'Ключи у заказчика, выезд по звонку'],
      ['local_parking', 'Парковка у ворот, въезд для грузовой машины'],
    ],
  },
];

/** Срез БЗ организации из сида домена с установленной «Базой знаний» (W4.30, Q-W4.30-16). */
export function seedKb(org: Org): KbState {
  const seed = createSeed({
    modules: [...createPilotModules(), createKnowledgeModule()],
    hooks: { ...FUTURE_STAGE_HOOKS, knowledge: knowledgeHook },
  });
  const db = (seed.dbs as Record<string, KbTenantDb | undefined>)[org.proto];
  if (!db) throw new Error(`нет БД организации ${org.proto} в сиде`);
  const withRepair = db as { repair?: { objects?: RepairObject[] } };
  if (org.proto === 't-alta' && !withRepair.repair?.objects?.length) {
    withRepair.repair = { objects: structuredClone([...ALTA_REPAIR_OBJECTS]) };
  }
  return { db, seq: 0, spaceRev: {}, accessRev: {} };
}

/** Срез БЗ организации (сид при первом обращении). */
export function kbOf(org: Org): KbState {
  const x = org as WithKb;
  x.knowledge ??= seedKb(org);
  return x.knowledge;
}

// ---------------------------------------------------------------------------------------------
// Время: даты домена (Москва) → моменты UTC контракта.

/** `ДД.ММ.ГГГГ`, `ДД.ММ ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ` по Москве → момент UTC; год без года — 2026. */
export function instant(s: string | undefined): string {
  const m = /^(\d\d)\.(\d\d)(?:\.(\d{4}))?(?:\s+(\d\d):(\d\d))?/.exec(s ?? '');
  if (!m) return '2026-10-01T07:30:00Z';
  const [, dd, mm, yyyy = '2026', hh = '00', mi = '00'] = m;
  const ms = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) - 3, Number(mi));
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** `ДД.ММ.ГГГГ` → `ГГГГ-ММ-ДД`; иначе null. */
export function isoDate(s: string | undefined): string | null {
  const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ---------------------------------------------------------------------------------------------
// Вид участника

export interface KbView {
  t: TenantAccess;
  k: KbState;
  db: KbTenantDb;
  K: KnowledgeSlice;
  /** Участник домена (id прототипа). */
  me: string;
  opts: KbOpts;
  clock: Clock;
  /** id прототипа → UUID организации. */
  U(id: string): string;
  /** UUID → id прототипа (или undefined). */
  P(uuid: string | undefined): string | undefined;
  cmds: KnowledgeApi;
  /** Команда домена: ApiError → Problem контракта. */
  run<T>(f: () => T): T;
}

const STATUS: Readonly<Record<string, 'active' | 'invited' | 'blocked'>> = {
  active: 'active',
  invited: 'invited',
  suspended: 'blocked',
  ended: 'blocked',
};

/** Статусы людей среза — из состояния сервера (блокировка участника действует и в БЗ). */
function syncMembers(org: Org, db: KbTenantDb): void {
  for (const m of db.members) {
    const row = org.members.find((x) => x.proto === m.id);
    if (row) m.status = STATUS[row.status] ?? m.status;
  }
}

const silentEmit = (): DomainEvent => ({ id: '', at: '', text: '', to: [], sensitive: null });

/** Ошибка домена → Problem контракта (тексты эталона — в detail). */
export function domainFail(e: unknown): never {
  if (!(e instanceof ApiError)) throw e;
  switch (e.code) {
    case 'not_found':
      return fail('not_found', e.message);
    case 'forbidden':
      return fail('forbidden_action', e.message);
    case 'conflict':
      return fail('revision_mismatch', e.message);
    case 'subscription_restricted':
      return fail('tenant_read_only', e.message);
    default:
      return fail('validation_failed', e.message);
  }
}

export function viewOf(ctx: HandlerContext): KbView {
  const t = ctx.org();
  const k = kbOf(t.org);
  const db = k.db;
  syncMembers(t.org, db);
  const K = db.knowledge;
  if (!K?.v2) return fail('not_found', 'База знаний не подключена');
  const clock: Clock = { now: () => new Date(ctx.now()) };
  const opts: KbOpts = { today: ddmmyyyy(clock) };
  const me = t.member?.proto ?? '';
  const U = (id: string): string => seedUuid(t.org.proto, id);
  let index: Map<string, string> | undefined;
  const P = (uuid: string | undefined): string | undefined => {
    if (!uuid) return undefined;
    if (!index) {
      index = new Map();
      const add = (id: string | undefined) => {
        if (id) index?.set(U(id), id);
      };
      for (const x of [...K.spaces, ...K.pages, ...(K.requests ?? []), ...(K.rules ?? [])])
        add(x.id);
      for (const x of [...(K.runs ?? []), ...(K.entries ?? [])]) add(x.id);
      for (const tb of K.tables ?? []) {
        add(tb.id);
        tb.columns.forEach((c) => add(c.id));
        tb.rows.forEach((r) => add(r.id));
      }
      for (const x of [...db.members, ...db.roles, ...(db.groups ?? []), ...db.units]) add(x.id);
      const repair = (db as { repair?: { objects?: { id: string }[] } }).repair;
      for (const o of repair?.objects ?? []) add(o.id);
      add('obj-42');
    }
    return index.get(uuid.toLowerCase());
  };
  const ids: IdGen = {
    next: (prefix: string) => `${prefix}w${++k.seq}`,
    peek: () => k.seq,
  };
  const mctx: ModuleCtx = {
    getDb: () => db,
    getActor: () => me,
    clock,
    ids,
    ApiError,
    can: ACCESS,
    emit: silentEmit,
    tasks: {} as TaskPort,
  };
  const cmds = knowledgeCommands(mctx);
  const run = <T>(f: () => T): T => {
    try {
      const out = f();
      index = undefined;
      return out;
    } catch (e) {
      return domainFail(e);
    }
  };
  return { t, k, db, K, me, opts, clock, U, P, cmds, run };
}

// ---------------------------------------------------------------------------------------------
// Поиск объектов по UUID пути (недоступное — как отсутствующее, 404)

export function spaceOr404(v: KbView, id: string | undefined): KbSpace {
  const proto = v.P(id);
  const sp = v.K.spaces.find((s) => s.id === proto);
  if (!sp || !spaceVisible(v, sp)) return fail('not_found', 'Пространство не найдено');
  return sp;
}

export function nodeOr404(v: KbView, id: string | undefined): KbNode {
  const proto = v.P(id);
  const n = v.K.pages.find((p) => p.id === proto);
  if (!n || !kbAccess(v.db, v.me, n, v.opts).view) {
    return fail('not_found', 'Страница не найдена или недоступна');
  }
  return n;
}

/** Пространство видно: роль области или пространства, или хотя бы одна видимая страница (kbView). */
export function spaceVisible(v: KbView, sp: KbSpace): boolean {
  if (kbSpaceMy(v.db, v.me, sp, v.opts).view) return true;
  return v.K.pages.some((p) => p.space === sp.id && kbAccess(v.db, v.me, p, v.opts).view);
}

export const isLead = (v: KbView, sp: KbSpace): boolean => kbSpaceMy(v.db, v.me, sp, v.opts).lead;

export const LEAD_ONLY = 'Это может руководитель пространства или владелец бизнеса';

export function needLead(v: KbView, sp: KbSpace): void {
  if (!isLead(v, sp)) fail('forbidden_action', LEAD_ONLY);
}

// ---------------------------------------------------------------------------------------------
// Проекция в схемы контракта

const MODE: Readonly<Record<string, S['KnowledgeNode']['accessMode']>> = {
  inherit: 'inherit',
  edit: 'edit_listed',
  listed: 'listed',
};
export const modeOf = (n: KbNode): S['KnowledgeNode']['accessMode'] =>
  MODE[n.mode ?? 'inherit'] ?? 'inherit';
export const domainMode = (m: string): 'inherit' | 'edit' | 'listed' =>
  m === 'edit_listed' ? 'edit' : m === 'listed' ? 'listed' : 'inherit';

const lastVersion = (n: KbNode) =>
  n.versions[n.versions.length - 1] ?? { v: 1, at: '', by: '', body: '' };

/** Узлы пространства в глубину по позициям (без архива). */
export function treeOrder(K: KnowledgeSlice, spaceId: string): KbNode[] {
  const out: KbNode[] = [];
  const walk = (parent: string | null) => {
    for (const n of kbKids(K, parent).filter((x) => x.space === spaceId)) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

const memberName = (db: KbTenantDb, id: string | undefined): string =>
  db.members.find((m) => m.id === id)?.name ?? '';

export function spaceDto(v: KbView, sp: KbSpace): S['KnowledgeSpace'] {
  const my = kbSpaceMy(v.db, v.me, sp, v.opts);
  const visible = v.K.pages.filter(
    (p) => p.space === sp.id && !p.archived && kbAccess(v.db, v.me, p, v.opts).view,
  );
  const home = v.K.pages.find(
    (p) => p.space === sp.id && !p.parent && p.title === 'Обзор' && !p.archived,
  );
  const area = kbAreaLabel(v.db, sp);
  const out: S['KnowledgeSpace'] = {
    id: v.U(sp.id),
    name: sp.name,
    icon: sp.icon ?? 'menu_book',
    color: sp.color ?? '#2B5479',
    orgUnitId: sp.unit ? v.U(sp.unit) : null,
    areaLabel: area.charAt(0).toUpperCase() + area.slice(1),
    access: sp.access ?? 'closed',
    templateKey: sp.template ?? null,
    homeNodeId: home ? v.U(home.id) : null,
    my: {
      owner: my.owner,
      lead: my.lead,
      view: my.view,
      create: my.create,
      edit: my.edit,
      role: my.role,
    },
    leadNames: kbLeads(v.db, sp, v.opts).map((m) => m.name),
    pageCount: visible.filter((p) => (p.kind ?? 'page') !== 'folder').length,
    revision: v.k.spaceRev[sp.id] ?? 1,
  };
  const last = visible
    .filter((p) => (p.kind ?? 'page') !== 'folder')
    .map((p) => ({ p, at: instant(lastVersion(p).at) }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.p.title.localeCompare(b.p.title, 'ru'))[0];
  if (last) out.lastUpdate = { nodeId: v.U(last.p.id), title: last.p.title, at: last.at };
  if (my.lead) {
    out.openRequestCount = (v.K.requests ?? []).filter(
      (r) => r.space === sp.id && r.status === 'open',
    ).length;
  }
  return out;
}

export function nodeMy(v: KbView, n: KbNode): S['KnowledgeNodeMy'] {
  const a = kbAccess(v.db, v.me, n, v.opts);
  return { edit: a.edit, lead: a.lead, create: a.create };
}

export function nodeSummary(v: KbView, n: KbNode): S['KnowledgeNodeSummary'] {
  return {
    id: v.U(n.id),
    spaceId: v.U(n.space),
    parentId: n.parent ? v.U(n.parent) : null,
    position: n.pos ?? 0,
    kind: n.kind ?? 'page',
    title: n.title,
    status: n.status ?? 'active',
    accessMode: modeOf(n),
    sensitivity: n.sensitivity === 'finance' ? 'finance' : 'normal',
    archived: Boolean(n.archived),
    version: lastVersion(n).v,
    my: nodeMy(v, n),
  };
}

const versionDto = (n: KbNode, ver: KbNode['versions'][number]): S['KnowledgeVersion'] => ({
  version: ver.v,
  publishedAt: instant(ver.at),
  authorDisplayName: ver.by,
  body: ver.body,
});

/** Аудитория ознакомления узла (как `audience` команд домена). */
function audience(v: KbView, n: KbNode, sp: KbSpace): string[] {
  const a = n.ack?.audience;
  if (!a) return [];
  return v.db.members
    .filter(
      (m) =>
        m.status === 'active' &&
        kbAccess(v.db, m.id, n, v.opts).view &&
        (a.who === 'all' || kbEntryHas(v.db, m.id, a, sp)),
    )
    .map((m) => m.id);
}
export function ackDto(v: KbView, n: KbNode): S['KnowledgeAck'] | undefined {
  const ack = n.ack;
  if (!ack) return undefined;
  const sp = v.K.spaces.find((s) => s.id === n.space);
  if (!sp) return undefined;
  const who = audience(v, n, sp);
  const a = ack.audience;
  const role = a.who === 'role' ? v.db.roles.find((r) => r.id === a.ref)?.name : undefined;
  const out: S['KnowledgeAck'] = {
    version: ack.v,
    audienceLabel: a.who === 'all' ? 'все, кто видит страницу' : `роль «${role ?? a.ref ?? ''}»`,
    mine: { required: who.includes(v.me), done: ack.done.includes(v.me) },
  };
  const acc = kbAccess(v.db, v.me, n, v.opts);
  if (acc.edit || acc.lead) {
    out.total = who.length;
    out.doneCount = who.filter((id) => ack.done.includes(id)).length;
    out.pendingNames = who.filter((id) => !ack.done.includes(id)).map((id) => memberName(v.db, id));
  }
  if (isLead(v, sp)) {
    out.log = (ack.log ?? []).map((l) => ({
      memberId: v.U(l.member),
      displayName: memberName(v.db, l.member),
      version: l.v,
      at: instant(l.at),
    }));
  }
  return out;
}

export function tableDto(
  v: KbView,
  t: NonNullable<KnowledgeSlice['tables']>[number],
): S['KnowledgeTable'] {
  return {
    id: v.U(t.id),
    nodeId: v.U(t.page),
    title: t.title,
    columns: t.columns.map((c) => ({ id: v.U(c.id), name: c.name, type: c.type })),
    rows: t.rows.map((r) => {
      const row: S['KnowledgeTableRow'] = {
        id: v.U(r.id),
        addedAt: instant(r.at),
        cells: Object.fromEntries(Object.entries(r.cells).map(([c, x]) => [v.U(c), x])),
      };
      if (r.src) {
        row.source = { formId: v.U(r.src.form), responseNumber: r.src.resp, formVersion: r.src.fv };
      }
      return row;
    }),
  };
}

export function nodeDto(v: KbView, n: KbNode): S['KnowledgeNode'] {
  const sp = v.K.spaces.find((s) => s.id === n.space);
  const path = kbPath(v.K, n).slice(0, -1);
  const versions = [...n.versions].sort((a, b) => b.v - a.v);
  const out: S['KnowledgeNode'] = {
    ...nodeSummary(v, n),
    spaceName: sp?.name ?? '',
    path: path.map((x) => ({ id: v.U(x.id), title: x.title })),
    owner: {
      memberId: n.owner ? v.U(n.owner) : null,
      displayName: memberName(v.db, n.owner),
    },
    reviewBy: isoDate(n.reviewBy),
    current: versionDto(n, lastVersion(n)),
    versions: versions.map((x) => ({
      version: x.v,
      publishedAt: instant(x.at),
      authorDisplayName: x.by,
    })),
    tables: (v.K.tables ?? []).filter((t) => t.page === n.id).map((t) => tableDto(v, t)),
    entries: (v.K.entries ?? [])
      .filter((e) => e.page === n.id)
      .map((e) => ({
        id: v.U(e.id),
        nodeId: v.U(e.page),
        addedAt: instant(e.at),
        head: e.head,
        lines: e.lines.map((l) => ({ name: l.name, value: l.value })),
        source: { formId: v.U(e.src.form), responseNumber: e.src.resp, formVersion: e.src.fv },
      })),
    revision: lastVersion(n).v,
  };
  const ack = ackDto(v, n);
  if (ack) out.ack = ack;
  if (n.kind === 'diagram' && n.diagram) {
    out.diagram = {
      steps: [...n.diagram.steps],
      outcomes: n.diagram.out.map(([text, tone]) => ({
        text,
        tone: tone === 'warn' ? 'warn' : 'ok',
      })),
    };
  }
  if (n.kind === 'file' && n.file) out.file = { sizeLabel: n.file.size, pages: n.file.pages };
  if (n.kind === 'link' && n.link) {
    out.link = { label: n.link.label, moduleKey: n.link.go, icon: n.link.icon };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Гранты ролей пространства для шлюза: x-scope БЗ засчитывает назначения space/page участника.

/** Ключи ролей пространства и страницы участника (срез БЗ его организации; срок назначения — PD-60). */
export function kbScopedKeys(t: TenantAccess, opScope: string, now: string): string[] {
  if (!opScope.startsWith('knowledge-') || !t.member) return [];
  const k = kbOf(t.org);
  const me = t.member.proto;
  const today = kbDval(ddmmyyyy({ now: () => new Date(now) }));
  const out = new Set<string>();
  for (const a of k.db.assignments) {
    if (a.member !== me || (a.scope.type !== 'space' && a.scope.type !== 'page')) continue;
    if (a.until && kbDval(a.until) < today) continue;
    const tpl = ROLE_TEMPLATE[a.role];
    if (!tpl) continue;
    for (const key of contract.permissions.roleTemplates[tpl]?.actions ?? []) out.add(key);
  }
  return [...out];
}
registerScopedKeys(kbScopedKeys);
