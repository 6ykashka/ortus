// W4.61 · Подписи страниц шага 4.6, которых нет в @ortus/texts: шаблоны строк эталона (usageVM, requestsVM,
// accountsVM, platformOrgVM, plansVM, billingVM — «Ортус CRM.dc.html» design-2026-10-19) и состояния без эталона
// (загрузка, ошибка чтения, нет права роли — бриф W4.61 §5). ICU — format() из @ortus/texts.
import { company } from '@ortus/texts';

export const KIT_TEXT = {
  dash: '—',
  status: {
    trial: company.modules.trial.chipTrial,
    active: company.modules.trial.chipActive,
    restricted: company.modules.trial.chipRestricted,
    suspended: 'Приостановлен',
    provisioning: 'Создаётся',
    closing: 'Закрывается',
    closed: 'Закрыта',
  },
  /** Состояния без эталона: ошибка чтения раздела, нет связи при чтении, повтор. */
  state: {
    offlineRead: 'Нет связи с сервером. Проверьте подключение.',
    retry: 'Повторить',
  },
} as const;
