import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { MoneyInput } from '../MoneyInput';

const NBSP = ' ';

function Harness({ onChange }: { onChange?: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(325000);
  return (
    <Field label="Сумма">
      <MoneyInput
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    </Field>
  );
}

describe('MoneyInput (components.md: хранит amountMinor, показывает 1 250,00 ₽; Дизайн-система.dc.html:223)', () => {
  it('325000 → «3 250,00», знак «₽», inputmode decimal, выравнивание вправо', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Сумма');
    expect(input).toHaveValue(`3${NBSP}250,00`);
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('data-align', 'right');
    expect(screen.getByText('₽')).toBeInTheDocument();
  });

  it('ввод «1250» → onChange(125000), после ухода фокуса — «1 250,00»', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Сумма');
    const user = userEvent.setup();
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(input, '1250');
    expect(onChange).toHaveBeenLastCalledWith(125000);
    await user.tab();
    expect(input).toHaveValue(`1${NBSP}250,00`);
  });

  it('копейки через запятую: «12,5» → 1250', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Сумма');
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '12,5');
    expect(onChange).toHaveBeenLastCalledWith(1250);
  });

  it('пустое значение null показывается пустым полем', () => {
    render(
      <Field label="Сумма">
        <MoneyInput value={null} onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByLabelText('Сумма')).toHaveValue('');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Harness />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
