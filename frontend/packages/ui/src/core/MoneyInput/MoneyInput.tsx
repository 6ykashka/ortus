import { useState, type ReactElement } from 'react';
import type { MoneyInputProps } from '../../types';
import control from '../_internal/control.module.css';
import type { FieldInjectedProps } from '../_internal/fieldContext';
import { formatMoney, isNumberDraft, parseMoney } from '../_internal/format';
import { InputFrame } from '../_internal/InputFrame';

const CURRENCY_SIGN = { RUB: '₽' } as const;

/**
 * Деньги: хранит `amountMinor` (копейки), показывает «3 250,00 ₽» (components.md; Дизайн-система.dc.html:223),
 * `inputmode="decimal"`, выравнивание вправо. Пустое поле — `null`.
 */
export function MoneyInput({
  value,
  onChange,
  unit,
  currency = 'RUB',
  inputMode = 'decimal',
  placeholder,
  readOnly,
  disabled,
  size = 'md',
  mono,
  'aria-label': ariaLabel,
  ...field
}: MoneyInputProps & FieldInjectedProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = value === null ? '' : formatMoney(value);

  const change = (text: string) => {
    if (!isNumberDraft(text, 2)) return;
    setDraft(text);
    if (text.trim() === '') onChange(null);
    else {
      const parsed = parseMoney(text);
      if (parsed !== null) onChange(parsed);
    }
  };

  return (
    <InputFrame
      unit={unit ?? CURRENCY_SIGN[currency]}
      size={size}
      disabled={disabled}
      readOnly={readOnly}
    >
      <input
        {...field}
        type="text"
        className={control.control}
        value={draft ?? formatted}
        onFocus={() => setDraft(formatted)}
        onBlur={() => setDraft(null)}
        onChange={(e) => change(e.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        aria-label={ariaLabel}
        data-align="right"
        data-mono={mono ? '' : undefined}
      />
    </InputFrame>
  );
}
