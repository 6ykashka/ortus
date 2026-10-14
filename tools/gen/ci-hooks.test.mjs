// W0.07 · Крючки контракта для CI W0.04 (docs/plan/v2/ws/W0.04.md §4.1): шаги lint/spectral и
// contract/openapi-validate берут скрипты `lint:api` и `validate:api`, если они есть. Исходник
// api/openapi/ortus.yaml по PD-56 без components (securitySchemes — в components/common), поэтому
// линтуется только бандл api/dist/ortus.bundle.yaml (api/README.md «Что линтуется»).
// Связь с конвейером проверяется через его CLI (`node tools/ci/pipeline.mjs --dry-run --job <job>`,
// строки «▶ <job>/<step>: <команда>»), а не через внутренние JOBS/makeContext W0.04: рефакторинг
// pipeline.mjs не ломает test:contract, пока CLI печатает план шага.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { abs, ROOT } from './lib/paths.mjs';
import { readJson } from './lib/yaml-io.mjs';

const pkg = readJson(abs('package.json'));

/** Строка плана шага из `pipeline.mjs --dry-run --job <job>`: «▶ job/step: команда» или «⏭ …». */
function planLine(job, step) {
  const r = spawnSync(process.execPath, ['tools/ci/pipeline.mjs', '--dry-run', '--job', job], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const line = r.stdout.split(/\r?\n/).find((l) => l.includes(` ${job}/${step}:`));
  assert.ok(line, `нет шага ${job}/${step} в плане:\n${r.stdout}`);
  return line;
}

describe('крючки контракта для CI W0.04', () => {
  it('lint:api — Spectral по бандлу с правилами api/.spectral.yaml, блокируют только ошибки', () => {
    assert.equal(
      pkg.scripts['lint:api'],
      'spectral lint api/dist/ortus.bundle.yaml --ruleset api/.spectral.yaml --fail-severity error',
    );
  });

  it('validate:api — все проверки контракта (бандл, дрейф, OpenAPI 3.1, реестры, примеры)', () => {
    assert.equal(pkg.scripts['validate:api'], 'node tools/gen/contract.mjs --check');
  });

  it('postinstall-телеметрия @scarf/scarf (тянет Spectral) не запускается при pnpm install', () => {
    assert.ok(
      pkg.pnpm?.neverBuiltDependencies?.includes('@scarf/scarf'),
      'нужно pnpm.neverBuiltDependencies: ["@scarf/scarf"] в корневом package.json',
    );
  });

  it('шаг lint/spectral конвейера W0.04 вызывает lint:api, а не исходник без компонентов', () => {
    assert.match(planLine('lint', 'spectral'), /^▶ lint\/spectral: .*\brun lint:api$/);
  });

  it('шаг contract/openapi-validate конвейера W0.04 вызывает validate:api', () => {
    assert.match(
      planLine('contract', 'openapi-validate'),
      /^▶ contract\/openapi-validate: .*\brun validate:api$/,
    );
  });
});
