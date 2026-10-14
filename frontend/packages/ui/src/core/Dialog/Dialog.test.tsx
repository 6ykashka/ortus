import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Button } from '../Button';
import { Dialog } from '../Dialog';

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onPress={() => setOpen(true)}>
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
            <Button variant="secondary" onPress={() => setOpen(false)}>
              Отмена
            </Button>
            <Button variant="danger">Отключить</Button>
          </>
        }
      >
        <ul>
          <li>Новые брони и рейсы закроются</li>
          <li>Данные и роли не удаляются</li>
        </ul>
      </Dialog>
    </>
  );
}

describe('Dialog (Дизайн-система.dc.html:383–393): фокус-ловушка, возврат фокуса, Esc', () => {
  it('закрытый диалог не рендерится', () => {
    render(<Dialog open={false} onClose={() => undefined} title="Отключить «Логистику»?" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('открытый: role="dialog" с именем из заголовка, aria-modal, фокус внутри, подвал с действиями', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Отключить модуль' }));
    const dialog = screen.getByRole('dialog', { name: 'Отключить «Логистику»?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Отключить' })).toBeInTheDocument();
    expect(screen.getByText('Данные и роли не удаляются')).toBeVisible();
  });

  it('Tab не выпускает фокус из диалога', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Отключить модуль' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('Esc закрывает и возвращает фокус на кнопку, которая открыла диалог', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Отключить модуль' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // FocusScope возвращает фокус в следующем кадре (requestAnimationFrame).
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('клик по подложке вызывает onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Назначить роль">
        Текст
      </Dialog>,
    );
    const scrim = screen.getByRole('dialog').parentElement?.parentElement as HTMLElement;
    await user.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  it('busy: aria-busy, Esc и подложка не закрывают', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Отключаем…" busy>
        Текст
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    await user.click(dialog.parentElement?.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('axe: открытый диалог без нарушений serious/critical', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Отключить модуль' }));
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});
