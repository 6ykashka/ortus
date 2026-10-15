// W0.07 · Примеры ответов ядра на идентификаторах сида (бриф §4.6; PD-43 — примеры файлами
// api/openapi/examples/<operationId>/; PD-30 — UUID v5 от прототипных ID).
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import {
  CORE_TAGS,
  checkExamples,
  collectUuids,
  loadExamples,
  PERSONAS,
  seedUuid,
} from './lib/examples.mjs';
import { listOperations } from './lib/inventory.mjs';
import { ERRORS_PATH, EXAMPLES_DIR, SEED_IDS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { uuidv5 } from './lib/uuid.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const examples = loadExamples();
const core = listOperations(doc).filter((o) => CORE_TAGS.includes(o.tag));
const codes = readYaml(ERRORS_PATH).codes;
const successStatus = (o) => Object.keys(o.op.responses).find((s) => /^[23]/.test(s));
// Ответ успеха без тела: 204 и редиректы входа 3xx (W0.08) — пример успеха не нужен.
const hasBody = (o) => Boolean(o.op.responses[successStatus(o)]?.content);

describe('примеры ядра', () => {
  it('ядро 0.1 — 37 операций тегов Context, Platform, Billing, Access, Modules, Files', () => {
    const tags0 = ['Context', 'Platform', 'Billing', 'Access', 'Modules', 'Files'];
    assert.equal(listOperations(source).filter((o) => tags0.includes(o.tag)).length, 37);
    assert.deepEqual(
      tags0.filter((t) => !CORE_TAGS.includes(t)),
      [],
    );
  });

  it('у каждой операции ядра есть пример успеха (если у ответа есть тело) и пример ошибки', () => {
    const gaps = [];
    for (const o of core) {
      const ex = examples.get(o.operationId) ?? new Map();
      const names = [...ex.keys()];
      const problems = names.filter((n) => n in codes);
      const success = names.filter((n) => !problems.includes(n));
      if (hasBody(o) && success.length === 0) gaps.push(`${o.operationId}: нет успеха`);
      if (problems.length === 0) gaps.push(`${o.operationId}: нет примера ошибки`);
    }
    assert.deepEqual(gaps, []);
  });

  it('getMyContext: пример на каждого персонажа пилота', () => {
    assert.deepEqual(
      [...examples.get('getMyContext').keys()].filter((n) => PERSONAS.includes(n)).sort(),
      [...PERSONAS].sort(),
    );
  });

  it('каждый пример валиден по схеме ответа (ajv 2020-12), у ошибки code = имя файла и статус реестра', () => {
    assert.deepEqual(checkExamples(doc, examples), []);
  });

  it('лишняя папка и невалидный пример ловятся', () => {
    const bad = new Map(examples);
    bad.set('noSuchOperation', new Map([['ok', {}]]));
    bad.set(
      'getFile',
      new Map([
        ['ok', { id: 'не-uuid' }],
        ['not_found', { code: 'forbidden_action' }],
      ]),
    );
    const errors = checkExamples(doc, bad);
    assert.ok(
      errors.some((e) => e.startsWith('noSuchOperation')),
      errors.join('\n'),
    );
    assert.ok(
      errors.some((e) => e.startsWith('getFile/ok')),
      errors.join('\n'),
    );
    assert.ok(
      errors.some((e) => e.startsWith('getFile/not_found')),
      errors.join('\n'),
    );
  });

  it('все UUID в примерах — из seed-ids.yaml', () => {
    const known = new Set(
      Object.values(readYaml(SEED_IDS_PATH).ids).flatMap((m) => Object.values(m)),
    );
    const unknown = [];
    for (const [op, ex] of examples) {
      for (const [name, body] of ex) {
        for (const u of collectUuids(body)) if (!known.has(u)) unknown.push(`${op}/${name}: ${u}`);
      }
    }
    assert.deepEqual(unknown, []);
  });

  it('seed-ids.yaml: UUID v5 от «ortus:<область>:<id прототипа>» в пространстве URL', () => {
    const seed = readYaml(SEED_IDS_PATH);
    assert.equal(seed.namespace, '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
    for (const [scope, ids] of Object.entries(seed.ids)) {
      for (const [id, uuid] of Object.entries(ids))
        assert.equal(uuid, seedUuid(scope, id), `${scope}:${id}`);
    }
    assert.equal(seed.ids.platform['t-alta'], seedUuid('platform', 't-alta'));
    assert.ok(seed.ids['t-alta']['m-kotova']);
    // П-15 (W1.00): членства — в области platform, по организации и аккаунту; один аккаунт в двух организациях —
    // два разных UUID (раньше проверялся id участника «Лотоса», который в примерах больше не нужен).
    assert.ok(seed.ids.platform['membership:t-lotos:acc-11']);
    assert.notEqual(
      seed.ids.platform['membership:t-lotos:acc-4'],
      seed.ids.platform['membership:t-alta:acc-4'],
    );
  });

  it('UUID v5 воспроизводим (вектор RFC 4122: DNS, www.example.com)', () => {
    assert.equal(
      uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'),
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('организации сида: «Альта Групп», «SPA «Лотос»», «Ремстрой Плюс», «Карго Сити»', () => {
    const page = examples.get('listPlatformTenants').get('ok');
    assert.deepEqual(
      page.items.map((t) => t.name),
      ['Альта Групп', 'SPA «Лотос»', 'Ремстрой Плюс', 'Карго Сити'],
    );
    assert.deepEqual(
      page.items.map((t) => t.status),
      ['trial', 'active', 'read_only', 'suspended'],
    );
  });

  it('владелец «Альты» видит «Альта Групп», оператор — без организаций', () => {
    const me = examples.get('getMyContext');
    assert.equal(me.get('owner').displayName, 'Дарья Зимина');
    assert.deepEqual(
      me.get('owner').tenants.map((t) => t.name),
      ['Альта Групп'],
    );
    assert.equal(me.get('operator').platformOperator, true);
    assert.deepEqual(me.get('operator').tenants, []);
  });

  it('папки примеров только операций бандла', () => {
    const ids = new Set(listOperations(doc).map((o) => o.operationId));
    const dirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.deepEqual(
      dirs.filter((d) => !ids.has(d)),
      [],
    );
  });
});
