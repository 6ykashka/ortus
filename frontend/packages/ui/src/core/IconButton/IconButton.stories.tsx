import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../stories/layout';
import { IconButton } from './IconButton';

const meta = {
  title: 'Core/IconButton',
  component: IconButton,
  args: { icon: 'close', label: 'Закрыть' },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Кнопка-иконка и бейдж (Дизайн-система.dc.html:207–208). */
export const Showcase: Story = {
  name: 'Кнопка-иконка витрины',
  render: () => (
    <Row gap={8}>
      <IconButton icon="notifications" label="Уведомления, 3 новых" badge={3} />
      <IconButton icon="close" label="Закрыть" />
    </Row>
  ),
};

/** «Закрыть» листа «Все разделы» — 44×44 (Ортус CRM.dc.html:2276). */
export const Sheet44: Story = {
  name: 'Лист: закрыть 44',
  args: { icon: 'close', label: 'Закрыть', size: 44 },
};
