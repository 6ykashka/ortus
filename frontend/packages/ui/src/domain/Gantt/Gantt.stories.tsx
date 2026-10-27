import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { GanttProps, GanttStage } from '../../types';
import { Gantt } from './Gantt';

const calendar = { weekends: [0, 6], holidays: ['2026-11-04'] };

const stages: GanttStage[] = [
  {
    id: 's1',
    title: 'Демонтаж',
    phase: 'Черновые работы',
    start: '2026-10-05',
    end: '2026-10-09',
    kind: 'accepted',
    meta: '05.10–09.10 · 5 дн',
  },
  {
    id: 's2',
    title: 'Электрика · черновая',
    phase: 'Черновые работы',
    start: '2026-10-12',
    end: '2026-10-23',
    kind: 'plan',
    progress: { accepted: 0.53, review: 0.08 },
    critical: true,
    meta: '12.10–23.10 · 10 дн',
    variance: { text: '+2 дн', tone: 'warn' },
    canResize: true,
  },
  {
    id: 's3',
    title: 'Штукатурка стен',
    phase: 'Черновые работы',
    start: '2026-10-20',
    end: '2026-11-02',
    kind: 'plan',
    critical: true,
    canMove: true,
    canResize: true,
    paused: [{ start: '2026-11-03', end: '2026-11-07', label: 'сушка штукатурки · 5 дней' }],
    marks: [{ icon: 'inventory_2', label: 'Материала нет на объекте', tone: 'warn' }],
    meta: '20.10–02.11 · 10 дн',
  },
  {
    id: 's4',
    title: 'Сдача объекта',
    phase: 'Сдача',
    start: '2026-12-01',
    end: '2026-12-01',
    kind: 'plan',
    milestone: true,
    critical: true,
    baseline: { start: '2026-11-27', end: '2026-11-27' },
  },
];

const meta = {
  title: 'Domain/Gantt',
  component: Gantt,
  args: {
    stages,
    links: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 's4' },
    ],
    today: '2026-10-20',
    calendar,
    zoom: 'fit',
    baseline: true,
  } satisfies GanttProps,
} satisfies Meta<typeof Gantt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fit: Story = { name: 'Весь объект' };

export const Days: Story = { name: 'По дням', args: { zoom: 'day' } };

export const CriticalPath: Story = {
  name: 'Критический путь',
  args: { criticalMode: true, selected: 's3' },
};

function DraggingDemo(args: GanttProps) {
  const [list, setList] = useState(args.stages);
  return (
    <Gantt
      {...args}
      stages={list}
      onPreview={(c) =>
        setList((cur) =>
          cur.map((s) => (s.id === c.stageId ? { ...s, start: c.start, end: c.end } : s)),
        )
      }
    />
  );
}

/** Перетаскивание мышью: правый край и полоса меняют даты (рабочие дни). */
export const Dragging: Story = {
  name: 'Перетаскивание',
  args: { zoom: 'day' },
  render: (args) => <DraggingDemo {...args} />,
};
