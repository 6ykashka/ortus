// Генератор баррели src/index.ts по каталогам src/core/* и src/domain/* (план §3.5: баррели генерируются).
//   node scripts/gen-barrel.mjs          — записать src/index.ts
//   node scripts/gen-barrel.mjs --check  — код 1, если файл устарел
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = join(import.meta.dirname, '../src');
export const BARREL_PATH = join(SRC, 'index.ts');

const units = (group) =>
  readdirSync(join(SRC, group), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SRC, group, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort();

export function barrelSource() {
  return [
    '// Сгенерировано scripts/gen-barrel.mjs по каталогам src/core/* и src/domain/*.',
    '// Не править руками: corepack pnpm --filter @ortus/ui barrel',
    ...units('core').map((name) => `export * from './core/${name}';`),
    ...units('domain').map((name) => `export * from './domain/${name}';`),
    "export type * from './types';",
    "export type { Unit } from './contract';",
    "export { OWNERS, PROP_KEYS, UNITS } from './contract';",
    '',
  ].join('\n');
}

if (resolve(process.argv[1] ?? '') === import.meta.filename) {
  const source = barrelSource();
  const current = existsSync(BARREL_PATH) ? readFileSync(BARREL_PATH, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (current !== source) {
      console.error(`устарел: ${BARREL_PATH} — запустите corepack pnpm --filter @ortus/ui barrel`);
      process.exit(1);
    }
  } else if (current !== source) {
    writeFileSync(BARREL_PATH, source, 'utf8');
    console.log(`записан: ${BARREL_PATH}`);
  }
}
