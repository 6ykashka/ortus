import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { TextInput } from '../TextInput';

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('Мойка после рейса');
  return (
    <Field label="Комментарий" error={value === '' ? 'Напишите комментарий' : undefined}>
      <TextInput
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </Field>
  );
}

describe('TextInput (Дизайн-система.dc.html:221): нативное поле внутри Field', () => {
  it('подпись Field связана с полем, значение и ввод', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Комментарий');
    expect(input).toHaveValue('Мойка после рейса');
    expect(input).toHaveAttribute('type', 'text');
    const user = userEvent.setup();
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Напишите комментарий');
    await user.type(input, 'А');
    expect(onChange).toHaveBeenLastCalledWith('А');
  });

  it('unit поля рисует Field — один раз, внутри рамки (Q-W0.10-5)', () => {
    render(
      <Field label="Пробег">
        <TextInput value="48 210" onChange={() => undefined} unit="км" inputMode="numeric" />
      </Field>,
    );
    expect(screen.getAllByText('км')).toHaveLength(1);
    expect(screen.getByLabelText('Пробег')).toHaveAttribute('inputmode', 'numeric');
  });

  it('size="lg" делает рамку Field 48 px (data-size), mono — моноширинное поле', () => {
    render(
      <Field label="Госномер">
        <TextInput value="А 123 ВС 77" onChange={() => undefined} size="lg" mono />
      </Field>,
    );
    const input = screen.getByLabelText('Госномер');
    expect(input).toHaveAttribute('data-mono');
    expect(input.parentElement).toHaveAttribute('data-size', 'lg');
  });

  it('без Field: собственная рамка, единица и aria-label', () => {
    render(
      <TextInput
        aria-label="Поиск"
        value=""
        onChange={() => undefined}
        placeholder="Номер рейса"
        unit="₽"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Поиск' });
    expect(input).toHaveAttribute('placeholder', 'Номер рейса');
    expect(input.parentElement).toHaveAttribute('data-frame');
    expect(screen.getByText('₽')).toBeInTheDocument();
  });

  it('только чтение и недоступность передаются полю', () => {
    render(
      <>
        <Field label="Фирма" readOnly>
          <TextInput value="Москва / Логистика 1" onChange={() => undefined} />
        </Field>
        <TextInput aria-label="Код" value="X" onChange={() => undefined} disabled />
      </>,
    );
    expect(screen.getByLabelText('Фирма')).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Код' })).toBeDisabled();
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Harness onChange={() => undefined} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
