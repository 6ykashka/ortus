import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import type { NavProps } from '../../types';
import { Nav } from './Nav';

type Mode = NavProps['mode'];

const meta = {
  title: 'Core/Nav',
  component: Nav,
  args: { groups: [], mode: 'sidebar', 'aria-label': 'Основная навигация' },
} satisfies Meta<typeof Nav>;

export default meta;
type Story = StoryObj<typeof meta>;

// Меню владельца (@ortus/texts shell.nav): группы «Обзор», «Компания», «Логистика».
const MENU = [
  { title: 'Обзор', items: [{ id: 'home', label: 'Главная', icon: 'home' }] },
  {
    title: 'Компания',
    items: [
      { id: 'modules', label: 'Модули и место', icon: 'extension' },
      { id: 'users', label: 'Пользователи и роли', icon: 'group', badge: 2 },
      { id: 'billing', label: 'Подписка и места', icon: 'workspace_premium', badge: 'план' },
    ],
  },
  {
    title: 'Логистика',
    items: [
      { id: 'fleet', label: 'Рабочее место логиста', icon: 'local_shipping' },
      { id: 'review', label: 'Приёмка смен', icon: 'fact_check', badge: 3 },
    ],
  },
] as const;

function Menu({ mode }: { mode: Mode }): ReactElement {
  const [page, setPage] = useState('home');
  const groups: NavProps['groups'] = MENU.map((g) => ({
    title: g.title,
    items: g.items.map((it) => ({
      ...it,
      current: it.id === page,
      onPress: () => setPage(it.id),
    })),
  }));
  if (mode === 'bottom') {
    // Нижняя навигация: три пункта и «Ещё» (Ортус CRM.dc.html:3028–3030).
    const short = [
      { ...groups[0]?.items[0], label: 'Главная' },
      { ...groups[1]?.items[0], label: 'Модули' },
      { ...groups[1]?.items[1], label: 'Люди' },
    ] as NavProps['groups'][number]['items'];
    return (
      <div style={{ maxWidth: 390 }}>
        <Nav
          mode="bottom"
          aria-label="Навигация"
          groups={[{ items: short }]}
          more={{ label: 'Ещё', icon: 'menu', onPress: () => undefined }}
        />
      </div>
    );
  }
  return (
    <div style={{ height: 520, display: 'flex' }}>
      <Nav mode={mode} aria-label="Основная навигация" groups={groups} />
    </div>
  );
}

/** Боковое меню ≥ 1080 (Ортус CRM.dc.html:150–169). */
export const Sidebar: Story = {
  name: 'Боковое меню',
  render: () => <Menu mode="sidebar" />,
};

/** Узкая колонка 640–1079: подписи визуально скрыты. */
export const Rail: Story = {
  name: 'Узкая колонка',
  render: () => <Menu mode="rail" />,
};

/** Нижняя навигация < 640 (Ортус CRM.dc.html:2166–2172). */
export const Bottom: Story = {
  name: 'Нижняя навигация',
  render: () => <Menu mode="bottom" />,
};
