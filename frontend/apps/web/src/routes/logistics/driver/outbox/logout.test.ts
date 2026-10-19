// W2.24 · Возврат 1 (major, 15-quality-security «удаление локальных данных при logout», бриф §10 п. 6): выход из
// аккаунта во время отправки очереди. Отправка, начатая до выхода, не возвращает данные пользователя на устройство
// (ключ `outbox:<организация>:<пользователь>` после очистки пуст и остаётся пустым) и не шлёт следующие элементы под
// чужой сессией; clearDeviceData ждёт записи очереди, начатой до выхода.
import { ProblemError } from '@ortus/api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDeviceData,
  type DeviceStore,
  memoryStore,
  setDeviceStore,
} from '../../../../pwa/store.ts';
import { outboxFor, resetOutboxes } from './hooks.ts';
import type { OutboxOps } from './queue.ts';

const EXPENSE = {
  kind: 'wash' as const,
  occurredAt: '2026-10-01T09:00:00Z',
  amount: { amountMinor: 40000, currency: 'RUB' },
  receiptFileIds: [],
};

const unauthorized = () =>
  new ProblemError(401, {
    type: 'about:blank',
    title: 'Unauthorized',
    status: 401,
    code: 'unauthenticated',
  } as never);

/** Запрос, который отвечает, когда тест скажет. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let store: DeviceStore;

beforeEach(async () => {
  store = memoryStore();
  setDeviceStore(store);
  await resetOutboxes();
});
afterEach(async () => {
  await resetOutboxes();
  setDeviceStore(null);
});

function ops(pending: ReturnType<typeof deferred>[]) {
  const sent: string[] = [];
  const o: OutboxOps = {
    upload: async () => 'file-1',
    createExpense: async (_trip, _body, key) => {
      sent.push(key);
      const d = pending.shift();
      if (d) await d.promise;
    },
    submitInspection: async () => ({ id: 'insp-1' }),
    returnTrip: async () => undefined,
  };
  return { o, sent };
}

describe('выход из аккаунта во время отправки очереди', () => {
  it('ответ после выхода (401): очередь не пишет на устройство и не шлёт следующий элемент', async () => {
    const first = deferred();
    const api = ops([first]);
    const box = outboxFor('t1:u1', 't1', api.o);
    await box.hydrate();
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 500 ₽', body: EXPENSE, receipt: null });
    const sending = box.flush();
    await expect.poll(() => api.sent.length).toBe(1);

    await clearDeviceData('u1');
    expect(await store.keys('')).toEqual([]);

    first.reject(unauthorized());
    await sending;
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.keys('')).toEqual([]);
    expect(api.sent).toHaveLength(1);
  });

  it('ответ после выхода (успех): элемент не снимается записью на устройство, тостов нет', async () => {
    const first = deferred();
    const api = ops([first]);
    const box = outboxFor('t1:u1', 't1', api.o);
    const events: string[] = [];
    box.onEvent((e) => events.push(e.type));
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    const sending = box.flush();
    await expect.poll(() => api.sent.length).toBe(1);
    await clearDeviceData('u1');
    first.resolve();
    await sending;
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.keys('')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('выход ждёт записи очереди, начатой до него', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: DeviceStore = {
      ...store,
      set: async (key, value) => {
        if (key.startsWith('outbox:')) await gate;
        await store.set(key, value);
      },
    };
    setDeviceStore(slow);
    const box = outboxFor('t1:u2', 't1', ops([]).o);
    await box.hydrate();
    const adding = box
      .addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    const clearing = clearDeviceData('u2');
    release();
    await clearing;
    await adding;
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.keys('outbox:')).toEqual([]);
  });
});
