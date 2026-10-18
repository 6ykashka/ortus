// Имена экспорта модуля по исходнику: типы стираются при сборке, поэтому их нельзя получить через
// `Object.keys(await import(...))`. Разбираются `export interface|type|const|function|class X`,
// `export { a, b as c } from`, `export type { … } from` и `export (type) * from` (рекурсивно).
// Только для тестов экспорт-листа: `node:fs` берётся динамически, у пакета нет `@types/node`.

interface Fs {
  readFileSync(path: URL, enc: 'utf8'): string;
}

const FS_MODULE = 'node:fs';
let fs: Fs | undefined;

async function read(file: URL): Promise<string> {
  fs ??= (await import(/* @vite-ignore */ FS_MODULE)) as Fs;
  return fs.readFileSync(file, 'utf8');
}

const DECL =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:interface|type|class|const|let|function|enum)\s+([A-Za-z_$][\w$]*)/gm;
const LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const STAR = /^export\s+(?:type\s+)?\*\s+from\s+'([^']+)'/gm;

const listed = (body: string): string[] =>
  body
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((s) => s.split(/\s+as\s+/).pop() as string);

/**
 * Имена (типы и значения), которые экспортирует `file`. `skip` — модули, в которые не спускаться
 * (например, сам модуль базы знаний, когда интегратор подключит его к общему барелю).
 */
export async function exportedNames(
  file: URL,
  skip: readonly string[] = [],
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(file.href)) return [];
  seen.add(file.href);
  const src = await read(file);
  const out = new Set<string>();
  for (const m of src.matchAll(DECL)) out.add(m[1] as string);
  for (const m of src.matchAll(LIST)) for (const n of listed(m[1] as string)) out.add(n);
  for (const m of src.matchAll(STAR)) {
    const spec = m[1] as string;
    if (skip.includes(spec)) continue;
    for (const n of await exportedNames(new URL(spec, file), skip, seen)) out.add(n);
  }
  return [...out].sort();
}
