import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Field } from '../Field';
import { Select } from './Select';

const options = [
  { value: 'fuel', label: 'Топливо' },
  { value: 'wash', label: 'Мойка' },
  { value: 'parking', label: 'Парковка' },
];

const meta = {
  title: 'Core/Select',
  component: Select,
  args: { value: 'fuel', options, onChange: () => undefined, 'aria-label': 'Категория' },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

function Category({ placeholder }: { placeholder?: string }): ReactElement {
  const [value, setValue] = useState(placeholder ? '' : 'fuel');
  return (
    <div style={{ maxWidth: 280 }}>
      <Field label={placeholder ? 'Роль' : 'Категория'}>
        <Select value={value} onChange={setValue} options={options} placeholder={placeholder} />
      </Field>
    </div>
  );
}

/** «Категория» Топливо / Мойка / Парковка (Дизайн-система.dc.html:225). */
export const Default: Story = {
  name: 'Категория',
  render: () => <Category />,
};

/** Пустая первая опция «Выберите роль» (Ортус CRM.dc.html:2207). */
export const WithPlaceholder: Story = {
  name: 'С пустой первой опцией',
  render: () => <Category placeholder="Выберите роль" />,
};
