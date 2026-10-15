import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Field } from '../Field';
import { NumberInput } from './NumberInput';

const meta = {
  title: 'Core/NumberInput',
  component: NumberInput,
  args: { value: 48210, onChange: () => undefined, unit: 'км', 'aria-label': 'Пробег' },
} satisfies Meta<typeof NumberInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Odometer({ error, lg }: { error?: string; lg?: boolean }): ReactElement {
  const [value, setValue] = useState<number | ''>(error ? 48100 : 48210);
  return (
    <div style={{ maxWidth: 320 }}>
      <Field
        label={error ? 'Пробег при сдаче' : 'Пробег при выезде'}
        hint={error ? undefined : 'Как на приборной панели'}
        error={error}
      >
        <NumberInput
          value={value}
          onChange={setValue}
          unit="км"
          min={0}
          size={lg ? 'lg' : 'md'}
          mono={lg}
        />
      </Field>
    </div>
  );
}

/** «Пробег при выезде» 48 210 км (Дизайн-система.dc.html:220). */
export const Mileage: Story = {
  name: 'Пробег при выезде',
  render: () => <Odometer />,
};

/** Ошибка под полем (Дизайн-система.dc.html:222). */
export const Invalid: Story = {
  name: 'Ошибка пробега',
  render: () => <Odometer error="Пробег не может быть меньше 48 210 км" />,
};

/** Одометр водителя: 48 px, моноширинный (Ортус CRM.dc.html:747). */
export const Mobile: Story = {
  name: 'Одометр 48 px',
  render: () => <Odometer lg />,
};
