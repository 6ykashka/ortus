import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScheduleChangePreview } from './ScheduleChangePreview';

const noop = () => undefined;

const meta = {
  title: 'Domain/ScheduleChangePreview',
  component: ScheduleChangePreview,
  args: {
    changes: [
      {
        stageId: 's3',
        title: 'Штукатурка стен',
        start: '2026-10-21',
        end: '2026-11-03',
        from: { start: '2026-10-20', end: '2026-11-02' },
      },
    ],
    moved: 3,
    finish: { from: '2026-12-01', to: '2026-12-03' },
    notify: ['Бригада О. Дронова', 'Заказчик'],
    reasons: [
      { value: 'executor_busy', label: 'Задержка подрядчика' },
      { value: 'material_delay', label: 'Поставка материалов' },
      { value: 'client_request', label: 'Решение заказчика' },
    ],
    onApply: noop,
    onCancel: noop,
  },
} satisfies Meta<typeof ScheduleChangePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: 'Сдача сдвигается' };

export const Late: Story = { name: 'Позже договора', args: { late: true } };

export const Saving: Story = { name: 'Идёт сохранение', args: { busy: true } };

export const Unchanged: Story = {
  name: 'Дата сдачи не меняется',
  args: { moved: 0, finish: { from: '2026-12-01', to: '2026-12-01' }, notify: [] },
};
