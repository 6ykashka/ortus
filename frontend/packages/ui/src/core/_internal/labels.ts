// Подписи компонентов по умолчанию — дословно из эталона (снимок design-stage-1). Совпадают с @ortus/texts
// (shell.modal, shell.a11y, gate.chips, gate.reason); пакет не импортируется — тексты страниц передаёт
// потребитель (контракт W0.10), здесь только то, что компонент рисует сам.
import type { AccessGateProps } from '../../types';

export const labels = {
  /** Ортус CRM.dc.html:2197 */
  cancel: 'Отмена',
  /** Ортус CRM.dc.html:3975 */
  busy: 'Выполняем…',
  /** Ортус CRM.dc.html:2276 */
  close: 'Закрыть',
  /** Ортус CRM.dc.html:183 (`aria-label` загрузки) */
  loading: 'Загрузка',
  /** Дизайн-система.dc.html:270 */
  retry: 'Повторить',
  /** Ортус CRM.dc.html:3030 */
  more: 'Ещё',
  /** Ортус CRM.dc.html:110 */
  scope: 'Область просмотра',
  /** Ортус CRM.dc.html:159 */
  planned: 'план',
} as const;

type Reason = AccessGateProps['reason'];

/** Чип и объяснение отказа: Ортус CRM.dc.html:3062–3080 (чипы), design/ortus/models.js REASON (тексты). */
export const gateCopy: Record<
  Reason,
  { chip: string; tone: 'neutral' | 'warn'; icon: string; text: string }
> = {
  module_off: {
    chip: 'Модуль не подключён',
    tone: 'neutral',
    icon: 'extension_off',
    text: 'Модуль не подключён организацией. Подключить его может владелец бизнеса.',
  },
  module_readonly: {
    chip: 'Модуль отключён',
    tone: 'neutral',
    icon: 'extension_off',
    text: 'Модуль отключён. История доступна для чтения, новые операции закрыты.',
  },
  no_permission: {
    chip: 'Нет права',
    tone: 'warn',
    icon: 'lock',
    text: 'Ни одна роль сотрудника не разрешает это действие.',
  },
  no_scope: {
    chip: 'Нет доступа к объекту',
    tone: 'warn',
    icon: 'visibility_off',
    text: 'Право есть, но объект находится вне области назначения.',
  },
};
