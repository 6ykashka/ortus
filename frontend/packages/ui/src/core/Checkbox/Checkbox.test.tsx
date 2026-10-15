import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Checkbox } from '../Checkbox';

describe('Checkbox (Дизайн-система.dc.html:228–229): строка ≥ 44 px с нативным флажком', () => {
  it('имя из label, отметка и onChange', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked label="Кузов и стёкла осмотрены" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Кузов и стёкла осмотрены' });
    expect(box).toBeChecked();
    await userEvent.setup().click(screen.getByText('Кузов и стёкла осмотрены'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('пробел переключает флажок', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} label="Документы на месте" onChange={onChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Документы на месте' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('строка — label с data-row (цель нажатия ≥ 44 px по высоте строки)', () => {
    render(<Checkbox checked={false} label="Документы на месте" onChange={() => undefined} />);
    const row = screen.getByRole('checkbox').closest('label');
    expect(row).toHaveAttribute('data-row');
  });

  it('indeterminate выставляет свойство input и aria-checked="mixed"', () => {
    render(
      <Checkbox checked={false} indeterminate label="Все пункты" onChange={() => undefined} />,
    );
    const box = screen.getByRole('checkbox', { name: 'Все пункты' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box).toBePartiallyChecked();
  });

  it('недоступный флажок не меняется; описание связано через aria-describedby', async () => {
    const onChange = vi.fn();
    render(
      <Checkbox
        checked
        disabled
        label="Понимаю последствия для текущей работы"
        description="Отключение закроет новые брони"
        onChange={onChange}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Понимаю последствия для текущей работы' });
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('Отключение закроет новые брони');
    await userEvent.setup().click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <>
        <Checkbox checked label="Кузов и стёкла осмотрены" onChange={() => undefined} />
        <Checkbox checked={false} label="Документы на месте" onChange={() => undefined} />
      </>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
