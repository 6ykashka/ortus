import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties, type ReactElement } from 'react';
import { Stack } from '../../stories/layout';
import { Checkbox } from './Checkbox';

const meta = {
  title: 'Core/Checkbox',
  component: Checkbox,
  args: { checked: true, label: 'Кузов и стёкла осмотрены', onChange: () => undefined },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

function Item({ label, initial }: { label: string; initial: boolean }): ReactElement {
  const [checked, setChecked] = useState(initial);
  return <Checkbox checked={checked} onChange={setChecked} label={label} />;
}

/** «Чек-лист» витрины (Дизайн-система.dc.html:226–230). */
export const Showcase: Story = {
  name: 'Чек-лист витрины',
  render: () => (
    <div style={{ maxWidth: 280 }}>
      <Stack gap={6}>
        <Item label="Кузов и стёкла осмотрены" initial />
        <Item label="Документы на месте" initial={false} />
      </Stack>
    </div>
  ),
};

export const States: Story = {
  name: 'Неопределённый и недоступный',
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <Stack gap={6}>
        <Checkbox
          checked={false}
          indeterminate
          label="Все пункты осмотра"
          onChange={() => undefined}
        />
        <Checkbox checked disabled label="Документы на месте" onChange={() => undefined} />
        <Checkbox
          checked={false}
          label="Шины и диски"
          description="Протектор не меньше 1,6 мм"
          onChange={() => undefined}
        />
      </Stack>
    </div>
  ),
};

/** Флажок подтверждения: 48 px, радиус 10, фон raised (Ортус CRM.dc.html:2194). */
const ackVars = {
  '--ox-check-row-h': 'var(--ox-control-mobile)',
  '--ox-check-row-radius': 'var(--ox-radius-lg)',
  '--ox-check-row-line': 'var(--ox-line)',
  '--ox-check-row-bg': 'var(--ox-raised)',
  maxWidth: 480,
} as CSSProperties;

export const Ack: Story = {
  name: 'Флажок подтверждения',
  render: () => (
    <div style={ackVars}>
      <Item label="Понимаю последствия для текущей работы" initial={false} />
    </div>
  ),
};
