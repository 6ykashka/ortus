import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties, type ReactElement } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from './Sheet';

const noop = () => undefined;

const meta = {
  title: 'Core/Sheet',
  component: Sheet,
  args: { open: true, onClose: noop, title: 'Все разделы', children: null },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

// Пункты листа рисует вызывающий (Ортус CRM.dc.html:2278–2279): 48 px, радиус 10, иконка 22.
const groupTitle: CSSProperties = {
  padding: '10px 10px 4px',
  color: 'var(--ox-text-muted)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

function SheetItem({ icon, label, current }: { icon: string; label: string; current?: boolean }) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: 48,
        padding: '0 12px',
        border: 0,
        borderRadius: 'var(--ox-radius-lg)',
        background: current ? 'var(--ox-accent-soft)' : 'transparent',
        color: current ? 'var(--ox-accent)' : 'var(--ox-text-label)',
        fontWeight: current ? 600 : 400,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Icon name={icon} size={22} />
      {label}
    </button>
  );
}

function Sections({ initial }: { initial: boolean }): ReactElement {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <Button variant="secondary" icon="menu" onPress={() => setOpen(true)}>
        Ещё
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Все разделы">
        <div style={groupTitle}>Обзор</div>
        <SheetItem icon="home" label="Главная" current />
        <div style={groupTitle}>Компания</div>
        <SheetItem icon="extension" label="Модули и место" />
        <SheetItem icon="group" label="Пользователи и роли" />
      </Sheet>
    </>
  );
}

/** Лист «Все разделы» нижней навигации (Ортус CRM.dc.html:2274–2281); на < 640 — снизу. */
export const AllSections: Story = {
  name: 'Все разделы',
  render: () => <Sections initial={false} />,
};

export const Open: Story = {
  name: 'Открыт на телефоне',
  render: () => <Sections initial />,
  globals: { viewport: { value: 'mobile-390' } },
};
