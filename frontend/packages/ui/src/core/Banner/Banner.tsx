import type { ReactElement } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { BannerProps, IconName, Tone } from '../../types';
import { Icon } from '../Icon';
import styles from './Banner.module.css';

/** Иконка по тону, если не задана своя: статус = иконка + текст + цвет. */
const TONE_ICON: Record<Tone, IconName> = {
  ok: 'check_circle',
  info: 'info',
  warn: 'warning',
  danger: 'error',
  neutral: 'info',
};

/**
 * Баннер раздела (Дизайн-система.dc.html:275–278). `role` по умолчанию: `alert` для блокирующего
 * `danger`, иначе `status`.
 */
export function Banner({ tone, title, text, icon, action, role }: BannerProps): ReactElement {
  return (
    <div
      className={styles.banner}
      data-tone={tone}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
    >
      <Icon name={icon ?? TONE_ICON[tone]} size={20} />
      <span className={styles.body}>
        <strong className={styles.title}>{title}</strong>
        {text ? <> {text}</> : null}
      </span>
      {action ? (
        <AriaButton className={styles.action} onPress={action.onPress} isDisabled={action.disabled}>
          {action.icon ? <Icon name={action.icon} size={18} /> : null}
          {action.label}
        </AriaButton>
      ) : null}
    </div>
  );
}
