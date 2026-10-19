// W2.24 · Статус очереди отправки для оболочки (баннеры :3093–3095): «Нет связи.» — «(ожидают отправки: N)»,
// «Связь восстановлена.» — пока очередь отправляет. Пишет очередь водителя (routes/logistics/driver/outbox), читает
// Banners.tsx оболочки по организации маршрута (W1.20: «оболочка показывает число ожидающих, если страница его
// сообщит»). До экрана водителя (перезапуск на любой странице) число — из очереди на устройстве (возврат 1):
// оболочка читает ключ очереди своего пользователя; живая очередь сильнее записи устройства.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { deviceStore, outboxKey, scopeKey } from './store.ts';

export interface QueueStatus {
  /** Операции на устройстве, ещё не принятые сервером. */
  count: number;
  /** Очередь отправляет операции. */
  sending: boolean;
}

const EMPTY: QueueStatus = { count: 0, sending: false };
const byTenant = new Map<string, QueueStatus>();
/** Организации, чья очередь в памяти сообщает статус сама. */
const live = new Set<string>();
const listeners = new Set<() => void>();

function put(tenantId: string, status: QueueStatus): void {
  const prev = byTenant.get(tenantId) ?? EMPTY;
  if (prev.count === status.count && prev.sending === status.sending) return;
  byTenant.set(tenantId, { ...status });
  for (const l of listeners) l();
}

/** Статус живой очереди организации. */
export function setQueueStatus(tenantId: string, status: QueueStatus): void {
  live.add(tenantId);
  put(tenantId, status);
}

/** Очередь снята (выход из аккаунта): статуса нет. */
export function clearQueueStatus(tenantId: string): void {
  live.delete(tenantId);
  put(tenantId, EMPTY);
}

/** Число ожидающих из очереди на устройстве — пока живая очередь не сообщила своё. */
export function seedQueueStatus(tenantId: string, count: number): void {
  if (live.has(tenantId)) return;
  put(tenantId, { count, sending: false });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useQueueStatus(tenantId: string | null): QueueStatus {
  const get = useCallback(() => (tenantId ? (byTenant.get(tenantId) ?? EMPTY) : EMPTY), [tenantId]);
  return useSyncExternalStore(subscribe, get, () => EMPTY);
}

/**
 * Кадр загрузки без связи (перезапуск, /me/context не пришёл — пользователь неизвестен, возврат 2): число операций
 * в очередях организации маршрута на устройстве; без организации — во всех очередях устройства.
 */
export function useDeviceQueueCount(tenantId: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let on = true;
    const store = deviceStore();
    const prefix = tenantId ? `${outboxKey(tenantId)}:` : 'outbox:';
    void (async () => {
      let n = 0;
      for (const k of await store.keys(prefix)) {
        const list = await store.get<unknown>(k);
        if (Array.isArray(list)) n += list.length;
      }
      if (on) setCount(n);
    })().catch(() => undefined);
    return () => {
      on = false;
    };
  }, [tenantId]);
  return count;
}

/** Оболочка: число ожидающих операций пользователя из хранилища устройства (до экрана водителя). */
export function useStoredQueueStatus(tenantId: string | null, userId: string): void {
  useEffect(() => {
    if (!tenantId) return;
    let on = true;
    void deviceStore()
      .get<unknown>(outboxKey(scopeKey(tenantId, userId)))
      .then((list) => {
        if (on && Array.isArray(list)) seedQueueStatus(tenantId, list.length);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [tenantId, userId]);
}
