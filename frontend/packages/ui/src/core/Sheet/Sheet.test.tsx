import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Sheet } from '../Sheet';

function renderSheet(onClose = vi.fn()) {
  render(
    <Sheet open onClose={onClose} title="Все разделы">
      <button type="button" aria-current="page">
        Главная
      </button>
      <button type="button">Модули и место</button>
    </Sheet>,
  );
  return onClose;
}

describe('Sheet (Ортус CRM.dc.html:2274–2281): лист «Все разделы»', () => {
  it('диалог с заголовком h2 и кнопкой «Закрыть» 44×44', () => {
    renderSheet();
    const sheet = screen.getByRole('dialog', { name: 'Все разделы' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('data-variant', 'sheet');
    expect(within(sheet).getByRole('heading', { level: 2 })).toHaveTextContent('Все разделы');
    expect(within(sheet).getByRole('button', { name: 'Закрыть' })).toHaveAttribute(
      'data-size',
      '44',
    );
    expect(within(sheet).getByRole('button', { name: 'Главная' })).toBeVisible();
  });

  it('«Закрыть» и Esc вызывают onClose', async () => {
    const onClose = renderSheet();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('закрытый не рендерится', () => {
    render(
      <Sheet open={false} onClose={() => undefined} title="Все разделы">
        <p>Пункты</p>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('axe: открытый лист без нарушений serious/critical', async () => {
    renderSheet();
    expect(await seriousViolations(document.body)).toEqual([]);
  });
});
