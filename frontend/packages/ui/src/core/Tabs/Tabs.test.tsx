import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TabItem } from '../../types';
import { seriousViolations } from '../../test/axe';
import { Tabs } from '../Tabs';

// Ортус CRM.dc.html:290–294 — «Пользователи и роли».
const items: TabItem[] = [
  { id: 'people', label: 'Люди', badge: 10 },
  { id: 'groups', label: 'Группы' },
  { id: 'roles', label: 'Роли', badge: 4 },
  { id: 'check', label: 'Проверка доступа' },
];

function Harness({ onChange }: { onChange: (id: string) => void }) {
  const [value, setValue] = useState('people');
  return (
    <Tabs
      aria-label="Разделы доступа"
      items={items}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    >
      <p>Раздел {value}</p>
    </Tabs>
  );
}

describe('Tabs (Ортус CRM.dc.html:290–294): «Разделы доступа», счётчик neutral', () => {
  it('tablist с именем, четыре вкладки, выбрана «Люди» со счётчиком', () => {
    render(<Harness onChange={() => undefined} />);
    const list = screen.getByRole('tablist', { name: 'Разделы доступа' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    const people = screen.getByRole('tab', { name: /^Люди/ });
    expect(people).toHaveAttribute('aria-selected', 'true');
    expect(within(people).getByText('10')).toHaveAttribute('data-badge');
    expect(screen.getByRole('tab', { name: 'Группы' })).toHaveAttribute('aria-selected', 'false');
  });

  it('клик переключает вкладку, панель показывает содержимое выбранной', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Роли/ }));
    expect(onChange).toHaveBeenCalledWith('roles');
    const roles = screen.getByRole('tab', { name: /^Роли/ });
    expect(roles).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(roles).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Раздел roles');
  });

  it('стрелка вправо выбирает следующую вкладку (PD-29)', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('tab', { name: /^Люди/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('groups');
  });

  it('вид cards отмечается на списке', () => {
    render(
      <Tabs
        aria-label="Рейсы"
        variant="cards"
        items={items}
        value="people"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Рейсы' })).toHaveAttribute('data-variant', 'cards');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Harness onChange={() => undefined} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
