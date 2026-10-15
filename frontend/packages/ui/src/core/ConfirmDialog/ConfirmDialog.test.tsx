import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Consequence } from '../../types';
import { seriousViolations } from '../../test/axe';
import { ConfirmDialog } from '../ConfirmDialog';

// Ортус CRM.dc.html:2660–2682 — отключение модуля «Логистика».
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
    ],
  },
];

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onConfirm: vi.fn() };
  render(
    <ConfirmDialog
      open
      title="Отключить «Логистика»?"
      text="Данные не удаляются. Модуль перейдёт в режим чтения истории."
      icon="extension_off"
      tone="danger"
      consequences={consequences}
      ack={{ label: 'Понимаю последствия для текущей работы' }}
      confirmLabel="Отключить модуль"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('ConfirmDialog (Ортус CRM.dc.html:2180–2199): последствия, флажок, «Выполняем…»', () => {
  it('закрытый не рендерится', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('диалог с именем из заголовка h2, aria-modal, текст и секции последствий', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Отключить «Логистика»?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Отключить «Логистика»?',
    );
    expect(
      screen.getByText('Данные не удаляются. Модуль перейдёт в режим чтения истории.'),
    ).toBeVisible();
    expect(screen.getByText('Затронет сейчас')).toBeVisible();
    expect(screen.getByText('Что произойдёт')).toBeVisible();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'local_shipping2 активных рейса можно будет сдать и принять',
      'blockНовые брони и рейсы закроются',
      'historyИстория, назначения ролей и файлы сохраняются',
    ]);
  });

  it('без флажка «Понимаю последствия…» подтвердить нельзя; с флажком — onConfirm', async () => {
    const { onConfirm } = renderDialog();
    const user = userEvent.setup();
    const confirm = screen.getByRole('button', { name: 'Отключить модуль' });
    expect(confirm).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: 'Понимаю последствия для текущей работы' }),
    );
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveAttribute('data-variant', 'danger');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('без ack подтверждение доступно сразу; tone по умолчанию — основная кнопка', async () => {
    const { onConfirm } = renderDialog({ ack: undefined, tone: undefined, consequences: [] });
    const confirm = screen.getByRole('button', { name: 'Отключить модуль' });
    expect(confirm).toHaveAttribute('data-variant', 'primary');
    await userEvent.setup().click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('busy: «Выполняем…», обе кнопки недоступны, aria-busy, Esc не закрывает', async () => {
    const { onClose } = renderDialog({ busy: true, ack: undefined });
    expect(screen.getByRole('button', { name: 'Выполняем…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('«Отмена» и Esc вызывают onClose; подпись отмены переопределяется', async () => {
    const { onClose } = renderDialog({ cancelLabel: 'Не отключать' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Не отключать' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('axe: открытый диалог без нарушений serious/critical', async () => {
    renderDialog();
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});
