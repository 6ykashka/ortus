import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Field } from '../Field';
import { Textarea } from './Textarea';

const meta = {
  title: 'Core/Textarea',
  component: Textarea,
  args: { value: '', onChange: () => undefined, 'aria-label': 'Заметка', rows: 3 },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

function Comment(): ReactElement {
  const [value, setValue] = useState('');
  return (
    <div style={{ maxWidth: 420 }}>
      <Field label="Комментарий для фирмы-владельца">
        <Textarea value={value} onChange={setValue} rows={2} placeholder="Необязательно" />
      </Field>
    </div>
  );
}

/** «Комментарий для фирмы-владельца» (Ортус CRM.dc.html:2268). */
export const Default: Story = {
  name: 'Комментарий',
  render: () => <Comment />,
};

export const Standalone: Story = {
  name: 'Без Field',
  args: { value: 'Мойка после рейса', 'aria-label': 'Заметка' },
};
