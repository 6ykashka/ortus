import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Caption, Stack } from '../../stories/layout';
import { Field } from '../Field';
import { MoneyInput } from './MoneyInput';

const meta = {
  title: 'Core/MoneyInput',
  component: MoneyInput,
  args: { value: 325000, onChange: () => undefined, 'aria-label': 'Сумма' },
} satisfies Meta<typeof MoneyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Amount({ initial }: { initial: number | null }): ReactElement {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <Stack gap={6}>
      <div style={{ maxWidth: 280 }}>
        <Field label="Сумма">
          <MoneyInput value={value} onChange={setValue} />
        </Field>
      </div>
      <Caption>amountMinor: {value ?? 'null'}</Caption>
    </Stack>
  );
}

/** «3 250,00 ₽», хранится amountMinor 325000 (Дизайн-система.dc.html:223). */
export const Amount325: Story = {
  name: 'Сумма',
  render: () => <Amount initial={325000} />,
};

export const Empty: Story = {
  name: 'Пусто',
  render: () => <Amount initial={null} />,
};
