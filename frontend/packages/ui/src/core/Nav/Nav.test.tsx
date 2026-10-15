import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NavProps } from '../../types';
import { seriousViolations } from '../../test/axe';
import { Nav } from '../Nav';

function groups(onPress = vi.fn()): NavProps['groups'] {
  return [
    {
      title: 'Обзор',
      items: [{ id: 'home', label: 'Главная', icon: 'home', current: true, onPress }],
    },
    {
      title: 'Компания',
      items: [
        { id: 'modules', label: 'Модули и место', icon: 'extension', onPress },
        { id: 'users', label: 'Пользователи и роли', icon: 'group', badge: 3, onPress },
        { id: 'billing', label: 'Подписка и места', icon: 'payments', badge: 'план', onPress },
      ],
    },
  ];
}

describe('Nav (Ортус CRM.dc.html:150–169, 2166–2172): sidebar, rail, bottom', () => {
  it('sidebar: заголовки групп, текущий пункт aria-current="page", бейдж и «план»', async () => {
    const onPress = vi.fn();
    render(<Nav mode="sidebar" aria-label="Основная навигация" groups={groups(onPress)} />);
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(nav).toHaveAttribute('data-mode', 'sidebar');
    expect(within(nav).getByText('Компания')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Главная' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Модули и место/ })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('button', { name: /^Пользователи и роли/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /^Подписка и места/ })).toHaveTextContent('план');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Модули и место/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('rail: подписи скрыты визуально, но остаются именами кнопок; групп-заголовков нет', () => {
    render(<Nav mode="rail" aria-label="Основная навигация" groups={groups()} />);
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(nav).toHaveAttribute('data-mode', 'rail');
    expect(within(nav).queryByText('Компания')).toBeNull();
    const home = screen.getByRole('button', { name: 'Главная' });
    expect(within(home).getByText('Главная')).toHaveAttribute('data-visually-hidden');
  });

  it('bottom: пункты и «Ещё» из more', async () => {
    const more = vi.fn();
    render(
      <Nav
        mode="bottom"
        aria-label="Навигация"
        groups={groups()}
        more={{ label: 'Ещё', icon: 'menu', onPress: more }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Навигация' });
    expect(nav).toHaveAttribute('data-mode', 'bottom');
    expect(within(nav).getAllByRole('button')).toHaveLength(5);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ещё' }));
    expect(more).toHaveBeenCalledTimes(1);
  });

  it.each(['sidebar', 'rail', 'bottom'] as const)('axe (%s): без нарушений', async (mode) => {
    const { container } = render(
      <Nav mode={mode} aria-label="Основная навигация" groups={groups()} />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
