import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel, Row } from '../../stories/layout';
import { Status } from './Status';

const meta = {
  title: 'Core/Status',
  component: Status,
  args: { tone: 'warn', icon: 'pending', children: 'Ожидает приёмки' },
} satisfies Meta<typeof Status>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  name: 'Пять тонов',
  render: () => (
    <Row gap={6}>
      <Status tone="ok" icon="check_circle">
        ok
      </Status>
      <Status tone="info" icon="info">
        info
      </Status>
      <Status tone="warn" icon="warning">
        warn
      </Status>
      <Status tone="danger" icon="error">
        danger
      </Status>
      <Status tone="neutral" icon="circle">
        neutral
      </Status>
    </Row>
  ),
};

/** «Состояния рейса» (Дизайн-система.dc.html:252–261). */
export const TripStates: Story = {
  name: 'Состояния рейса',
  render: () => (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--ox-fs-lg)', fontWeight: 600 }}>Состояния рейса</h3>
      <Row gap={6}>
        <Status tone="neutral" icon="event">
          Запланирован
        </Status>
        <Status tone="info" icon="event_available">
          Машина назначена
        </Status>
        <Status tone="info" icon="fact_check">
          Осмотр перед выездом
        </Status>
        <Status tone="danger" icon="report">
          Дефект на проверке
        </Status>
        <Status tone="info" icon="route">
          В рейсе
        </Status>
        <Status tone="warn" icon="pending">
          Ожидает приёмки
        </Status>
        <Status tone="warn" icon="undo">
          На доработке
        </Status>
        <Status tone="ok" icon="verified">
          Принят
        </Status>
      </Row>
    </Panel>
  ),
};
