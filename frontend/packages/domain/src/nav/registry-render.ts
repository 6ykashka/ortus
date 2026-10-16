// W1.20 · Текст генерируемого реестра манифестов навигации (план v2 §3.5 «Меню и гейты»: манифест на модуль
// и генерируемый реестр). Чистая функция: её вызывают генератор gen-registry.mjs и тест дрейфа.

export const REGISTRY_FILE = 'registry.gen.ts';

/** Реестр по именам файлов `modules/<id>.ts` (порядок — по имени). */
export function renderRegistry(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  const imports = sorted.map((id) => `import { manifest as ${id} } from './modules/${id}.ts';`);
  const items = sorted.map((id) => `  ${id},`);
  return [
    '// Сгенерировано src/nav/gen-registry.mjs (W1.20) — не править руками:',
    '// node --experimental-strip-types frontend/packages/domain/src/nav/gen-registry.mjs',
    ...imports,
    "import type { NavManifest } from './types.ts';",
    '',
    '/** Манифесты модулей навигации (`modules/<id>.ts`), по имени файла. */',
    'export const MANIFESTS: readonly NavManifest[] = [',
    ...items,
    '];',
    '',
  ].join('\n');
}
