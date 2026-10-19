// W2.24 · Хранилище устройства (07-ux §6, 15-quality-security «удаление локальных данных при logout»): ключ — строка,
// значение — данные или Blob фото; выборка по префиксу (организация и пользователь); очистка при выходе. В jsdom нет
// IndexedDB — deviceStore() даёт хранилище в памяти (как в браузере без IndexedDB).
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearQueueStatus,
  setQueueStatus,
  useDeviceQueueCount,
  useQueueStatus,
  useStoredQueueStatus,
} from './status.ts';
import {
  clearDeviceData,
  type DeviceStore,
  deviceStore,
  memoryStore,
  onDeviceClear,
  outboxKey,
  resilientStore,
  scopeKey,
  setDeviceStore,
} from './store.ts';

afterEach(() => setDeviceStore(null));

describe('хранилище устройства', () => {
  it('get / set / delete и ключи по префиксу', async () => {
    const s = memoryStore();
    await s.set('outbox:t1:u1', [{ id: 'a' }]);
    await s.set('draft:t1:u1:k', { odometer: '1' });
    await s.set('draft:t2:u9:k', { odometer: '2' });
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' });
    await s.set('blob:t1:u1:k:front', blob);
    expect(await s.get('outbox:t1:u1')).toEqual([{ id: 'a' }]);
    expect(await s.get('blob:t1:u1:k:front')).toBe(blob);
    expect(await s.keys('draft:')).toEqual(['draft:t1:u1:k', 'draft:t2:u9:k']);
    await s.delete('draft:t1:u1:k');
    expect(await s.get('draft:t1:u1:k')).toBeUndefined();
  });

  it('значение — копия: правка после записи не меняет хранилище', async () => {
    const s = memoryStore();
    const v = { list: [1] };
    await s.set('k', v);
    v.list.push(2);
    expect(await s.get('k')).toEqual({ list: [1] });
  });

  it('область — организация и пользователь', () => {
    expect(scopeKey('t-1', 'u-1')).toBe('t-1:u-1');
  });

  it('без IndexedDB — хранилище в памяти, одно на приложение', async () => {
    const a = deviceStore();
    await a.set('x', 1);
    expect(await deviceStore().get('x')).toBe(1);
  });

  // Возврат 1 (minor): IndexedDB не ответила (open завис, onblocked) — экран не ждёт вечно, данные — в памяти.
  it('хранилище не отвечает — после таймаута запасное в памяти', async () => {
    const never = <T>() => new Promise<T>(() => undefined);
    const hung: DeviceStore = { get: never, set: never, delete: never, keys: never };
    const s = resilientStore(hung, { timeoutMs: 20 });
    expect(await s.get('outbox:t1:u1')).toBeUndefined();
    await s.set('outbox:t1:u1', [1]);
    expect(await s.get('outbox:t1:u1')).toEqual([1]);
    expect(await s.keys('outbox:')).toEqual(['outbox:t1:u1']);
  });

  it('хранилище отказало — запасное в памяти', async () => {
    const fail = () => Promise.reject(new Error('QuotaExceededError'));
    const s = resilientStore({ get: fail, set: fail, delete: fail, keys: fail });
    await s.set('k', 1);
    expect(await s.get('k')).toBe(1);
  });

  it('выход ждёт подписчиков очистки (запись очереди, начатая до выхода)', async () => {
    const s = memoryStore();
    setDeviceStore(s);
    const off = onDeviceClear(async () => {
      await new Promise((r) => setTimeout(r, 10));
      await s.set('outbox:t1:u1', [{ id: 'late' }]);
    });
    try {
      await clearDeviceData('u1');
      expect(await s.keys('')).toEqual([]);
    } finally {
      off();
    }
  });

  // Возврат 2 (minor): после перехода на запасное хранилище в памяти данные, записанные в IndexedDB раньше (очередь,
  // черновики, фото), выход тоже удаляет — из обоих хранилищ, IndexedDB — насколько она отвечает.
  it('выход после перехода на запасное хранилище: удалено и в памяти, и в IndexedDB', async () => {
    const idb = memoryStore();
    await idb.set('outbox:t1:u1', [{ id: 'a' }]);
    await idb.set('draft:t1:u1:k', {});
    await idb.set('blob:t1:u1:draft:k:front', new Blob([]));
    await idb.set('outbox:t1:u2', [{ id: 'b' }]);
    let broken = false;
    const flaky: DeviceStore = {
      get: (k) => (broken ? Promise.reject(new Error('IndexedDB')) : idb.get(k)),
      set: (k, v) => idb.set(k, v),
      delete: (k) => idb.delete(k),
      keys: (p) => idb.keys(p),
    };
    const s = resilientStore(flaky, { timeoutMs: 50 });
    setDeviceStore(s);
    broken = true;
    expect(await s.get('outbox:t1:u1')).toBeUndefined();
    await s.set('outbox:t1:u1', [{ id: 'mem' }]);
    await clearDeviceData('u1');
    expect(await s.keys('')).toEqual([]);
    expect(await idb.keys('')).toEqual(['outbox:t1:u2']);
  });

  it('выход после перехода на запасное хранилище: IndexedDB не отвечает — выход не висит', async () => {
    const never = <T>() => new Promise<T>(() => undefined);
    const s = resilientStore(
      { get: never, set: never, delete: never, keys: never },
      { timeoutMs: 20 },
    );
    setDeviceStore(s);
    await s.set('outbox:t1:u1', [1]);
    await clearDeviceData('u1');
    expect(await s.keys('')).toEqual([]);
  });

  // Возврат 2 (minor): выход в одной вкладке останавливает очередь и черновик в других вкладках того же
  // пользователя (BroadcastChannel `ortus-device:clear`).
  it('выход в другой вкладке: подписчики очистки этой вкладки вызваны для того же пользователя', async () => {
    const seen: string[] = [];
    const off = onDeviceClear((userId) => {
      seen.push(userId);
    });
    const other = new BroadcastChannel('ortus-device:clear');
    try {
      other.postMessage({ type: 'cleared', userId: 'u5' });
      await waitFor(() => expect(seen).toEqual(['u5']));
    } finally {
      other.close();
      off();
    }
  });

  it('выход сообщает другим вкладкам', async () => {
    setDeviceStore(memoryStore());
    const other = new BroadcastChannel('ortus-device:clear');
    const got: unknown[] = [];
    other.addEventListener('message', (e) => got.push(e.data));
    try {
      await clearDeviceData('u6');
      await waitFor(() => expect(got).toEqual([{ type: 'cleared', userId: 'u6' }]));
    } finally {
      other.close();
    }
  });

  it('выход из аккаунта: данные устройства пользователя удалены, чужие — нет', async () => {
    const s = memoryStore();
    setDeviceStore(s);
    await s.set('outbox:t1:u1', []);
    await s.set('draft:t1:u1:k', {});
    await s.set('blob:t1:u1:k:front', new Blob([]));
    await s.set('outbox:t1:u2', []);
    await clearDeviceData('u1');
    expect(await s.keys('')).toEqual(['outbox:t1:u2']);
  });
});

describe('статус очереди для оболочки', () => {
  it('число ожидающих и «идёт отправка» по организации', () => {
    const { result } = renderHook(() => useQueueStatus('t-9'));
    expect(result.current).toEqual({ count: 0, sending: false });
    act(() => setQueueStatus('t-9', { count: 2, sending: true }));
    expect(result.current).toEqual({ count: 2, sending: true });
    act(() => setQueueStatus('t-9', { count: 0, sending: false }));
    expect(result.current).toEqual({ count: 0, sending: false });
  });

  it('без организации — пусто', () => {
    const { result } = renderHook(() => useQueueStatus(null));
    expect(result.current).toEqual({ count: 0, sending: false });
  });

  // Возврат 1 (minor): после перезапуска на любой странице «(ожидают отправки: N)» — из очереди на устройстве, ещё до
  // экрана водителя; живая очередь сильнее записи устройства.
  it('оболочка: число ожидающих — из очереди на устройстве, пока живая очередь не сообщила своё', async () => {
    const s = memoryStore();
    setDeviceStore(s);
    await s.set(outboxKey(scopeKey('t-7', 'u-7')), [{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => {
      useStoredQueueStatus('t-7', 'u-7');
      return useQueueStatus('t-7');
    });
    await waitFor(() => expect(result.current).toEqual({ count: 2, sending: false }));
    act(() => setQueueStatus('t-7', { count: 1, sending: true }));
    expect(result.current).toEqual({ count: 1, sending: true });
    act(() => clearQueueStatus('t-7'));
    expect(result.current).toEqual({ count: 0, sending: false });
  });

  // Возврат 2: перезапуск без связи — /me/context не пришёл, пользователь неизвестен; «(ожидают отправки: N)» —
  // по очередям организации маршрута на устройстве (без организации — всех очередей устройства).
  it('до /me/context: число ожидающих — по очередям организации на устройстве', async () => {
    const s = memoryStore();
    setDeviceStore(s);
    await s.set(outboxKey(scopeKey('t-3', 'u-1')), [{ id: 'a' }, { id: 'b' }]);
    await s.set(outboxKey(scopeKey('t-3', 'u-2')), [{ id: 'c' }]);
    await s.set(outboxKey(scopeKey('t-4', 'u-1')), [{ id: 'd' }]);
    const one = renderHook(() => useDeviceQueueCount('t-3'));
    await waitFor(() => expect(one.result.current).toBe(3));
    const all = renderHook(() => useDeviceQueueCount(null));
    await waitFor(() => expect(all.result.current).toBe(4));
  });

  it('оболочка: живая очередь уже сообщила — запись устройства не перекрывает её', async () => {
    const s = memoryStore();
    setDeviceStore(s);
    await s.set(outboxKey(scopeKey('t-8', 'u-8')), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    act(() => setQueueStatus('t-8', { count: 0, sending: false }));
    const { result } = renderHook(() => {
      useStoredQueueStatus('t-8', 'u-8');
      return useQueueStatus('t-8');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual({ count: 0, sending: false });
  });
});
