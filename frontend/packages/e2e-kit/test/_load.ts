// Загрузка модуля пакета без падения на импорте: красный тест падает на утверждении
// о публичном имени, а не на отсутствующем файле (tdd-protocol.md §1). Не тест: glob `*.test.ts`.
export async function load<T = Record<string, unknown>>(rel: string): Promise<Partial<T>> {
  try {
    return (await import(new URL(rel, import.meta.url).href)) as Partial<T>;
  } catch {
    return {};
  }
}
