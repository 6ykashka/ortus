import type { ReactElement } from 'react';
import type { SelectProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { InputFrame } from '../_internal/InputFrame';

/**
 * Выпадающий список: нативный `<select>` (Дизайн-система.dc.html:225; Ортус CRM.dc.html:2207), стрелка
 * системная. `placeholder` — пустая первая опция («Выберите роль»). `readOnly` — `aria-readonly`, выбор
 * не меняется.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  unit,
  placeholder,
  readOnly,
  disabled,
  size = 'md',
  mono,
  inputMode,
  'aria-label': ariaLabel,
  ...field
}: SelectProps<V> & FieldInjectedProps): ReactElement {
  return (
    <InputFrame unit={unit} size={size} disabled={disabled} readOnly={readOnly}>
      <select
        {...field}
        className={control.control}
        value={value}
        onChange={(e) => {
          if (!readOnly) onChange(e.target.value as V);
        }}
        inputMode={inputMode}
        disabled={disabled}
        aria-readonly={readOnly || undefined}
        aria-label={ariaLabel}
        data-mono={mono ? '' : undefined}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </InputFrame>
  );
}
