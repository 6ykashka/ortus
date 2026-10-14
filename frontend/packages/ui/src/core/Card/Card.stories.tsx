import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { Status } from '../Status';
import { Card } from './Card';

const noop = () => undefined;

const meta = {
  title: 'Core/Card',
  component: Card,
  args: {
    title: 'Логистика',
    meta: 'Подключён · 12 мест',
    children: 'Автопарк, рейсы, осмотры и приёмка смен.',
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: 'Обычная' };

/** Карточка-строка таблицы на ширине < 640 (Дизайн-система.dc.html:375–379). */
export const Clickable: Story = {
  name: 'Кликабельная (строка на телефоне)',
  args: {
    title: 'TR-000214',
    meta: 'А 123 ВС 77 · Илья Васильев',
    onOpen: noop,
    children: (
      <Status tone="warn" icon="pending">
        Ожидает приёмки
      </Status>
    ),
    actions: (
      <Button variant="secondary" size="compact">
        Принять смену
      </Button>
    ),
  },
};

export const Selected: Story = {
  name: 'Выбранная',
  args: { title: 'Москва-1', meta: 'Регион · 3 фирмы', onOpen: noop, selected: true },
};

export const Disabled: Story = {
  name: 'Недоступная с причиной',
  args: {
    title: 'Склад',
    meta: 'Номенклатура, партии, резервы',
    onOpen: noop,
    disabled: true,
    disabledReason: 'Модуль не подключён',
    children: undefined,
  },
};

export const Dashed: Story = {
  name: 'Пунктир',
  args: {
    title: 'Склад',
    meta: 'Не подключён',
    dashed: true,
    children: undefined,
    actions: <Button variant="ghost">Подключить</Button>,
  },
};
