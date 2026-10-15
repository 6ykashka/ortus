import type { ReactElement } from 'react';
import { Heading } from 'react-aria-components';
import type { SheetProps } from '../../types';
import { labels } from '../_internal/labels';
import { ModalFrame } from '../_internal/ModalFrame';
import { IconButton } from '../IconButton';
import styles from './Sheet.module.css';

/**
 * Лист (Ортус CRM.dc.html:2274–2281): на ширине < 640 — снизу, радиус `16px 16px 0 0`; шапка — `h2` 17/600
 * и «Закрыть» 44×44. Доступность как у `Dialog` (фокус-ловушка, Esc, возврат фокуса).
 */
export function Sheet({ open, onClose, title, children }: SheetProps): ReactElement {
  return (
    <ModalFrame open={open} onClose={onClose} variant="sheet">
      <div className={styles.head}>
        <Heading slot="title" level={2} className={styles.title}>
          {title}
        </Heading>
        <IconButton icon="close" label={labels.close} size={44} onPress={onClose} />
      </div>
      <div className={styles.body}>{children}</div>
    </ModalFrame>
  );
}
