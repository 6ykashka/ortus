import { useId, type ReactElement, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { CardProps } from '../../types';
import styles from './Card.module.css';

/**
 * Карточка (Дизайн-система.dc.html:159, :375; выбранная — Ортус CRM.dc.html:3639).
 * Кликабельная карточка — одна кнопка или ссылка в заголовке; область нажатия растянута на всю
 * карточку, действия (`actions`) лежат поверх неё и не вложены в кнопку.
 */
export function Card({
  title,
  meta,
  actions,
  onOpen,
  href,
  selected = false,
  disabled = false,
  disabledReason,
  dashed = false,
  headingLevel = 3,
  children,
}: CardProps): ReactElement {
  const reasonId = useId();
  const describedBy = disabled && disabledReason ? reasonId : undefined;
  const current = selected ? 'true' : undefined;
  const interactive = Boolean(onOpen ?? href);
  const Heading = `h${headingLevel}` as const;

  let titleContent: ReactNode = title;
  if (interactive && href && !disabled) {
    titleContent = (
      <a className={styles.open} href={href} aria-current={current}>
        {title}
      </a>
    );
  } else if (interactive) {
    titleContent = (
      <AriaButton
        className={styles.open}
        onPress={onOpen}
        isDisabled={disabled}
        aria-describedby={describedBy}
        // RAC не пропускает aria-current в DOM: дописываем его в собственном render.
        render={(domProps) => <button {...domProps} aria-current={current} />}
      >
        {title}
      </AriaButton>
    );
  }

  return (
    <div
      className={styles.card}
      data-selected={selected ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-dashed={dashed ? '' : undefined}
      data-interactive={interactive && !disabled ? '' : undefined}
    >
      {title !== undefined ? <Heading className={styles.title}>{titleContent}</Heading> : null}
      {meta !== undefined ? <div className={styles.meta}>{meta}</div> : null}
      {children !== undefined ? <div className={styles.body}>{children}</div> : null}
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
      {describedBy ? (
        <p id={reasonId} className={styles.reason}>
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
