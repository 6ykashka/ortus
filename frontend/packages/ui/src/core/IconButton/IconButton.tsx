import type { ReactElement } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { IconButtonProps } from '../../types';
import { Icon } from '../Icon';
import styles from './IconButton.module.css';

/**
 * Кнопка-иконка на React Aria (PD-13): ghost 40×40, радиус 10, иконка 22 (Дизайн-система.dc.html:207–208);
 * 44×44 — «Закрыть» листа (Ортус CRM.dc.html:2276). `label` — `aria-label`; бейдж только визуальный
 * (число входит в `label`: «Уведомления, 3 новых»).
 */
export function IconButton({
  icon,
  label,
  badge,
  size = 40,
  onPress,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHaspopup,
}: IconButtonProps): ReactElement {
  const showBadge = badge !== undefined && badge !== 0 && badge !== '';
  return (
    <AriaButton
      className={styles.button}
      data-size={String(size)}
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      onPress={onPress}
    >
      <Icon name={icon} size={22} />
      {showBadge ? (
        <span className={styles.badge} data-badge="" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </AriaButton>
  );
}
