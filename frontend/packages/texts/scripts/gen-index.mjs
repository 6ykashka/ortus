#!/usr/bin/env node
// W0.14 · Генератор src/index.ts словаря (горячая точка «баррель texts», план v2 §3.5) и реестра ключей.
//   node scripts/gen-index.mjs           — переписать src/index.ts по файлам доменов src/*.ts
//   node scripts/gen-index.mjs --check   — exit 1, если index.ts устарел
//   node --experimental-strip-types scripts/gen-index.mjs --keys
//                                        — дописать новые ключи в contract/keys.json (только добавление)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PKG, 'src');
const INDEX = join(SRC, 'index.ts');
const KEYS = join(PKG, 'contract', 'keys.json');
const SERVICE = new Set(['index.ts', 'icu.ts', 'types.ts']);
const WIDTH = 100;

const camel = (file) => file.replace(/\.ts$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Файлы доменов в алфавитном порядке: [файл, имя экспорта]. */
export function domains() {
  return readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !SERVICE.has(f))
    .sort()
    .map((f) => [f, camel(f)]);
}

/** Список в стиле prettier: в строку, если помещается, иначе по одному на строку. */
function list(head, names, tail) {
  const one = `${head}{ ${names.join(', ')} }${tail}`;
  if (one.length <= WIDTH) return one;
  return `${head}{\n${names.map((n) => `  ${n},`).join('\n')}\n}${tail}`;
}

export function renderIndex() {
  const ds = domains();
  const names = ds.map(([, n]) => n);
  return [
    '// Сгенерировано scripts/gen-index.mjs (W0.14) — не править руками:',
    '// corepack pnpm --filter @ortus/texts gen',
    ...ds.map(([f, n]) => `import { ${n} } from './${f}';`),
    '',
    list('export ', names, ';'),
    list('export ', ['IcuSyntaxError', 'argNames', 'format', 'parseMessage'], " from './icu.ts';"),
    list('export type ', ['MessageNode', 'MessageValues', 'TextTree'], " from './types.ts';"),
    '',
    '/** Все домены словаря — для охранников и сверок подписей. */',
    'export const ALL = {',
    ...names.map((n) => `  ${n},`),
    '} as const;',
    '',
  ].join('\n');
}

/** Пути всех листьев: «домен.ключ.подключ». */
export function leafPaths(tree, prefix) {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}.${k}`] : leafPaths(v, `${prefix}.${k}`),
  );
}

async function updateKeys() {
  const { ALL } = await import(pathToFileURL(INDEX).href);
  const now = Object.entries(ALL).flatMap(([ns, t]) => leafPaths(t, ns));
  const keys = JSON.parse(readFileSync(KEYS, 'utf8'));
  const known = new Set(keys);
  const added = now.filter((k) => !known.has(k));
  writeFileSync(KEYS, `${JSON.stringify([...keys, ...added], null, 2)}\n`, 'utf8');
  return added.length;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const arg = process.argv[2];
  if (arg === '--check') {
    if (readFileSync(INDEX, 'utf8') !== renderIndex()) {
      console.error('src/index.ts устарел: corepack pnpm --filter @ortus/texts gen');
      process.exit(1);
    }
  } else if (arg === '--keys') {
    console.log(`contract/keys.json: добавлено ключей — ${await updateKeys()}`);
  } else {
    writeFileSync(INDEX, renderIndex(), 'utf8');
    console.log(`src/index.ts: ${domains().length} доменов`);
  }
}
