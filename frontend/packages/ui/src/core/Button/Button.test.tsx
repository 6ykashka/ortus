import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Button } from '../Button';

describe('Button (Дизайн-система.dc.html:164–210)', () => {
  it('кнопка с именем по глаголу-результату, type="button" по умолчанию', () => {
    render(<Button>Принять смену</Button>);
    const button = screen.getByRole('button', { name: 'Принять смену' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('нажатие мышью, Enter и пробелом вызывает onPress', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Принять смену</Button>);
    await user.click(screen.getByRole('button', { name: 'Принять смену' }));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it('иконка — лигатура Material Symbols, скрытая от вспомогательных технологий', () => {
    render(<Button icon="verified">Принять смену</Button>);
    const button = screen.getByRole('button', { name: 'Принять смену' });
    const icon = button.querySelector('.material-symbols-rounded');
    expect(icon).toHaveTextContent('verified');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('выполняется: aria-busy, подпись «Принимаем…», иконка progress_activity, нажатие не срабатывает', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <Button icon="verified" loading loadingLabel="Принимаем…" onPress={onPress}>
        Принять смену
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Принимаем…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.material-symbols-rounded')).toHaveTextContent(
      'progress_activity',
    );
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('недоступна с причиной: причина видна рядом и связана через aria-describedby', () => {
    render(
      <Button disabled disabledReason="Нет фото одометра">
        Принять смену
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Принять смену' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Нет фото одометра');
    expect(screen.getByText('Нет фото одометра')).toBeVisible();
  });

  it('вариант и размер отражены в data-атрибутах для стилей', () => {
    render(
      <Button variant="danger" size="compact">
        Отключить модуль
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Отключить модуль' });
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'compact');
  });

  it('axe: 0 нарушений serious/critical во всех вариантах и состояниях', async () => {
    const { container } = render(
      <div>
        <Button icon="verified">Принять смену</Button>
        <Button variant="secondary" icon="undo">
          Вернуть на доработку
        </Button>
        <Button variant="ghost">Обновить список</Button>
        <Button variant="danger" icon="extension_off">
          Отключить модуль
        </Button>
        <Button loading loadingLabel="Отправляем…">
          Отправить
        </Button>
        <Button disabled disabledReason="Нет фото одометра">
          Начать рейс
        </Button>
      </div>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
