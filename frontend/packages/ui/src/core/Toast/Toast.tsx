import { useEffect, useEffectEvent, type ReactElement } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { ToastProps, ToastTone } from '../../types';
import { Icon } from '../Icon';
import styles from './Toast.module.css';

/** Иконка по тону — toastVM (Ортус CRM.dc.html:2888). */
const ICON: Record<ToastTone, string> = {
  ok: 'check_circle',
  warn: 'cloud_off',
  error: 'error',
  info: 'info',
};

/**
 * Тост (Ортус CRM.dc.html:2287–2291; витрина — Дизайн-система.dc.html:406): тёмная поверхность, иконка
 * по тону, `role="alert"` только для `error`, `aria-live="polite"`. Успех — только после ответа сервера;
 * не для ошибок полей. Через `durationMs` (4200) вызывает `onDismiss`; новый текст или тон сбрасывают
 * таймер (`toast()` :2414). Позицию на экране задаёт оболочка (W1.20).
 */
export function Toast({
  tone,
  text,
  action,
  onDismiss,
  durationMs = 4200,
}: ToastProps): ReactElement {
  const dismiss = useEffectEvent(() => onDismiss());
  useEffect(() => {
    const timer = setTimeout(dismiss, durationMs);
    return () => clearTimeout(timer);
  }, [text, tone, durationMs]);

  return (
    <div
      className={styles.toast}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-tone={tone}
    >
      <span className={styles.icon}>
        <Icon name={ICON[tone]} size={20} />
      </span>
      <span className={styles.text}>{text}</span>
      {action ? (
        <AriaButton className={styles.action} onPress={action.onPress} isDisabled={action.disabled}>
          {action.label}
        </AriaButton>
      ) : null}
    </div>
  );
}
