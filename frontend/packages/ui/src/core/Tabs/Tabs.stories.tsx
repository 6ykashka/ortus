import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import type { TabItem } from '../../types';
import { Tabs } from './Tabs';

const items: TabItem[] = [
  { id: 'people', label: 'Люди', badge: 10 },
  { id: 'groups', label: 'Группы', badge: 2 },
  { id: 'roles', label: 'Роли', badge: 6 },
  { id: 'check', label: 'Проверка доступа' },
];

const meta = {
  title: 'Core/Tabs',
  component: Tabs,
  args: { items, value: 'people', onChange: () => undefined, 'aria-label': 'Разделы доступа' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

function Access({ variant }: { variant?: 'underline' | 'cards' }): ReactElement {
  const [value, setValue] = useState('people');
  const current = items.find((i) => i.id === value);
  return (
    <Tabs
      aria-label="Разделы доступа"
      items={items}
      value={value}
      onChange={setValue}
      variant={variant}
    >
      <p style={{ margin: 0, color: 'var(--ox-text-muted)' }}>Раздел «{current?.label}»</p>
    </Tabs>
  );
}

/** «Пользователи и роли»: счётчик neutral (Ортус CRM.dc.html:290–294). */
export const AccessSections: Story = {
  name: 'Разделы доступа',
  render: () => <Access />,
};

/** Плитки-вкладки (Ортус CRM.dc.html:440–442). */
export const Cards: Story = {
  name: 'Плитки',
  render: () => <Access variant="cards" />,
};
