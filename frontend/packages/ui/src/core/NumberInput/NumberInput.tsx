import { useState, type KeyboardEvent, type ReactElement } from 'react';
import type { NumberInputProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { formatInteger, isNumberDraft, parseNumber } from '../_internal/format';
import { InputFrame } from '../_internal/InputFrame';

const clamp = (n: number, min?: number, max?: number): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

/**
 * Число с разрядами: «48 210 км», `inputmode="numeric"` (Дизайн-система.dc.html:220). Пока поле в фокусе,
 * показывается черновик ввода; `onChange` получает число или `''` (пусто). ↑/↓ — шаг `step` в пределах
 * `min`/`max`.
 */
export function NumberInput({
  value,
  onChange,
  unit,
  inputMode = 'numeric',
  placeholder,
  readOnly,
  disabled,
  size = 'md',
  mono,
  min,
  max,
  step = 1,
  'aria-label': ariaLabel,
  ...field
}: NumberInputProps & FieldInjectedProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = value === '' ? '' : formatInteger(value);

  const change = (text: string) => {
    if (!isNumberDraft(text)) return;
    setDraft(text);
    const parsed = parseNumber(text);
    if (parsed !== null) onChange(parsed);
  };

  const stepBy = (e: KeyboardEvent<HTMLInputElement>, dir: 1 | -1) => {
    if (readOnly || disabled) return;
    e.preventDefault();
    const next = clamp((value === '' ? 0 : value) + dir * step, min, max);
    setDraft(formatInteger(next));
    onChange(next);
  };

  return (
    <InputFrame unit={unit} size={size} disabled={disabled} readOnly={readOnly}>
      <input
        {...field}
        type="text"
        className={control.control}
        value={draft ?? formatted}
        onFocus={() => setDraft(formatted)}
        onBlur={() => setDraft(null)}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') stepBy(e, 1);
          else if (e.key === 'ArrowDown') stepBy(e, -1);
        }}
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
