// Эталон 14.10 для тестов паритета (только тесты; в код пакета не входит и не экспортируется).
// Каталог: переменная окружения ORTUS_REFERENCE_DIR (например, распакованный `ortus/` 14.10 до
// слияния W0.02), иначе `design/ortus` репозитория. Эталон импортируется, а не копируется.
// Если в каталоге снимок старше 14.10 (нет `buildWf`), тест падает с понятной причиной.

type Env = Record<string, string | undefined>;
const env = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};

const DEFAULT_DIR = new URL('../../../../../design/ortus/', import.meta.url);

/** URL каталога эталона с завершающим `/`. */
export function referenceDir(): URL {
  const dir = env()['ORTUS_REFERENCE_DIR'];
  if (!dir) return DEFAULT_DIR;
  const path = dir.replace(/\\/g, '/').replace(/\/?$/, '/');
  return new URL(path.startsWith('/') ? 'file://' + path : 'file:///' + path);
}

/** Импорт модуля эталона (`models.js`, `mock-data.js`, `api.js`). */
export async function importReference<T>(file: string): Promise<T> {
  return (await import(/* @vite-ignore */ new URL(file, referenceDir()).href)) as T;
}

/** Модели эталона с проверкой версии снимка. */
export async function referenceModels<T>(): Promise<T> {
  const m = await importReference<T & { buildWf?: unknown }>('models.js');
  if (typeof m.buildWf !== 'function') {
    throw new Error(
      'Эталон ' +
        referenceDir().href +
        ' старше 14.10 (нет buildWf). Задайте ORTUS_REFERENCE_DIR=<каталог ortus 14.10> ' +
        'или влейте W0.02 (design/ortus 14.10).',
    );
  }
  return m;
}
