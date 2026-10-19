// W2.24 · Возврат 2 · Черновик осмотра на устройстве (`useDeviceDraft`) и выход из аккаунта (major ревью, бриф §10
// п. 6, 15-quality-security «удаление локальных данных при logout»): правка, прогресс загрузки фото и фото слота во
// время выхода и после него на устройство не пишутся — ни паузой записи (300 мс), ни при размонтировании (переход на
// вход), ни после сжатия фото; запись, начатая до выхода, выходом дожидается. И восстановление (minor ревью): правка
// до восстановления черновика с устройства не выбрасывает его — правка ложится поверх восстановленного.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDeviceData,
  type DeviceStore,
  memoryStore,
  setDeviceStore,
} from '../../../../pwa/store.ts';
import { emptyDraft } from '../model.ts';
import { loadDraft, saveDraft } from './drafts.ts';
import { outboxFor, resetOutboxes, useDeviceDraft } from './hooks.ts';
import type { OutboxOps } from './queue.ts';

const SCOPE = 't1:u1';
const KEY = 'trip-1:ret:0';
/** Больше паузы записи черновика (SAVE_MS = 300). */
const AFTER_SAVE_MS = 450;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function mounted() {
  const h = renderHook(() => useDeviceDraft(SCOPE, KEY));
  await waitFor(() => expect(h.result.current.loaded).toBe(true));
  return h;
}

describe('выход из аккаунта: черновик осмотра больше не пишется на устройство', () => {
  it('правка → выход → размонтирование (переход на вход): ключей нет', async () => {
    const h = await mounted();
    act(() => h.result.current.update((d) => ({ ...d, odometer: '84560', comment: 'царапина' })));
    await clearDeviceData('u1');
    h.unmount();
    await sleep(20);
    expect(await store.keys('')).toEqual([]);
  });

  it('правка → выход → пауза записи: ключей нет', async () => {
    const h = await mounted();
    act(() => h.result.current.update((d) => ({ ...d, odometer: '84560' })));
    await clearDeviceData('u1');
    await sleep(AFTER_SAVE_MS);
    expect(await store.keys('')).toEqual([]);
    h.unmount();
    await sleep(20);
    expect(await store.keys('')).toEqual([]);
  });

  it('прогресс загрузки фото после выхода: правка не пишется ни паузой, ни размонтированием', async () => {
    const h = await mounted();
    await clearDeviceData('u1');
    act(() =>
      h.result.current.update((d) => ({
        ...d,
        photos: { ...d.photos, front: { state: 'uploading', progress: 40 } },
      })),
    );
    await sleep(AFTER_SAVE_MS);
    h.unmount();
    await sleep(20);
    expect(await store.keys('')).toEqual([]);
  });

  it('фото слота после выхода (сжатие закончилось позже): на устройство не пишется', async () => {
    const h = await mounted();
    await clearDeviceData('u1');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    expect(await h.result.current.savePhoto('front', blob)).toBe(false);
    h.unmount();
    await sleep(20);
    expect(await store.keys('')).toEqual([]);
  });

  it('фото слота до выхода — пишется; выход его удаляет', async () => {
    const h = await mounted();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    expect(await h.result.current.savePhoto('front', blob)).toBe(true);
    expect(await store.keys('blob:')).toEqual([`blob:${SCOPE}:draft:${KEY}:front`]);
    await clearDeviceData('u1');
    h.unmount();
    expect(await store.keys('')).toEqual([]);
  });

  it('запись черновика, начатая до выхода, — выход её дожидается', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started = false;
    const slow: DeviceStore = {
      ...store,
      set: async (key, value) => {
        if (key.startsWith('draft:')) {
          started = true;
          await gate;
        }
        await store.set(key, value);
      },
    };
    setDeviceStore(slow);
    const h = await mounted();
    act(() => h.result.current.update((d) => ({ ...d, odometer: '84560' })));
    await waitFor(() => expect(started).toBe(true), { timeout: 2000 });
    const clearing = clearDeviceData('u1');
    release();
    await clearing;
    h.unmount();
    await sleep(20);
    expect(await store.keys('')).toEqual([]);
  });

  // Минор ревью: выход в одной вкладке останавливает черновик и очередь в другой вкладке того же пользователя.
  it('выход в другой вкладке: черновик этой вкладки больше не пишется, очередь закрыта', async () => {
    const h = await mounted();
    const ops: OutboxOps = {
      upload: async () => 'file-1',
      createExpense: async () => undefined,
      submitInspection: async () => ({ id: 'insp-1' }),
      returnTrip: async () => undefined,
    };
    const box = outboxFor(SCOPE, 't1', ops);
    await box.hydrate();
    const other = new BroadcastChannel('ortus-device:clear');
    try {
      other.postMessage({ type: 'cleared', userId: 'u1' });
      await waitFor(() => expect(outboxFor(SCOPE, 't1', ops)).not.toBe(box));
    } finally {
      other.close();
    }
    act(() => h.result.current.update((d) => ({ ...d, odometer: '84560' })));
    await sleep(AFTER_SAVE_MS);
    h.unmount();
    await sleep(20);
    expect(await store.keys('draft:')).toEqual([]);
  });

  it('выход другого пользователя черновик этого не закрывает', async () => {
    const h = await mounted();
    await clearDeviceData('u2');
    act(() => h.result.current.update((d) => ({ ...d, odometer: '84560' })));
    await waitFor(
      async () => expect(await store.keys('draft:')).toEqual([`draft:${SCOPE}:${KEY}`]),
      {
        timeout: 2000,
      },
    );
    h.unmount();
  });
});

describe('восстановление черновика с устройства', () => {
  it('правка до восстановления ложится поверх черновика с устройства и пишется вместе с ним', async () => {
    await saveDraft(store, SCOPE, KEY, { ...emptyDraft(), odometer: '84560', comment: 'царапина' });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: DeviceStore = {
      ...store,
      get: async <T>(key: string) => {
        if (key.startsWith('draft:')) await gate;
        return store.get<T>(key);
      },
    };
    setDeviceStore(slow);
    const h = renderHook(() => useDeviceDraft(SCOPE, KEY));
    expect(h.result.current.loaded).toBe(false);
    act(() =>
      h.result.current.update((d) => ({
        ...d,
        photos: { ...d.photos, front: { state: 'uploading', progress: 10 } },
      })),
    );
    release();
    await waitFor(() => expect(h.result.current.loaded).toBe(true));
    expect(h.result.current.draft.odometer).toBe('84560');
    expect(h.result.current.draft.comment).toBe('царапина');
    expect(h.result.current.draft.photos.front.state).toBe('uploading');
    await sleep(AFTER_SAVE_MS);
    const saved = await loadDraft(store, SCOPE, KEY);
    expect(saved?.odometer).toBe('84560');
    expect(saved?.comment).toBe('царапина');
    h.unmount();
  });
});
