import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties, type ReactElement } from 'react';
import { Row, Stack } from '../../stories/layout';
import { Switch } from './Switch';

const meta = {
  title: 'Core/Switch',
  component: Switch,
  args: { checked: true, label: 'Логистика', onChange: () => undefined },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

function Toggle({
  label,
  initial,
  labelHidden,
}: {
  label: string;
  initial: boolean;
  labelHidden?: boolean;
}): ReactElement {
  const [on, setOn] = useState(initial);
  return <Switch checked={on} onChange={setOn} label={label} labelHidden={labelHidden} />;
}

/** «Переключатель модуля в роли» (Дизайн-система.dc.html:231–235). */
export const Showcase: Story = {
  name: 'Переключатель модуля в роли',
  render: () => (
    <div style={{ maxWidth: 280 }}>
      <Stack gap={6}>
        <Toggle label="Логистика" initial />
        <Toggle label="Склад" initial={false} />
      </Stack>
    </div>
  ),
};

/** CRM: 44×26, ручка 20 с тенью (Ортус CRM.dc.html:359); включён и недоступен одновременно. */
const crmVars = {
  '--ox-switch-w': '44px',
  '--ox-switch-h': '26px',
  '--ox-switch-knob': '20px',
  '--ox-switch-knob-shadow': '0 1px 2px var(--ox-scrim)',
} as CSSProperties;

export const Crm: Story = {
  name: 'Как в CRM: 44×26',
  render: () => (
    <div style={crmVars}>
      <Row>
        <Toggle label="Доступ роли к модулю «Логистика»" initial labelHidden />
        <Switch
          checked
          disabled
          labelHidden
          label="Доступ роли к модулю «Склад»"
          onChange={() => undefined}
        />
      </Row>
    </div>
  ),
};

export const Bare: Story = {
  name: 'Без подписи на экране',
  args: { checked: false, labelHidden: true, label: 'Склад' },
};
