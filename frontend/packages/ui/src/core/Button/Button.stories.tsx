import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption, Panel, Row } from '../../stories/layout';
import { Button } from './Button';

const meta = {
  title: 'Core/Button',
  component: Button,
  args: { children: 'Принять смену', icon: 'verified' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Сетка витрины «Обычное / Выполняется / Недоступно» (Дизайн-система.dc.html:160–190). */
export const Variants: Story = {
  name: 'Варианты',
  render: () => (
    <Panel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '110px repeat(3, minmax(200px, 1fr))',
          gap: '16px 12px',
          alignItems: 'center',
        }}
      >
        <span />
        <Caption>Обычное</Caption>
        <Caption>Выполняется</Caption>
        <Caption>Недоступно</Caption>

        <Caption>primary</Caption>
        <Button icon="verified">Принять смену</Button>
        <Button icon="verified" loading loadingLabel="Принимаем…">
          Принять смену
        </Button>
        <Button icon="verified" disabled disabledReason="Нет фото одометра">
          Принять смену
        </Button>

        <Caption>secondary</Caption>
        <Button variant="secondary" icon="undo">
          Вернуть на доработку
        </Button>
        <Button variant="secondary" icon="undo" loading loadingLabel="Отправляем…">
          Вернуть на доработку
        </Button>
        <Button variant="secondary" icon="undo" disabled>
          Вернуть на доработку
        </Button>

        <Caption>ghost</Caption>
        <Button variant="ghost">Обновить список</Button>
        <Caption>—</Caption>
        <Button variant="ghost" disabled>
          Обновить список
        </Button>

        <Caption>danger</Caption>
        <Button variant="danger" icon="extension_off">
          Отключить модуль
        </Button>
        <Button variant="danger" icon="extension_off" loading loadingLabel="Отключаем…">
          Отключить модуль
        </Button>
        <Button variant="danger" icon="extension_off" disabled>
          Отключить модуль
        </Button>
      </div>
    </Panel>
  ),
};

/** 48 px — основное действие на телефоне, 44 px — везде, 32 px — только плотные таблицы. */
export const Sizes: Story = {
  name: 'Размеры',
  render: () => (
    <Row>
      <Button size="lg" icon="route">
        Начать рейс
      </Button>
      <Button icon="verified">Принять смену</Button>
      <Button size="compact" variant="secondary" icon="filter_list">
        Фильтр
      </Button>
      <Button size="compact" variant="secondary" icon="download">
        Выгрузить
      </Button>
    </Row>
  ),
};

export const Loading: Story = {
  name: 'Выполняется',
  args: { loading: true, loadingLabel: 'Принимаем…' },
};

export const DisabledWithReason: Story = {
  name: 'Недоступно с причиной',
  args: { disabled: true, disabledReason: 'Нет фото одометра' },
};
