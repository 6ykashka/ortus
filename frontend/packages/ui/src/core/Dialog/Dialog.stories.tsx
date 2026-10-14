import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../Button';
import { Dialog } from './Dialog';

const meta = {
  title: 'Core/Dialog',
  component: Dialog,
  args: {
    open: true,
    onClose: () => undefined,
    title: 'Отключить «Логистику»?',
    size: 'sm',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const consequences = (
  <ul>
    <li>2 активных рейса можно будет сдать и принять</li>
    <li>Новые брони и рейсы закроются</li>
    <li>История останется доступной для чтения</li>
    <li>Данные и роли не удаляются</li>
  </ul>
);

/** Опасный диалог витрины (Дизайн-система.dc.html:383–393). */
export const Danger: Story = {
  name: 'Опасный (витрина)',
  args: {
    children: consequences,
    footer: (
      <>
        <Button variant="secondary">Отмена</Button>
        <Button variant="danger">Отключить</Button>
      </>
    ),
  },
};

function Trigger() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ padding: 24 }}>
      <Button variant="danger" icon="extension_off" onPress={() => setOpen(true)}>
        Отключить модуль
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Отключить «Логистику»?"
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onPress={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel="Отключаем…"
              onPress={() => setBusy(true)}
            >
              Отключить
            </Button>
          </>
        }
      >
        {consequences}
      </Dialog>
    </div>
  );
}

export const OpenByButton: Story = {
  name: 'Открыть по кнопке',
  render: () => <Trigger />,
};
