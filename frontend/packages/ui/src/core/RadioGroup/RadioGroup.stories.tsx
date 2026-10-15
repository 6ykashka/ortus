import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Radio } from '../Radio';
import { RadioGroup } from './RadioGroup';

const meta = {
  title: 'Core/RadioGroup',
  component: RadioGroup,
  args: { label: 'Уровень топлива', value: 'q2', onChange: () => undefined, children: null },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function Fuel(): ReactElement {
  const [value, setValue] = useState('q2');
  return (
    <div style={{ maxWidth: 280 }}>
      <RadioGroup label="Уровень топлива" value={value} onChange={setValue}>
        <Radio value="q1" label="¼" />
        <Radio value="q2" label="½" />
        <Radio value="q3" label="¾" />
        <Radio value="full" label="Полный" />
      </RadioGroup>
    </div>
  );
}

/** Плитки «Уровень топлива» (Дизайн-система.dc.html:236–243). */
export const Tiles: Story = {
  name: 'Уровень топлива',
  render: () => <Fuel />,
};

function Base(): ReactElement {
  const [value, setValue] = useState('empty');
  return (
    <div style={{ maxWidth: 520 }}>
      <RadioGroup label="Основа роли" labelHidden variant="cards" value={value} onChange={setValue}>
        <Radio value="empty" label="С нуля" description="Пустая роль, действия добавите сами" />
        <Radio value="copy" label="Копия роли" description="Начать с действий существующей роли" />
      </RadioGroup>
    </div>
  );
}

/** Карточки «Основа роли» (Ортус CRM.dc.html:2252–2258). */
export const Cards: Story = {
  name: 'Карточки',
  render: () => <Base />,
};
