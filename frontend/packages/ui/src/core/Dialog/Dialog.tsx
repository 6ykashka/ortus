import type { ReactElement } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { DialogProps } from '../../types';
import styles from './Dialog.module.css';

/**
 * Модальный диалог на React Aria (PD-13): фокус-ловушка, возврат фокуса, Esc и клик по подложке
 * закрывают (кроме `busy` и `dismissable={false}`). Визуал — Дизайн-система.dc.html:383–393;
 * на ширине < 640 — лист снизу (Ортус CRM.dc.html:3957).
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
  const canDismiss = dismissable && !busy;
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      isDismissable={canDismiss}
      isKeyboardDismissDisabled={!canDismiss}
    >
      <Modal className={`${styles.modal} ${styles[size] ?? ''}`}>
        <AriaDialog
          className={styles.dialog}
          // RAC не ставит aria-modal и aria-busy: дописываем их в собственном render.
          render={(domProps) => (
            <section {...domProps} aria-modal="true" aria-busy={busy || undefined} />
          )}
        >
          <Heading slot="title" className={styles.title}>
            {title}
          </Heading>
          {children !== undefined ? <div className={styles.body}>{children}</div> : null}
          {footer !== undefined ? <div className={styles.footer}>{footer}</div> : null}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
