import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Toast } from '../Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast (Ортус CRM.dc.html:2287–2291, toastVM :2885–2891; Дизайн-система.dc.html:406)', () => {
  it.each([
    ['ok', 'status', 'check_circle'],
    ['warn', 'status', 'cloud_off'],
    ['info', 'status', 'info'],
    ['error', 'alert', 'error'],
  ] as const)('тон %s → role="%s", иконка %s', (tone, role, icon) => {
    render(<Toast tone={tone} text="Модуль «Логистика» подключён" onDismiss={() => undefined} />);
    const toast = screen.getByRole(role);
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('data-tone', tone);
    expect(toast).toHaveTextContent('Модуль «Логистика» подключён');
    expect(toast.querySelector('.material-symbols-rounded')).toHaveTextContent(icon);
  });

  it('скрывается через 4200 мс', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast tone="ok" text="Список обновлён" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(4199));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('новый текст сбрасывает таймер (Ортус CRM.dc.html:2414)', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast tone="ok" text="Первый" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(2000));
    rerender(<Toast tone="warn" text="Второй" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(4199));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('durationMs переопределяет время показа', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast tone="info" text="Готово" durationMs={1000} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('действие «Открыть» внутри тоста', () => {
    const onPress = vi.fn();
    render(
      <Toast
        tone="ok"
        text="Смена принята. Машина свободна."
        action={{ label: 'Открыть', onPress }}
        onDismiss={() => undefined}
      />,
    );
    const toast = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(toast).toContainElement(screen.getByRole('button', { name: 'Открыть' }));
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <Toast
        tone="ok"
        text="Смена принята. Машина свободна."
        action={{ label: 'Открыть', onPress: () => undefined }}
        onDismiss={() => undefined}
      />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
