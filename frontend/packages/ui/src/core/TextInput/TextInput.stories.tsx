import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Caption, Panel } from '../../stories/layout';
import { Field } from '../Field';
import { MoneyInput } from '../MoneyInput';
import { NumberInput } from '../NumberInput';
import { Select } from '../Select';
import { TextInput } from './TextInput';

const noop = () => undefined;

const meta = {
  title: 'Core/TextInput',
  component: TextInput,
  args: { value: 'Мойка после рейса', onChange: noop, 'aria-label': 'Комментарий' },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function FieldsShowcase(): ReactElement {
  const [start, setStart] = useState<number | ''>(48210);
  const [end, setEnd] = useState<number | ''>(48100);
  const [comment, setComment] = useState('Мойка после рейса');
  const [amount, setAmount] = useState<number | null>(325000);
  const [category, setCategory] = useState('fuel');
  return (
    <Panel
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
        gap: '20px 16px',
      }}
    >
      <Field label="Пробег при выезде" hint="Как на приборной панели">
        <NumberInput value={start} onChange={setStart} unit="км" />
      </Field>
      <Field label="Фокус">
        <TextInput value={comment} onChange={setComment} />
      </Field>
      <Field label="Пробег при сдаче" error="Пробег не может быть меньше 48 210 км">
        <NumberInput value={end} onChange={setEnd} unit="км" />
      </Field>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Field label="Сумма">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Caption>amountMinor: {amount ?? 'null'}</Caption>
      </div>
      <Field label="Фирма (только чтение)" readOnly>
        <TextInput value="Москва / Логистика 1" onChange={noop} />
      </Field>
      <Field label="Категория">
        <Select
          value={category}
          onChange={setCategory}
          options={[
            { value: 'fuel', label: 'Топливо' },
            { value: 'wash', label: 'Мойка' },
            { value: 'parking', label: 'Парковка' },
          ]}
        />
      </Field>
    </Panel>
  );
}

/** Поля витрины (Дизайн-система.dc.html:219–225) из TextInput, NumberInput, MoneyInput, Select. */
export const Showcase: Story = {
  name: 'Поля витрины',
  render: () => <FieldsShowcase />,
};

function InField(): ReactElement {
  const [value, setValue] = useState('Мойка после рейса');
  return (
    <Field label="Комментарий">
      <TextInput value={value} onChange={setValue} />
    </Field>
  );
}

export const WithField: Story = {
  name: 'В поле с подписью',
  render: () => <InField />,
};

/** Вне Field: собственная рамка, имя из aria-label. */
export const Standalone: Story = {
  name: 'Без Field',
  args: { value: '', 'aria-label': 'Поиск', placeholder: 'Номер рейса' },
};

export const Large: Story = {
  name: 'Госномер 48 px моноширинный',
  render: () => (
    <Field label="Госномер">
      <TextInput value="А 123 ВС 77" onChange={noop} size="lg" mono />
    </Field>
  ),
};
