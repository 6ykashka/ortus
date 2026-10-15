import type { ReactElement } from 'react';
import type { EmptyStateProps } from '../../types';
import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './EmptyState.module.css';

/**
 * Пустое состояние (Дизайн-система.dc.html:396–400): иконка 32 приглушённая, заголовок 16/600, текст 13
 * до 280 px; действие — одна кнопка. `dashed` — пунктирная рамка (Ортус CRM.dc.html:816).
 */
export function EmptyState({ icon, title, text, action, dashed }: EmptyStateProps): ReactElement {
  return (
    <div className={styles.empty} data-dashed={dashed ? '' : undefined}>
      <span className={styles.icon}>
        <Icon name={icon} size={32} />
      </span>
      <strong className={styles.title}>{title}</strong>
      {text ? <span className={styles.text}>{text}</span> : null}
      {action ? (
        <Button icon={action.icon} onPress={action.onPress} disabled={action.disabled}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
