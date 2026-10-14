import type { ReactElement } from 'react';
import type { StatusProps } from '../../types';
import { Icon } from '../Icon';
import styles from './Status.module.css';

/** Статус-пилл (Дизайн-система.dc.html:254–261): иконка + текст + цвет тона. */
export function Status({ tone, icon, children }: StatusProps): ReactElement {
  return (
    <span className={styles.status} data-tone={tone}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </span>
  );
}
