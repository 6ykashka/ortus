import { useId, type ReactElement } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { ButtonProps } from '../../types';
import { Icon } from '../Icon';
import styles from './Button.module.css';

const ICON_SIZE = { md: 20, lg: 22, compact: 18 } as const;

/**
 * Кнопка на React Aria (PD-13). Метрики витрины: Дизайн-система.dc.html:164–210.
 * `loading` — иконка `progress_activity`, `aria-busy`, нажатие подавлено, ширина сохраняется
 * (обе подписи в одной ячейке сетки). `disabledReason` — текст рядом и `aria-describedby`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  loadingLabel,
  disabled = false,
  disabledReason,
  type = 'button',
  onPress,
  'aria-label': ariaLabel,
  children,
}: ButtonProps): ReactElement {
  const reasonId = useId();
  const showReason = disabled && Boolean(disabledReason);
  const iconSize = ICON_SIZE[size];

  const button = (
    <AriaButton
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      isDisabled={disabled}
      isPending={loading}
      // RAC не пропускает aria-busy в DOM: дописываем его в собственном render.
      render={(domProps) => <button {...domProps} aria-busy={loading || undefined} />}
      aria-label={ariaLabel}
      aria-describedby={showReason ? reasonId : undefined}
      onPress={onPress}
    >
      {/* Обычная и «выполняется» подписи в одной ячейке сетки: ширина кнопки не меняется. */}
      <span className={styles.faces}>
        {loading ? (
          <span className={styles.face}>
            <Icon name="progress_activity" size={iconSize} />
            {loadingLabel ?? children}
          </span>
        ) : null}
        <span className={styles.face} aria-hidden={loading || undefined}>
          {icon ? <Icon name={icon} size={iconSize} /> : null}
          {children}
        </span>
      </span>
    </AriaButton>
  );

  if (!showReason) return button;
  return (
    <span className={styles.withReason}>
      {button}
      <span id={reasonId} className={styles.reason}>
        {disabledReason}
      </span>
    </span>
  );
}
