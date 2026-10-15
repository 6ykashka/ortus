// Строки состояния → тела контракта (W0.13). Поля — в порядке примеров W0.07; вычисляемые поля (права
// роли «Владелец», число назначений группы, владельцы организации, доступность модулей) считаются здесь.
import type { components } from '@ortus/api-client';

import { contract } from '../contract/index.ts';
import {
  CORE_MODULES,
  INSTALLABLE,
  type InstallableKey,
  INSTALLABLE_KEYS,
  ownerKeys,
} from './catalog.ts';
import type {
  AssignmentRow,
  FileRow,
  GroupRow,
  ImportRow,
  InvitationRow,
  MemberRow,
  NotificationRow,
  Org,
  RoleRow,
  ScenarioState,
  TenantRow,
  UnitRow,
  UploadRow,
} from './state.ts';

type S = components['schemas'];

const GiB = 1024 ** 3;

/** Модули, которые считаются подключёнными (ядро + подключаемые не в состоянии uninstalled/disabled). */
export function installedModules(org: Org): string[] {
  const on = INSTALLABLE_KEYS.filter((k) => {
    const st = org.modules[k]?.state;
    return st === 'active' || st === 'read_only' || st === 'draining';
  });
  return [...CORE_MODULES, ...on];
}

/** Канонические права роли: у роли «все действия» — по подключённым модулям. */
export const rolePermissions = (org: Org, r: RoleRow): string[] =>
  r.all ? ownerKeys(installedModules(org)) : r.permissions;

export const memberDto = (m: MemberRow): S['Member'] =>
  reorder<S['Member']>(
    {
      id: m.id,
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      status: m.status,
      orgUnitIds: [...m.orgUnitIds],
      lastSeenAt: m.lastSeenAt,
      revision: m.revision,
      workProfiles: [...m.workProfiles],
    },
    [],
  );

export const unitDto = (u: UnitRow): S['OrgUnit'] => ({
  id: u.id,
  parentId: u.parentId,
  name: u.name,
  kind: u.kind,
  status: u.status,
  revision: u.revision,
});

export const groupDto = (org: Org, g: GroupRow): S['Group'] => ({
  id: g.id,
  name: g.name,
  description: g.description,
  homeUnitId: g.homeUnitId,
  memberIds: [...g.memberIds],
  hiddenMemberCount: 0,
  assignmentCount: org.assignments.filter(
    (a) => a.principalType === 'group' && a.principalId === g.id,
  ).length,
  revision: g.revision,
  createdAt: g.createdAt,
});

export const roleDto = (org: Org, r: RoleRow): S['Role'] => ({
  id: r.id,
  name: r.name,
  description: r.description,
  builtIn: r.builtIn,
  permissions: [...rolePermissions(org, r)],
  revision: r.revision,
});

export function assignmentDto(a: AssignmentRow): S['Assignment'] {
  const out: S['Assignment'] = {
    id: a.id,
    principalType: a.principalType,
    principalId: a.principalId,
    roleId: a.roleId,
    scope: structuredClone(a.scope),
  } as S['Assignment'];
  if (a.validFrom) out.validFrom = a.validFrom;
  if (a.validUntil) out.validUntil = a.validUntil;
  out.state = a.state;
  return out;
}

export const ownerIds = (s: ScenarioState, tenantId: string): string[] =>
  s.memberships.filter((m) => m.tenantId === tenantId && m.owner).map((m) => m.accountId);

export const tenantDto = (s: ScenarioState, t: TenantRow): S['Tenant'] => ({
  id: t.id,
  name: t.name,
  status: t.status,
  ownerUserIds: ownerIds(s, t.id),
  createdAt: t.createdAt,
  revision: t.revision,
});

/** Последнее значение права подписки (ручные права идут после тарифных и перекрывают их). */
export function entitlement(sub: S['Subscription'], key: string): number | undefined {
  return sub.entitlements.filter((e) => e.key === key).at(-1)?.value;
}

export const seatsLimit = (t: TenantRow): number => entitlement(t.subscription, 'seats') ?? 0;

export const quotaBytes = (t: TenantRow): number =>
  entitlement(t.subscription, 'storage_quota_bytes') ?? 0;

export function storageUsageDto(t: TenantRow): S['StorageUsage'] {
  const st = t.storage;
  const quota = quotaBytes(t);
  const out: S['StorageUsage'] = {
    quotaBytes: quota,
    committedBytes: st.committedBytes,
    reservedBytes: st.reservedBytes,
    buckets: [
      { kind: 'attachments', bytes: st.buckets.attachments },
      { kind: 'database', bytes: st.buckets.database },
      { kind: 'versions', bytes: st.buckets.versions },
      { kind: 'trash', bytes: st.buckets.trash },
      { kind: 'reserved_uploads', bytes: st.reservedBytes },
    ],
    measuredAt: st.measuredAt,
    consistency: 'estimated',
    writeStatus: st.committedBytes + st.reservedBytes >= quota ? 'blocked' : 'allowed',
  };
  if (st.pendingQuotaBytes !== undefined) out.pendingQuotaBytes = st.pendingQuotaBytes;
  if (st.pendingEffectiveAt) out.pendingEffectiveAt = st.pendingEffectiveAt;
  return out;
}

/** Занятое место в ГБ (ГиБ) с точностью до 0,1 — для текстов. */
export const usedGb = (t: TenantRow): number =>
  Math.round((t.storage.committedBytes / GiB) * 10) / 10;

const SCOPE_KIND: Readonly<Record<string, S['Permission']['allowedScopeKinds'][number]>> = {
  tenant: 'tenant',
  unit: 'org_unit',
  project: 'project',
  self: 'self',
  resource: 'resource_pool',
};

const SENSITIVITY: Readonly<Record<string, S['Permission']['sensitivity']>> = {
  sensitive: 'personal',
  restricted: 'financial',
};

/** Манифест подключаемого модуля по каталогу прав (`manifest()` генератора W0.07). */
export function manifestDto(
  key: InstallableKey,
  state: S['ModuleManifest']['state'],
  revision: number,
): S['ModuleManifest'] {
  const m = contract.permissions.modules[INSTALLABLE[key]];
  const actions = contract.permissions.actions.filter((a) => a.module === INSTALLABLE[key]);
  return {
    moduleKey: key,
    version: '1.0.0',
    name: m?.label ?? key,
    dependencies: (m?.dependsOn ?? []).map((d) => d.replace(/^core\./, '')),
    permissions: actions.map((a) => ({
      key: a.key,
      moduleKey: key,
      description: a.label,
      allowedScopeKinds: [
        ...new Set(a.scopes.map((sc) => SCOPE_KIND[sc]).filter((x) => x !== undefined)),
      ],
      sensitivity: SENSITIVITY[a.sensitivity ?? ''] ?? 'standard',
    })),
    datasets: [],
    state,
    revision,
  };
}

export const invitationDto = (i: InvitationRow): S['Invitation'] => ({
  id: i.id,
  email: i.email,
  status: i.status,
  expiresAt: i.expiresAt,
});

export const fileDto = (f: FileRow): S['File'] => ({
  id: f.id,
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  status: f.status,
  createdAt: f.createdAt,
});

export const uploadDto = (u: UploadRow): S['UploadSession'] => ({
  uploadId: u.uploadId,
  fileId: u.fileId,
  state: u.state,
  purpose: u.purpose,
  owner: { ...u.owner },
  sizeBytes: u.sizeBytes,
  reservedBytes: u.reservedBytes,
  ticketExpiresAt: u.ticketExpiresAt,
  sessionExpiresAt: u.sessionExpiresAt,
  fileStatus: u.fileStatus,
  createdAt: u.createdAt,
});

export function importDto(i: ImportRow): S['PeopleImport'] {
  const out: S['PeopleImport'] = {
    id: i.id,
    state: i.state,
    fileName: i.fileName,
    defaultOrgUnitId: i.defaultOrgUnitId,
    totals: { ...i.totals },
    rows: structuredClone(i.rows),
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    revision: i.revision,
  };
  if (i.committedAt) out.committedAt = i.committedAt;
  return reorder(out, [
    'id',
    'state',
    'fileName',
    'defaultOrgUnitId',
    'totals',
    'rows',
    'createdAt',
    'expiresAt',
    'committedAt',
    'revision',
  ]);
}

export function notificationDto(tenantId: string, n: NotificationRow): S['Notification'] {
  const out: S['Notification'] = {
    id: n.id,
    tenantId,
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
  if (n.body) out.body = n.body;
  if (n.object) out.object = { ...n.object };
  if (n.link) out.link = n.link;
  return reorder(out, [
    'id',
    'tenantId',
    'kind',
    'severity',
    'title',
    'body',
    'createdAt',
    'readAt',
    'object',
    'link',
  ]);
}

/** Копия объекта с ключами в порядке `keys` (остальные — в конце); отсутствующие ключи пропускаются. */
export function reorder<T extends object>(o: T, keys: readonly string[]): T {
  const src = o as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src && src[k] !== undefined) out[k] = src[k];
  for (const [k, v] of Object.entries(src)) if (!(k in out) && v !== undefined) out[k] = v;
  return out as T;
}
