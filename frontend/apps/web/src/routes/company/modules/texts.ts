// W1.24 · Подписи «Модули и место» и «Хранилище», которых нет в `@ortus/texts` (Q-W1.24-13). Строки эталона
// design-stage-1 помечены строкой источника; без эталона — no-reference (B-6 №5, PD-48). Перенос в словарь
// `@ortus/texts/company.ts` — через владельца словаря (стюард этапа).
import { format, type MessageValues } from '@ortus/texts';

export const MOD_TEXT = {
  /** Группы разбивки места (`ortus/mock-data.js` :150–152, StorageBreakdownGroup.key). */
  groups: {
    photos: 'Фото осмотров и отчётов',
    documents: 'Документы',
    attachments: 'Вложения задач и форм',
    other: 'Прочее',
  },
  /** Ссылка из карточки «Место организации» на «Хранилище» (Q-W1.24-8, без эталона). */
  storageLink: 'Хранилище',
  /** Строка «Затронет сейчас» сверх 50 показанных (`hiddenCount`, без эталона). */
  hiddenItems: 'И ещё {n}',
  /** Строки «Затронет сейчас» по виду (`toggleModule` :2665–2666; Q-W1.24-6). */
  affects: {
    process: '{title} · {state}',
    processWho: '{title} · {state} · {who}',
    form: 'Форма «{title}» — приём новых ответов остановится',
    automation: 'Автоматизация «{title}» будет приостановлена',
  },
  /** Ошибка загрузки данных страницы (role=alert, без эталона). */
  loadFailed: 'Не удалось загрузить данные: {error}',
  storage: {
    title: 'Хранилище',
    intro:
      'Файлы всех модулей, база данных и резерв начатых загрузок. Уменьшение лимита не удаляет файлы.',
    reserved: 'Резерв начатых загрузок: {gb} ГБ',
    measured: 'Оценка на {at}',
    groupsTitle: 'По видам файлов',
    modulesTitle: 'По модулям',
    files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}',
    coreModule: 'База данных и служебные данные',
    changeTitle: 'Изменить лимит',
    changeNote:
      'Сначала расчёт: он показывает стоимость и действует ограниченное время. Уменьшение ниже занятого места сервер не примет.',
    newLimit: 'Новый лимит',
    quote: 'Рассчитать',
    quoteLine: 'Лимит {gb} ГБ · {price} в месяц',
    /** Расчёт без `recurringCharge`: цену не показываем, а не «0 ₽». */
    quoteLineFree: 'Лимит {gb} ГБ',
    quoteUntil: 'Расчёт действует до {at}',
    apply: 'Применить',
    cancel: 'Отмена',
    pending: 'Запрошено уменьшение до {gb} ГБ с {at}',
    /** `StorageChange.state = scheduled` без `effectiveAt`. */
    pendingNoDate: 'Запрошено уменьшение до {gb} ГБ',
  },
  /** Повтор загрузки данных страницы после ошибки (без эталона). */
  retry: 'Повторить',
} as const;

export const t = (message: string, values?: MessageValues): string => format(message, values);
