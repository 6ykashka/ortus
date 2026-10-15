import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { NumberInput } from '../NumberInput';

const NBSP = ' ';

function Harness({
  initial = 48210,
  onChange,
  min,
  max,
  step,
}: {
  initial?: number | '';
  onChange?: (v: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [value, setValue] = useState<number | ''>(initial);
  return (
    <Field label="Пробег при выезде" hint="Как на приборной панели">
      <NumberInput
        value={value}
        unit="км"
        min={min}
        max={max}
        step={step}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    </Field>
  );
}

describe('NumberInput (Дизайн-система.dc.html:220): «48 210 км», inputmode numeric', () => {
  it('показывает число с разрядами, единицу и подсказку', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Пробег при выезде');
    expect(input).toHaveValue(`48${NBSP}210`);
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText('км')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('Как на приборной панели');
  });

  it('ввод «48300» → onChange(48300); после ухода фокуса — «48 300»', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Пробег при выезде');
    const user = userEvent.setup();
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.type(input, '48300');
    expect(onChange).toHaveBeenLastCalledWith(48300);
    await user.tab();
    expect(input).toHaveValue(`48${NBSP}300`);
  });

  it('буквы не меняют значение', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Пробег при выезде');
    const user = userEvent.setup();
    await user.click(input);
    await user.type(input, 'x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('↑/↓ меняют на step в пределах min/max', async () => {
    const onChange = vi.fn();
    render(<Harness initial={9} min={0} max={10} step={1} onChange={onChange} />);
    const input = screen.getByLabelText('Пробег при выезде');
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(8);
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Harness />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
