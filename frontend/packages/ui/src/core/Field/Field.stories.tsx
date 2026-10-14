import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel } from '../../stories/layout';
import { Field } from './Field';

const meta = {
  title: 'Core/Field',
  component: Field,
  args: {
    label: 'Пробег при выезде',
    hint: 'Как на приборной панели',
    unit: 'км',
    children: <input inputMode="numeric" defaultValue="48 210" />,
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Секция «Поля ввода» витрины (Дизайн-система.dc.html:219–225). */
export const Showcase: Story = {
  name: 'Поля витрины',
  render: () => (
    <Panel
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
        gap: '20px 16px',
      }}
    >
      <Field label="Пробег при выезде" hint="Как на приборной панели" unit="км">
        <input inputMode="numeric" defaultValue="48 210" />
      </Field>
      <Field label="Комментарий">
        <input defaultValue="Мойка после рейса" />
      </Field>
      <Field label="Пробег при сдаче" error="Пробег не может быть меньше 48 210 км" unit="км">
        <input inputMode="numeric" defaultValue="48 100" />
      </Field>
      <Field label="Сумма" unit="₽">
        <input inputMode="decimal" defaultValue="3 250,00" style={{ textAlign: 'right' }} />
      </Field>
      <Field label="Фирма (только чтение)" readOnly>
        <input defaultValue="Москва / Логистика 1" />
      </Field>
      <Field label="Категория">
        <select defaultValue="Топливо">
          <option>Топливо</option>
          <option>Мойка</option>
          <option>Парковка</option>
        </select>
      </Field>
    </Panel>
  ),
};

export const WithHintAndUnit: Story = { name: 'Обычное с подсказкой и единицей' };

export const Invalid: Story = {
  name: 'Ошибка',
  args: {
    label: 'Пробег при сдаче',
    hint: undefined,
    error: 'Пробег не может быть меньше 48 210 км',
    children: <input inputMode="numeric" defaultValue="48 100" />,
  },
};

export const ReadOnly: Story = {
  name: 'Только чтение',
  args: {
    label: 'Фирма (только чтение)',
    hint: undefined,
    unit: undefined,
    readOnly: true,
    children: <input defaultValue="Москва / Логистика 1" />,
  },
};

export const Disabled: Story = {
  name: 'Недоступно',
  args: { disabled: true },
};
