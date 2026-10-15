import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Core/EmptyState',
  component: EmptyState,
  args: {
    icon: 'inbox',
    title: 'Нет смен на проверке',
    text: 'Когда водитель сдаст машину, смена появится здесь.',
  },
  render: (args) => (
    <div style={{ maxWidth: 360, display: 'flex' }}>
      <EmptyState {...args} />
    </div>
  ),
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Дизайн-система.dc.html:396–400. */
export const Showcase: Story = {
  name: 'Нет смен на проверке',
};

/** Пунктир и действие (Ортус CRM.dc.html:816–829). */
export const DashedWithAction: Story = {
  name: 'Пунктир с действием',
  args: {
    icon: 'verified',
    title: 'Смена принята',
    text: 'Менеджер подтвердил осмотр и расходы. Машина снова доступна для назначения.',
    dashed: true,
    action: { label: 'Начать новую демо-смену', onPress: () => undefined },
  },
};
