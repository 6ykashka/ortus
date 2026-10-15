// W0.08 · Контракт этапа 1 (шаг 0.3 плана 27): вход и CSRF, приглашение, переключатель бизнеса,
// группы, передача владения, explainAccess, входящие уведомления, импорт CSV людей, сессии загрузки.
// Источники: 03-api-guide «Что требуется допроектировать» (Auth; Группы и владельцы), 13 (S1-05, S1-06,
// S1-07, S1-10, S1-14, S1-16, S1-20, S1-26), G-01, G-02, G-19, C п.2, 14, 17; бриф docs/plan/v2/ws/W0.08.md §4.
// Контракт после 0.1 только аддитивный: каждое отличие бандла объявлено в source-delta.yaml.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { bundle } from './lib/bundle.mjs';
import { CORE_TAGS, checkExamples, loadExamples } from './lib/examples.mjs';
import { listOperations, operationsById } from './lib/inventory.mjs';
import { ERRORS_PATH, ROOT_SPEC, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { escapeToken } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W0.08 §4.1. */
const OPS = [
  ['startLogin', 'get', '/api/v1/auth/login', 'Auth', [], 'identity'],
  ['completeLogin', 'get', '/api/v1/auth/callback', 'Auth', [], 'identity'],
  ['getCsrfToken', 'get', '/api/v1/auth/csrf', 'Auth', [], 'identity'],
  ['logout', 'post', '/api/v1/auth/logout', 'Auth', [], 'identity'],
  ['inspectInvitation', 'post', '/api/v1/auth/invitations/inspect', 'Auth', [], 'identity'],
  ['acceptInvitation', 'post', '/api/v1/auth/invitations/accept', 'Auth', [], 'identity'],
  ['selectTenant', 'put', '/api/v1/me/selected-tenant', 'Context', [], 'identity'],
  ['listMyNotifications', 'get', '/api/v1/me/notifications', 'Context', [], 'identity'],
  [
    'getMyNotificationSummary',
    'get',
    '/api/v1/me/notifications/summary',
    'Context',
    [],
    'identity',
  ],
  ['markMyNotificationsRead', 'post', '/api/v1/me/notifications/read', 'Context', [], 'identity'],
  ['listGroups', 'get', `${T}/groups`, 'Access', ['members.read'], 'tenant-or-org-unit'],
  ['createGroup', 'post', `${T}/groups`, 'Access', ['members.manage'], 'tenant-or-org-unit'],
  ['getGroup', 'get', `${T}/groups/{groupId}`, 'Access', ['members.read'], 'tenant-or-org-unit'],
  [
    'updateGroup',
    'patch',
    `${T}/groups/{groupId}`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'deleteGroup',
    'delete',
    `${T}/groups/{groupId}`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'setGroupMembers',
    'put',
    `${T}/groups/{groupId}/members`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  ['listOwners', 'get', `${T}/owners`, 'Access', ['members.read'], 'tenant'],
  [
    'transferOwnership',
    'post',
    `${T}/owners/transfers`,
    'Access',
    ['members.manage'],
    'tenant-owner',
  ],
  [
    'revokeOwnership',
    'delete',
    `${T}/owners/{memberId}`,
    'Access',
    ['members.manage'],
    'tenant-owner',
  ],
  [
    'explainAccess',
    'get',
    `${T}/access/explanation`,
    'Access',
    ['roles.read'],
    'tenant-or-org-unit',
  ],
  [
    'createPeopleImport',
    'post',
    `${T}/people-imports`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'getPeopleImport',
    'get',
    `${T}/people-imports/{importId}`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'commitPeopleImport',
    'post',
    `${T}/people-imports/{importId}/commit`,
    'Access',
    ['members.manage'],
    'tenant-or-org-unit',
  ],
  [
    'getUploadSession',
    'get',
    `${T}/files/uploads/{uploadId}`,
    'Files',
    ['files.upload'],
    'owning-object-scope',
  ],
  [
    'abortUpload',
    'delete',
    `${T}/files/uploads/{uploadId}`,
    'Files',
    ['files.upload'],
    'owning-object-scope',
  ],
];
const STAGE1 = OPS.map((o) => o[0]);
const PUBLIC = ['startLogin', 'completeLogin', 'inspectInvitation'];
const COOKIE_ONLY = ['getCsrfToken', 'logout'];
const READ_ONLY_POST = ['inspectInvitation'];
const IF_MATCH = ['updateGroup', 'deleteGroup', 'setGroupMembers', 'commitPeopleImport'];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const codes = readYaml(ERRORS_PATH).codes;
const schemas = doc.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const header = (id, name) =>
  params(id).find((p) => p.in === 'header' && p.name.toLowerCase() === name.toLowerCase());
const successOf = (o) => Object.keys(o.responses).find((s) => /^[23]/.test(s));
const responseBody = (r) => {
  const resolved = r?.$ref ? doc.components.responses[r.$ref.split('/').pop()] : r;
  return resolved?.content?.['application/json'];
};
/** ajv 2020-12 по схеме компонента бандла (как проверка примеров, lib/examples.mjs). */
const validator = (name) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of ['int32', 'int64']) ajv.addFormat(f, true);
  ajv.addSchema(structuredClone(doc), 'ortus');
  return ajv.compile({ $ref: `ortus#/components/schemas/${name}` });
};
const ALTA = '0b6c4c9e-5f1a-5d3e-8a43-2f0c8b1d9e01';

/** Пути, которые браузер не уведёт на чужой хост: `\` браузер читает как `/` (CWE-601). */
const SAME_ORIGIN_OK = ['/', '/users', '/tasks?id=1#comments', '/a/b/c', '/inbox?tenant=a%2Fb'];
const SAME_ORIGIN_BAD = [
  '',
  'users',
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/\\/evil.example',
  '/a\\b',
  '/\t/evil.example',
  '/ /evil.example',
  '/\n/evil.example',
  '/\u0000/evil.example',
];
const checkSameOrigin = (where, schema) => {
  const re = new RegExp(schema.pattern, 'u');
  const wrong = [
    ...SAME_ORIGIN_OK.filter((s) => !re.test(s)).map(
      (s) => `${where}: отклонён ${JSON.stringify(s)}`,
    ),
    ...SAME_ORIGIN_BAD.filter((s) => re.test(s)).map(
      (s) => `${where}: принят ${JSON.stringify(s)}`,
    ),
  ];
  // Шаблон исполняет и Go (RE2 в валидаторе W0.09): без опережающих и ретроспективных проверок.
  if (/\(\?[=!<]/.test(schema.pattern)) wrong.push(`${where}: lookaround не поддержан RE2`);
  if (schema.maxLength !== 512) wrong.push(`${where}: maxLength ${schema.maxLength} ≠ 512`);
  return wrong;
};

describe('контракт этапа 1 (W0.08)', () => {
  it('25 операций этапа 1: метод, путь, тег, x-permissions, x-scope', () => {
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
    assert.equal(new Set(STAGE1).size, 25);
  });

  it('тег Auth объявлен в корне; 18 тегов 0.1 на месте; Auth входит в ядро примеров', () => {
    const tags = readYaml(ROOT_SPEC).tags.map((t) => t.name);
    assert.ok(tags.includes('Auth'), tags.join(', '));
    const sourceTags = source.tags.map((t) => t.name);
    assert.deepEqual(
      sourceTags.filter((t) => !tags.includes(t)),
      [],
    );
    assert.ok(CORE_TAGS.includes('Auth'));
  });

  it('контракт аддитивный: операции 0.1 на месте, каждое отличие — в source-delta', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    const deltas = new Set(loadDeltas().map((d) => d.pointer));
    const newPaths = [...new Set(OPS.map((o) => o[2]))].filter((p) => !(p in source.paths));
    assert.deepEqual(
      newPaths.filter((p) => !deltas.has(`/paths/${escapeToken(p)}`)),
      [],
    );
    const ids = new Set(listOperations(doc).map((o) => o.operationId));
    assert.ok(listOperations(source).every((o) => ids.has(o.operationId)));
    assert.ok(STAGE1.every((id) => ids.has(id)));
  });

  it('вход: login, callback и inspect — security: [] с x-public-capability; csrf и logout — только cookie-сессия', () => {
    for (const id of PUBLIC) {
      assert.deepEqual(op(id).security, [], id);
      assert.ok(String(op(id)['x-public-capability'] ?? '').length > 20, id);
    }
    for (const id of COOKIE_ONLY) assert.deepEqual(op(id).security, [{ sessionCookie: [] }], id);
    for (const id of ['startLogin', 'completeLogin']) {
      const r = op(id).responses['302'];
      assert.ok(r?.headers?.Location, `${id}: 302 с Location`);
      assert.ok(op(id).responses['503'], `${id}: 503 при недоступном IdP`);
    }
  });

  it('токены не в пути: ни одного параметра пути с токеном приглашения или сессии', () => {
    const stage1Paths = new Set(OPS.map((o) => o[2]));
    assert.deepEqual(
      [...stage1Paths].filter((p) => /\{[^}]*token[^}]*\}/i.test(p)),
      [],
    );
    for (const id of ['inspectInvitation', 'acceptInvitation']) {
      const body = op(id).requestBody.content['application/json'].schema;
      const name = body.$ref.split('/').pop();
      assert.ok(schemas[name].required.includes('token'), `${id}: токен в теле`);
    }
  });

  it('изменяющие операции этапа 1: Idempotency-Key, X-CSRF-Token, Origin; If-Match там, где ревизия', () => {
    const gaps = [];
    for (const [id, method] of OPS) {
      if (method === 'get' || READ_ONLY_POST.includes(id)) continue;
      if (header(id, 'Idempotency-Key')?.required !== true) gaps.push(`${id}: Idempotency-Key`);
      if (!header(id, 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!header(id, 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
    }
    for (const id of IF_MATCH) {
      if (header(id, 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ${s}`);
    }
    assert.deepEqual(gaps, []);
  });

  it('передача и снятие владения — только владелец (x-scope tenant-owner), последнего не снять', () => {
    assert.equal(op('transferOwnership')['x-scope'], 'tenant-owner');
    assert.equal(op('revokeOwnership')['x-scope'], 'tenant-owner');
    const body = schemas.OwnershipTransferCreate;
    assert.deepEqual([...body.required].sort(), [
      'confirmation',
      'keepCurrentOwner',
      'reason',
      'toMemberId',
    ]);
    assert.ok(op('revokeOwnership').responses['409']);
  });

  it('commitPeopleImport: приглашения из файла требуют members.invite', () => {
    assert.deepEqual(op('commitPeopleImport')['x-field-permissions'], {
      sendInvitations: 'members.invite',
    });
    assert.ok(op('createPeopleImport').responses['413'], 'файл больше лимита — 413');
  });

  it('explainAccess: denyCode — ProblemCode, decisiveCheck и check — один перечень шагов x-authorization-order', () => {
    const s = schemas.AccessExplanation;
    assert.equal(s.properties.denyCode.$ref, '#/components/schemas/ProblemCode');
    const order = readYaml(ROOT_SPEC)['x-authorization-order'];
    const steps = schemas.AccessCheckStep.enum;
    assert.deepEqual(
      steps.filter((x) => !order.includes(x)),
      [],
    );
    assert.deepEqual(s.properties.decisiveCheck.$ref, '#/components/schemas/AccessCheckStep');
    assert.deepEqual(schemas.AccessCheck.properties.check, {
      $ref: '#/components/schemas/AccessCheckStep',
    });
  });

  it('explainAccess: скрытые назначения — флаг hiddenGrants без деталей, allowed не раскрывает их состав', () => {
    const s = schemas.AccessExplanation;
    assert.deepEqual(s.properties.hiddenGrants?.type, 'boolean');
    assert.ok(s.required.includes('hiddenGrants'));
    const text = `${s.description} ${s.properties.hiddenGrants.description ?? ''}`;
    assert.match(text, /outside the actor scope/);
    assert.match(text, /no (count|details)/);
    assert.match(op('explainAccess').description, /hiddenGrants/);
  });

  it('returnTo и Notification.link — путь того же источника: без схемы, хоста, // и обратного слеша', () => {
    const returnTo = op('startLogin').parameters.find((p) => p.name === 'returnTo').schema;
    assert.deepEqual(
      [
        ...checkSameOrigin('returnTo', returnTo),
        ...checkSameOrigin('Notification.link', schemas.Notification.properties.link),
      ],
      [],
    );
    assert.equal(returnTo.pattern, schemas.Notification.properties.link.pattern);
    assert.match(op('startLogin').parameters[0].description, /backslash/);
  });

  it('markMyNotificationsRead: ровно одно из notificationIds и upTo выражено схемой', () => {
    const v = validator('NotificationReadRequest');
    const ids = { tenantId: ALTA, notificationIds: [ALTA] };
    const upTo = { tenantId: ALTA, upTo: '2026-10-01T07:30:00Z' };
    assert.ok(v(ids), JSON.stringify(v.errors));
    assert.ok(v(upTo), JSON.stringify(v.errors));
    assert.equal(v({ ...ids, ...upTo }), false, 'оба поля');
    assert.equal(v({ tenantId: ALTA }), false, 'ни одного');
  });

  it('импорт CSV: совпадение с человеком вне области members.manage — ошибка строки без раскрытия', () => {
    const create = op('createPeopleImport').description;
    assert.match(create, /outside the members\.manage scope of the actor/);
    assert.match(create, /never reveals? (the match|whether)/);
    assert.match(create, /home unit/);
    assert.match(create, /old and the new unit/);
    const memberId = schemas.PeopleImportRow.properties.memberId;
    assert.match(memberId.description ?? '', /only for people within the actor scope/);
    assert.match(op('commitPeopleImport').description, /re-checked/);
  });

  it('импорт CSV: строки с персональными данными удаляются после применения, итоги остаются', () => {
    const s = schemas.PeopleImport;
    assert.deepEqual(s.properties.rowsPurgedAt, { $ref: '#/components/schemas/Instant' });
    assert.ok(!s.required.includes('rowsPurgedAt'));
    assert.match(s.description, /30 days/);
    assert.match(op('getPeopleImport').description, /rowsPurgedAt/);
  });

  it('снятие владельца — свежий вход, как у передачи; снятый и остальные владельцы уведомлены', () => {
    for (const id of ['transferOwnership', 'revokeOwnership']) {
      assert.match(op(id).description, /auth_time within 10 minutes/, id);
      assert.match(op(id).description, /401 session_expired/, id);
      assert.ok(op(id).responses['401'], id);
    }
    assert.match(op('revokeOwnership').description, /notif/i);
  });

  it('UploadSession.purpose — те же значения, что UploadCreate.purpose, и они же в files.objects.purpose', () => {
    const p = schemas.UploadSession.properties.purpose;
    assert.deepEqual(p.enum, schemas.UploadCreate.properties.purpose.enum);
    assert.match(p.description ?? '', /files\.objects\.purpose/);
  });

  it('MeContext.lastTenantId — необязательное, UUID или null', () => {
    const p = schemas.MeContext.properties.lastTenantId;
    assert.deepEqual(p, { type: ['string', 'null'], format: 'uuid' });
    assert.ok(!schemas.MeContext.required.includes('lastTenantId'));
  });

  it('у каждой операции этапа 1 есть пример ошибки и пример успеха (кроме ответов без тела)', () => {
    const examples = loadExamples();
    const gaps = [];
    for (const id of STAGE1) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      const problems = names.filter((n) => n in codes);
      const hasBody = Boolean(responseBody(op(id).responses[successOf(op(id))]));
      if (!problems.length) gaps.push(`${id}: нет примера ошибки`);
      if (hasBody && problems.length === names.length) gaps.push(`${id}: нет примера успеха`);
      if (!hasBody && problems.length !== names.length) gaps.push(`${id}: лишний пример успеха`);
    }
    assert.deepEqual(gaps, []);
    assert.deepEqual(checkExamples(doc, examples), []);
  });

  it('screens.yaml: экраны этапа 1 ссылаются на операции этапа 1, каждая операция — на экране', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const want = {
      shell: ['selectTenant', 'getCsrfToken', 'logout', 'getMyNotificationSummary'],
      'auth-login': ['startLogin', 'completeLogin', 'getCsrfToken'],
      'auth-invitation': ['inspectInvitation', 'acceptInvitation', 'startLogin'],
      inbox: ['listMyNotifications', 'markMyNotificationsRead', 'getMyNotificationSummary'],
      'company-users': ['listGroups', 'listOwners', 'explainAccess'],
      'modal-group': ['createGroup', 'getGroup', 'updateGroup', 'deleteGroup', 'setGroupMembers'],
      'modal-transfer-owner': ['listOwners', 'transferOwnership', 'revokeOwnership'],
      'modal-explain-access': ['explainAccess'],
      'company-people-import': ['createPeopleImport', 'getPeopleImport', 'commitPeopleImport'],
      'core-files': ['getUploadSession', 'abortUpload'],
      'modal-upload': ['initiateUpload', 'getUploadSession', 'completeUpload', 'abortUpload'],
    };
    const gaps = [];
    for (const [key, list] of Object.entries(want)) {
      for (const id of list) {
        if (!screens[key]?.operations?.includes(id)) gaps.push(`${key}: ${id}`);
      }
    }
    const onScreens = new Set(Object.values(screens).flatMap((s) => s.operations));
    for (const id of STAGE1) if (!onScreens.has(id)) gaps.push(`ни на одном экране: ${id}`);
    assert.deepEqual(gaps, []);
  });

  it('версия контракта — этапа не ниже 1, не ниже 0.3.0-stage1', () => {
    const [major, minor] = doc.info.version.split('.').map(Number);
    // W2.00: следующие этапы поднимают суффикс (0.5.0-stage2) — проверяется этап не ниже 1.
    assert.match(doc.info.version, /^\d+\.\d+\.\d+-stage[1-9]\d*$/);
    assert.ok(major > 0 || minor >= 3, doc.info.version);
  });
});
