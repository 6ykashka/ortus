// W0.07 · Каталог прав api/permissions.yaml (11-permissions.yaml версии 14.10; C, факт 3: 14 ключей
// x-permissions OpenAPI 0.1 вне каталога; prototype_renames; бриф §4.4).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { listOperations } from './lib/inventory.mjs';
import { abs, PERMISSIONS_PATH } from './lib/paths.mjs';
import { checkCatalog, flattenActions } from './lib/permissions.mjs';
import { readJson, readYaml } from './lib/yaml-io.mjs';

const catalog = readYaml(PERMISSIONS_PATH);
const actions = flattenActions(catalog);
const source11 = readJson(abs('tools/gen/fixtures/11-permissions-14.10.json'));
const prototypeKeys = readJson(abs('tools/gen/fixtures/prototype-perm-keys-14.10.json')).keys;
const doc = bundle();

const ADDED = {
  inventory: [
    'inventory.items.read',
    'inventory.items.manage',
    'inventory.movements.read',
    'inventory.movements.post',
    'inventory.consume',
  ],
  spa: [
    'spa.services.read',
    'spa.services.manage',
    'spa.appointments.read',
    'spa.appointments.create',
    'spa.appointments.perform',
    'spa.appointments.complete',
  ],
  cash: ['cash.read', 'cash.post', 'cash.manage'],
};
// W4.04 (контракт «Базы знаний», docs/23-knowledge-spaces.md «Новые права», knowledge.md §3.1): к областям ключей
// core.knowledge добавлены space, page, relation (надмножество 11, порядок 11 — в начале), knowledge.publish — уровень
// review вместо settings (Q-W4.00-knowledge-5), пять новых ключей модуля.
const W404_SCOPES = new Set([
  'knowledge.read',
  'knowledge.create',
  'knowledge.update',
  'knowledge.publish',
]);
const W404_LEVEL = { 'knowledge.publish': 'review' };
const W404_KEYS = [
  'knowledge.organize',
  'knowledge.access.manage',
  'knowledge.members.manage',
  'knowledge.automation.manage',
  'knowledge.spaces.manage',
];
const FIELDS = [
  'level',
  'label',
  'scopes',
  'sensitivity',
  'owner_only',
  'blocked_by_function',
  'note',
];

/**
 * Поля ключей 11, изменённые после 14.10 явным решением (стюард контракта): 19.10b — подпись
 * fleet.reservations.manage «Ставить и снимать брони» (D-35 комплекта, docs/29 «Права»; W2.71, 0.6.3-stage2);
 * W4.03 (Q-W4.00-tasks-6) — область project у tasks.projects.manage: правка проекта и чужие вложения руководителем
 * проекта (шаблон project_manager); создание проекта — по-прежнему x-scope tenant-or-org-unit.
 */
const CHANGED_SINCE_14_10 = {
  'fleet.reservations.manage': { label: 'Ставить и снимать брони' },
  'tasks.projects.manage': { scopes: ['tenant', 'unit', 'project'] },
};

/** Ключи, добавленные контрактными дельтами этапов после W0.07: W2.71 — выбор из предложенных (D-35 комплекта). */
// W2.71 (S2-20) — fleet.reservations.choose; W4.07 (0.8.0-stage4) — branding.manage.
const ADDED_LATER = ['fleet.reservations.choose', 'branding.manage'];

describe('каталог прав api/permissions.yaml', () => {
  it('108 ключей 11 (14.10) сохранены дословно в своих модулях (кроме явных правок эталона)', () => {
    assert.equal(Object.keys(source11.actions).length, 108);
    for (const [key, src] of Object.entries(source11.actions)) {
      const a = actions.get(key);
      assert.ok(a, `нет ключа ${key}`);
      assert.equal(a.module, src.module, key);
      const want = { ...src, ...CHANGED_SINCE_14_10[key] };
      for (const f of FIELDS) {
        if (f === 'scopes' && W404_SCOPES.has(key)) {
          assert.deepEqual(a.scopes.slice(0, want.scopes.length), want.scopes, key);
        } else if (f === 'level' && key in W404_LEVEL) {
          assert.equal(a.level, W404_LEVEL[key], key);
        } else {
          assert.deepEqual(a[f], want[f], `${key}.${f}`);
        }
      }
    }
  });

  it('объявленные отличия от 11 (14.10) действительно отличаются (W2.71, W4.03)', () => {
    for (const [key, fields] of Object.entries(CHANGED_SINCE_14_10)) {
      for (const f of Object.keys(fields)) {
        assert.notDeepEqual(source11.actions[key][f], fields[f], `${key}.${f} совпадает с 11`);
      }
    }
  });

  it('14 ключей cash/inventory/spa из OpenAPI 0.1, forms.responses.assign и ключи этапов добавлены, итого 129', () => {
    for (const k of ADDED_LATER) assert.ok(actions.has(k), k);
    for (const [mod, keys] of Object.entries(ADDED)) {
      assert.equal(catalog.modules[mod]?.proposed, true, `модуль ${mod} помечен proposed`);
      assert.deepEqual(Object.keys(catalog.modules[mod].actions), keys, mod);
    }
    assert.equal(Object.values(ADDED).flat().length, 14);
    const assign = actions.get('forms.responses.assign');
    assert.ok(assign, 'нет forms.responses.assign (x-field-permissions reviewFormResponse)');
    assert.equal(assign.module, 'core.forms');
    assert.deepEqual(assign.scopes, ['tenant', 'unit', 'project']);
    assert.match(assign.note ?? '', /PROPOSED W0\.07/);
    for (const k of W404_KEYS) assert.equal(actions.get(k)?.module, 'core.knowledge', k);
    assert.equal(actions.size, 123 + ADDED_LATER.length + W404_KEYS.length);
  });

  it('каждый x-permissions бандла есть в каталоге', () => {
    const missing = listOperations(doc).flatMap((o) =>
      (o.op['x-permissions'] ?? [])
        .filter((k) => !actions.has(k))
        .map((k) => `${o.operationId}: ${k}`),
    );
    assert.deepEqual(missing, []);
  });

  it('каждое значение x-field-permissions бандла есть в каталоге', () => {
    const withFields = listOperations(doc).filter((o) => o.op['x-field-permissions']);
    assert.ok(withFields.length > 0, 'в бандле нет x-field-permissions');
    const missing = withFields.flatMap((o) =>
      Object.entries(o.op['x-field-permissions'])
        .filter(([, k]) => !actions.has(k))
        .map(([f, k]) => `${o.operationId}.${f}: ${k}`),
    );
    assert.deepEqual(missing, []);
  });

  it('каждое действие шаблона роли есть в каталоге; шаблоны 11 на месте', () => {
    for (const [name, t] of Object.entries(catalog.role_templates)) {
      for (const k of [...(t.actions ?? []), ...(t.optional_restricted ?? [])]) {
        assert.ok(actions.has(k), `${name}: ${k}`);
      }
    }
    for (const name of source11.role_templates) assert.ok(catalog.role_templates[name], name);
  });

  it('prototype_renames 11 сохранены, цели — ключи каталога или null', () => {
    for (const [k, v] of Object.entries(source11.prototype_renames)) {
      assert.deepEqual(catalog.prototype_renames[k], v, k);
    }
    for (const [k, v] of Object.entries(catalog.prototype_renames)) {
      assert.ok(!actions.has(k), `${k} переименовывается, но сам есть в каталоге`);
      if (v === null) continue;
      for (const t of [v].flat()) assert.ok(actions.has(t), `${k} → ${t}`);
    }
  });

  it('каждый ключ прав прототипа 14.10 в каталоге, переименован или отложен до своего шага', () => {
    assert.equal(prototypeKeys.length, 85);
    const renamed = new Set(Object.keys(catalog.prototype_renames));
    const pending = new Set(Object.keys(catalog.prototype_pending));
    const lost = prototypeKeys.filter((k) => !actions.has(k) && !renamed.has(k) && !pending.has(k));
    assert.deepEqual(lost, []);
    for (const [k, v] of Object.entries(catalog.prototype_pending)) {
      assert.ok(!actions.has(k), `${k} отложен, но уже в каталоге`);
      assert.match(v, /^W\d\.\d\d /, `${k}: ${v}`);
    }
  });

  it('platform.* без scopes и уровней', () => {
    const platform = [...actions].filter(([k]) => k.startsWith('platform.'));
    assert.equal(platform.length, 9);
    for (const [k, a] of platform) {
      assert.equal(a.scopes, undefined, k);
      assert.equal(a.level, undefined, k);
    }
  });

  it('owner_only и blocked_by_function на месте', () => {
    for (const k of [
      'modules.manage',
      'billing.manage',
      'chat.hold.manage',
      'chat.policy.manage',
    ]) {
      assert.equal(actions.get(k).owner_only, true, k);
    }
    for (const k of ['fleet.earnings.read', 'fleet.earnings.manage', 'chat.pdn.read']) {
      assert.deepEqual(actions.get(k).blocked_by_function, ['driver'], k);
    }
  });

  it('проверка каталога целиком без ошибок; лишний ключ x-permissions ловится', () => {
    assert.deepEqual(checkCatalog(catalog, doc, prototypeKeys), []);
    const bad = structuredClone(doc);
    bad.paths['/api/v1/me/context'].get['x-permissions'] = ['nobody.knows'];
    const errors = checkCatalog(catalog, bad, prototypeKeys);
    assert.ok(
      errors.some((e) => e.includes('getMyContext') && e.includes('nobody.knows')),
      errors.join('\n'),
    );
  });

  it('checkCatalog ловит ключ x-field-permissions вне каталога', () => {
    const bad = structuredClone(doc);
    const op = listOperations(bad).find((o) => o.operationId === 'reviewFormResponse').op;
    op['x-field-permissions'] = { ...op['x-field-permissions'], reviewComment: 'nobody.knows' };
    const errors = checkCatalog(catalog, bad, prototypeKeys);
    assert.ok(
      errors.some(
        (e) =>
          e.includes('reviewFormResponse') &&
          e.includes('x-field-permissions') &&
          e.includes('nobody.knows'),
      ),
      errors.join('\n'),
    );
  });
});
