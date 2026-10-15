import type { ReactElement } from 'react';
import type { TextInputProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { InputFrame } from '../_internal/InputFrame';

/**
 * Однострочное поле (Дизайн-система.dc.html:221). Внутри `Field` — только `<input>` и единица; вне `Field` —
 * собственная рамка, имя из `aria-label`.
 */
export function TextInput({
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
}: TextInputProps & FieldInjectedProps): ReactElement {
  return (
    <InputFrame unit={unit} size={size} disabled={disabled} readOnly={readOnly}>
      <input
        {...field}
        type="text"
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
