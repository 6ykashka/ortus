import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactElement } from 'react';
import { Stack } from '../../stories/layout';
import { Button } from '../Button';
import { Toast } from './Toast';

const noop = () => undefined;
/** Статичные истории не скрываются: время показа — сутки. */
const DAY = 86_400_000;

const meta = {
  title: 'Core/Toast',
  component: Toast,
  args: { tone: 'ok', text: 'Список обновлён', onDismiss: noop, durationMs: DAY },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Четыре тона toastVM (Ортус CRM.dc.html:2888) и тост витрины с действием (Дизайн-система.dc.html:406). */
export const Tones: Story = {
  name: 'Тосты по тонам',
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Stack gap={12}>
        <Toast
          tone="ok"
          text="Смена принята. Машина свободна."
          action={{ label: 'Открыть', onPress: noop }}
          onDismiss={noop}
          durationMs={DAY}
        />
        <Toast tone="ok" text="Модуль «Логистика» подключён" onDismiss={noop} durationMs={DAY} />
        <Toast
          tone="warn"
          text="Нет связи. Черновики сохраняются на устройстве"
          onDismiss={noop}
          durationMs={DAY}
        />
        <Toast tone="info" text="Список обновлён" onDismiss={noop} durationMs={DAY} />
        <Toast tone="error" text="Ошибка" onDismiss={noop} durationMs={DAY} />
      </Stack>
    </div>
  ),
};

function Live(): ReactElement {
  const [text, setText] = useState<string | null>(null);
  return (
    <Stack gap={12}>
      <div>
        <Button variant="secondary" onPress={() => setText('Модуль «Логистика» подключён')}>
          Показать тост
        </Button>
      </div>
      {text ? <Toast tone="ok" text={text} onDismiss={() => setText(null)} /> : null}
    </Stack>
  );
}

/** Автоскрытие через 4200 мс (Ортус CRM.dc.html:2414). */
export const AutoHide: Story = {
  name: 'Автоскрытие',
  render: () => <Live />,
};
