// W2.25 · Генератор реестра источников «Требует решения»: sources/*.ts → sources.gen.ts.
//   node --experimental-strip-types frontend/packages/domain/src/home/gen-sources.mjs [--check]
// Новый модуль добавляет файл sources/<id>.ts и запускает генератор; реестр и общий VM руками не правятся.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSources, SOURCES_FILE } from './sources-render.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ids = readdirSync(join(here, 'sources'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.slice(0, -3));
const text = renderSources(ids);
const file = join(here, SOURCES_FILE);

if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) {
    console.error(`${SOURCES_FILE} устарел: запустите gen-sources.mjs`);
    process.exitCode = 1;
  } else {
    console.log(`${SOURCES_FILE} свежий: ${ids.length} источников`);
  }
} else {
  writeFileSync(file, text);
  console.log(`${SOURCES_FILE}: ${ids.length} источников`);
}
