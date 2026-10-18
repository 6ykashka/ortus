// W2.26 · Подписи «Данных» без эталона (no-reference, allowlist/core-data.md). Подписи эталона — домен
// `@ortus/texts` `data`; ошибка загрузки и «Повторить» — общие `LoadFailed` страниц ядра (W1.24).

export const DATA_TEXT = {
  /** Следующая страница выборки по `nextCursor` (в эталоне пагинации нет; как «Файлы», Q-W1.24-12). */
  more: 'Показать ещё',
} as const;
