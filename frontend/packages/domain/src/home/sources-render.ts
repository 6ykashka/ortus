// W2.25 · Текст генерируемого реестра источников «Требует решения» (план v2 §3.5: источник на модуль и
// генерируемый реестр, как меню W1.20). Чистая функция: её вызывают генератор gen-sources.mjs и тест дрейфа.

export const SOURCES_FILE = 'sources.gen.ts';
const PRINT_WIDTH = 100;

/** Реестр по именам файлов `sources/<id>.ts` (порядок — по имени). */
export function renderSources(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  const imports = sorted.map((id) => `import { source as ${id} } from './sources/${id}.ts';`);
  // Как печатает prettier (printWidth 100): список в одну строку, если помещается.
  const head = 'export const HOME_SOURCES: readonly HomeSource[] = [';
  const line = `${head}${sorted.join(', ')}];`;
  const items =
    line.length <= PRINT_WIDTH ? [line] : [head, ...sorted.map((id) => `  ${id},`), '];'];
  return [
    '// Сгенерировано src/home/gen-sources.mjs (W2.25) — не править руками:',
    '// node --experimental-strip-types frontend/packages/domain/src/home/gen-sources.mjs',
    ...imports,
    "import type { HomeSource } from './types.ts';",
    '',
    '/** Источники «Требует решения» (`sources/<id>.ts`), по имени файла. */',
    ...items,
    '',
  ].join('\n');
}
