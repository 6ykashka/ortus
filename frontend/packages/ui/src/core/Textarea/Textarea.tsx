import type { ReactElement } from 'react';
import type { TextareaProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { InputFrame } from '../_internal/InputFrame';

/** Многострочное поле: `resize: vertical`, отступ 10/12 (Ортус CRM.dc.html:2268). */
export function Textarea({
  value,
  onChange,
  unit,
  inputMode,
  placeholder,
  readOnly,
  disabled,
  size = 'md',
  mono,
  rows = 3,
  'aria-label': ariaLabel,
  ...field
}: TextareaProps & FieldInjectedProps): ReactElement {
  return (
    <InputFrame unit={unit} size={size} disabled={disabled} readOnly={readOnly}>
      <textarea
        {...field}
        className={control.control}
        value={value}
        rows={rows}
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
