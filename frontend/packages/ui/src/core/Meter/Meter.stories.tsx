import type { Meta, StoryObj } from '@storybook/react-vite';
import { Meter } from './Meter';

const meta = {
  title: 'Core/Meter',
  component: Meter,
  args: { value: 46.2, max: 50, label: 'Занятое место', text: '46,2 ГБ из 50 ГБ' },
  render: (args) => (
    <div style={{ maxWidth: 480 }}>
      <Meter {...args} />
    </div>
  ),
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** «Место организации» (Ортус CRM.dc.html:258–263). */
export const Storage: Story = {
  name: 'Занятое место',
};

/** 46,2 из 25 ГБ — заливка 100 % и danger. */
export const Over: Story = {
  name: 'Сверх лимита',
  args: { value: 46.2, max: 25, text: '46,2 ГБ из 25 ГБ' },
};
