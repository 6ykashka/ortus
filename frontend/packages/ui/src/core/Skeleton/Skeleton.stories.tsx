import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel, Row } from '../../stories/layout';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Core/Skeleton',
  component: Skeleton,
  args: {},
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Три полосы 40/85/65 % в карточке (Дизайн-система.dc.html:401–405). */
export const Showcase: Story = {
  name: 'Скелетон витрины',
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Panel style={{ padding: 16 }}>
        <Skeleton />
      </Panel>
    </div>
  ),
};

/** «Загружаем рабочее пространство…» — role="status" «Загрузка» (Ортус CRM.dc.html:183–188). */
export const Workspace: Story = {
  name: 'Загрузка рабочего пространства',
  args: { lines: 4, label: 'Загружаем рабочее пространство…' },
};

export const Shapes: Story = {
  name: 'Блок и круг',
  render: () => (
    <Row gap={16}>
      <div style={{ width: 240 }}>
        <Skeleton shape="block" />
      </div>
      <Skeleton shape="circle" />
    </Row>
  ),
};
