import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Field } from '../Field';
import { DateInput } from './DateInput';

const meta = {
  title: 'Core/DateInput',
  component: DateInput,
  args: { value: '2026-10-15', onChange: () => undefined, 'aria-label': 'Дата' },
} satisfies Meta<typeof DateInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Until({ disabled }: { disabled?: boolean }): ReactElement {
  const [value, setValue] = useState('');
  return (
    <div style={{ maxWidth: 240 }}>
      <Field label="Действует до" hint="Необязательно" disabled={disabled}>
        <DateInput value={value} onChange={setValue} />
      </Field>
    </div>
  );
}

/** «Действует до» назначения роли (Ортус CRM.dc.html:2215). */
export const Default: Story = {
  name: 'Действует до',
  render: () => <Until />,
};

export const Disabled: Story = {
  name: 'Недоступно',
  render: () => <Until disabled />,
};
