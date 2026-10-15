import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import type { ScopeOption } from '../../types';
import { ScopeSelect } from './ScopeSelect';

const options: ScopeOption[] = [
  { value: 'all', label: 'Все подразделения', kind: 'tenant' },
  { value: 'msk', label: 'Москва · весь регион', kind: 'region' },
  { value: 'msk-l1', label: 'Москва / Логистика 1', kind: 'firm' },
  { value: 'spb-l2', label: 'Санкт-Петербург / Логистика 2', kind: 'firm' },
];

const meta = {
  title: 'Core/ScopeSelect',
  component: ScopeSelect,
  args: { value: 'all', options, onChange: () => undefined },
} satisfies Meta<typeof ScopeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

function Scope({ label }: { label?: string }): ReactElement {
  const [value, setValue] = useState('all');
  return <ScopeSelect value={value} onChange={setValue} options={options} label={label} />;
}

/** Шапка: «Область просмотра» (Ортус CRM.dc.html:109–112, подписи — @ortus/texts shell.header). */
export const Default: Story = {
  name: 'Область просмотра',
  render: () => <Scope />,
};

export const CustomLabel: Story = {
  name: 'Своя подпись',
  render: () => <Scope label="Область" />,
};
