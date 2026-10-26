// Примеры ответов ядра на сиде прототипа (W0.07, бриф §4.6; этап 1 — examples-stage1.mjs, W0.08).
//   node tools/gen/examples-seed.mjs   — (пере)записать api/openapi/examples/<operationId>/*.json
//                                         и api/openapi/examples/seed-ids.yaml
// Источник данных — выписка из ortus/mock-data.js прототипа 14.10 (ниже, SEED). Идентификаторы
// прототипа → UUID v5 «ortus:<область>:<id>» (PD-30): область — `platform` для организаций,
// аккаунтов и операторов, иначе id организации (`t-alta`); новые объекты примеров — `<тенант>:example`.
// Время сида — 2026-10-01 10:30 МСК (07:30Z). После генерации примеры можно править руками:
// проверка — node tools/gen/contract.mjs --check (ajv по схеме ответа, UUID только из seed-ids.yaml).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from './lib/errors.mjs';
import { stage1Examples } from './examples-stage1.mjs';
import { stage1bExamples } from './examples-w100.mjs';
import { stage2Examples } from './examples-w200.mjs';
import { stage2w240Examples } from './examples-w240.mjs';
import { stage2w251Examples } from './examples-w251.mjs';
import { stage2w252Examples } from './examples-w252.mjs';
import { stage2w257Examples } from './examples-w257.mjs';
import { stage2w271Examples } from './examples-w271.mjs';
import { stage4w402Examples } from './examples-w402.mjs';
import { stage4w403Examples } from './examples-w403.mjs';
import { stage4w404Examples } from './examples-w404.mjs';
import { stage4w405Examples } from './examples-w405.mjs';
import { stage5w500Examples } from './examples-w500.mjs';
import { stage4w406Examples } from './examples-w406.mjs';
import { stage4w480Examples } from './examples-w480.mjs';
import { stage4w407Examples } from './examples-w407.mjs';
import { stage6w600Examples } from './examples-w600.mjs';
import { seedUuid } from './lib/examples.mjs';
import { EXAMPLES_DIR, SEED_IDS_PATH } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { NAMESPACE_URL } from './lib/uuid.mjs';
import { renderJson, renderYaml, writeText } from './lib/yaml-io.mjs';

const GiB = 1024 ** 3;
const NOW = '2026-10-01T07:30:00Z';
const REQUEST_ID = '01J9Z4QK8M6T2V5X7Y9A1B3C5D';

// ---------------------------------------------------------------------------------------------
// Выписка сида прототипа 14.10 (ortus/mock-data.js: baseSeed, seedLotos, platform).
const SEED = {
  tenants: [
    // status прототипа → PLAT-02: restricted (пробный период истёк) → read_only (README v0.2).
    {
      id: 't-alta',
      name: 'Альта Групп',
      status: 'trial',
      owner: 'acc-1',
      createdAt: '2026-09-30T15:12:00Z',
      tier: 'start',
      seatsLimit: 10,
      quotaGb: 100,
      usedGb: 46.2,
      trialEndsAt: '2026-10-13T21:00:00Z',
    },
    {
      id: 't-lotos',
      name: 'SPA «Лотос»',
      status: 'active',
      owner: 'acc-11',
      createdAt: '2026-03-31T09:00:00Z',
      tier: 'team',
      seatsLimit: 25,
      quotaGb: 50,
      usedGb: 12.4,
    },
    {
      id: 't-remstroy',
      name: 'Ремстрой Плюс',
      status: 'read_only',
      owner: 'acc-12',
      createdAt: '2026-09-06T09:00:00Z',
      tier: 'start',
      seatsLimit: 10,
      quotaGb: 25,
      usedGb: 19.8,
    },
    {
      id: 't-cargo',
      name: 'Карго Сити',
      status: 'suspended',
      owner: 'acc-13',
      createdAt: '2026-05-12T08:02:00Z',
      tier: 'team',
      seatsLimit: 25,
      quotaGb: 100,
      usedGb: 63.0,
    },
  ],
  accounts: [
    ['acc-1', 'Дарья Зимина', 'd.zimina@alta.example', 'active', '01.10 09:12', ['t-alta']],
    ['acc-2', 'Марина Котова', 'm.kotova@alta.example', 'active', '01.10 08:40', ['t-alta']],
    ['acc-3', 'Илья Васильев', 'i.vasiliev@alta.example', 'active', '01.10 07:55', ['t-alta']],
    [
      'acc-4',
      'Анна Морозова',
      'a.morozova@alta.example',
      'active',
      '30.09 19:05',
      ['t-alta', 't-lotos'],
    ],
    [
      'acc-5',
      'Алексей Соколов',
      'a.sokolov@alta.example',
      'active',
      '30.09 17:30',
      ['t-alta', 't-remstroy'],
    ],
    ['acc-6', 'Олеся Петрова', 'o.petrova@alta.example', 'pending', null, ['t-alta']],
    ['acc-7', 'Кирилл Громов', 'k.gromov@alta.example', 'active', '14.09 08:02', ['t-alta']],
    [
      'acc-8',
      'Вера Котельникова',
      'v.kotelnikova@alta.example',
      'active',
      '01.10 08:58',
      ['t-alta'],
    ],
    ['acc-9', 'Тимур Ахмедов', 't.akhmedov@alta.example', 'active', '01.10 06:47', ['t-alta']],
    ['acc-10', 'Сергей Ильин', 's.ilyin@alta.example', 'pending', null, ['t-alta']],
    ['acc-11', 'Ирина Белова', 'owner@lotos-spa.example', 'active', '01.10 10:01', ['t-lotos']],
    ['acc-12', 'Павел Орлов', 'p.orlov@remstroy.example', 'active', '20.09 12:44', ['t-remstroy']],
    ['acc-13', 'Денис Шишкин', 'd.shishkin@cargo.example', 'locked', '18.09 23:51', ['t-cargo']],
  ],
  operator: { id: 'op-1', name: 'Евгения Лаптева' },
  alta: {
    regions: [
      ['r-msk', 'Москва'],
      ['r-smr', 'Самара'],
      ['r-spb', 'Санкт-Петербург'],
    ],
    firms: [
      ['f-msk-sever', 'r-msk', 'Север Логистик'],
      ['f-msk-yug', 'r-msk', 'Юг Транс'],
      ['f-msk-vostok', 'r-msk', 'Восток Карго'],
      ['f-msk-centr', 'r-msk', 'Центр Экспресс'],
      ['f-smr-volga', 'r-smr', 'Волга Логистик'],
      ['f-smr-truck', 'r-smr', 'Самара Трак'],
      ['f-smr-zhig', 'r-smr', 'Жигули Карго'],
      ['f-smr-priv', 'r-smr', 'Приволжье Сервис'],
      ['f-spb-neva', 'r-spb', 'Нева Логистик'],
      ['f-spb-baltic', 'r-spb', 'Балтик Транс'],
      ['f-spb-ohta', 'r-spb', 'Охта Карго'],
      ['f-spb-pulk', 'r-spb', 'Пулково Экспресс'],
    ],
    // [id, account, status прототипа, function]
    members: [
      ['m-owner', 'acc-1', 'active', null],
      ['m-kotova', 'acc-2', 'active', null],
      ['m-vasiliev', 'acc-3', 'active', 'driver'],
      ['m-morozova', 'acc-4', 'active', null],
      ['m-sokolov', 'acc-5', 'active', null],
      ['m-petrova', 'acc-6', 'invited', null],
      ['m-gromov', 'acc-7', 'blocked', 'driver'],
      ['m-kotelnikova', 'acc-8', 'active', null],
      ['m-akhmedov', 'acc-9', 'active', 'driver'],
      ['m-ilyin', 'acc-10', 'invited', null],
    ],
    groups: { 'g-disp': 'Диспетчеры Север', 'g-drv': 'Водители Север' },
    // [id, имя, шаблон каталога (role_templates) или '*' — все действия подключённых модулей]
    roles: [
      ['r-owner', 'Владелец бизнеса', '*', true],
      ['r-manager', 'Менеджер логистики', 'logistics_manager', false],
      ['r-driver', 'Водитель', 'driver', false],
      ['r-therapist', 'Массажист', 'therapist', false],
      ['r-foreman', 'Прораб', 'foreman', false],
      ['r-pm', 'Руководитель проекта', 'project_manager', false],
      ['r-approver', 'Согласующий', 'project_approver', false],
      ['r-exec', 'Исполнитель', 'project_executor', false],
      ['r-viewer', 'Наблюдатель', 'project_viewer', false],
    ],
    // [id, принципал (m-… или g-…), роль, область]
    assignments: [
      ['a1', 'm-owner', 'r-owner', { type: 'tenant' }],
      ['ap1', 'm-kotova', 'r-pm', { type: 'project', id: 'fleet' }],
      ['ap2', 'g-drv', 'r-exec', { type: 'project', id: 'fleet' }],
      ['ap3', 'm-kotelnikova', 'r-approver', { type: 'project', id: 'fleet' }],
      ['a2', 'g-drv', 'r-driver', { type: 'firm', id: 'f-msk-sever' }],
      ['a3', 'm-morozova', 'r-therapist', { type: 'self' }],
      ['a4', 'm-sokolov', 'r-foreman', { type: 'self' }],
    ],
    groupMembers: { 'g-drv': ['m-vasiliev', 'm-gromov'], 'g-disp': ['m-kotova', 'm-petrova'] },
    storage: { attachments: 31.4 + 9.8 + 3.1, database: 1.9 },
  },
};

/** Права роли «Массажист» прототипа (spa view/create, calendar view/edit, knowledge view) в каноне. */
const THERAPIST = [
  'spa.appointments.read',
  'spa.appointments.create',
  'calendar.bookings.read',
  'calendar.bookings.manage',
  'knowledge.read',
];

/** Модули и их состояние по организациям (prototype modules + CORE). */
const CORE_MODULES = [
  'tasks',
  'forms',
  'calendar',
  'knowledge',
  'files',
  'data',
  'inventory',
  'cash',
];
const INSTALLED = {
  't-alta': ['spa'],
  't-lotos': ['spa'],
  't-remstroy': ['repairs'],
  't-cargo': ['fleet'],
};
const MODULE_OF_KEY = (k) => {
  const p = k.split('.')[0];
  return (
    {
      members: 'members',
      roles: 'members',
      org_units: 'members',
      modules: 'modules',
      billing: 'modules',
      branding: 'modules', // W4.07: branding.manage — core.modules
    }[p] ?? p
  );
};

// ---------------------------------------------------------------------------------------------
const ids = {};
/** UUID объекта сида с записью в seed-ids.yaml. */
const id = (scope, protoId) => {
  ids[scope] ??= {};
  ids[scope][protoId] = seedUuid(scope, protoId);
  return ids[scope][protoId];
};
const msk = (s) => {
  if (!s) return undefined;
  const [d, t] = s.split(' ');
  const [dd, mm] = d.split('.');
  const [h, m] = t.split(':').map(Number);
  return new Date(Date.UTC(2026, Number(mm) - 1, Number(dd), h - 3, m))
    .toISOString()
    .replace('.000Z', 'Z');
};
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const catalog = loadCatalog();
const actions = flattenActions(catalog);
const registry = loadRegistry();
const templateKeys = (t) =>
  t === 'therapist' ? THERAPIST : [...(catalog.role_templates[t].actions ?? [])];

function installedModules(tenant) {
  return [...CORE_MODULES, ...INSTALLED[tenant]];
}
/** Все действия подключённых модулей организации (владелец). */
function ownerKeys(tenant) {
  const mods = new Set(['members', 'modules', ...installedModules(tenant)]);
  return [...actions.keys()].filter(
    (k) => !k.startsWith('platform.') && !k.startsWith('chat.') && mods.has(MODULE_OF_KEY(k)),
  );
}
const scopeOf = (tenant, s) => {
  if (s.type === 'tenant') return { kind: 'tenant', resourceIds: [], includeDescendants: true };
  if (s.type === 'self') return { kind: 'self', resourceIds: [], includeDescendants: false };
  if (s.type === 'project')
    return { kind: 'project', resourceIds: [id(tenant, s.id)], includeDescendants: false };
  return { kind: 'org_unit', resourceIds: [id(tenant, s.id)], includeDescendants: true };
};
const roleKeys = (tenant, roleId) => {
  const r = SEED.alta.roles.find((x) => x[0] === roleId);
  if (r[2] === '*') return ownerKeys(tenant);
  const keys = templateKeys(r[2]);
  if (roleId === 'r-manager') keys.push('fleet.earnings.read'); // finance.read прототипа
  return keys;
};

function moduleAvailability(tenant, tenantStatus, keys) {
  const installed = new Set(installedModules(tenant));
  const all = [...CORE_MODULES, 'fleet', 'spa', 'repairs'];
  return all.map((m) => {
    if (!installed.has(m))
      return { moduleKey: m, state: 'uninstalled', accessMode: 'none', reason: 'not_installed' };
    const mine = keys.filter((k) => MODULE_OF_KEY(k) === m);
    const write = mine.some((k) => actions.get(k).level !== 'view');
    if (tenantStatus === 'read_only') {
      return {
        moduleKey: m,
        state: 'read_only',
        accessMode: mine.length ? 'read' : 'none',
        reason: 'plan_expired',
      };
    }
    if (!mine.length)
      return { moduleKey: m, state: 'active', accessMode: 'none', reason: 'permission_denied' };
    return {
      moduleKey: m,
      state: 'active',
      accessMode: write ? 'write' : 'read',
      reason: 'available',
    };
  });
}

/** Аккаунты участников вне «Альты» (mock-data.js seedLotos; прораб «Ремстроя» — по прототипу). */
const MEMBER_ACCOUNTS = {
  't-lotos': { 'm-owner': 'acc-11', 'm-morozova': 'acc-4' },
  't-remstroy': { 'm-sokolov': 'acc-5' },
};
const accountOfMember = (tenant, memberProtoId) =>
  tenant === 't-alta'
    ? SEED.alta.members.find((m) => m[0] === memberProtoId)[1]
    : MEMBER_ACCOUNTS[tenant][memberProtoId];
/**
 * Членство control DB (П-15): UUID `membership:<организация>:<аккаунт>`, как в Go-сиде W0.06
 * (cmd/seed/platform.go) и в MSW W0.13, а не id участника в tenant DB.
 */
const membershipId = (tenant, memberProtoId) =>
  id('platform', `membership:${tenant}:${accountOfMember(tenant, memberProtoId)}`);

/** Состояние организации для баннеров оболочки (W1.00, S1-19): статус PLAT-02, конец пробного периода, запись. */
const tenantState = (t) =>
  compact({
    status: t.status,
    trialEndsAt: t.status === 'trial' ? t.trialEndsAt : undefined,
    storageWriteStatus: t.usedGb >= t.quotaGb ? 'blocked' : 'allowed',
  });

function tenantContext(tenant, memberProtoId, grants) {
  const t = SEED.tenants.find((x) => x.id === tenant);
  const keys = [...new Set(grants.flatMap((g) => g.keys))];
  return {
    tenantId: id('platform', tenant),
    name: t.name,
    membershipId: membershipId(tenant, memberProtoId),
    membershipStatus: 'active',
    orgUnitIds: [],
    modules: moduleAvailability(tenant, t.status, keys),
    capabilities: grants.flatMap((g) =>
      g.keys.map((permission) => ({ permission, scope: g.scope })),
    ),
    tenantState: tenantState(t),
  };
}
const grantsOf = (tenant, memberProtoId) => {
  const groups = Object.entries(SEED.alta.groupMembers)
    .filter(([, ms]) => ms.includes(memberProtoId))
    .map(([g]) => g);
  return SEED.alta.assignments
    .filter(([, p]) => p === memberProtoId || groups.includes(p))
    .map(([, , role, scope]) => ({ keys: roleKeys(tenant, role), scope: scopeOf(tenant, scope) }));
};
const account = (accId) => SEED.accounts.find((a) => a[0] === accId);
// userId оператора — accounts.id его аккаунта `account:op-1` (стенд W0.09, dev-вход, MSW W0.13; П-15).
const me = (accId, contexts, operator = false) => ({
  userId: id('platform', operator ? `account:${SEED.operator.id}` : accId),
  displayName: operator ? SEED.operator.name : account(accId)[1],
  platformOperator: operator,
  tenants: contexts,
  permissionVersion: '2026-10-01T07:30:00Z.1',
});
const allTenant = (tenant) => [
  { keys: ownerKeys(tenant), scope: scopeOf(tenant, { type: 'tenant' }) },
];

const problem = (code, detail, extra = {}) => ({
  type: `https://docs.ortus.example/errors/${code}`,
  title: registry.codes[code].title,
  status: registry.codes[code].status,
  code,
  detail,
  requestId: REQUEST_ID,
  ...extra,
  ...(registry.codes[code].retryable ? { retryable: true } : {}),
});

// ---------------------------------------------------------------------------------------------
// Схемы ответов
const tenantDto = (t, patch = {}) => ({
  id: id('platform', t.id),
  name: t.name,
  status: t.status,
  ownerUserIds: [id('platform', t.owner)],
  createdAt: t.createdAt,
  revision: 1,
  ...patch,
});
const ALTA = SEED.tenants[0];
const entitlements = (t, source) => [
  { key: 'seats', sourceType: source, sourceRef: `price-book:v2:${t.tier}`, value: t.seatsLimit },
  {
    key: 'storage_quota_bytes',
    sourceType: source,
    sourceRef: `price-book:v2:${t.tier}`,
    value: t.quotaGb * GiB,
  },
];
const subscription = (patch = {}) => ({
  planKey: 'start',
  status: 'trialing',
  trialEndsAt: ALTA.trialEndsAt,
  cancelAtPeriodEnd: false,
  entitlements: entitlements(ALTA, 'trial'),
  revision: 2,
  ...patch,
});
const memberDto = ([mid, acc, status, fn], patch = {}) => {
  const a = account(acc);
  const units = SEED.alta.assignments
    .filter(
      ([, p, , s]) => (p === mid || SEED.alta.groupMembers[p]?.includes(mid)) && s.type === 'firm',
    )
    .map(([, , , s]) => id('t-alta', s.id));
  return compact({
    id: id('t-alta', mid),
    userId: id('platform', acc),
    displayName: a[1],
    email: a[2],
    status: { blocked: 'suspended' }[status] ?? status,
    orgUnitIds: [...new Set(units)],
    lastSeenAt: msk(a[4]),
    revision: 1,
    workProfiles: fn ? [fn] : [],
    ...patch,
  });
};
const roleDto = ([rid, name, tpl, builtIn], patch = {}) => ({
  id: id('t-alta', rid),
  name,
  description:
    tpl === '*'
      ? 'Все действия подключённых модулей; владение — OwnerBinding'
      : (catalog.role_templates[tpl]?.label ?? name),
  builtIn,
  permissions: roleKeys('t-alta', rid),
  revision: 1,
  ...patch,
});
const assignmentDto = ([aid, principal, role, scope]) => ({
  id: id('t-alta', aid),
  principalType: principal.startsWith('g-') ? 'group' : 'member',
  principalId: id('t-alta', principal),
  roleId: id('t-alta', role),
  scope: scopeOf('t-alta', scope),
  validFrom: '2026-09-30T15:12:00Z',
  state: 'active',
});
const orgUnits = () => [
  ...SEED.alta.regions.map(([uid, name]) => ({
    id: id('t-alta', uid),
    parentId: null,
    name,
    kind: 'region',
    status: 'active',
    revision: 1,
  })),
  ...SEED.alta.firms.map(([uid, parent, name]) => ({
    id: id('t-alta', uid),
    parentId: id('t-alta', parent),
    name,
    kind: 'company',
    status: 'active',
    revision: 1,
  })),
];
const SCOPE_KIND = {
  tenant: 'tenant',
  unit: 'org_unit',
  project: 'project',
  self: 'self',
  resource: 'resource_pool',
};
const SENSITIVITY = { sensitive: 'personal', restricted: 'financial' };
const manifest = (moduleKey, catalogModule, state, revision = 1) => {
  const m = catalog.modules[catalogModule];
  return {
    moduleKey,
    version: '1.0.0',
    name: m.label,
    dependencies: (m.depends_on ?? []).map((d) => d.replace(/^core\./, '')),
    permissions: Object.entries(m.actions).map(([key, a]) => ({
      key,
      moduleKey,
      description: a.label,
      allowedScopeKinds: [...new Set((a.scopes ?? []).map((s) => SCOPE_KIND[s]).filter(Boolean))],
      sensitivity: SENSITIVITY[a.sensitivity] ?? 'standard',
    })),
    datasets: [],
    state,
    revision,
  };
};
const SHA = 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';
const file = (patch = {}) => ({
  id: id('t-alta', 'file-insp-208-front'),
  fileName: 'Р-208 · спереди.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 2457600,
  sha256: SHA,
  status: 'ready',
  createdAt: '2026-10-01T06:05:00Z',
  ...patch,
});
const page = (items) => ({ items, nextCursor: null });
const alta = SEED.alta;

/** operationId → { имя: тело }. */
function build() {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);

  // Context
  add(
    'getMyContext',
    'owner',
    me('acc-1', [tenantContext('t-alta', 'm-owner', allTenant('t-alta'))]),
  );
  add(
    'getMyContext',
    'manager',
    me('acc-2', [tenantContext('t-alta', 'm-kotova', grantsOf('t-alta', 'm-kotova'))]),
  );
  add(
    'getMyContext',
    'driver',
    me('acc-3', [tenantContext('t-alta', 'm-vasiliev', grantsOf('t-alta', 'm-vasiliev'))]),
  );
  add(
    'getMyContext',
    'therapist',
    me('acc-4', [
      tenantContext('t-alta', 'm-morozova', grantsOf('t-alta', 'm-morozova')),
      tenantContext('t-lotos', 'm-morozova', [
        { keys: THERAPIST, scope: scopeOf('t-lotos', { type: 'self' }) },
      ]),
    ]),
  );
  add(
    'getMyContext',
    'foreman',
    me('acc-5', [
      tenantContext('t-alta', 'm-sokolov', grantsOf('t-alta', 'm-sokolov')),
      tenantContext('t-remstroy', 'm-sokolov', [
        { keys: templateKeys('foreman'), scope: scopeOf('t-remstroy', { type: 'self' }) },
      ]),
    ]),
  );
  add('getMyContext', 'operator', me(null, [], true));
  add(
    'getMyContext',
    'owner-lotos',
    me('acc-11', [tenantContext('t-lotos', 'm-owner', allTenant('t-lotos'))]),
  );
  add(
    'getMyContext',
    'session_expired',
    problem('session_expired', 'Сессия истекла. Войдите снова.'),
  );

  // Platform
  add('listPlatformTenants', 'ok', page(SEED.tenants.map((t) => tenantDto(t))));
  add(
    'listPlatformTenants',
    'forbidden_action',
    problem('forbidden_action', 'Раздел доступен только операторам платформы.'),
  );
  const created = {
    id: 't-example-new',
    name: 'Северный ветер',
    status: 'provisioning',
    owner: 'acc-1',
    createdAt: NOW,
  };
  add(
    'createPlatformTenant',
    'ok',
    tenantDto(created, { id: id('platform', 't-example-new'), ownerUserIds: [] }),
  );
  add(
    'createPlatformTenant',
    'validation_failed',
    problem('validation_failed', 'Проверьте поля формы.', {
      violations: [{ field: 'ownerEmail', code: 'format', message: 'Укажите почту владельца' }],
    }),
  );
  add('getPlatformTenant', 'ok', tenantDto(ALTA));
  add('getPlatformTenant', 'not_found', problem('not_found', 'Организация не найдена.'));
  add('updatePlatformTenant', 'ok', tenantDto(SEED.tenants[3], { status: 'active', revision: 2 }));
  add(
    'updatePlatformTenant',
    'revision_mismatch',
    problem('revision_mismatch', 'Данные изменились. Обновите карточку организации и повторите.'),
  );
  add(
    'listPlatformUsers',
    'ok',
    page(
      SEED.accounts.map(([aid, name, email, status, last, tenants]) =>
        compact({
          id: id('platform', aid),
          displayName: name,
          email,
          status: { pending: 'invited', locked: 'suspended' }[status] ?? status,
          lastSeenAt: msk(last),
          tenantCount: tenants.length,
        }),
      ),
    ),
  );
  add(
    'listPlatformUsers',
    'forbidden_action',
    problem('forbidden_action', 'Каталог аккаунтов доступен только операторам платформы.'),
  );
  add('getPlatformSubscription', 'ok', subscription());
  add('getPlatformSubscription', 'not_found', problem('not_found', 'Организация не найдена.'));
  add(
    'updatePlatformSubscription',
    'ok',
    subscription({ trialEndsAt: '2026-10-27T21:00:00Z', revision: 3 }),
  );
  add(
    'updatePlatformSubscription',
    'validation_failed',
    problem('validation_failed', 'Укажите причину изменения.', {
      violations: [
        { field: 'reason', code: 'required', message: 'Причина обязательна: от 5 до 500 символов' },
      ],
    }),
  );

  // Billing
  add('getTenantSubscription', 'ok', subscription());
  add(
    'getTenantSubscription',
    'forbidden_action',
    problem('forbidden_action', 'Подписку видит владелец бизнеса.'),
  );
  add(
    'requestSubscriptionChange',
    'ok',
    subscription({
      planKey: 'team',
      status: 'active',
      trialEndsAt: undefined,
      periodEndsAt: '2027-09-30T21:00:00Z',
      entitlements: entitlements({ ...ALTA, tier: 'team', seatsLimit: 25 }, 'plan'),
      revision: 3,
    }),
  );
  add(
    'requestSubscriptionChange',
    'feature_requires_plan',
    problem(
      'feature_requires_plan',
      'Функция недоступна в тарифе «Старт». Обратитесь к владельцу.',
    ),
  );
  const storage = alta.storage;
  add('getStorageUsage', 'ok', {
    quotaBytes: ALTA.quotaGb * GiB,
    committedBytes: Math.round((storage.attachments + storage.database) * GiB),
    reservedBytes: 0,
    buckets: [
      { kind: 'attachments', bytes: Math.round(storage.attachments * GiB) },
      { kind: 'database', bytes: Math.round(storage.database * GiB) },
      { kind: 'versions', bytes: 0 },
      { kind: 'trash', bytes: 0 },
      { kind: 'reserved_uploads', bytes: 0 },
    ],
    measuredAt: NOW,
    consistency: 'estimated',
    writeStatus: 'allowed',
  });
  add(
    'getStorageUsage',
    'forbidden_action',
    problem('forbidden_action', 'Место организации видит владелец бизнеса.'),
  );
  add('requestStorageChange', 'ok', {
    id: id('t-alta:example', 'storage-change-150'),
    state: 'quoted',
    requestedQuotaBytes: 150 * GiB,
    quoteId: id('t-alta:example', 'storage-quote-150'),
    quoteExpiresAt: '2026-10-01T08:30:00Z',
    recurringCharge: { amountMinor: 150000, currency: 'RUB' },
  });
  add(
    'requestStorageChange',
    'downgrade_below_usage',
    problem(
      'downgrade_below_usage',
      'Новая квота 25 ГБ меньше занятых 46,2 ГБ. Освободите 21,2 ГБ.',
    ),
  );

  // Access
  add('listMembers', 'ok', page(alta.members.map((m) => memberDto(m))));
  add(
    'listMembers',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать участников.'),
  );
  add('inviteMember', 'ok', {
    id: id('t-alta:example', 'inv-testov'),
    email: 'i.testov@alta.example',
    status: 'pending',
    expiresAt: '2026-10-08T07:30:00Z',
  });
  add(
    'inviteMember',
    'validation_failed',
    problem('validation_failed', 'Участник с таким адресом уже есть.', {
      violations: [
        { field: 'email', code: 'already_exists', message: 'Участник с таким адресом уже есть' },
      ],
    }),
  );
  add('getMember', 'ok', memberDto(alta.members[1]));
  add('getMember', 'not_found', problem('not_found', 'Участник не найден.'));
  add('updateMember', 'ok', memberDto(alta.members[6], { status: 'active', revision: 2 }));
  add(
    'updateMember',
    'revision_mismatch',
    problem('revision_mismatch', 'Карточку участника уже изменили. Обновите и повторите.'),
  );
  add('listRoles', 'ok', page(alta.roles.map((r) => roleDto(r))));
  add(
    'listRoles',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать роли.'),
  );
  add('createRole', 'ok', {
    id: id('t-alta:example', 'r-dispatcher'),
    name: 'Диспетчер',
    description: 'Видит машины, рейсы и маршруты своей области',
    builtIn: false,
    permissions: [
      'fleet.vehicles.read',
      'fleet.trips.read',
      'fleet.routes.read',
      'calendar.bookings.read',
    ],
    revision: 1,
  });
  add(
    'createRole',
    'validation_failed',
    problem('validation_failed', 'Укажите название роли.', {
      violations: [{ field: 'name', code: 'required', message: 'Укажите название роли' }],
    }),
  );
  add('getRole', 'ok', roleDto(alta.roles[1]));
  add('getRole', 'not_found', problem('not_found', 'Роль не найдена.'));
  add(
    'deleteRole',
    'invalid_transition',
    problem('invalid_transition', 'Системную роль нельзя удалить.'),
  );
  add(
    'deleteRole',
    'revision_mismatch',
    problem('revision_mismatch', 'Роль уже изменили. Обновите и повторите.'),
  );
  add('updateRole', 'ok', roleDto(alta.roles[2], { name: 'Водитель (Север)', revision: 2 }));
  add(
    'updateRole',
    'separation_of_duties_conflict',
    problem(
      'separation_of_duties_conflict',
      'Роль с функцией «Водитель» не может содержать начисления',
    ),
  );
  add('listAssignments', 'ok', page(alta.assignments.map(assignmentDto)));
  add(
    'listAssignments',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать назначения.'),
  );
  add('createAssignment', 'ok', {
    id: id('t-alta:example', 'a-kotova-manager'),
    principalType: 'member',
    principalId: id('t-alta', 'm-kotova'),
    roleId: id('t-alta', 'r-manager'),
    scope: scopeOf('t-alta', { type: 'firm', id: 'f-msk-sever' }),
    validFrom: NOW,
    state: 'active',
  });
  add(
    'createAssignment',
    'separation_of_duties_conflict',
    problem(
      'separation_of_duties_conflict',
      'Функция «Водитель» несовместима с правом на начисления (правило MVP).',
    ),
  );
  add(
    'revokeAssignment',
    'last_owner_required',
    problem('last_owner_required', 'Нельзя снять роль с последнего владельца'),
  );
  add('listOrgUnits', 'ok', page(orgUnits()));
  add(
    'listOrgUnits',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать структуру.'),
  );
  add('createOrgUnit', 'ok', {
    id: id('t-alta:example', 'f-msk-zapad'),
    parentId: id('t-alta', 'r-msk'),
    name: 'Запад Логистик',
    kind: 'company',
    status: 'active',
    revision: 1,
  });
  add(
    'createOrgUnit',
    'validation_failed',
    problem('validation_failed', 'Укажите название фирмы.', {
      violations: [{ field: 'name', code: 'required', message: 'Укажите название' }],
    }),
  );
  add('getOrgUnit', 'ok', orgUnits()[3]);
  add('getOrgUnit', 'not_found', problem('not_found', 'Подразделение не найдено.'));
  add('updateOrgUnit', 'ok', { ...orgUnits()[3], name: 'Север Логистик · Лобня', revision: 2 });
  add(
    'updateOrgUnit',
    'revision_mismatch',
    problem('revision_mismatch', 'Структуру уже изменили. Обновите и повторите.'),
  );

  // Modules
  add('listModuleCatalog', 'ok', {
    items: [
      manifest('fleet', 'logistics', 'uninstalled'),
      manifest('spa', 'spa', 'active'),
      manifest('repairs', 'repairs', 'uninstalled'),
    ],
  });
  add(
    'listModuleCatalog',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать модули.'),
  );
  add('getModuleInstallation', 'ok', manifest('spa', 'spa', 'active'));
  add('getModuleInstallation', 'not_found', problem('not_found', 'Модуль не найден.'));
  add('setModuleInstallation', 'ok', manifest('fleet', 'logistics', 'active', 2));
  add(
    'setModuleInstallation',
    'revision_mismatch',
    problem('revision_mismatch', 'Состояние модуля уже изменили. Обновите и повторите.'),
  );
  const spaSettings = {
    moduleKey: 'spa',
    cancellationMinutes: 120,
    allowNegativeStock: false,
    defaultTimeZone: 'Europe/Moscow',
  };
  add('getModuleSettings', 'ok', spaSettings);
  add(
    'getModuleSettings',
    'module_not_installed',
    problem('module_not_installed', 'Модуль «Логистика» не подключён организацией.'),
  );
  add('updateModuleSettings', 'ok', { ...spaSettings, cancellationMinutes: 180 });
  add(
    'updateModuleSettings',
    'validation_failed',
    problem('validation_failed', 'Проверьте настройки модуля.', {
      violations: [{ field: 'cancellationMinutes', code: 'minimum', message: 'Не меньше 0 минут' }],
    }),
  );

  // Files
  const upload = id('t-alta:example', 'upload-insp-208-front');
  add('initiateUpload', 'ok', {
    uploadId: upload,
    fileId: id('t-alta', 'file-insp-208-front'),
    method: 'PUT',
    uploadUrl: `https://storage.example.invalid/uploads/${upload}`,
    requiredContentType: 'image/jpeg',
    requiredSha256: SHA,
    expiresAt: '2026-10-01T06:20:00Z',
    maxBytes: 20 * 1024 * 1024,
  });
  add(
    'initiateUpload',
    'quota_exceeded',
    problem('quota_exceeded', 'Место организации заполнено. Загрузка новых файлов недоступна.'),
  );
  add('completeUpload', 'ok', file({ status: 'quarantined' }));
  add('completeUpload', 'not_found', problem('not_found', 'Загрузка не найдена или истекла.'));
  add('getFileDownload', 'ok', {
    fileId: id('t-alta', 'file-insp-208-front'),
    downloadUrl: `https://storage.example.invalid/files/${id('t-alta', 'file-insp-208-front')}`,
    expiresAt: '2026-10-01T07:35:00Z',
  });
  add(
    'getFileDownload',
    'photo_not_ready',
    problem('photo_not_ready', 'Файл ещё проверяется и недоступен для скачивания.'),
  );
  add('getFile', 'ok', file());
  add('getFile', 'not_found', problem('not_found', 'Файл не найден.'));

  // Этап 1 (W0.08): вход, приглашение, переключатель, входящие, группы, владельцы, импорт, загрузки.
  const stage1 = stage1Examples({
    id,
    membershipId,
    problem,
    me,
    tenantContext,
    grantsOf,
    allTenant,
    scopeOf,
    page,
    catalog,
    SEED,
    NOW,
  });
  for (const [op, bodies] of Object.entries(stage1)) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Этап 1, второй PR (W1.00): оператор, журнал, файлы, место, отключение модуля, билет канала.
  const stage1b = stage1bExamples(
    { id, problem, page, tenantDto, subscription, SEED, NOW, storage: alta.storage },
    ex,
  );
  for (const [op, bodies] of Object.entries(stage1b)) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Этап 2 (W2.00): рейс от плана до приёмки, дефекты, назначение машины, начисления, «Требует решения».
  const stage2 = stage2Examples({ id, problem, page, NOW });
  for (const [op, bodies] of Object.entries(stage2)) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Этап 2, аддитивный PR (W2.40): категории расходов по ответу на D-12 комплекта.
  for (const [op, bodies] of Object.entries(stage2w240Examples({ problem }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Стюард этапа 2, часть 1 (W2.51): пул водителей (S2-14) и наборы «Данных» (S2-16).
  for (const [op, bodies] of Object.entries(stage2w251Examples({ id, problem, page, NOW }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Стюард этапа 2, часть 2 (W2.52): ответы владельца 17.10 — справочник расходов, машина, фото, чек-лист, дефект, D-11 комплекта.
  for (const [op, bodies] of Object.entries(
    stage2w252Examples({ id, problem, page, NOW, prior: ex }),
  )) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактная дельта W2.57 (решение Q-W2.07-1): продление временного назначения водителя пула.
  for (const [op, bodies] of Object.entries(stage2w257Examples({ prior: ex }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 1 этапа 4 (W4.02): «Почему доступно» с объектом проекта, причина отказа перехода задачи.
  for (const [op, bodies] of Object.entries(stage4w402Examples({ problem, prior: ex }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 5 этапа 4 (W4.06): календарь ресурсов, сохранённые виды и выгрузка заданием «Данных».
  for (const [op, bodies] of Object.entries(stage4w406Examples({ id, problem, page, NOW }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактная дельта W2.71 (S2-20, D-35 комплекта; 0.7.1-stage4): машина для временного водителя — выбор из
  // предложенных.
  for (const [op, bodies] of Object.entries(stage2w271Examples({ id, problem, NOW }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 6 этапа 4 (W4.07): места, тарифная сетка, заявки, «Использование», аккаунты, операторы, оформление.
  for (const [op, bodies] of Object.entries(
    stage4w407Examples({ id, problem, page, NOW, prior: ex }),
  )) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 3 этапа 4 (W4.04): «База знаний» — снимки сценарного сервера на сиде W4.30.
  for (const [op, bodies] of Object.entries(stage4w404Examples({ id }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 2 этапа 4 (W4.03): «Задачи и проекты» — проекты, участники, процесс, задачи, автоматизация.
  for (const [op, bodies] of Object.entries(stage4w403Examples({ id }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR 4 этапа 4 (W4.05): «Формы и опросы» — снимки сценарного сервера на сиде W4.20.
  for (const [op, bodies] of Object.entries(stage4w405Examples({ id }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR этапа 5 (W5.00): касса, склад, SPA — сид «Альты» (cash.js seedAlta).
  for (const [op, bodies] of Object.entries(stage5w500Examples({ id, problem, page, NOW }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактный PR этапа 6 (W6.00): «Ремонт и стройка» — снимки сценарного сервера на сиде эталона «Альты».
  for (const [op, bodies] of Object.entries(stage6w600Examples({ id }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }

  // Контрактная дельта W4.80 (0.11.1-stage4): наборы «Данных» модулей ядра — «Ответы на осмотр» и «Задачи».
  for (const [op, bodies] of Object.entries(stage4w480Examples({ id, prior: ex }))) {
    for (const [name, body] of Object.entries(bodies)) add(op, name, body);
  }
  return ex;
}

/**
 * Тексты всех файлов примеров и seed-ids.yaml без записи на диск (проверка «пересборка не меняет файлы»).
 * @returns {Promise<{files: Map<string, string>, operations: number, examples: number}>} путь → текст
 */
export async function renderExamples() {
  for (const k of Object.keys(ids)) delete ids[k];
  const ex = build();
  const files = new Map();
  let n = 0;
  for (const [op, bodies] of Object.entries(ex)) {
    for (const [name, body] of Object.entries(bodies)) {
      const path = join(EXAMPLES_DIR, op, `${name}.json`);
      files.set(path, await renderJson(compact(body), path));
      n++;
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(ids)
      .sort()
      .map((s) => [
        s,
        Object.fromEntries(
          Object.keys(ids[s])
            .sort()
            .map((k) => [k, ids[s][k]]),
        ),
      ]),
  );
  const seed = { namespace: NAMESPACE_URL, name: 'ortus:<scope>:<prototype-id>', ids: sorted };
  files.set(
    SEED_IDS_PATH,
    await renderYaml(
      seed,
      SEED_IDS_PATH,
      [
        'Карта идентификаторов сида прототипа 14.10 → UUID (W0.07, PD-30). Сгенерировано tools/gen/examples-seed.mjs.',
        'UUID = v5(namespace URL, "ortus:<scope>:<id прототипа>"); scope — platform (организации, аккаунты, операторы),',
        'id организации (объекты внутри неё) или <организация>:example (новые объекты примеров).',
        'Потребители: W0.06 (Go-сид), W0.12 (TS-сид), W0.13 (MSW). Go: uuid.NewSHA1(uuid.NameSpaceURL, []byte(name)).',
      ].join('\n'),
    ),
  );
  return { files, operations: Object.keys(ex).length, examples: n };
}

export async function writeExamples() {
  const { files, operations, examples } = await renderExamples();
  rmSync(EXAMPLES_DIR, { recursive: true, force: true });
  for (const [path, text] of files) writeText(path, text);
  return { operations, files: examples };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await writeExamples();
  console.log(`examples: ${r.files} files for ${r.operations} operations; seed-ids.yaml`);
}
