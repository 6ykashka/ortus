// W2.26 · Подписи «Данных» без эталона (no-reference, allowlist/core-data.md). Подписи эталона — домен
// `@ortus/texts` `data`; ошибка загрузки и «Повторить» — общие `LoadFailed` страниц ядра (W1.24).
// W4.50 · Журнал «Выгрузки» (07-ux-and-data §3) в эталоне не нарисован (B-6): подписи временные до прорисовки.

export const DATA_TEXT = {
  /** Следующая страница выборки по `nextCursor` (в эталоне пагинации нет; как «Файлы», Q-W1.24-12). */
  more: 'Показать ещё',
  jobs: {
    title: 'Выгрузки',
    /** Состояния задания (DatasetExportJob.state). */
    states: {
      queued: 'В очереди',
      running: 'Готовится',
      ready: 'Готова',
      failed: 'Не удалась',
      expired: 'Срок хранения истёк',
      revoked: 'Отозвана',
    },
    /** Сбой — только код (DatasetExportJob.failureCode). */
    failures: {
      timeout: 'Не уложилась во время',
      too_large: 'Файл слишком большой',
      source_unavailable: 'Источник данных недоступен',
      internal: 'Сбой при подготовке файла',
    },
    /** Почему отозвана (DatasetExportJob.revokeReason). */
    reasons: {
      author: 'Отозвана автором',
      owner: 'Отозвана владельцем',
      permissions_changed: 'Права изменились',
      module_disabled: 'Модуль отключён',
    },
    /** c — число строк (согласование), n — оно же с разрядами. */
    rows: '{c, plural, one {{n} строка} few {{n} строки} other {{n} строк}}',
    truncated:
      '{c, plural, one {{n} строка} few {{n} строки} other {{n} строк}}, обрезано по пределу',
    keep: 'файл до {at}',
    download: 'Скачать',
    cancel: 'Отменить',
    revoke: 'Отозвать',
    cancelled: 'Выгрузка отменена',
    revoked: 'Выгрузка отозвана',
  },
} as const;
