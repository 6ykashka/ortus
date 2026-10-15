import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import type { Consequence } from '../../types';
import { Button } from '../Button';
import { ConfirmDialog } from './ConfirmDialog';

const noop = () => undefined;

// Отключение модуля «Логистика» (Ортус CRM.dc.html:2660–2682).
const consequences: Consequence[] = [
  {
    title: 'Затронет сейчас',
    items: [
      {
        icon: 'local_shipping',
        tone: 'warn',
        text: '2 активных рейса можно будет сдать и принять',
      },
    ],
  },
  {
    title: 'Что произойдёт',
    items: [
      { icon: 'block', tone: 'danger', text: 'Новые брони и рейсы закроются' },
      { icon: 'history', tone: 'neutral', text: 'История, назначения ролей и файлы сохраняются' },
      {
        icon: 'menu_open',
        tone: 'neutral',
        text: 'Группа модуля уйдёт из меню, останется один пункт в «Отключены · только чтение»',
      },
    ],
  },
];

const meta = {
  title: 'Core/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    open: true,
    onClose: noop,
    onConfirm: noop,
    title: 'Отключить «Логистика»?',
    confirmLabel: 'Отключить модуль',
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Disable(): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="danger" icon="extension_off" onPress={() => setOpen(true)}>
        Открыть диалог
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setOpen(false);
          }, 1000);
        }}
        busy={busy}
        title="Отключить «Логистика»?"
        text="Данные не удаляются. Модуль перейдёт в режим чтения истории."
        icon="extension_off"
        tone="danger"
        consequences={consequences}
        ack={{ label: 'Понимаю последствия для текущей работы' }}
        confirmLabel="Отключить модуль"
      />
    </>
  );
}

/** Подтверждение с последствиями и флажком; «Выполняем…» держится 1 с. */
export const DisableLogistics: Story = {
  name: 'Отключить «Логистика»?',
  render: () => <Disable />,
};

export const Busy: Story = {
  name: 'Выполняется',
  args: {
    open: true,
    busy: true,
    text: 'Данные не удаляются. Модуль перейдёт в режим чтения истории.',
    icon: 'extension_off',
    tone: 'danger',
    consequences,
  },
};
