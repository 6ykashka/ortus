// Общий срез этапа 7 сценарного сервера (W7.00, контрактный PR этапа 7): БД организации домена со стадиями сида
// `service` (W7.30) и `chats` (W7.10) — их читают модули «Чаты» и «Обращения» (в одной БД: чат записи ссылается на
// объект ремонта, обращение — на проект задач). Роли и назначения этих модулей живут только здесь: access API их
// не отдаёт (шлюзу их ключи даёт `registerScopedKeys`, PD-53). Документы — отдельная модель (`msw/docs`): барреля
// `@ortus/domain/modules` для них ещё нет (интегратор, W7.21).
import {
  ACCESS,
  ApiError,
  type Clock,
  type DomainEvent,
  type IdGen,
  type ModuleCtx,
  rolePermKeys,
  type TaskPort,
} from '@ortus/domain';
import {
  chatsHook,
  createPilotModules,
  repairModule,
  serviceHook,
  SVC_BASE,
} from '@ortus/domain/modules';
import { createSeed, FUTURE_STAGE_HOOKS, type PilotDb, seedUuid } from '@ortus/domain/seed';

import { registerScopedKeys, type TenantAccess } from '../core/access.ts';
import { SEED_NOW } from '../core/state.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { Org } from '../core/state.ts';

/** БД организации со срезами `chats` и `service` (типы срезов — у модулей домена). */
export type S7Db = PilotDb;

export interface S7State {
  db: S7Db;
  /** chats.now сида: минуты от 01.10.2026 00:00 на момент «сейчас» сида. */
  chatBase: number;
  /** Счётчик id новых объектов (`<префикс>w<N>`). */
  seq: number;
  /** Ревизии чатов (ETag), источников и политик видов. */
  chatRev: Record<string, number>;
  srcRev: Record<string, number>;
  policyRev: Record<string, number>;
  /** Удержания и выгрузки чатов (в домене их нет). */
  holds: ChatHoldRow[];
  exports: ChatExportRow[];
  /** Ревизии обращений (ETag). */
  reqRev: Record<string, number>;
  /** Черновики направлений (настройка: в домене только опубликованная версия), загрузки и отказы портала. */
  drafts: Record<string, { body: unknown; revision: number; updatedAt: string }>;
  portalUploads: {
    uploadId: string;
    fileId: string;
    token: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
  }[];
  optOut: string[];
  csat: Record<string, { score: number; at: string }>;
}

export interface ChatHoldRow {
  id: string;
  scope: 'chat' | 'member' | 'period';
  chatId: string | null;
  memberIds: string[];
  from: string | null;
  to: string | null;
  reason: string;
  until: string | null;
  by: string;
  at: string;
  status: 'active' | 'released';
}

export interface ChatExportRow {
  id: string;
  chatId: string;
  format: 'csv' | 'json';
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: string;
  by: string;
}

type WithS7 = Org & { stage7?: S7State };

/** Организации сида: «Альта» и «Лотос»; у «Лотоса» обращений нет (`service: null`). */
export function stage7Of(org: Org): S7State {
  const x = org as WithS7;
  if (!x.stage7) {
    const seed = createSeed({
      modules: [...createPilotModules(), repairModule],
      hooks: { ...FUTURE_STAGE_HOOKS, service: serviceHook, chats: chatsHook },
    });
    const db = (seed.dbs as Record<string, S7Db | undefined>)[org.proto];
    if (!db) throw new Error(`нет БД организации ${org.proto} в сиде`);
    // Чаты записей (рейс, объект) видны, когда модуль записи подключён: на стенде показа «Логистика» и «Ремонт и
    // стройка» «Альты» подключены (в сиде домена они выключены до пресета).
    if (org.proto === 't-alta') {
      const mods = db.modules as Record<string, { enabled?: boolean } | undefined>;
      for (const k of ['logistics', 'repair']) mods[k] = { ...mods[k], enabled: true };
    }
    x.stage7 = {
      db,
      chatBase: (db as { chats?: { now: number } }).chats?.now ?? 630,
      seq: 0,
      chatRev: {},
      srcRev: {},
      policyRev: {},
      holds: [],
      exports: [],
      reqRev: {},
      drafts: {},
      portalUploads: [],
      optOut: [],
      csat: {},
    };
  }
  return x.stage7;
}

const STATUS: Readonly<Record<string, 'active' | 'invited' | 'blocked'>> = {
  active: 'active',
  invited: 'invited',
  suspended: 'blocked',
  ended: 'blocked',
};

/** Статусы людей среза — из состояния сервера (блокировка участника действует и в чатах, и в обращениях). */
export function syncMembers(org: Org, db: S7Db): void {
  for (const m of db.members) {
    const row = org.members.find((x) => x.proto === m.id);
    if (row) m.status = STATUS[row.status] ?? m.status;
  }
}

const silentEmit = (): DomainEvent => ({ id: '', at: '', text: '', to: [], sensitive: null });

/** Задачи этапа 4 сценарного сервера в срез не входят: задача чата и обращения — заглушка с id `T-<N>`. */
function taskStub(next: () => number): TaskPort {
  return {
    create: () => ({ id: `T-${next()}` }),
    get: () => undefined,
    update: () => undefined,
    comment: () => undefined,
    statusName: (_p, _c, preferred) => preferred ?? 'Новая',
  };
}

export interface S7Ctx {
  t: TenantAccess;
  s: S7State;
  db: S7Db;
  /** Участник домена (id прототипа). */
  me: string;
  /** id прототипа → UUID организации и обратно. */
  U(id: string): string;
  P(uuid: string | undefined): string | undefined;
  mctx: ModuleCtx;
  clock: Clock;
  /** Часы чатов: минуты от 01.10.2026 00:00 (МСК). */
  chatNow: number;
}

/** 01.10.2026 00:00 по Москве, момент UTC. */
export const CHAT_EPOCH = Date.UTC(2026, 9, 1, 0, 0) - 3 * 3_600_000;

/** Момент UTC из минут чатов. */
export const chatInstant = (min: number): string =>
  new Date(CHAT_EPOCH + min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Момент UTC из миллисекунд Unix домена обращений. */
export const msInstant = (ms: number): string =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Контекст стадий этапа 7 для запроса: часы домена идут от «сейчас» сида. */
export function s7Ctx(
  ctx: HandlerContext,
  index?: Map<string, string>,
  tenant?: TenantAccess,
): S7Ctx {
  const t = tenant ?? ctx.org();
  const s = stage7Of(t.org);
  syncMembers(t.org, s.db);
  const me = t.member?.proto ?? '';
  const U = (id: string): string => seedUuid(t.org.proto, id);
  const elapsed = Date.parse(ctx.now()) - Date.parse(SEED_NOW);
  const clock: Clock = { now: () => new Date(SVC_BASE + elapsed) };
  const ids: IdGen = { next: (prefix: string) => `${prefix}w${++s.seq}`, peek: () => s.seq };
  const mctx: ModuleCtx = {
    getDb: () => s.db,
    getActor: () => me,
    clock,
    ids,
    ApiError,
    can: ACCESS,
    emit: silentEmit,
    tasks: taskStub(() => ++s.seq + 100),
  };
  const idx = index ?? new Map<string, string>();
  const chatNow = s.chatBase + Math.round(elapsed / 60_000);
  return {
    t,
    s,
    db: s.db,
    me,
    U,
    P: (uuid) => (uuid ? idx.get(uuid.toLowerCase()) : undefined),
    mctx,
    clock,
    chatNow,
  };
}

/** Ключи ролей этапа 7 участника: `chat.*`, `docs.*`, `service.*` по назначениям среза (PD-53: любые области). */
export function stage7Keys(t: TenantAccess): string[] {
  if (!t.member) return [];
  const s = stage7Of(t.org);
  const out = new Set<string>();
  for (const a of s.db.assignments) {
    if (a.member !== t.member.proto) continue;
    const role = s.db.roles.find((r) => r.id === a.role);
    if (!role || role.all) continue;
    for (const k of rolePermKeys(role)) out.add(k);
  }
  // «Решать» даёт назначать компенсацию, руководитель направления видит контакты клиентов (docs/22, Q-W4.00-service-4, -6).
  if (out.has('service.requests.resolve')) out.add('service.compensation.manage');
  const dirs = ((s.db as { service?: { directions?: { lead?: string }[] } | null }).service
    ?.directions ?? []) as { lead?: string }[];
  if (dirs.some((d) => d.lead === t.member?.proto)) out.add('service.clients.contacts');
  return [...out].filter((k) => /^(chat|service)\./.test(k));
}

const MY_SCOPES = new Set(['chat', 'service-direction']);
let registered = false;
/** Шлюз получает ключи ролей среза только для операций этапа 7 (остальные запросы срез не поднимают). */
export function registerStage7Keys(): void {
  if (registered) return;
  registered = true;
  registerScopedKeys((t, opScope) => (MY_SCOPES.has(opScope) ? stage7Keys(t) : []));
}
