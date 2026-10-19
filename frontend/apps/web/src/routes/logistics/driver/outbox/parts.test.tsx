// W2.24 · Карточка «Сдача сохранена на устройстве» (dr.sQueued :822–829). Возврат 1 (major, axe
// scrollable-region-focusable на #ox-main при 390): в состояниях без «Повторить» в прокручиваемой основной области
// нет ни одной цели Tab — карточка сама цель фокуса (как дерево «Структуры», W1.54); с «Повторить» — лишней цели нет.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QueuedReturn } from './parts.tsx';
import type { ReturnItem } from './queue.ts';

afterEach(cleanup);

const item = (state: ReturnItem['state'], error?: string): ReturnItem => ({
  kind: 'return',
  id: 'r-1',
  tripId: 'trip-1',
  label: 'Сдача машины',
  createdAt: '2026-10-01T12:00:00Z',
  state,
  error,
  keys: { inspection: 'k-i', trip: 'k-t' },
  inspection: {
    checklistVersionId: 'cl-1',
    vehicleId: 'v-1',
    kind: 'return',
    tripId: 'trip-1',
    odometerKm: '84560',
    fuelPercent: 50,
    checks: [],
    photos: [],
    capturedAt: '2026-10-01T12:00:00Z',
  },
  photos: [],
});

const card = () =>
  screen
    .getByRole('heading', { level: 2, name: 'Сдача сохранена на устройстве' })
    .closest('[role="status"]') as HTMLElement;

describe('карточка «Сдача сохранена на устройстве»', () => {
  it.each(['local', 'sending'] as const)(
    '%s: команд нет — карточка цель Tab с именем по заголовку',
    (state) => {
      render(<QueuedReturn item={item(state)} onRetry={() => undefined} />);
      expect(card().getAttribute('tabindex')).toBe('0');
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByRole('status', { name: 'Сдача сохранена на устройстве' })).toBe(card());
    },
  );

  it('ошибка: «Повторить» — цель Tab, карточка не лишняя цель', () => {
    render(<QueuedReturn item={item('error', 'Нет места')} onRetry={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(card().hasAttribute('tabindex')).toBe(false);
  });
});
