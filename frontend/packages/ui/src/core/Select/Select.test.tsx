import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { Select } from '../Select';

const options = [
  { value: 'fuel', label: 'Топливо' },
  { value: 'wash', label: 'Мойка' },
  { value: 'parking', label: 'Парковка', disabled: true },
];

describe('Select (Дизайн-система.dc.html:225): нативный select', () => {
  it('combobox с подписью Field, опции и выбор', async () => {
    const onChange = vi.fn();
    render(
      <Field label="Категория">
        <Select value="fuel" options={options} onChange={onChange} />
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Категория' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('fuel');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Топливо',
      'Мойка',
      'Парковка',
    ]);
    expect(screen.getByRole('option', { name: 'Парковка' })).toBeDisabled();
    await userEvent.setup().selectOptions(select, 'wash');
    expect(onChange).toHaveBeenCalledWith('wash');
  });

  it('placeholder становится пустой первой опцией', () => {
    render(
      <Field label="Роль">
        <Select value="" options={options} onChange={() => undefined} placeholder="Выберите роль" />
      </Field>,
    );
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('Выберите роль');
    expect(first).toHaveValue('');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <Field label="Категория">
        <Select value="fuel" options={options} onChange={() => undefined} />
      </Field>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
