// W1.00 · Контракт этапа 1, второй PR (0.4.0-stage1): то, чего этапу 1 не хватало после W0.08 —
// команды оператора с причиной и журнал платформы (S1-04, W1.11, W1.25), список файлов (S1-21, W1.24),
// разбивка места (S1-22, W1.09), предпросмотр отключения модуля (S1-18, W1.08), билет канала реального
// времени (S1-15, S1-26, ADR-0015, PD-58). Бриф docs/plan/v2/ws/W1.00.md §4. Контракт только аддитивный.
// DoR: screens.yaml покрывает истории S1-01…S1-30 экранами или причиной «без экрана».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { bundle } from './lib/bundle.mjs';
import { checkCoverage, checkExamples, loadExamples } from './lib/examples.mjs';
import { listOperations, operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { escapeToken } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';
const P = '/api/v1/platform/tenants/{tenantId}';

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W1.00 §4. */
const OPS = [
  [
    'suspendPlatformTenant',
    'post',
    `${P}/suspend`,
    'Platform',
    ['platform.tenants.manage'],
    'platform',
  ],
  [
    'resumePlatformTenant',
    'post',
    `${P}/resume`,
    'Platform',
    ['platform.tenants.manage'],
    'platform',
  ],
  [
    'extendPlatformTrial',
    'post',
    `${P}/trial-extensions`,
    'Platform',
    ['platform.billing.manage'],
    'platform',
  ],
  [
    'listPlatformAuditEvents',
    'get',
    '/api/v1/platform/audit-events',
    'Platform',
    ['platform.tenants.read'],
    'platform',
  ],
  ['listFiles', 'get', `${T}/files`, 'Files', ['files.read'], 'owning-object-scope'],
  [
    'getStorageBreakdown',
    'get',
    `${T}/storage/breakdown`,
    'Billing',
    ['billing.read'],
    'tenant-owner-or-billing-manager',
  ],
  [
    'previewModuleDeactivation',
    'get',
    `${T}/modules/{moduleKey}/deactivation-preview`,
    'Modules',
    ['modules.manage'],
    'tenant-owner',
  ],
  ['createRealtimeTicket', 'post', '/api/v1/auth/realtime-tickets', 'Auth', [], 'identity'],
  [
    'previewOrgUnitMove',
    'get',
    `${T}/org-units/{orgUnitId}/move-preview`,
    'Access',
    ['org_units.manage'],
    'tenant-or-org-unit',
  ],
  ['createMember', 'post', `${T}/members`, 'Access', ['members.manage'], 'tenant-or-org-unit'],
  [
    'listWorkProfiles',
    'get',
    `${T}/members/{memberId}/work-profiles`,
    'Access',
    ['members.read'],
    'tenant-or-org-unit',
  ],
  [
    'createWorkProfile',
    'post',
    `${T}/members/{memberId}/work-profiles`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'updateWorkProfile',
    'patch',
    `${T}/members/{memberId}/work-profiles/{workProfileId}`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
];
const NEW = OPS.map((o) => o[0]);
const COMMANDS = ['suspendPlatformTenant', 'resumePlatformTenant', 'extendPlatformTrial'];
/** Операции W0.08 (0.3.0-stage1) — не должны пропасть. */
const W008 = [
  'startLogin',
  'completeLogin',
  'getCsrfToken',
  'logout',
  'inspectInvitation',
  'acceptInvitation',
  'selectTenant',
  'listMyNotifications',
  'getMyNotificationSummary',
  'markMyNotificationsRead',
  'explainAccess',
  'createPeopleImport',
  'getUploadSession',
  'abortUpload',
];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const codes = readYaml(ERRORS_PATH).codes;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, name) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === name.toLowerCase());
const successOf = (o) => Object.keys(o.responses).find((s) => /^[23]/.test(s));
const bodySchema = (id) => {
  const ref = op(id).requestBody?.content?.['application/json']?.schema?.$ref;
  return ref ? schemas[ref.split('/').pop()] : undefined;
};
const okSchema = (id) => {
  const r = op(id).responses[successOf(op(id))];
  const ref = r?.content?.['application/json']?.schema?.$ref;
  return ref?.split('/').pop();
};
const name = (ref) => ref?.split('/').pop();
const screensDoc = readYaml(SCREENS_PATH);
const screens = screensDoc.screens;

describe('контракт этапа 1, второй PR (W1.00, 0.4.0-stage1)', () => {
  it('13 новых операций: метод, путь, тег, x-permissions, x-scope', () => {
    const wrong = [];
    for (const [id, method, path, tag, perms, scope] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, tag, perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('аддитивность: операции 0.1 и W0.08 на месте, новые пути объявлены в source-delta, тегов не прибавилось', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    const ids = new Set(listOperations(doc).map((o) => o.operationId));
    assert.deepEqual(
      [...listOperations(source).map((o) => o.operationId), ...W008].filter((id) => !ids.has(id)),
      [],
    );
    const deltas = loadDeltas();
    const pointers = new Set(deltas.map((d) => d.pointer));
    const newPaths = [...new Set(OPS.map((o) => o[2]))].filter((p) => !(p in source.paths));
    assert.deepEqual(
      newPaths.filter((p) => !pointers.has(`/paths/${escapeToken(p)}`)),
      [],
    );
    for (const p of newPaths) {
      const d = deltas.find((x) => x.pointer === `/paths/${escapeToken(p)}`);
      assert.match(d.source, /W1\.00/, p);
    }
    assert.equal(doc.tags.length, 19, 'новых тегов нет: билет — в Auth');
  });

  it('команды оператора: причина обязательна (5–500), If-Match, Idempotency-Key, CSRF, Origin, 409/412/428', () => {
    const gaps = [];
    for (const id of COMMANDS) {
      const body = bodySchema(id);
      if (!body?.required?.includes('reason')) gaps.push(`${id}: reason не обязательна`);
      const reason = body?.properties?.reason ?? {};
      if (reason.minLength !== 5 || reason.maxLength !== 500) gaps.push(`${id}: reason 5–500`);
      if (body?.additionalProperties !== false) gaps.push(`${id}: additionalProperties`);
      if (param(id, 'header', 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['404', '409', '412', '422', '428']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
      if (!/platform_audit/.test(op(id).description)) gaps.push(`${id}: аудит в описании`);
    }
    assert.deepEqual(gaps, []);
    assert.equal(okSchema('suspendPlatformTenant'), 'Tenant');
    assert.equal(okSchema('resumePlatformTenant'), 'Tenant');
    assert.equal(okSchema('extendPlatformTrial'), 'Subscription');
    const days = bodySchema('extendPlatformTrial').properties.days;
    assert.deepEqual([days.type, days.minimum, days.maximum], ['integer', 1, 30]);
  });

  it('изменяющие операции W1.00: Idempotency-Key (кроме билета), X-CSRF-Token, Origin, x-csrf-required-for-cookie', () => {
    const gaps = [];
    for (const [id, method] of OPS) {
      if (method === 'get') continue;
      if (
        id !== 'createRealtimeTicket' &&
        param(id, 'header', 'Idempotency-Key')?.required !== true
      )
        gaps.push(`${id}: Idempotency-Key`);
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
    }
    assert.deepEqual(gaps, []);
  });

  it('журнал платформы: фильтр по организации, курсор, структурная запись без текста интерфейса', () => {
    const id = 'listPlatformAuditEvents';
    assert.ok(param(id, 'query', 'tenantId'), 'tenantId в query');
    assert.notEqual(param(id, 'query', 'tenantId').required, true);
    assert.ok(param(id, 'query', 'cursor') && param(id, 'query', 'limit'));
    assert.equal(okSchema(id), 'PlatformAuditPage');
    const e = schemas.PlatformAuditEvent;
    for (const f of ['id', 'at', 'action', 'actor', 'target', 'result']) {
      assert.ok(e.required.includes(f), f);
    }
    assert.deepEqual(schemas.PlatformAuditActor.properties.kind.enum, [
      'operator',
      'owner',
      'system',
    ]);
    assert.ok(!('text' in e.properties), 'текст строки собирает клиент из словаря');
  });

  it('журнал платформы (ревью W1.00): строки фильтруются по праву на тип цели; subscription.* — цель subscription', () => {
    const d = op('listPlatformAuditEvents').description;
    for (const [type, perm] of [
      ['account', 'platform.users.read'],
      ['operator', 'platform.operators.manage'],
      ['price_book', 'platform.pricing.manage'],
    ]) {
      assert.match(d, new RegExp(`${type} rows need ${perm.replace(/\./g, '\\.')}`), type);
    }
    assert.match(d, /omitted/);
    assert.match(schemas.PlatformAuditTarget.description, /subscription\.\* actions/);
    const rows = loadExamples().get('listPlatformAuditEvents').get('ok').items;
    const wrong = rows
      .filter((r) => r.action.startsWith('subscription.') && r.target.type !== 'subscription')
      .map((r) => `${r.id} ${r.action}: ${r.target.type}`);
    assert.deepEqual(wrong, []);
  });

  it('listFiles: фильтры status и purpose, курсор; элемент — File, родитель ObjectRef и purpose загрузки', () => {
    const id = 'listFiles';
    for (const q of ['status', 'purpose', 'cursor', 'limit']) assert.ok(param(id, 'query', q), q);
    assert.equal(okSchema(id), 'FilePage');
    const item = schemas.FileListItem;
    assert.equal(name(item.properties.file.$ref), 'File');
    assert.equal(name(item.properties.owner.$ref), 'ObjectRef');
    assert.deepEqual(item.properties.purpose.enum, schemas.UploadCreate.properties.purpose.enum);
    assert.match(op(id).description, /before pagination/);
    assert.match(op(id).description, /parent/);
  });

  it('getStorageBreakdown: группы эталона и модули-источники; StorageUsage 0.1 не меняется', () => {
    assert.equal(okSchema('getStorageBreakdown'), 'StorageBreakdown');
    const s = schemas.StorageBreakdown;
    const group = schemas.StorageBreakdownGroup;
    assert.deepEqual(group.properties.key.enum, ['photos', 'documents', 'attachments', 'other']);
    assert.ok(s.required.includes('groups') && s.required.includes('modules'));
    assert.deepEqual([...schemas.StorageBreakdownModule.required].sort(), [
      'bytes',
      'fileCount',
      'moduleKey',
    ]);
    assert.deepEqual(
      loadDeltas().filter((d) => d.pointer.startsWith('/components/schemas/StorageUsage')),
      [],
    );
  });

  it('previewModuleDeactivation: «Затронет сейчас» без побочных эффектов, только чтение', () => {
    const id = 'previewModuleDeactivation';
    assert.equal(okSchema(id), 'ModuleDeactivationPreview');
    const p = schemas.ModuleDeactivationPreview;
    for (const f of ['moduleKey', 'activeItems', 'hiddenCount', 'retainedAccess']) {
      assert.ok(p.required.includes(f), f);
    }
    assert.equal(name(p.properties.activeItems.items.$ref), 'ModuleDeactivationItem');
    assert.ok(op(id).responses['403'] && op(id).responses['404']);
    assert.match(op(id).description, /does not change/);
  });

  it('createRealtimeTicket: только cookie-сессия, 201, билет не в URL, x-realtime со схемами сообщений', () => {
    const o = op('createRealtimeTicket');
    assert.deepEqual(o.security, [{ sessionCookie: [] }]);
    assert.ok(o.responses['201']);
    assert.equal(okSchema('createRealtimeTicket'), 'RealtimeTicket');
    const t = schemas.RealtimeTicket;
    for (const f of ['ticket', 'path', 'protocol', 'expiresAt', 'heartbeatSeconds']) {
      assert.ok(t.required.includes(f), f);
    }
    assert.equal(t.properties.path.const, '/api/v1/realtime');
    assert.equal(t.properties.protocol.const, 'ortus.realtime.v1');
    const rt = o['x-realtime'];
    assert.equal(rt.path, '/api/v1/realtime');
    assert.equal(rt.auth, 'first-frame');
    assert.equal(name(rt.messages.client.$ref), 'RealtimeClientMessage');
    assert.equal(name(rt.messages.server.$ref), 'RealtimeServerMessage');
    assert.match(o.description, /ADR-0015/);
    // Ни один путь контракта не несёт билет или токен в параметре пути или query.
    const leaks = [];
    for (const { operationId } of listOperations(doc)) {
      for (const p of params(operationId)) {
        if ((p.in === 'query' || p.in === 'path') && /ticket/i.test(p.name)) {
          leaks.push(`${operationId}: ${p.in} ${p.name}`);
        }
      }
    }
    assert.deepEqual(leaks, []);
  });

  it('createRealtimeTicket без Idempotency-Key: одноразовый секрет не хранится и не повторяется (ревью W1.00)', async () => {
    const o = op('createRealtimeTicket');
    assert.equal(param('createRealtimeTicket', 'header', 'Idempotency-Key'), undefined);
    assert.ok(!('Idempotency-Replayed' in (o.responses['201'].headers ?? {})));
    assert.ok(!o.responses['409'] && !o.responses['428'], 'нет конфликта и предусловия ключа');
    assert.match(o.description, /no Idempotency-Key/);
    assert.match(o.description, /never stored/);
    // Правило Spectral ortus-idempotency-key: билет — в списке singleUse, ключ у него запрещён.
    const ruleset = readYaml(abs('api/.spectral.yaml'));
    const opts = ruleset.rules['ortus-idempotency-key'].then.functionOptions;
    assert.ok(opts.singleUse?.includes('createRealtimeTicket'));
    const { default: idempotencyKey } = await import(
      pathToFileURL(abs('api/spectral/functions/idempotencyKey.js')).href
    );
    const withKey = {
      operationId: 'createRealtimeTicket',
      parameters: [{ in: 'header', name: 'Idempotency-Key', required: true }],
    };
    assert.equal(idempotencyKey(withKey, opts).length, 1);
    assert.deepEqual(
      idempotencyKey({ operationId: 'createRealtimeTicket', parameters: [] }, opts),
      [],
    );
    assert.match(readFileSync(abs('docs/adr/0015-realtime-channel.md'), 'utf8'), /Idempotency-Key/);
  });

  it('сообщения канала — подсказки без данных: тип, организация, версия, счётчик; без заголовков и текста', () => {
    const server = schemas.RealtimeServerMessage;
    assert.deepEqual(server.properties.type.enum, [
      'context.changed',
      'notifications.changed',
      'session.ended',
      'ping',
    ]);
    for (const f of ['title', 'body', 'payload', 'data']) {
      assert.ok(!(f in server.properties), `${f}: данные идут только обычными операциями`);
    }
    assert.equal(server.additionalProperties, false);
    const client = schemas.RealtimeClientMessage;
    assert.deepEqual(client.properties.type.enum, ['auth', 'pong']);
  });

  it('сотрудник без аккаунта (S1-09): карточка без приглашения и места, подразделение обязательно', () => {
    const body = bodySchema('createMember');
    assert.deepEqual([...body.required].sort(), ['displayName', 'orgUnitIds']);
    assert.equal(body.properties.orgUnitIds.minItems, 1);
    assert.ok(!('userId' in body.properties) && !('status' in body.properties));
    assert.equal(body.additionalProperties, false);
    assert.ok(op('createMember').responses['201']);
    assert.equal(okSchema('createMember'), 'Member');
    assert.match(op('createMember').description, /no seat/);
    assert.match(op('createMember').description, /no invitation/);
  });

  it('функция с периодом (S1-09, AUTH-05): список, назначение, окончание; SoD и пересечение — 409', () => {
    const wp = schemas.WorkProfile;
    for (const f of ['id', 'function', 'validFrom', 'validUntil', 'state', 'revision']) {
      assert.ok(wp.required.includes(f), f);
    }
    assert.deepEqual(
      wp.properties.function.enum,
      schemas.Member.properties.workProfiles.items.enum,
    );
    assert.deepEqual(wp.properties.validUntil.type, ['string', 'null']);
    assert.deepEqual(wp.properties.state.enum, ['scheduled', 'active', 'ended']);
    assert.equal(okSchema('listWorkProfiles'), 'WorkProfileList');
    assert.ok(op('createWorkProfile').responses['201']);
    assert.equal(okSchema('createWorkProfile'), 'WorkProfile');
    assert.deepEqual([...bodySchema('createWorkProfile').required].sort(), [
      'function',
      'validFrom',
    ]);
    assert.match(op('createWorkProfile').description, /separation_of_duties_conflict/);
    assert.match(op('createWorkProfile').description, /overlap/);
    assert.ok(op('createWorkProfile').responses['409']);
    const patch = bodySchema('updateWorkProfile');
    assert.deepEqual(Object.keys(patch.properties), ['validUntil']);
    assert.deepEqual(patch.required, ['validUntil']);
    assert.equal(param('updateWorkProfile', 'header', 'If-Match')?.required, true);
    assert.ok(param('updateWorkProfile', 'path', 'workProfileId'));
  });

  it('перенос подразделения (S1-08): предпросмотр влияния на доступ без изменений', () => {
    const id = 'previewOrgUnitMove';
    const parent = param(id, 'query', 'parentId');
    assert.ok(
      parent && parent.required !== true,
      'parentId необязателен: без него — верхний уровень',
    );
    assert.equal(okSchema(id), 'OrgUnitMovePreview');
    const s = schemas.OrgUnitMovePreview;
    for (const f of [
      'orgUnitId',
      'fromParentId',
      'toParentId',
      'descendantUnitCount',
      'memberCount',
      'assignmentsLosingScope',
      'assignmentsGainingScope',
      'affectedPeople',
      'hiddenCount',
    ]) {
      assert.ok(s.required.includes(f), f);
    }
    assert.deepEqual(schemas.OrgUnitMoveImpact.properties.change.enum, ['gains', 'loses']);
    assert.match(op(id).description, /does not change/);
    assert.match(op(id).description, /old and the new/);
    // Ревью W1.00: без права на старого или нового родителя — 403; верхний уровень — право на всю организацию.
    assert.match(op(id).description, /403 forbidden_action/);
    assert.match(op(id).description, /top level needs org_units\.manage over the whole tenant/);
    assert.match(op(id).description, /members\.read/);
    // Ревью W1.00 (возврат 2): hiddenCount — число людей (memberId), а не назначений.
    assert.match(s.properties.hiddenCount.description, /distinct people/);
    assert.match(
      s.properties.affectedPeople.description ?? '',
      /one entry per person and assignment/,
    );
  });

  it('TenantContext.tenantState — необязательное: статус PLAT-02, сроки, запись в хранилище (S1-19)', () => {
    const p = schemas.TenantContext.properties.tenantState;
    assert.equal(name(p.$ref), 'TenantState');
    assert.ok(!schemas.TenantContext.required.includes('tenantState'));
    const s = schemas.TenantState;
    assert.deepEqual(s.properties.status.enum, schemas.Tenant.properties.status.enum);
    assert.deepEqual(s.properties.storageWriteStatus.enum, ['allowed', 'blocked']);
    assert.deepEqual([...s.required].sort(), ['status', 'storageWriteStatus']);
    const d = loadDeltas().find(
      (x) => x.pointer === '/components/schemas/TenantContext/properties/tenantState',
    );
    assert.match(d?.source ?? '', /W1\.00/);
  });
  it('у каждой новой операции есть пример ошибки и пример успеха; примеры валидны; покрытие ядра', () => {
    const examples = loadExamples();
    const gaps = [];
    for (const id of NEW) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      const problems = names.filter((n) => n in codes);
      if (!problems.length) gaps.push(`${id}: нет примера ошибки`);
      if (problems.length === names.length) gaps.push(`${id}: нет примера успеха`);
    }
    assert.deepEqual(gaps, []);
    assert.deepEqual(checkExamples(doc, examples), []);
    assert.deepEqual(checkCoverage(doc, examples), []);
  });

  it('screens.yaml: новые операции на своих экранах', () => {
    const want = {
      shell: ['createRealtimeTicket'],
      'core-files': ['listFiles'],
      'company-storage': ['getStorageBreakdown'],
      'modal-module-disable': ['previewModuleDeactivation', 'setModuleInstallation'],
      'company-structure': ['previewOrgUnitMove', 'updateOrgUnit'],
      'member-card': ['createMember', 'listWorkProfiles', 'createWorkProfile', 'updateWorkProfile'],
      'platform-tenants': [
        'suspendPlatformTenant',
        'resumePlatformTenant',
        'extendPlatformTrial',
        'listPlatformAuditEvents',
      ],
    };
    const gaps = [];
    for (const [key, list] of Object.entries(want)) {
      for (const id of list)
        if (!screens[key]?.operations?.includes(id)) gaps.push(`${key}: ${id}`);
    }
    assert.deepEqual(gaps, []);
  });

  it('DoR: у экранов этапа 1 — истории и эталон; S1-01…S1-30 покрыты экраном или причиной «без экрана»', () => {
    const gaps = [];
    const covered = new Set();
    for (const [key, s] of Object.entries(screens)) {
      if (s.stage !== 1) continue;
      if (!Array.isArray(s.stories) || !s.stories.length) gaps.push(`${key}: нет stories`);
      for (const st of s.stories ?? []) {
        if (!/^S1-(0[1-9]|[12]\d|30)$/.test(st)) gaps.push(`${key}: история ${st}`);
        covered.add(st);
      }
      if (!/^(design-stage-1 · |no-reference)/.test(s.reference ?? '')) {
        gaps.push(`${key}: reference «design-stage-1 · …» или «no-reference …»`);
      }
    }
    const without = screensDoc.storiesWithoutScreen ?? {};
    for (const [st, reason] of Object.entries(without)) {
      if (String(reason).length < 20) gaps.push(`${st}: причина «без экрана» короче 20 символов`);
      if (covered.has(st)) gaps.push(`${st}: и на экране, и «без экрана»`);
    }
    const all = Array.from({ length: 30 }, (_, i) => `S1-${String(i + 1).padStart(2, '0')}`);
    gaps.push(
      ...all.filter((st) => !covered.has(st) && !(st in without)).map((st) => `${st}: не покрыта`),
    );
    assert.deepEqual(gaps, []);
  });

  it('новые экраны DoR: отключение модуля, создание организации, структура, карточка сотрудника', () => {
    for (const key of [
      'modal-module-disable',
      'platform-tenant-create',
      'company-structure',
      'member-card',
    ]) {
      assert.ok(screens[key], key);
    }
    assert.match(screens['platform-tenant-create'].reference, /^no-reference/);
  });

  it('реестр миграций api/README.md: control 0004, 0005 и tenant 0007 выданы W1.00', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /\|\s*control\s*\|\s*0004\s*\|\s*`0004_accounts_last_tenant\.sql`/);
    assert.match(readme, /\|\s*control\s*\|\s*0005\s*\|\s*`0005_idempotency_keys\.sql`/);
    assert.match(readme, /\|\s*tenant\s*\|\s*0007\s*\|\s*`0007_outbox_dead_letter\.sql`/);
  });

  it('версия контракта — 0.4.0-stage1', () => {
    assert.equal(doc.info.version, '0.4.0-stage1');
  });
});
