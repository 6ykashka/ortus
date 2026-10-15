import type { ReactElement } from 'react';
import type { AccessGateProps } from '../../types';
import { gateCopy } from '../_internal/labels';
import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './AccessGate.module.css';

/**
 * Отказ доступа (Ортус CRM.dc.html:195–202; gateVM :3053–3081): круг 56 с иконкой, чип причины, `h1`,
 * объяснение и действие — только если оно доступно. Чип и тон — по `reason`; заголовок и текст страницы
 * передаёт потребитель (`@ortus/texts` gate), без них — чип и объяснение причины (models.js REASON).
 * `module_readonly` у того, кто видит модуль, гейт не показывают — решает страница (components.md).
 */
export function AccessGate({
  reason,
  moduleName,
  title,
  text,
  action,
}: AccessGateProps): ReactElement {
  const copy = gateCopy[reason];
  const moduleTitle =
    moduleName && (reason === 'module_off' || reason === 'module_readonly')
      ? `«${moduleName}» не подключён организацией`
      : undefined;
  return (
    <div className={styles.gate} data-reason={reason}>
      <span className={styles.circle} data-tone={copy.tone}>
        <Icon name={copy.icon} size={28} />
      </span>
      <span className={styles.chip} data-chip="" data-tone={copy.tone}>
        {copy.chip}
      </span>
      <h1 className={styles.title}>{title ?? moduleTitle ?? copy.chip}</h1>
      <p className={styles.text}>{text ?? copy.text}</p>
      {action ? (
        <Button icon={action.icon} onPress={action.onPress} disabled={action.disabled}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
