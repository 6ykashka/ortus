import { readFileSync } from 'node:fs';

export const read = (path: string): string => readFileSync(path, 'utf8');

/** Объявления `--ox-*` из CSS до первого `@media` (базовый `:root`). */
export function baseDeclarations(css: string): Map<string, string> {
  const head = css.split('@media')[0] ?? '';
  const withoutComments = head.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of withoutComments.matchAll(/(--ox-[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim());
  }
  return out;
}

/** Сравнение значений без учёта регистра, пробелов и ведущего нуля (`.18` ≡ `0.18`). */
export const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[^\d])0\./g, '$1.');
