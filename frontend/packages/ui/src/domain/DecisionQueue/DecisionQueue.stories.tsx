import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DecisionItem } from '../../types';
import { DecisionQueue } from './DecisionQueue';

// Ортус CRM.dc.html :1733–1744; homeVM :4053–4072 (логистика и организация).
const items: DecisionItem[] = [
  {
    id: 'defect',
    tone: 'danger',
    icon: 'report',
    tag: 'Блокирует выезд',
    title: 'Критический дефект · рейс Р-208',
    meta: 'Стёкла: Скол · Илья Васильев',
    action: { label: 'Решить', onPress: () => undefined },
  },
  {
    id: 'review',
    tone: 'warn',
    icon: 'fact_check',
    tag: 'Приёмка',
    title: 'Смена Р-205 ждёт приёмки',
    meta: 'Илья Васильев · машина не вернётся в пул до решения',
    action: { label: 'Проверить', onPress: () => undefined },
  },
  {
    id: 'pool',
    tone: 'info',
    icon: 'person_search',
    tag: 'Сегодня 14:00',
    title: 'Рейс Р-211 без водителя',
    meta: 'Охлаждённая продукция · Молочная продукция · +2…+6 °C',
    action: { label: 'Найти в пуле', onPress: () => undefined },
  },
  {
    id: 'trial',
    tone: 'neutral',
    icon: 'hourglass_top',
    tag: 'Подписка',
    title: 'Пробный период: осталось 12 дней',
    meta: 'До 13.10.2026. После окончания история останется доступной для чтения',
    action: { label: 'Модули и место', onPress: () => undefined },
  },
];

const meta = {
  title: 'Domain/DecisionQueue',
  component: DecisionQueue,
  args: { title: 'Требует решения', items, count: '4' },
} satisfies Meta<typeof DecisionQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: 'По срочности' };

export const Empty: Story = { name: 'Пусто', args: { items: [], count: '' } };

export const Loading: Story = { name: 'Загрузка', args: { items: [], state: 'loading' } };

export const Failed: Story = {
  name: 'Ошибка',
  args: {
    items: [],
    state: 'error',
    error: { text: 'Слишком много запросов. Повторите позже.', onRetry: () => undefined },
  },
};

export const Phone: Story = {
  name: 'Телефон',
  globals: { viewport: { value: 'mobile-390' } },
};
