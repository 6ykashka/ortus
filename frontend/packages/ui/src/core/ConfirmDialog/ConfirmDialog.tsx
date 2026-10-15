import { useState, type ReactElement } from 'react';
import { Heading } from 'react-aria-components';
import type { ConfirmDialogProps } from '../../types';
import { labels } from '../_internal/labels';
import { ModalFrame } from '../_internal/ModalFrame';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Icon } from '../Icon';
import styles from './ConfirmDialog.module.css';

type BodyProps = Omit<ConfirmDialogProps, 'open'>;

/** Содержимое живёт внутри модалки: флажок `ack` сбрасывается при каждом открытии. */
function ConfirmBody({
  onClose,
  onConfirm,
  title,
  text,
  icon = 'help',
  tone = 'default',
  consequences = [],
  ack,
  confirmLabel,
  cancelLabel = labels.cancel,
  busy = false,
  busyLabel = labels.busy,
}: BodyProps): ReactElement {
  const [acked, setAcked] = useState(false);
  const danger = tone === 'danger';
  const hasScroll = consequences.length > 0 || ack !== undefined;
  return (
    <>
      <div className={styles.head}>
        <span className={styles.chip} data-tone={danger ? 'danger' : 'info'}>
          <Icon name={icon} size={22} />
        </span>
        <div className={styles.headText}>
          <Heading slot="title" level={2} className={styles.title}>
            {title}
          </Heading>
          {text !== undefined ? <p className={styles.text}>{text}</p> : null}
        </div>
      </div>
      {hasScroll ? (
        <div className={styles.scroll}>
          {consequences.map((section) => (
            <div key={section.title} className={styles.section}>
              <span className={styles.sectionTitle}>{section.title}</span>
              <ul className={styles.items}>
                {section.items.map((item) => (
                  <li key={item.text} className={styles.item}>
                    <span className={styles.itemIcon} data-tone={item.tone ?? 'neutral'}>
                      <Icon name={item.icon ?? 'arrow_right'} size={18} />
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {ack ? (
            <div className={styles.ack}>
              <Checkbox checked={acked} onChange={setAcked} label={ack.label} disabled={busy} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.footer}>
        <Button variant="secondary" onPress={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onPress={onConfirm}
          disabled={busy || (ack !== undefined && !acked)}
        >
          {busy ? busyLabel : confirmLabel}
        </Button>
      </div>
    </>
  );
}

/**
 * Подтверждение значимого изменения (Ортус CRM.dc.html:2180–2199, VM :3969–3976): круг с иконкой, `h2`,
 * секции последствий, флажок «Понимаю последствия…» — без него подтвердить нельзя; при `busy` главная
 * кнопка — «Выполняем…», обе недоступны, Esc и подложка не закрывают.
 */
export function ConfirmDialog({ open, ...props }: ConfirmDialogProps): ReactElement {
  return (
    <ModalFrame open={open} onClose={props.onClose} busy={props.busy} variant="confirm">
      <ConfirmBody {...props} />
    </ModalFrame>
  );
}
