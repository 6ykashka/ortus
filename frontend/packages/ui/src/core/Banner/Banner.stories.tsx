import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stack } from '../../stories/layout';
import { Banner } from './Banner';

const noop = () => undefined;

const meta = {
  title: 'Core/Banner',
  component: Banner,
  args: { tone: 'warn', icon: 'cloud_off', title: 'Нет связи.' },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Четыре баннера витрины (Дизайн-система.dc.html:275–278). */
export const Showcase: Story = {
  name: 'Баннеры витрины',
  render: () => (
    <Stack>
      <Banner
        tone="info"
        icon="hourglass_top"
        title="Пробный период — осталось 3 дня."
        text="После окончания 7 дней льготного периода, затем только чтение. Данные не удаляются."
        action={{ label: 'Продлить', onPress: noop }}
      />
      <Banner
        tone="warn"
        icon="cloud_off"
        title="Нет связи."
        text="Фото и расходы сохраняются на устройстве. Выезд и сдача будут доступны после подключения."
      />
      <Banner
        tone="neutral"
        icon="history"
        title="Логистика отключена · только чтение."
        text="Новые рейсы закрыты, история доступна. Начатые смены можно сдать."
      />
      <Banner
        tone="danger"
        icon="storage"
        title="Хранилище заполнено: 5,0 из 5 ГиБ."
        text="Новые фото не загружаются. Начатые смены закрываются из резерва."
        action={{ label: 'Увеличить место', onPress: noop }}
      />
    </Stack>
  ),
};

export const WithAction: Story = {
  name: 'С действием',
  args: {
    tone: 'ok',
    icon: 'cloud_done',
    title: 'Связь восстановлена.',
    text: 'Отправили 3 фото и 2 расхода.',
    action: { label: 'Открыть', onPress: noop },
  },
};
