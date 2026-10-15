import { cloneElement, useId, type ReactElement } from 'react';
import type { FieldProps } from '../../types';
import { FieldContext } from '../_internal/fieldContext';
import { Icon } from '../Icon';
import styles from './Field.module.css';

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
}

/**
 * Поле с подписью (Дизайн-система.dc.html:220–225). Рисует рамку поля, единицу справа, подсказку
 * или ошибку под полем и передаёт дочернему контролу `id`, `aria-describedby`, `aria-invalid`,
 * `required`, `readOnly`, `disabled`. Поля W1.21 внутри `Field` (контекст) рисуют только контрол
 * и свою единицу; `size="lg"` поля делает рамку 48 px.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  readOnly = false,
  disabled = false,
  unit,
  id,
  children,
}: FieldProps): ReactElement {
  const control = children as ReactElement<ControlProps>;
  const own = control.props;
  const autoId = useId();
  const controlId = id ?? own.id ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const note = error ? errorId : hint ? hintId : undefined;
  const describedBy = [own['aria-describedby'], note].filter(Boolean).join(' ') || undefined;

  const field = cloneElement(control, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : own['aria-invalid'],
    required: required || own.required,
    readOnly: readOnly || own.readOnly,
    disabled: disabled || own.disabled,
  });

  return (
    <div className={styles.field}>
      <label htmlFor={controlId} className={styles.label}>
        {label}
      </label>
      <div
        className={styles.box}
        data-invalid={error ? '' : undefined}
        data-readonly={readOnly ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        data-size={own.size === 'lg' ? 'lg' : undefined}
      >
        {readOnly ? <Icon name="lock" size={18} className={styles.lock} /> : null}
        <FieldContext.Provider value={true}>{field}</FieldContext.Provider>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {error ? (
        <span id={errorId} className={styles.error}>
          <Icon name="error" size={16} />
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
