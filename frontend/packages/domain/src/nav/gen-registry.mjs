// W1.20 · Генератор реестра манифестов навигации: modules/*.ts → registry.gen.ts.
//   node --experimental-strip-types frontend/packages/domain/src/nav/gen-registry.mjs [--check]
// Новый модуль добавляет файл modules/<id>.ts и запускает генератор; реестр руками не правится (план v2 §3.5).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGISTRY_FILE, renderRegistry } from './registry-render.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ids = readdirSync(join(here, 'modules'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.slice(0, -3));
const text = renderRegistry(ids);
const file = join(here, REGISTRY_FILE);

if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) {
    console.error(`${REGISTRY_FILE} устарел: запустите gen-registry.mjs`);
    process.exitCode = 1;
  } else {
    console.log(`${REGISTRY_FILE} свежий: ${ids.length} манифестов`);
  }
} else {
  writeFileSync(file, text);
  console.log(`${REGISTRY_FILE}: ${ids.length} манифестов`);
}
