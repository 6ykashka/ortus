// W2.24 · Хуки очереди отправки и черновика на устройстве для экрана водителя. Очередь — одна на область устройства
// (`<организация>:<пользователь>`) и живёт дольше страницы: отправка, начатая на «Сегодня», продолжается на
// «Автомобилях»; появление связи (`online`) запускает отправку и без открытой страницы. Число ожидающих операций и
// «идёт отправка» уходят в баннеры оболочки (pwa/status.ts). Выход из аккаунта закрывает очередь и очищает
// устройство (pwa/store.ts). Вкладки одной области — Web Locks и BroadcastChannel (возврат 1, queue.ts).
import type { ApiClient } from '@ortus/api-client';
import { format, toast as toastText } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { clearQueueStatus, setQueueStatus } from '../../../../pwa/status.ts';
import { deviceStore, onDeviceClear, scopeKey } from '../../../../pwa/store.ts';
import { useShell } from '../../../../shell/context.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { afterChange, createExpense, returnTrip, submitInspection } from '../api.ts';
import { type Draft, emptyDraft, type SideKey } from '../model.ts';
import { uploadPhoto } from '../photos.ts';
import { loadDraft, pruneDrafts, putPhoto, saveDraft } from './drafts.ts';
import {
  Outbox,
  type OutboxChannel,
  type OutboxItem,
  type OutboxLock,
  type OutboxOps,
} from './queue.ts';

const TS = toastText.shell;

/** Blob фото с устройства как файл загрузки (имя — для initiateUpload). */
export const asFile = (blob: Blob, name = 'photo.jpg'): File =>
  blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/jpeg' });

/** Операции очереди: команды экрана водителя и загрузка уже сжатого фото. */
export function outboxOps(api: ApiClient, tenantId: string): OutboxOps {
  return {
    upload: (blob, purpose, tripId) =>
      uploadPhoto(api, tenantId, asFile(blob), { purpose, tripId, prepared: true }),
    createExpense: (tripId, body, key) => createExpense(api, tenantId, tripId, body, key),
    submitInspection: (body, key) => submitInspection(api, tenantId, body, key),
    returnTrip: (tripId, inspectionId, key) => returnTrip(api, tenantId, tripId, inspectionId, key),
  };
}

interface Entry {
  box: Outbox;
  off: () => Promise<void>;
}

const boxes = new Map<string, Entry>();

/** Замок между вкладками (Web Locks); без него — замок в памяти вкладки (queue.ts). */
function webLock(): OutboxLock | undefined {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return undefined;
  return <T>(name: string, fn: () => Promise<T>) => locks.request(name, fn) as Promise<T>;
}

/** Канал между вкладками области (BroadcastChannel); без него — вкладки не узнают о чужих изменениях. */
function tabChannel(scope: string): OutboxChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel(`ortus-outbox:${scope}`);
  // Node (тесты): канал не держит процесс; в браузере unref нет.
  (bc as BroadcastChannel & { unref?: () => void }).unref?.();
  return {
    post: () => bc.postMessage('changed'),
    listen: (fn) => {
      const h = () => fn();
      bc.addEventListener('message', h);
      return () => bc.removeEventListener('message', h);
    },
    close: () => bc.close(),
  };
}

/** Очередь области устройства (одна на приложение); операции API обновляются при новом клиенте. */
export function outboxFor(scope: string, tenantId: string, ops: OutboxOps): Outbox {
  const found = boxes.get(scope);
  if (found) {
    found.box.setOps(ops);
    return found.box;
  }
  const box = new Outbox({
    scope,
    store: deviceStore(),
    ops,
    lock: webLock(),
    channel: tabChannel(scope),
  });
  const sync = () => {
    const items = box.items();
    setQueueStatus(tenantId, {
      count: items.length,
      sending: items.some((i) => i.state === 'sending'),
    });
  };
  const unsubscribe = box.subscribe(sync);
  // Появилась связь — отправка и элементов с ошибкой сервера (обычный проход их не повторяет).
  const online = () => void box.flush({ errors: true });
  if (typeof window !== 'undefined') window.addEventListener('online', online);
  boxes.set(scope, {
    box,
    off: async () => {
      unsubscribe();
      if (typeof window !== 'undefined') window.removeEventListener('online', online);
      clearQueueStatus(tenantId);
      await box.close();
    },
  });
  return box;
}

/** Снять все очереди (выход из аккаунта, тесты) и дождаться их записей на устройство, начатых до этого. */
export async function resetOutboxes(): Promise<void> {
  const all = [...boxes.values()];
  boxes.clear();
  await Promise.all(all.map((e) => e.off()));
}

onDeviceClear(resetOutboxes);

export interface OutboxView {
  box: Outbox;
  scope: string;
  items: readonly OutboxItem[];
  ready: boolean;
}

/**
 * Очередь водителя на экране: восстановление с устройства, отправка со связью, тосты «{операция} — принято
 * сервером» / «{операция}: {сообщение}» (flush :2544–2549) и перечитывание смены после отправки.
 */
export function useOutbox(tenantId: string): OutboxView {
  const { me } = useShell();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const scope = scopeKey(tenantId, me.userId);
  const box = useMemo(
    () => outboxFor(scope, tenantId, outboxOps(api, tenantId)),
    [scope, tenantId, api],
  );
  const subscribe = useCallback((fn: () => void) => box.subscribe(fn), [box]);
  const items = useSyncExternalStore(subscribe, () => box.items());
  const ready = useSyncExternalStore(subscribe, () => box.ready());
  useEffect(
    () =>
      box.onEvent((e) => {
        if (e.type === 'sent') {
          toast(format(TS.flushOk, { label: e.item.label }), 'ok');
          void afterChange(qc, tenantId);
        } else toast(format(TS.flushFail, { label: e.item.label, message: e.message }), 'error');
      }),
    [box, toast, qc, tenantId],
  );
  useEffect(() => {
    void box.hydrate().then(() => box.flush());
  }, [box]);
  return { box, scope, items, ready };
}

/** Пауза записи черновика на устройство после правки, мс. */
const SAVE_MS = 300;

type Patch = (d: Draft) => Draft;

/** Пользователь области устройства `<организация>:<пользователь>`. */
const userOf = (scope: string): string => scope.slice(scope.indexOf(':') + 1);

export interface DeviceDraft {
  draft: Draft;
  update: (patch: Patch) => void;
  /** Черновик шага прочитан с устройства — до этого экран показывает скелетон (возврат 2). */
  loaded: boolean;
  /**
   * Фото слота на устройство (Blob уже сжатого JPEG). `false` — область закрыта выходом из аккаунта: фото не
   * записано, загружать его не нужно (возврат 2).
   */
  savePhoto: (side: SideKey, blob: Blob) => Promise<boolean>;
}

/**
 * Черновик осмотра шага смены на устройстве: восстанавливается при открытии (`loaded`), каждая правка пишется с
 * паузой; черновики других шагов удаляются. `draftKey = null` — шага осмотра нет (рейс, приёмка): черновиков нет.
 *
 * Возврат 2:
 * - правка до восстановления (прогресс загрузки, начатой раньше) не выбрасывает черновик с устройства — правки
 *   запоминаются и ложатся поверх восстановленного, запись — после восстановления;
 * - выход из аккаунта (`onDeviceClear`, и в другой вкладке) закрывает область: отложенная запись снимается, новые
 *   правки, размонтирование и фото слотов на устройство не пишутся; запись, начатая до выхода, выходом дожидается.
 */
export function useDeviceDraft(scope: string, draftKey: string | null): DeviceDraft {
  const [state, setState] = useState<{ key: string | null; draft: Draft; loaded: boolean }>(() => ({
    key: draftKey,
    draft: emptyDraft(),
    loaded: false,
  }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Правка, ещё не записанная на устройство. */
  const pending = useRef<{ key: string; draft: Draft } | null>(null);
  /** Шаг, чей черновик уже прочитан с устройства; правки других шагов ждут восстановления в `early`. */
  const loadedKey = useRef<string | null | undefined>(undefined);
  const early = useRef<{ key: string | null; patches: Patch[] }>({ key: draftKey, patches: [] });
  /** Область, закрытая выходом из аккаунта. */
  const closed = useRef<string | null>(null);
  /** Записи на устройство в работе (выход их дожидается). */
  const writes = useRef(new Set<Promise<unknown>>());

  const isClosed = useCallback(() => closed.current === scope, [scope]);

  const write = useCallback((fn: () => Promise<unknown>): Promise<unknown> => {
    const p = fn()
      .catch(() => undefined)
      .finally(() => writes.current.delete(p));
    writes.current.add(p);
    return p;
  }, []);

  const flushSave = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!p || isClosed()) return;
    void write(() => saveDraft(deviceStore(), scope, p.key, p.draft));
  }, [scope, isClosed, write]);

  const schedule = useCallback(
    (key: string, draft: Draft) => {
      if (isClosed()) return;
      pending.current = { key, draft };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flushSave, SAVE_MS);
    },
    [flushSave, isClosed],
  );

  // Выход из аккаунта (эта вкладка или другая): область закрыта, отложенная запись снята.
  useEffect(
    () =>
      onDeviceClear(async (userId) => {
        if (userOf(scope) !== userId) return;
        closed.current = scope;
        pending.current = null;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        await Promise.all([...writes.current]);
      }),
    [scope],
  );

  useEffect(() => {
    let live = true;
    const store = deviceStore();
    void (async () => {
      await pruneDrafts(store, scope, draftKey).catch(() => undefined);
      const saved = draftKey
        ? await loadDraft(store, scope, draftKey).catch(() => undefined)
        : undefined;
      if (!live) return;
      // Правки до восстановления — поверх черновика с устройства.
      const patches = early.current.key === draftKey ? early.current.patches : [];
      early.current = { key: draftKey, patches: [] };
      loadedKey.current = draftKey;
      const draft = patches.reduce((d, p) => p(d), saved ?? emptyDraft());
      setState({ key: draftKey, draft, loaded: true });
      if (draftKey && patches.length) schedule(draftKey, draft);
    })();
    return () => {
      live = false;
      flushSave();
    };
  }, [scope, draftKey, flushSave, schedule]);

  const update = useCallback(
    (patch: Patch) => {
      const restored = loadedKey.current === draftKey;
      if (!restored) {
        if (early.current.key !== draftKey) early.current = { key: draftKey, patches: [] };
        early.current.patches.push(patch);
      }
      setState((s) => {
        const same = s.key === draftKey;
        const draft = patch(same ? s.draft : emptyDraft());
        if (draftKey && restored) schedule(draftKey, draft);
        return { key: draftKey, draft, loaded: same ? s.loaded : false };
      });
    },
    [draftKey, schedule],
  );

  const savePhoto = useCallback(
    async (side: SideKey, blob: Blob): Promise<boolean> => {
      if (!draftKey || isClosed()) return false;
      await write(() => putPhoto(deviceStore(), scope, draftKey, side, blob));
      return !isClosed();
    },
    [scope, draftKey, isClosed, write],
  );

  const same = state.key === draftKey;
  return {
    draft: same ? state.draft : emptyDraft(),
    update,
    loaded: same && state.loaded,
    savePhoto,
  };
}
