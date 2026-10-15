// Проекция сида домена W0.12 (`createSeed`) в состояние сервера (W0.13). Правила — генератора примеров W0.07
// (`tools/gen/examples-seed.mjs`) и Go-сида W0.06: UUID v5 `ortus:<область>:<id>` (PD-30), членства
// `membership:<организация>:<аккаунт>` в области `platform`, restricted → read_only, blocked → suspended.
// Атрибутов, которых в домене нет (создание организации, канонические права ролей, описания ролей, домашнее
// подразделение групп, настройки модулей, входящие, файл и загрузка «Альты»), сервер берёт из примеров
// контракта (PD-43: примеры — снимки сценарного сервера).
import type { components } from '@ortus/api-client';
import { type Role as DomainRole, rolePermKeys, type Scope as DomainScope } from '@ortus/domain';
import { createSeed, type PilotDb, seedUuid } from '@ortus/domain/seed';

import { contract, example } from '../contract/index.ts';
import { canonicalKeys, DOMAIN_TO_MODULE, INSTALLABLE_KEYS } from './catalog.ts';
import type {
  AccountRow,
  AssignmentRow,
  FileRow,
  GroupRow,
  InvitationRow,
  MemberRow,
  MembershipRow,
  ModuleRow,
  NotificationRow,
  OperatorRow,
  Org,
  RoleRow,
  ScenarioState,
  StorageRow,
  TenantRow,
  TenantStatus,
  UnitRow,
  UploadRow,
} from './state.ts';
import { addMs, DAY, mskEndOfDay, mskStamp } from './time.ts';

type S = components['schemas'];

const SEED_NOW = '2026-10-01T07:30:00Z';
const GiB = 1024 ** 3;

const P = (id: string): string => seedUuid('platform', id);

/** Страница примера `op/ok` как список. */
const items = <T>(op: string): T[] =>
  (example(op, 'ok') as { items?: T[] } | undefined)?.items ?? [];

const STATUS: Readonly<Record<string, TenantStatus>> = {
  trial: 'trial',
  active: 'active',
  restricted: 'read_only',
  suspended: 'suspended',
};

/** Токен приглашения сида: детерминированный, не короче 32 символов (InvitationToken). */
export const invitationToken = (tenant: string, memberProto: string): string =>
  'inv_' + seedUuid(`${tenant}:invitation`, memberProto).replaceAll('-', '');

function subscription(
  t: ReturnType<typeof createSeed>['platform']['tenants'][number],
  priceBook: number,
): S['Subscription'] {
  const trial = t.status === 'trial' || t.status === 'restricted';
  const source = trial ? 'trial' : 'plan';
  const sourceRef = `price-book:v${priceBook}:${t.plan.tier}`;
  const status: S['Subscription']['status'] =
    t.status === 'trial'
      ? 'trialing'
      : t.status === 'restricted'
        ? 'read_only'
        : t.status === 'suspended'
          ? 'past_due'
          : 'active';
  const sub: S['Subscription'] = {
    planKey: t.plan.tier,
    status,
    cancelAtPeriodEnd: false,
    entitlements: [
      { key: 'seats', sourceType: source, sourceRef, value: t.seatsLimit ?? 0 },
      { key: 'storage_quota_bytes', sourceType: source, sourceRef, value: t.quotaGb * GiB },
    ],
    revision: t.plan.version,
  };
  const trialEndsAt = trial ? mskEndOfDay(t.trialEnds) : undefined;
  const periodEndsAt = trial ? undefined : mskEndOfDay(t.plan.paidUntil);
  if (trialEndsAt) sub.trialEndsAt = trialEndsAt;
  if (periodEndsAt) sub.periodEndsAt = periodEndsAt;
  return sub;
}

/** Место: вложения — разбивка без «Прочее», база данных — «Прочее» (getStorageUsage W0.07). */
function storage(db: PilotDb | undefined, usedGb: number): StorageRow {
  const rows = db?.storage?.breakdown ?? [];
  const attachmentsGb = rows.length ? rows.slice(0, -1).reduce((s, [, gb]) => s + gb, 0) : usedGb;
  const databaseGb = rows.length ? (rows.at(-1)?.[1] ?? 0) : 0;
  return {
    committedBytes: Math.round((attachmentsGb + databaseGb) * GiB),
    reservedBytes: 0,
    buckets: {
      attachments: Math.round(attachmentsGb * GiB),
      database: Math.round(databaseGb * GiB),
      versions: 0,
      trash: 0,
    },
    measuredAt: SEED_NOW,
  };
}

/** Область назначения домена → Scope контракта (объектные области кроме проекта этапу 1 не нужны). */
function scopeOf(tenant: string, s: DomainScope): S['Scope'] | undefined {
  const T = (id: string) => seedUuid(tenant, id);
  switch (s.type) {
    case 'tenant':
      return { kind: 'tenant', resourceIds: [], includeDescendants: true };
    case 'self':
      return { kind: 'self', resourceIds: [], includeDescendants: false };
    case 'project':
      return { kind: 'project', resourceIds: [T(s.id)], includeDescendants: false };
    case 'firm':
    case 'region':
      return { kind: 'org_unit', resourceIds: [T(s.id)], includeDescendants: true };
    default:
      return undefined;
  }
}

/** Права и описание ролей «Альты» из примера listRoles/ok — по id прототипа (у «Лотоса» те же шаблоны). */
function exampleRoles(): Map<string, S['Role']> {
  const out = new Map<string, S['Role']>();
  const byUuid = new Map(Object.entries(contract.seedIds['t-alta'] ?? {}).map(([k, v]) => [v, k]));
  for (const r of items<S['Role']>('listRoles')) {
    const proto = byUuid.get(r.id);
    if (proto) out.set(proto, r);
  }
  return out;
}

function roleRow(tenant: string, r: DomainRole, known: Map<string, S['Role']>): RoleRow {
  const ex = known.get(r.id);
  const row: RoleRow = {
    id: seedUuid(tenant, r.id),
    proto: r.id,
    name: r.name,
    description: ex?.description ?? r.name,
    builtIn: r.kind === 'system',
    permissions: r.all ? [] : (ex?.permissions ?? canonicalKeys(rolePermKeys(r))),
    revision: 1,
  };
  if (r.all) row.all = true;
  if (r.professional === 'driver') row.workFunction = 'driver';
  return row;
}

/** Назначения: развёрнутые по участникам назначения группы (`via`) возвращаются группе. */
function assignments(tenant: string, db: PilotDb, createdAt: string): AssignmentRow[] {
  const T = (id: string) => seedUuid(tenant, id);
  const out: AssignmentRow[] = [];
  for (const a of db.assignments) {
    if (out.some((x) => x.proto === a.id)) continue;
    const scope = scopeOf(tenant, a.scope);
    if (!scope) continue;
    const group = a.via ? db.groups.find((g) => a.via?.includes(`«${g.name}»`)) : undefined;
    out.push({
      id: T(a.id),
      proto: a.id,
      principalType: group ? 'group' : 'member',
      principalId: T(group ? group.id : a.member),
      roleId: T(a.role),
      scope,
      validFrom: createdAt,
      state: 'active',
    });
  }
  return out;
}

function members(
  tenant: string,
  db: PilotDb,
  accounts: AccountRow[],
  assigned: AssignmentRow[],
): MemberRow[] {
  const T = (id: string) => seedUuid(tenant, id);
  return db.members.map((m) => {
    const acc = accounts.find((a) => a.email === m.email);
    const groups = db.groups.filter((g) => g.members.includes(m.id)).map((g) => T(g.id));
    const units: string[] = [];
    for (const a of assigned) {
      const mine = a.principalId === T(m.id) || groups.includes(a.principalId);
      const unit = a.scope.kind === 'org_unit' ? a.scope.resourceIds[0] : undefined;
      const firm = db.units.find((u) => T(u.id) === unit)?.type === 'firm';
      if (mine && unit && firm && !units.includes(unit)) units.push(unit);
    }
    const row: MemberRow = {
      id: T(m.id),
      proto: m.id,
      displayName: m.name,
      status: m.status === 'blocked' ? 'suspended' : m.status,
      orgUnitIds: units,
      revision: 1,
      workProfiles: m.function ? [m.function] : [],
    };
    if (acc) row.userId = acc.id;
    if (m.email) row.email = m.email;
    if (acc?.lastLoginAt) row.lastSeenAt = acc.lastLoginAt;
    return row;
  });
}

function modules(db: PilotDb): Record<string, ModuleRow> {
  const spa = example('getModuleSettings', 'ok') as S['ModuleSettings'];
  const out: Record<string, ModuleRow> = {};
  for (const key of INSTALLABLE_KEYS) {
    const domainKey = Object.entries(DOMAIN_TO_MODULE).find(([, v]) => v === key)?.[0] ?? key;
    const st = db.modules[domainKey as keyof PilotDb['modules']];
    const state = st?.enabled ? 'active' : st?.history ? 'read_only' : 'uninstalled';
    const row: ModuleRow = { state, revision: 1, settingsRevision: 1 };
    if (key === 'spa') row.settings = structuredClone(spa);
    out[key] = row;
  }
  out.forms = {
    state: 'active',
    revision: 1,
    settingsRevision: 1,
    settings: {
      moduleKey: 'forms',
      allowPublicForms: true,
      maxPublicUploadBytes: 10 * 1024 * 1024,
      defaultRetentionDays: 365,
    },
  };
  out.tasks = {
    state: 'active',
    revision: 1,
    settingsRevision: 1,
    settings: { moduleKey: 'tasks', allowUnassignedTasks: true },
  };
  return out;
}

function orgOfSeed(
  tenant: TenantRow,
  db: PilotDb,
  accounts: AccountRow[],
  knownRoles: Map<string, S['Role']>,
): Org {
  const proto = tenant.proto;
  const T = (id: string) => seedUuid(proto, id);
  const exGroups = new Map(items<S['Group']>('listGroups').map((g) => [g.id, g]));
  const assigned = assignments(proto, db, tenant.createdAt);
  const people = members(proto, db, accounts, assigned);
  const units: UnitRow[] = db.units.map((u) => ({
    id: T(u.id),
    proto: u.id,
    parentId: u.parent ? T(u.parent) : null,
    name: u.name,
    kind: u.type === 'region' ? 'region' : 'company',
    status: 'active',
    revision: 1,
  }));
  const groups: GroupRow[] = db.groups.map((g) => ({
    id: T(g.id),
    proto: g.id,
    name: g.name,
    description: exGroups.get(T(g.id))?.description ?? '',
    homeUnitId: exGroups.get(T(g.id))?.homeUnitId ?? null,
    memberIds: g.members.map(T),
    revision: 1,
    createdAt: tenant.createdAt,
  }));
  const invitations: InvitationRow[] = people
    .filter((m) => m.status === 'invited' && m.email)
    .map((m) => ({
      id: seedUuid(`${proto}:invitation`, `id:${m.proto}`),
      memberId: m.id,
      email: m.email ?? '',
      status: 'pending',
      expiresAt: addMs(SEED_NOW, 7 * DAY),
      createdAt: SEED_NOW,
      token: invitationToken(proto, m.proto),
    }));
  const org: Org = {
    tenantId: tenant.id,
    proto,
    units,
    members: people,
    groups,
    roles: db.roles.map((r) => roleRow(proto, r, knownRoles)),
    assignments: assigned,
    modules: modules(db),
    invitations,
    notifications: [],
    imports: [],
    files: [],
    uploads: [],
    policyVersion: 1,
  };
  if (proto === 't-alta') seedAltaExamples(org, accounts);
  return org;
}

/** Входящие владельца, файл осмотра Р-208 и его загрузка — снимки примеров «Альты». */
function seedAltaExamples(org: Org, accounts: AccountRow[]): void {
  const owner = accounts.find((a) => a.proto === 'acc-1');
  for (const n of items<S['Notification']>('listMyNotifications')) {
    const row: NotificationRow = {
      accountId: owner?.id ?? '',
      id: n.id,
      kind: n.kind,
      severity: n.severity,
      title: n.title,
      createdAt: n.createdAt,
      readAt: n.readAt ?? null,
    };
    if (n.body) row.body = n.body;
    if (n.object) row.object = n.object;
    if (n.link) row.link = n.link;
    org.notifications.push(row);
  }
  const file = example('getFile', 'ok') as FileRow | undefined;
  const upload = example('getUploadSession', 'ok') as S['UploadSession'] | undefined;
  if (file) org.files.push({ ...file });
  if (file && upload) {
    const row: UploadRow = {
      ...upload,
      requiredSha256: file.sha256,
      contentType: file.contentType,
    };
    org.uploads.push(row);
  }
}

/** Свежее состояние из сида домена W0.12. */
export function createScenarioStateFromSeed(): ScenarioState {
  const seed = createSeed();
  const P0 = seed.platform;
  const created = new Map(
    items<S['Tenant']>('listPlatformTenants').map((t) => [t.id, t.createdAt]),
  );
  const accounts: AccountRow[] = P0.accounts.map((a) => {
    const row: AccountRow = {
      id: P(a.id),
      proto: a.id,
      displayName: a.name,
      email: a.email,
      status: a.status,
    };
    const at = mskStamp(a.lastLogin);
    if (at) row.lastLoginAt = at;
    return row;
  });
  const operators: OperatorRow[] = P0.operators.map((o) => ({
    id: P(o.id),
    accountId: P(`account:${o.id}`),
    proto: o.id,
    displayName: o.name,
    email: o.email,
    role: o.role,
    status: o.status,
  }));
  const tenants: TenantRow[] = P0.tenants.map((t) => {
    const db = seed.dbs[t.id as keyof typeof seed.dbs] as PilotDb | undefined;
    return {
      id: P(t.id),
      proto: t.id,
      name: t.name,
      status: STATUS[t.status] ?? 'active',
      createdAt: created.get(P(t.id)) ?? SEED_NOW,
      revision: 1,
      subscription: subscription(t, P0.priceBook.current),
      storage: storage(db, t.usedGb),
      storageChanges: [],
    };
  });
  const knownRoles = exampleRoles();
  const orgs: Record<string, Org> = {};
  for (const t of tenants) {
    const db = seed.dbs[t.proto as keyof typeof seed.dbs] as PilotDb | undefined;
    if (db) orgs[t.id] = orgOfSeed(t, db, accounts, knownRoles);
  }
  const memberships: MembershipRow[] = [];
  for (const a of P0.accounts) {
    for (const m of a.memberships) {
      const tenant = tenants.find((t) => t.proto === m.tenantId);
      if (!tenant) continue;
      const member = orgs[tenant.id]?.members.find((x) => x.userId === P(a.id));
      const row: MembershipRow = {
        id: P(`membership:${m.tenantId}:${a.id}`),
        tenantId: tenant.id,
        accountId: P(a.id),
        status: m.status,
        owner: Boolean(m.owner),
      };
      if (m.owner) row.ownerSince = tenant.createdAt;
      if (member) row.memberId = member.id;
      memberships.push(row);
    }
  }
  return {
    v: 1,
    clock: SEED_NOW,
    seq: 0,
    accounts,
    operators,
    tenants,
    memberships,
    orgs,
    sessions: {},
    logins: {},
    idempotency: {},
    scenario: null,
  };
}
