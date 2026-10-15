import type { ReactElement, ReactNode } from 'react';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import styles from './ModalFrame.module.css';

export interface ModalFrameProps {
  open: boolean;
  onClose: () => void;
  /** Идёт операция: Esc и подложка не закрывают, `aria-busy`. */
  busy?: boolean;
  /** `false` — закрывается только кнопками. */
  dismissable?: boolean;
  /** `sm` 380 px (витрина), `md` 560 px (CRM), `lg` 620 px (назначение роли). */
  size?: 'sm' | 'md' | 'lg';
  /** Внутренние отступы: обычный диалог, подтверждение (22 px), лист (16/12/20). */
  variant?: 'dialog' | 'confirm' | 'sheet';
  /** Заголовок — `Heading slot="title"` RAC внутри детей. */
  children: ReactNode;
}

/**
 * Модальная оболочка на React Aria (PD-13) для `Dialog`, `ConfirmDialog`, `Sheet`: фокус-ловушка, возврат
 * фокуса, Esc и клик по подложке закрывают (кроме `busy`), `aria-modal`. Витрина — Дизайн-система.dc.html:383;
 * на ширине < 640 — лист снизу (Ортус CRM.dc.html:3966).
 */
export function ModalFrame({
  open,
  onClose,
  busy = false,
  dismissable = true,
  size = 'md',
  variant = 'dialog',
  children,
}: ModalFrameProps): ReactElement {
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
      <Modal className={styles.modal} data-size={size}>
        <AriaDialog
          className={styles.dialog}
          data-variant={variant}
          // RAC не ставит aria-modal и aria-busy: дописываем их в собственном render.
          render={(domProps) => (
            <section {...domProps} aria-modal="true" aria-busy={busy || undefined} />
          )}
        >
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
