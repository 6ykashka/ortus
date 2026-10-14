// W0.07 · Реестр кодов ошибок api/errors.yaml и enum Problem.code
// (12-errors-and-events.md версии 14.10: «Реестр кодов», «Формат ошибки»; PD-34; бриф §4.2–4.3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { abs, ERRORS_PATH } from './lib/paths.mjs';
import { readJson, readYaml } from './lib/yaml-io.mjs';

const registry = readYaml(ERRORS_PATH);
const codes = registry.codes;
const rows = readJson(abs('tools/gen/fixtures/12-errors-rows-14.10.json')).rows;
const prototype = readJson(abs('tools/gen/fixtures/prototype-error-codes-14.10.json')).codes;
const PD34 = ['seats_exhausted', 'request_pending', 'tier_below_usage', 'not_implemented'];
const RETRYABLE = [
  'reservation_overlap',
  'resources_unavailable',
  'idempotency_in_progress',
  'rate_limited',
  'dependency_unavailable',
];

describe('реестр api/errors.yaml', () => {
  it('реестр содержит 52 кода: 48 из 12 (14.10) и 4 из PD-34', () => {
    assert.equal(rows.flatMap((r) => r.codes).length, 48);
    assert.equal(Object.keys(codes).length, 52);
    for (const c of PD34) assert.equal(codes[c]?.source, 'PD-34', c);
  });

  it('каждая строка реестра 12 представлена дословно с тем же статусом', () => {
    for (const row of rows) {
      for (const code of row.codes) {
        const e = codes[code];
        assert.ok(e, `нет кода ${code} (12:${row.line})`);
        assert.equal(e.status, row.status, code);
        assert.equal(e.title, row.when, code);
        assert.equal(e.ui, row.ui, code);
        assert.equal(e.source, `12:${row.line}`, code);
      }
    }
  });

  it('порядок кодов — порядок строк 12, затем PD-34', () => {
    assert.deepEqual(Object.keys(codes), [...rows.flatMap((r) => r.codes), ...PD34]);
  });

  it('retryable только у пяти кодов', () => {
    const actual = Object.entries(codes)
      .filter(([, e]) => e.retryable === true)
      .map(([c]) => c);
    assert.deepEqual(actual.sort(), [...RETRYABLE].sort());
    for (const [c, e] of Object.entries(codes)) assert.equal(typeof e.retryable, 'boolean', c);
  });

  it('у каждого кода HTTP-статус 4xx/5xx и snake_case', () => {
    for (const [c, e] of Object.entries(codes)) {
      assert.match(c, /^[a-z][a-z0-9_]*$/);
      assert.ok(e.status >= 400 && e.status <= 599, c);
    }
  });

  it('клиентские состояния offline, timeout, upload_failed — вне enum', () => {
    assert.deepEqual(Object.keys(registry.client_states).sort(), [
      'offline',
      'timeout',
      'upload_failed',
    ]);
    for (const c of Object.keys(registry.client_states)) assert.equal(codes[c], undefined, c);
  });

  it('коды ApiError прототипа 14.10 замаплены на канон', () => {
    const known = new Set([...Object.keys(codes), ...Object.keys(registry.client_states)]);
    assert.deepEqual(Object.keys(registry.prototype_codes).sort(), [...prototype].sort());
    for (const [p, target] of Object.entries(registry.prototype_codes)) {
      for (const t of [target].flat()) assert.ok(known.has(t), `${p} → ${t}`);
    }
  });

  it('коды из описаний 0.1 вне реестра замаплены на канон', () => {
    assert.deepEqual(Object.keys(registry.openapi_0_1_aliases).sort(), [
      'driver_unavailable',
      'file_not_ready',
      'form_version_changed',
      'plan_required',
    ]);
    for (const [a, t] of Object.entries(registry.openapi_0_1_aliases)) {
      assert.ok(codes[t], `${a} → ${t}`);
    }
  });
});

describe('Problem в бандле', () => {
  const schemas = bundle().components.schemas;

  it('enum ProblemCode в бандле равен реестру и в том же порядке', () => {
    assert.equal(schemas.ProblemCode.type, 'string');
    assert.deepEqual(schemas.ProblemCode.enum, Object.keys(codes));
  });

  it('Problem.code ссылается на ProblemCode', () => {
    assert.deepEqual(schemas.Problem.properties.code, { $ref: '#/components/schemas/ProblemCode' });
    assert.ok(schemas.Problem.required.includes('code'));
  });

  it('Problem.retryable — необязательное boolean (12 «Формат ошибки»)', () => {
    assert.equal(schemas.Problem.properties.retryable.type, 'boolean');
    assert.ok(!schemas.Problem.required.includes('retryable'));
  });
});
