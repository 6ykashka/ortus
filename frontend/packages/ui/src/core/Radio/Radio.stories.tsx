import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio } from './Radio';

const meta = {
  title: 'Core/Radio',
  component: Radio,
  args: { value: 'q2', label: '½' },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Одиночное радио вне группы: состояние из checked. Плитка — Дизайн-система.dc.html:240. */
export const Checked: Story = {
  name: 'Одиночное отмеченное',
  args: { value: 'q2', label: '½', checked: true },
  render: (args) => (
    <div style={{ width: 64 }}>
      <Radio {...args} />
    </div>
  ),
};

export const Unchecked: Story = {
  name: 'Одиночное',
  args: { value: 'q1', label: '¼' },
  render: (args) => (
    <div style={{ width: 64 }}>
      <Radio {...args} />
    </div>
  ),
};
