// W0.07 · Правила Spectral контракта (12 «Линтер контракта»: operationId, x-permissions из каталога,
// x-scope, ответы 4xx через Problem; бриф §4.5). Каждое правило ловит свою фикстуру и молчит на бандле.
// Пустой x-permissions и security: [] — только с явным основанием (identity, x-public-capability,
// x-field-permissions), иначе новая операция незаметно станет эндпоинтом без проверки прав.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { before, describe, it } from 'node:test';
import { abs, BUNDLE_PATH, SPECTRAL_RULESET } from './lib/paths.mjs';
import { ERROR, runSpectral } from './lib/spectral.mjs';

const CLI = abs('node_modules/@stoplight/spectral-cli/dist/index.js');

const RULES = [
  'ortus-operation-id',
  'ortus-single-tag',
  'ortus-tag-known',
  'ortus-x-permissions-present',
  'ortus-x-permissions-in-catalog',
  'ortus-x-field-permissions-in-catalog',
  'ortus-x-permissions-empty',
  'ortus-public-security',
  'ortus-x-scope-known',
  'ortus-problem-json-errors',
  'ortus-problem-code-enum',
  'ortus-idempotency-key',
  'ortus-path-kebab',
];
const DIR = 'tools/gen/fixtures/spectral';
const fixture = (rule) => `${DIR}/bad-${rule.replace(/^ortus-/, '')}.yaml`;

describe('Spectral: правила Ортуса', () => {
  let results;
  before(() => {
    const files = readdirSync(abs(DIR)).map((f) => abs(`${DIR}/${f}`));
    results = runSpectral([BUNDLE_PATH, ...files]);
  });
  const errorsOf = (source) =>
    results.filter((r) => r.source === source && r.severity === ERROR).map((r) => r.code);

  it('бандл без ошибок Spectral', () => {
    const errs = results.filter(
      (r) => r.source === 'api/dist/ortus.bundle.yaml' && r.severity === ERROR,
    );
    assert.deepEqual(
      errs.map((r) => `${r.code} ${r.path.join('.')}: ${r.message}`),
      [],
    );
  });

  it('хорошая фикстура проходит все правила', () => {
    assert.deepEqual(errorsOf(`${DIR}/good.yaml`), []);
  });

  it('правила не зависят от каталога запуска (CI, плагины IDE)', () => {
    const r = spawnSync(
      process.execPath,
      [CLI, 'lint', BUNDLE_PATH, '--ruleset', SPECTRAL_RULESET, '-f', 'json', '--quiet'],
      { cwd: tmpdir(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const out = r.stdout.trim();
    assert.ok(out.startsWith('['), `Spectral не выдал JSON: ${(r.stderr || out).slice(0, 2000)}`);
    const errs = JSON.parse(out).filter((x) => x.severity === ERROR);
    assert.deepEqual(
      errs.map((x) => `${x.code} ${x.path.join('.')}: ${x.message}`),
      [],
    );
  });

  for (const rule of RULES) {
    it(`правило ${rule} ловит свою фикстуру и только его`, () => {
      assert.deepEqual([...new Set(errorsOf(fixture(rule)))], [rule]);
    });
  }
});
