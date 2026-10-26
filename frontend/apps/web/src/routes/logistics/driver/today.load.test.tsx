// W2.87 · «Моя смена» под нагрузкой ПК (возврат 1): скелетон «Загрузка» не должен держать экран дольше, чем нужно.
// Причина (предпроверка 24.10, строка AC-06 `temporary-driver.spec.ts:787` [tablet-768]): экран ждал чтения очереди
// отправки с устройства (IndexedDB `ortus-device`, запасное хранилище в памяти — через 5 с, pwa/store.ts) наравне с
// ответами сервера. Под нагрузкой первое обращение к IndexedDB занимает секунды, а ответы сервера уже пришли (≤ 0,2 с):
// рейс есть, экран всё ещё «Загрузка», шаг e2e с ожиданием 5 с по умолчанию падает.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MockApp } from '../../../app/testing.tsx';
import { memoryStore, setDeviceStore } from '../../../pwa/store.ts';
import { closeApp, open, SLOW } from './outbox/fixtures.test-util.ts';
import { resetOutboxes } from './outbox/hooks.ts';

vi.setConfig({ testTimeout: 30_000 });

const TRIP = 'Р-208 · Северный маршрут';
let app: MockApp | undefined;
let release: (() => void) | undefined;

beforeEach(async () => {
  setDeviceStore(memoryStore());
  await resetOutboxes();
});
afterEach(async () => {
  release?.();
  release = undefined;
  closeApp(app);
  app = undefined;
  await resetOutboxes();
  setDeviceStore(null);
});

/** Хранилище устройства, где чтение очереди отправки не отвечает, пока не вызван `release` (IndexedDB под нагрузкой). */
function holdOutbox(): void {
  const mem = memoryStore();
  const gate = new Promise<void>((r) => {
    release = r;
  });
  setDeviceStore({
    ...mem,
    get: async <T,>(key: string) => {
      if (key.startsWith('outbox:')) await gate;
      return mem.get<T>(key);
    },
  });
}

describe('«Моя смена» под нагрузкой', () => {
  it('очередь с устройства не читается: рейс не ждёт её дольше полутора секунд', async () => {
    holdOutbox();
    app = await open();
    // Ответы сервера пришли, очередь на устройстве — нет: смена показана, а не «Загрузка».
    await screen.findByText(TRIP, undefined, { timeout: 4_000 });
    expect(within(screen.getByRole('main')).queryByRole('status', { name: 'Загрузка' })).toBeNull();
  });

  it('очередь прочитана позже: смена остаётся на экране, сданное с устройства не пропадает', async () => {
    holdOutbox();
    app = await open();
    await screen.findByText(TRIP, undefined, { timeout: 4_000 });
    release?.();
    await waitFor(() => expect(screen.getByText(TRIP)).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1, name: 'Моя смена' })).toBeTruthy();
  });

  it('ответ сервера медленный: «Загрузка» до ответа, затем рейс (скелетон не залипает)', async () => {
    app = await open({ scenario: 'listTripPlans=delay=1500' });
    expect(within(screen.getByRole('main')).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await screen.findByText(TRIP, undefined, SLOW);
    expect(within(screen.getByRole('main')).queryByRole('status', { name: 'Загрузка' })).toBeNull();
  });

  it('грант выдан при открытой странице: 403 до начала окна — не «Загрузка», «Повторить» перезапрашивает рейс', async () => {
    app = await open({ scenario: 'listTripPlans=forbidden_action' });
    const banner = await screen.findByText(/Не удалось загрузить смену/, undefined, SLOW);
    expect(banner.textContent).toContain('Нет права на это действие');
    expect(within(screen.getByRole('main')).queryByRole('status', { name: 'Загрузка' })).toBeNull();
    // Окно перевода началось: сервер выдал грант — тот же запрос отвечает рейсом.
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText(TRIP, undefined, SLOW);
    expect(screen.queryByText(/Не удалось загрузить смену/)).toBeNull();
  });
});
