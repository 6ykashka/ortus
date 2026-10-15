import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Button } from '../../core/Button';
import { Status } from '../../core/Status';
import type { DataColumn } from '../../types';
import { DataTable } from './DataTable';

interface Trip {
  id: string;
  car: string;
  driver: string;
  state: 'review' | 'route' | 'done';
  cost: number;
}

// Дизайн-система.dc.html:365–369.
const rows: Trip[] = [
  { id: 'TR-000214', car: 'А 123 ВС 77', driver: 'Илья Васильев', state: 'review', cost: 4120 },
  { id: 'TR-000213', car: 'Е 482 КМ 77', driver: 'Олег Белов', state: 'route', cost: 0 },
  { id: 'TR-000211', car: 'М 901 ОР 50', driver: 'Сергей Ким', state: 'done', cost: 2870 },
];

const STATE = {
  review: { tone: 'warn', icon: 'pending', text: 'Ожидает приёмки' },
  route: { tone: 'info', icon: 'route', text: 'В рейсе' },
  done: { tone: 'ok', icon: 'verified', text: 'Принят' },
} as const;

const rub = (n: number) => (n ? `${n.toLocaleString('ru-RU')} ₽` : '—');

const columns: DataColumn<Trip>[] = [
  { key: 'id', header: 'Рейс', mono: true, primary: true, render: (r) => r.id },
  { key: 'car', header: 'Машина', mono: true, render: (r) => r.car },
  { key: 'driver', header: 'Водитель', render: (r) => r.driver },
  {
    key: 'state',
    header: 'Статус',
    render: (r) => (
      <Status tone={STATE[r.state].tone} icon={STATE[r.state].icon}>
        {STATE[r.state].text}
      </Status>
    ),
  },
  { key: 'cost', header: 'Расходы', align: 'right', render: (r) => rub(r.cost) },
];

const meta = {
  title: 'Domain/DataTable',
  component: DataTable,
  args: { columns, rows, rowKey: (r: Trip) => r.id },
} satisfies Meta<typeof DataTable<Trip>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Таблица рейсов витрины (Дизайн-система.dc.html:362–372). */
export const Trips: Story = {
  name: 'Рейсы витрины',
  args: { onRow: () => undefined },
};

function Sorted(): ReactElement {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'id',
    dir: 'desc',
  });
  const sorted = [...rows].sort((a, b) => {
    const k = sort.key as keyof Trip;
    const cmp = String(a[k]).localeCompare(String(b[k]), 'ru', { numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return (
    <DataTable
      columns={columns}
      rows={sorted}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={setSort}
      filter={
        <Button variant="secondary" size="compact" icon="filter_list">
          Фильтр
        </Button>
      }
    />
  );
}

/** Сортировка в заголовке (состояние — у страницы, в URL) и фильтр над таблицей. */
export const Sorting: Story = {
  name: 'Сортировка и фильтр',
  render: () => <Sorted />,
};

export const Loading: Story = {
  name: 'Загрузка',
  args: { rows: [], state: 'loading' },
};

export const Empty: Story = {
  name: 'Пусто',
  args: {
    rows: [],
    state: 'empty',
    empty: {
      icon: 'inbox',
      title: 'Нет смен на проверке',
      text: 'Когда водитель сдаст машину, смена появится здесь.',
    },
  },
};

export const Failed: Story = {
  name: 'Ошибка',
  args: {
    rows: [],
    state: 'error',
    error: { text: 'Не удалось загрузить рейсы.', onRetry: () => undefined },
  },
};

/** < 640 px: список карточек, вся карточка — одна кнопка (Дизайн-система.dc.html:374–379). */
export const Cards: Story = {
  name: 'Карточки на телефоне',
  args: { onRow: () => undefined },
  globals: { viewport: { value: 'mobile-390' } },
};

/** mobile="scroll": на телефоне таблица прокручивается внутри рамки (Q-W0.10-2). */
export const Scroll: Story = {
  name: 'Прокрутка на телефоне',
  args: { mobile: 'scroll' },
  globals: { viewport: { value: 'mobile-390' } },
};
