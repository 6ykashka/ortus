// Примеры контракта — снимки сценарного сервера (W0.13, PD-43; цель `make examples` запускает интегратор).
//   node scripts/examples.mjs           — проверка: каждый пример этапа 1 воспроизводится (conformance), exit 1 при дрейфе
//   node scripts/examples.mjs --write   — пересъёмка: примеры без записи в deviations.ts, которые сервер отдаёт
//                                         иначе, переписываются его ответом (новые UUID → id карты seed-ids),
//                                         затем Prettier и пересборка contract.gen.json
// Писать в api/openapi/examples/ может только стюард контракта или интегратор (CODEOWNERS).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const write = process.argv.includes('--write');
const log = join(tmpdir(), `ortus-examples-${process.pid}.log`);

const run = spawnSync(
  process.execPath,
  [vitest, 'run', 'test/conformance/runner.test.ts', 'test/conformance/coverage.test.ts'],
  {
    cwd: PKG,
    stdio: 'inherit',
    env: { ...process.env, ORTUS_EXAMPLES_WRITE: write ? '1' : '', ORTUS_EXAMPLES_LOG: log },
  },
);

const files = existsSync(log)
  ? [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean))]
  : [];
rmSync(log, { force: true });
for (const file of files) {
  const config = (await prettier.resolveConfig(file)) ?? {};
  writeFileSync(
    file,
    await prettier.format(readFileSync(file, 'utf8'), { ...config, filepath: file }),
  );
}
if (files.length) {
  console.log(`examples: переснято ${files.length}:\n${files.map((f) => `  ${f}`).join('\n')}`);
  spawnSync(process.execPath, [join(PKG, 'scripts', 'contract.mjs')], {
    cwd: PKG,
    stdio: 'inherit',
  });
  console.log('Дальше: node tools/gen/contract.mjs --check (ajv примеров и карта seed-ids).');
} else {
  console.log(
    `examples: ${run.status === 0 ? 'все примеры этапа 1 — снимки сервера' : 'есть расхождения'}`,
  );
}
process.exitCode = run.status ?? 1;
