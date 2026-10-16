// W1.20 · Подписи оболочки, которых нет в эталоне design-stage-1 и в `@ortus/texts` (no-reference, B-6):
// переключатель бизнеса (S1-07), выход (вместо «Выйти · недоступно в демо», PD-54), «Страница не найдена»,
// skip-link (components.md:37). Перенос в `@ortus/texts/shell.ts` — через владельца словаря (стюард этапа).
import { format, type MessageValues } from '@ortus/texts';

export const SHELL_TEXT = {
  switcher: {
    title: 'Бизнесы',
    /** Доступное имя кнопки: начинается с видимого названия организации (WCAG 2.5.3 Label in Name). */
    label: '{name} — сменить бизнес',
  },
  logout: 'Выйти',
  notFound: {
    title: 'Страница не найдена',
    text: 'Адрес устарел или раздел вам недоступен. Выберите раздел в меню.',
    /** Вне оболочки (чужая организация, неизвестный путь): меню нет, выход — ссылка на «/». */
    global: 'Адрес устарел или раздел вам недоступен.',
    home: 'На стартовую страницу',
  },
  skipLink: 'К содержимому',
  /** Область сотрудника, когда названия подразделений ему не видны (нет права org_units.read). */
  myAssignments: 'Мои назначения',
  /** Подпись шаблона роли `owner` (api/permissions.yaml, roleTemplates.owner.label). */
  ownerRole: 'Владелец бизнеса',
  noTenants: 'Нет организаций',
  /** Шапка до ответа /me/context (:2823). */
  bootTenant: 'Ортус',
  bootScope: 'Загрузка…',
} as const;

export const t = (message: string, values?: MessageValues): string => format(message, values);
