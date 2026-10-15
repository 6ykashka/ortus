import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Radio } from '../Radio';
import { RadioGroup } from '../RadioGroup';

type Fuel = 'q1' | 'q2' | 'q3' | 'full';

function FuelLevel({ onChange }: { onChange: (v: Fuel) => void }) {
  const [value, setValue] = useState<Fuel>('q2');
  return (
    <RadioGroup<Fuel>
      label="Уровень топлива"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      <Radio value="q1" label="¼" />
      <Radio value="q2" label="½" />
      <Radio value="q3" label="¾" />
      <Radio value="full" label="Полный" disabled />
    </RadioGroup>
  );
}

describe('RadioGroup и Radio (Дизайн-система.dc.html:237–243): плитки «Уровень топлива»', () => {
  it('radiogroup с именем, ровно один выбранный «½»', () => {
    render(<FuelLevel onChange={() => undefined} />);
    const group = screen.getByRole('radiogroup', { name: 'Уровень топлива' });
    expect(group).toHaveAttribute('data-variant', 'tiles');
    const checked = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(screen.getByRole('radio', { name: '½' })).toBeChecked();
  });

  it('клик по плитке выбирает её', async () => {
    const onChange = vi.fn();
    render(<FuelLevel onChange={onChange} />);
    await userEvent.setup().click(screen.getByText('¾'));
    expect(onChange).toHaveBeenCalledWith('q3');
    expect(screen.getByRole('radio', { name: '¾' })).toBeChecked();
  });

  it('стрелка вправо переносит выбор на следующую плитку', async () => {
    const onChange = vi.fn();
    render(<FuelLevel onChange={onChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('radio', { name: '½' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('q3');
  });

  it('недоступная плитка не выбирается', async () => {
    const onChange = vi.fn();
    render(<FuelLevel onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Полный' })).toBeDisabled();
    await userEvent.setup().click(screen.getByText('Полный'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('карточки: подпись и описание, скрытая подпись группы', () => {
    render(
      <RadioGroup
        label="Основа роли"
        labelHidden
        variant="cards"
        value="empty"
        onChange={() => undefined}
      >
        <Radio value="empty" label="С нуля" description="Пустая роль без действий" />
        <Radio value="copy" label="Копия роли" description="Скопировать действия другой роли" />
      </RadioGroup>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Основа роли' });
    expect(group).toHaveAttribute('data-variant', 'cards');
    expect(screen.getByRole('radio', { name: 'С нуля' })).toHaveAccessibleDescription(
      'Пустая роль без действий',
    );
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<FuelLevel onChange={() => undefined} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
