import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { Textarea } from '../Textarea';

describe('Textarea (Ортус CRM.dc.html:2268): многострочное поле внутри Field', () => {
  it('подпись, rows, placeholder и ввод', async () => {
    const onChange = vi.fn();
    render(
      <Field label="Комментарий для фирмы-владельца">
        <Textarea value="" rows={2} placeholder="Необязательно" onChange={onChange} />
      </Field>,
    );
    const area = screen.getByRole('textbox', { name: 'Комментарий для фирмы-владельца' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('rows', '2');
    expect(area).toHaveAttribute('placeholder', 'Необязательно');
    await userEvent.setup().type(area, 'Да');
    expect(onChange).toHaveBeenLastCalledWith('а');
  });

  it('rows по умолчанию — 3', () => {
    render(<Textarea aria-label="Заметка" value="" onChange={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveAttribute('rows', '3');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <Field label="Комментарий">
        <Textarea value="Мойка" onChange={() => undefined} />
      </Field>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
