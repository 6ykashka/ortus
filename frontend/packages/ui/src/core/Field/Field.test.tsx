import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';

describe('Field (Дизайн-система.dc.html:220–225): подпись над полем, ошибка под полем', () => {
  it('подпись связана с полем через <label for>, подсказка — описание, единица внутри поля', () => {
    render(
      <Field label="Пробег при выезде" hint="Как на приборной панели" unit="км">
        <input inputMode="numeric" defaultValue="48 210" />
      </Field>,
    );
    const input = screen.getByLabelText('Пробег при выезде');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAccessibleDescription('Как на приборной панели');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('км')).toBeVisible();
  });

  it('ошибка: aria-invalid, текст ошибки в aria-describedby, иконка error скрыта от AT', () => {
    const { container } = render(
      <Field
        label="Пробег при сдаче"
        hint="Как на приборной панели"
        error="Пробег не может быть меньше 48 210 км"
      >
        <input defaultValue="48 100" />
      </Field>,
    );
    const input = screen.getByLabelText('Пробег при сдаче');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Пробег не может быть меньше 48 210 км');
    const icon = container.querySelector('.material-symbols-rounded');
    expect(icon).toHaveTextContent('error');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('обязательное, только чтение и недоступное доходят до поля', () => {
    render(
      <>
        <Field label="Госномер" required>
          <input />
        </Field>
        <Field label="Фирма (только чтение)" readOnly>
          <input defaultValue="Москва / Логистика 1" />
        </Field>
        <Field label="Категория" disabled>
          <select>
            <option>Топливо</option>
          </select>
        </Field>
      </>,
    );
    expect(screen.getByLabelText('Госномер')).toBeRequired();
    expect(screen.getByLabelText('Фирма (только чтение)')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Категория')).toBeDisabled();
    expect(screen.getByText('lock')).toHaveAttribute('aria-hidden', 'true');
  });

  it('сохраняет id и собственное описание поля', () => {
    render(
      <>
        <span id="own-note">Только цифры</span>
        <Field label="Сумма" id="amount" hint="В рублях">
          <input aria-describedby="own-note" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText('Сумма');
    expect(input).toHaveAttribute('id', 'amount');
    expect(input).toHaveAccessibleDescription('Только цифры В рублях');
  });

  it('axe: 0 нарушений serious/critical', async () => {
    const { container } = render(
      <div>
        <Field label="Пробег при выезде" hint="Как на приборной панели" unit="км">
          <input inputMode="numeric" defaultValue="48 210" />
        </Field>
        <Field label="Пробег при сдаче" error="Пробег не может быть меньше 48 210 км" unit="км">
          <input defaultValue="48 100" />
        </Field>
        <Field label="Фирма (только чтение)" readOnly>
          <input defaultValue="Москва / Логистика 1" />
        </Field>
      </div>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
