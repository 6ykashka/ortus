// W1.25 · Подписи «Организаций» оператора. Подписи эталона — из @ortus/texts (platform.tenants, company, shell,
// toast); здесь — шаблоны строк эталона, которых нет в словаре (opVM :3532–3568), и подписи без эталона: поле
// «Причина» (S1-04, design-requests), строки «Журнала действий» по action (контракт не отдаёт текст, 04 §12),
// состояния без эталона (бриф W1.25 §10). ICU — format() из @ortus/texts.
import { company, platform } from '@ortus/texts';

export const ORGS_TEXT = {
  dash: '—',
  usage: '{used} из {quota} ГБ',
  seatsOf: company.billing.seatsOf,
  seatsUnlimited: '{used} · без ограничения',
  ownerSeats: '{used}/{limit}',
  gb: '{gb} ГБ',
  plan: {
    trial: '«{tier}» · пробный · цены v{version}',
    paid: '«{tier}» · цены v{version}',
    bare: '«{tier}»',
  },
  tiers: {
    start: 'Старт',
    team: 'Команда',
    biz: 'Бизнес',
    net: 'Сеть',
    unl: 'Безлимит',
  } as Readonly<Record<string, string>>,
  status: {
    trial: company.modules.trial.chipTrial,
    active: company.modules.trial.chipActive,
    restricted: company.modules.trial.chipRestricted,
    suspended: 'Приостановлен',
    provisioning: 'Создаётся',
    closing: 'Закрывается',
    closed: 'Закрыта',
  },
  /** Список: состояния без эталона (подпись области карточки — заголовок h2, Q-W1.25-15). */
  empty: 'Организаций пока нет',
  loadError: 'Не удалось загрузить организации: {error}',
  /** Нет связи при чтении (список, подписка, организация, журнал): без «Операция не выполнена» команд. */
  offlineRead: 'Нет связи с сервером. Проверьте подключение.',
  retry: 'Повторить',
  /** Строка списка, у которой не загрузилась подписка: «—» в ней — сбой, а не данные этапа 4. */
  subMissing: 'Подписка не загружена',
  /** Карточка: загрузка и ошибки своих данных (подписка, организация, журнал) — без эталона. */
  card: {
    subError: 'Не удалось загрузить подписку: {error}',
    tenantError: 'Не удалось загрузить организацию: {error}',
    auditError: 'Не удалось загрузить журнал: {error}',
    auditEmpty: 'Действий пока нет',
  },
  reason: {
    label: 'Причина',
    hint: 'От 5 до 500 символов',
    tooLong: 'Не больше 500 символов',
  },
  audit: {
    trialStarted:
      '{name}: открыт пробный период на {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}',
    trialStartedQuota:
      '{name}: открыт пробный период на {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}, квота {gb} ГБ',
    trialEnded: '{name}: пробный период завершён, новые операции ограничены',
    trialExtended:
      '{name}: пробный период продлён на {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}',
    status: '{name}: статус «{status}»',
    quota: '{name}: квота {gb} ГБ',
    renamed: '{name}: организация переименована',
    created: '{name}: организация создана',
    other: '{name}: {action}',
    denied: '{text} · отказано',
    failed: '{text} · ошибка',
    meta: '{at} · {by}',
    reason: 'Причина: {reason}',
    system: 'Система',
  },
  trialLeft: platform.tenants.trialLeft,
  trialEnded: platform.tenants.trialEnded,
  notApplicable: platform.tenants.notApplicable,
} as const;
