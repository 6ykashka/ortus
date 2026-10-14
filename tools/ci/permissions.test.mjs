// W0.04 · «Каждый x-permissions есть в api/permissions.yaml» (14-engineering «Поток контракта» п.2).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importIfExists, read, runNode, tempTree } from './_util.mjs';

const SCRIPT = 'tools/ci/check-permissions.mjs';
const mod = await importIfExists(SCRIPT);

function need() {
  assert.ok(mod, `${SCRIPT} ещё не существует`);
  return mod;
}

const CATALOG = `version: "0.2"
modules:
  core.members:
    label: Пользователи
    actions:
      members.read: { level: view, label: Просматривать }
      roles.manage: { level: settings, label: Роли }
  logistics:
    actions:
      fleet.inspections.submit: { level: create, label: Осмотр }
  platform:
    actions:
      platform.tenants.read: { label: Видеть организации }
role_templates:
  driver:
    actions: [members.read]
prototype_renames:
  fleet.inspections.create: fleet.inspections.submit
  knowledge.write: [knowledge.create, knowledge.update]
`;

const ROOT_SPEC = `openapi: 3.1.0
info: { title: t, version: '0.1' }
paths:
  /me:
    get:
      operationId: getMe
      x-permissions: []
  /members:
    get:
      operationId: listMembers
      x-permissions:
      - members.read
`;

const FLEET_SPEC = `get:
  operationId: listInspections
  x-permissions: [fleet.inspections.submit, platform.tenants.read]
post:
  operationId: createInspection
  x-permissions:
    - fleet.inspections.create
`;

describe('catalogKeys: ключи каталога', () => {
  it('ключи действий — ключи отображений actions на любой глубине', () => {
    const r = need().catalogKeys(CATALOG, 'api/permissions.yaml');
    assert.deepEqual(r.errors, []);
    assert.deepEqual([...r.keys.keys()].sort(), [
      'fleet.inspections.submit',
      'members.read',
      'platform.tenants.read',
      'roles.manage',
    ]);
  });

  it('списки actions в role_templates не считаются объявлением', () => {
    const r = need().catalogKeys(CATALOG, 'api/permissions.yaml');
    assert.equal(r.keys.size, 4);
  });

  it('prototype_renames → подсказки (строка и список)', () => {
    const r = need().catalogKeys(CATALOG, 'api/permissions.yaml');
    assert.deepEqual(r.renames.get('fleet.inspections.create'), ['fleet.inspections.submit']);
    assert.deepEqual(r.renames.get('knowledge.write'), ['knowledge.create', 'knowledge.update']);
  });

  it('ключ, объявленный в двух модулях, — ошибка', () => {
    const text = `modules:
  a:
    actions:
      files.read: { level: view }
  b:
    actions:
      files.read: { level: view }
`;
    const r = need().catalogKeys(text, 'api/permissions.yaml');
    assert.deepEqual(r.errors, [
      'api/permissions.yaml:7: ключ «files.read» объявлен дважды (первый раз — строка 4)',
    ]);
  });

  it('каталог без единого actions — ошибка', () => {
    const r = need().catalogKeys('version: "1"\n', 'api/permissions.yaml');
    assert.deepEqual(r.errors, [
      'api/permissions.yaml: в каталоге нет ни одного ключа действий (отображения actions)',
    ]);
  });
});

describe('findXPermissions: ссылки в OpenAPI', () => {
  it('собирает ключи с номерами строк; пустой список допустим', () => {
    const r = need().findXPermissions(ROOT_SPEC, 'api/openapi/ortus.yaml');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.refs, [{ key: 'members.read', file: 'api/openapi/ortus.yaml', line: 12 }]);
  });

  it('flow- и block-списки в файле тега', () => {
    const r = need().findXPermissions(FLEET_SPEC, 'api/openapi/paths/fleet.yaml');
    assert.deepEqual(
      r.refs.map((x) => `${x.key}@${x.line}`),
      ['fleet.inspections.submit@3', 'platform.tenants.read@3', 'fleet.inspections.create@7'],
    );
  });

  it('строка вместо списка — ошибка с номером строки', () => {
    const r = need().findXPermissions(
      'get:\n  x-permissions: members.read\n',
      'api/openapi/paths/x.yaml',
    );
    assert.deepEqual(r.errors, [
      'api/openapi/paths/x.yaml:2: x-permissions должен быть списком строк',
    ]);
  });

  it('YAML с синтаксической ошибкой — ошибка файла', () => {
    const r = need().findXPermissions('get: [\n', 'api/openapi/bad.yaml');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^api\/openapi\/bad\.yaml: YAML: /);
  });
});

describe('checkPermissions: дерево api/', () => {
  it('нет api/openapi — пропуск', () => {
    const t = tempTree({ 'README.md': '#' });
    try {
      const r = need().checkPermissions({ root: t.root });
      assert.equal(r.skipped, 'нет api/openapi');
      assert.deepEqual(r.errors, []);
    } finally {
      t.cleanup();
    }
  });

  it('есть спецификация, нет каталога — ошибка', () => {
    const t = tempTree({ 'api/openapi/ortus.yaml': ROOT_SPEC });
    try {
      const r = need().checkPermissions({ root: t.root });
      assert.deepEqual(r.errors, ['api/permissions.yaml: каталог прав не найден']);
    } finally {
      t.cleanup();
    }
  });

  it('неизвестный ключ и имя прототипа — ошибки с файлом, строкой и подсказкой; examples/ не читаются', () => {
    const t = tempTree({
      'api/permissions.yaml': CATALOG,
      'api/openapi/ortus.yaml': ROOT_SPEC,
      'api/openapi/paths/fleet.yaml': FLEET_SPEC,
      'api/openapi/paths/cash.yml': 'get:\n  x-permissions: [cash.read]\n',
      'api/openapi/examples/getMe/x-permissions.yaml': 'x-permissions: [nope.nope]\n',
    });
    try {
      const r = need().checkPermissions({ root: t.root });
      assert.deepEqual(r.errors, [
        'api/openapi/paths/cash.yml:2: x-permissions «cash.read» нет в api/permissions.yaml',
        'api/openapi/paths/fleet.yaml:7: x-permissions «fleet.inspections.create» нет в api/permissions.yaml (имя прототипа; в каталоге: fleet.inspections.submit)',
      ]);
      assert.equal(r.files, 3);
      assert.equal(r.refs, 5);
      assert.equal(r.keys, 4);
    } finally {
      t.cleanup();
    }
  });

  it('всё в каталоге — без ошибок', () => {
    const t = tempTree({ 'api/permissions.yaml': CATALOG, 'api/openapi/ortus.yaml': ROOT_SPEC });
    try {
      const r = need().checkPermissions({ root: t.root });
      assert.deepEqual(r.errors, []);
      assert.equal(r.refs, 1);
    } finally {
      t.cleanup();
    }
  });

  it('OpenAPI 0.1 против каталога 0.2: не хватает ровно 14 ключей cash/inventory/spa (C, факт 3)', () => {
    const t = tempTree({
      'api/permissions.yaml': read('design/docs/11-permissions.yaml'),
      'api/openapi/ortus.yaml': read('design/docs/v0.1/ortus-openapi-v0.1.yaml'),
    });
    try {
      const r = need().checkPermissions({ root: t.root });
      const missing = new Set(r.errors.map((e) => /«([^»]+)»/.exec(e)?.[1]));
      assert.ok(r.errors.length > 0);
      for (const k of missing) assert.match(k, /^(cash|inventory|spa)\./);
      assert.equal(missing.size, 14, [...missing].join(', '));
    } finally {
      t.cleanup();
    }
  });
});

describe('check-permissions CLI', () => {
  it('нет api/openapi — «пропуск», exit 0', () => {
    const t = tempTree({ 'README.md': '#' });
    try {
      const r = runNode(SCRIPT, ['--root', t.root]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /permissions: нет api\/openapi — пропуск/);
    } finally {
      t.cleanup();
    }
  });

  it('ошибки — exit 1 и сообщения в stderr; успех — сводка', () => {
    const bad = tempTree({
      'api/permissions.yaml': CATALOG,
      'api/openapi/paths/cash.yaml': 'get:\n  x-permissions: [cash.read]\n',
    });
    const good = tempTree({ 'api/permissions.yaml': CATALOG, 'api/openapi/ortus.yaml': ROOT_SPEC });
    try {
      const r1 = runNode(SCRIPT, ['--root', bad.root]);
      assert.equal(r1.status, 1);
      assert.match(
        r1.stderr,
        /cash\.yaml:2: x-permissions «cash\.read» нет в api\/permissions\.yaml/,
      );
      const r2 = runNode(SCRIPT, ['--root', good.root]);
      assert.equal(r2.status, 0, r2.stderr);
      assert.match(r2.stdout, /permissions: 1 ссылок в 1 файлах, каталог 4 ключей — ок/);
    } finally {
      bad.cleanup();
      good.cleanup();
    }
  });
});
