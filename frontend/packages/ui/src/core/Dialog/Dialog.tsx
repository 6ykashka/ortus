import type { ReactElement } from 'react';
import { Heading } from 'react-aria-components';
import type { DialogProps } from '../../types';
import { ModalFrame } from '../_internal/ModalFrame';
import styles from './Dialog.module.css';

/**
 * Модальный диалог на React Aria (PD-13): фокус-ловушка, возврат фокуса, Esc и клик по подложке
 * закрывают (кроме `busy` и `dismissable={false}`). Визуал — Дизайн-система.dc.html:383–393;
 * на ширине < 640 — лист снизу (Ортус CRM.dc.html:3957). Оболочка — общий `ModalFrame`.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  busy = false,
  dismissable = true,
}: DialogProps): ReactElement {
  return (
    <ModalFrame open={open} onClose={onClose} size={size} busy={busy} dismissable={dismissable}>
      <Heading slot="title" className={styles.title}>
        {title}
      </Heading>
      {children !== undefined ? <div className={styles.body}>{children}</div> : null}
      {footer !== undefined ? <div className={styles.footer}>{footer}</div> : null}
    </ModalFrame>
  );
}
