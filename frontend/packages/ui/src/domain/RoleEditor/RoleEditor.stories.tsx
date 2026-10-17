import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Panel } from '../../stories/layout';
import type { RoleCatalog, RoleDraft, RoleEditorProps } from '../../types';
import { RoleEditor } from './RoleEditor';

// Каталог «Альты» в форме страницы W1.23 (api/permissions.yaml, уровни модулей эталона; «Логистика» не подключена).
const catalog: RoleCatalog = {
  modules: [
    {
      key: 'logistics',
      name: 'Логистика',
      icon: 'local_shipping',
      on: false,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['fleet.vehicles.read', 'fleet.trips.read'] },
        { key: 'create', label: 'Создавать', perms: ['fleet.reservations.create'] },
        { key: 'edit', label: 'Изменять', perms: ['fleet.routes.manage'] },
        { key: 'review', label: 'Проверять', perms: ['fleet.trips.review'] },
        { key: 'settings', label: 'Настраивать', perms: ['fleet.vehicles.manage'] },
        {
          key: 'earnings.read',
          label: 'Видеть начисления водителям',
          perms: ['fleet.earnings.read'],
          restricted: true,
        },
        {
          key: 'earnings.manage',
          label: 'Управлять начислениями',
          perms: ['fleet.earnings.manage'],
          restricted: true,
        },
      ],
    },
    {
      key: 'spa',
      name: 'Салон и SPA',
      icon: 'spa',
      on: true,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['spa.appointments.read'] },
        { key: 'create', label: 'Создавать', perms: ['spa.appointments.create'] },
      ],
    },
    {
      key: 'tasks',
      name: 'Задачи',
      icon: 'task_alt',
      on: true,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['tasks.read'] },
        { key: 'create', label: 'Создавать', perms: ['tasks.create'] },
        { key: 'edit', label: 'Изменять', perms: ['tasks.update'] },
      ],
    },
  ],
};

const manager: RoleDraft = {
  id: 'r-manager',
  name: 'Менеджер логистики',
  actions: { logistics: ['view', 'edit', 'review', 'settings', 'earnings.read'], tasks: ['view'] },
};

function Live(
  p: Omit<RoleEditorProps, 'onChange' | 'catalog'> & { catalog?: RoleCatalog },
): ReactElement {
  const [role, setRole] = useState(p.role);
  return (
    <Panel style={{ maxWidth: 520 }}>
      <RoleEditor {...p} catalog={p.catalog ?? catalog} role={role} onChange={setRole} />
    </Panel>
  );
}

const meta = {
  title: 'Domain/RoleEditor',
  component: RoleEditor,
  args: { role: manager, catalog, onChange: () => undefined },
} satisfies Meta<typeof RoleEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 02 §6.7: «Менеджер логистики», логистика не подключена, раскрыта (UD-47). */
export const ManagerLogisticsOff: Story = {
  name: 'Менеджер логистики — модуль не подключён',
  render: () => <Live role={manager} initiallyOpen={['logistics']} />,
};

/** Частично выданный уровень — неопределённый флажок; модуль только с частичными уровнями включён. */
export const Partial: Story = {
  name: 'Частично выданный уровень',
  render: () => (
    <Live
      role={{ ...manager, partial: { tasks: ['create'], spa: ['view'] } }}
      initiallyOpen={['tasks']}
    />
  ),
};

/** UD-49: роль функции «Водитель». */
export const Driver: Story = {
  name: 'Роль функции «Водитель»',
  render: () => (
    <Live
      role={{ id: 'r-driver', name: 'Водитель', actions: { logistics: ['view', 'create'] } }}
      driverBlocked
      driverReason="role"
    />
  ),
};

/** UD-50: системная роль. */
export const System: Story = {
  name: 'Системная роль',
  render: () => (
    <Live role={{ id: 'r-owner', name: 'Владелец бизнеса', system: true, actions: {} }} />
  ),
};
