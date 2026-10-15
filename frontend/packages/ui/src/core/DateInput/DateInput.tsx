import type { ReactElement } from 'react';
import type { DateInputProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { InputFrame } from '../_internal/InputFrame';

/** Дата: нативный `type="date"`, значение ISO `YYYY-MM-DD` (Ортус CRM.dc.html:2215). */
export function DateInput({
  value,
  onChange,
  unit,
  inputMode,
  placeholder,
  readOnly,
  disabled,
  size = 'md',
  mono,
  'aria-label': ariaLabel,
  ...field
}: DateInputProps & FieldInjectedProps): ReactElement {
  return (
    <InputFrame unit={unit} size={size} disabled={disabled} readOnly={readOnly}>
      <input
        {...field}
        type="date"
        className={control.control}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        aria-label={ariaLabel}
        data-mono={mono ? '' : undefined}
      />
    </InputFrame>
  );
}
