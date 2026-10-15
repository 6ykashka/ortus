import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { IconButton } from '../IconButton';

describe('IconButton (Дизайн-система.dc.html:207–208): 40×40, подпись обязательна, бейдж', () => {
  it('имя кнопки — из label, иконка скрыта от чтения с экрана', () => {
    render(<IconButton icon="close" label="Закрыть" />);
    const button = screen.getByRole('button', { name: 'Закрыть' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('.material-symbols-rounded')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('бейдж «3» виден и не дублирует имя кнопки', () => {
    render(<IconButton icon="notifications" label="Уведомления, 3 новых" badge={3} />);
    const button = screen.getByRole('button', { name: 'Уведомления, 3 новых' });
    const badge = screen.getByText('3');
    expect(button).toContainElement(badge);
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('бейдж 0 и пустая строка не рисуются', () => {
    const { rerender } = render(<IconButton icon="notifications" label="Уведомления" badge={0} />);
    expect(screen.queryByText('0')).toBeNull();
    rerender(<IconButton icon="notifications" label="Уведомления" badge="" />);
    expect(screen.getByRole('button').querySelector('[data-badge]')).toBeNull();
  });

  it('нажатие вызывает onPress; aria-expanded и aria-haspopup передаются', async () => {
    const onPress = vi.fn();
    render(
      <IconButton
        icon="notifications"
        label="Уведомления"
        onPress={onPress}
        aria-expanded={false}
        aria-haspopup="dialog"
      />,
    );
    const button = screen.getByRole('button', { name: 'Уведомления' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.setup().click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('размер 44 (кнопка «Закрыть» листа) отмечается data-size', () => {
    render(<IconButton icon="close" label="Закрыть" size={44} />);
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveAttribute('data-size', '44');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <>
        <IconButton icon="notifications" label="Уведомления, 3 новых" badge={3} />
        <IconButton icon="close" label="Закрыть" />
      </>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
