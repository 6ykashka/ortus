// W0.07 · Реестр кодов ошибок api/errors.yaml и enum Problem.code
// (12-errors-and-events.md версии 14.10: «Реестр кодов», «Формат ошибки»; PD-34; бриф §4.2–4.3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { abs, ERRORS_PATH } from './lib/paths.mjs';
import { readJson, readYaml } from './lib/yaml-io.mjs';
import { W5_CODES } from './lib/stage5.mjs';

const registry = readYaml(ERRORS_PATH);
const codes = registry.codes;
const rows = readJson(abs('tools/gen/fixtures/12-errors-rows-14.10.json')).rows;
const prototype = readJson(abs('tools/gen/fixtures/prototype-error-codes-14.10.json')).codes;
const PD34 = ['seats_exhausted', 'request_pending', 'tier_below_usage', 'not_implemented'];
/** Коды контрактных дельт этапов (стюард, только добавление в конец): W2.71 — выбор машины закрыт (D-35 комплекта). */
const LATER = ['offer_closed', ...W5_CODES]; // W5.00 — 5 кодов кассы (cash.md §2.4)
/** W7.00 (0.12.0-stage7): «Чаты», «Документы», «Обращения» — коды в конец реестра (chats.md §2.2, documents.md §2.2, service.md §2.4). */
const STAGE7 = [
  'chat_ephemeral_disabled',
  'document_locked',
  'range_protected',
  'formula_invalid',
  'job_in_progress',
  'file_password_protected',
  'sign_code_invalid',
  'service_assignee_out_of_scope',
];
const RETRYABLE = [
  'reservation_overlap',
  'resources_unavailable',
  'idempotency_in_progress',
  'rate_limited',
  'dependency_unavailable',
];

describe('реестр api/errors.yaml', () => {
  it('реестр содержит 61 код: 48 из 12 (14.10), 4 из PD-34 и коды дельт этапов', () => {
    assert.equal(rows.flatMap((r) => r.codes).length, 48);
    assert.equal(Object.keys(codes).length, 52 + LATER.length + STAGE7.length);
    for (const c of PD34) assert.equal(codes[c]?.source, 'PD-34', c);
    for (const c of LATER.filter((x) => !W5_CODES.includes(x))) {
      assert.match(codes[c]?.source ?? '', /D-35 комплекта/, c);
    }
    for (const c of W5_CODES) assert.match(codes[c]?.source ?? '', /W5\.00/, c);
    for (const c of STAGE7) assert.match(codes[c]?.source ?? '', /W7\.00/, c);
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

  it('порядок кодов — порядок строк 12, затем PD-34, затем коды дельт этапов (только добавление)', () => {
    assert.deepEqual(Object.keys(codes), [
      ...rows.flatMap((r) => r.codes),
      ...PD34,
      ...LATER,
      ...STAGE7,
    ]);
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
