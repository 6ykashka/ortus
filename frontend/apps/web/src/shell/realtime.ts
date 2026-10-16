// W1.49 · Канал реального времени (ADR-0015, PD-58; контракт createRealtimeTicket, протокол клиента — отчёт W1.07):
//   билет → WebSocket на `path` билета с подпротоколом `protocol` → первый кадр `auth` с билетом (не в адресе);
//   `ping` → `pong`; `context.changed` → перечитать /me/context; `notifications.changed` → входящие;
//   `session.ended` → перечитать /me/context (401 → «Нужен вход»), без переподключения;
//   разрыв `seq` → перечитать всё; 4401 → сразу новый билет; прочие закрытия, нет связи, 429, 5xx при выдаче
//   билета → повтор с паузой 1 → 2 → 4 … 30 с и полное перечитывание после переподключения.
//   501 и 404 билета (стенд до W1.42: операция не реализована, шлюз не смонтирован) — тишина: ни тоста, ни
//   повторов до перезагрузки вкладки (`RealtimeMemo`). 401 и 403 — тоже без повторов: сессию показывает оболочка.
// Данные по сокету не ходят: подсказка только инвалидирует ключи запросов, данные — обычными операциями.
import { type components, type MeContext, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useApi } from '../app/api.tsx';
import { ME_CONTEXT_KEY, NOTIFICATIONS_KEY } from './me.ts';

type Ticket = components['schemas']['RealtimeTicket'];

/** Подсказка канала: что перечитать (`all` — всё, подсказки могли потеряться). */
export type RealtimeHint = 'context' | 'notifications' | 'session' | 'all';

/** Транспорт: открыть сокет `url` с подпротоколом и обработчиками; в режиме mock транспорта нет. */
export type RealtimeConnect = (
  url: string,
  protocol: string,
  on: { open(): void; message(data: string): void; close(code: number): void },
) => { send(data: string): void; close(code?: number): void };

/** Общая память запусков одной вкладки: канал не поддержан сервером (501/404) — до перезагрузки. */
export interface RealtimeMemo {
  unsupported: boolean;
}

export interface RealtimeOptions {
  ticket: () => Promise<Ticket>;
  connect: RealtimeConnect;
  /** Origin приложения (`location.origin`): сокет — тот же хост, схема ws/wss. */
  origin: string;
  onHint: (hint: RealtimeHint) => void;
  memo: RealtimeMemo;
}

const MAX_DELAY_MS = 30_000;
const backoff = (attempt: number): number => Math.min(1_000 * 2 ** attempt, MAX_DELAY_MS);

/** Билет не поддержан (501/404) или не поможет повтор (401, 403). */
function ticketVerdict(e: unknown): 'unsupported' | 'stop' | 'retry' {
  if (!(e instanceof ProblemError)) return 'retry';
  if (e.status === 501 || e.status === 404) return 'unsupported';
  if (e.status === 401 || e.status === 403) return 'stop';
  return 'retry';
}

const SERVER_TYPES = new Set(['context.changed', 'notifications.changed', 'session.ended', 'ping']);

function parse(data: string): { type: string; seq: number } | null {
  try {
    const m = JSON.parse(data) as { type?: unknown; seq?: unknown };
    if (typeof m.type !== 'string' || !SERVER_TYPES.has(m.type)) return null;
    if (typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 1) return null;
    return { type: m.type, seq: m.seq };
  } catch {
    return null;
  }
}

/** Адрес сокета: путь билета на origin приложения, http → ws, https → wss. */
export function socketUrl(origin: string, path: string): string {
  const u = new URL(path, origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** Запускает канал; возвращает остановку (закрывает сокет кодом 1000, отменяет повтор). */
export function startRealtime(o: RealtimeOptions): () => void {
  let stopped = false;
  let ended = false;
  let attempt = 0;
  let connections = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: ReturnType<RealtimeConnect> | null = null;

  const later = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, ms);
  };
  const retry = () => {
    later(backoff(attempt));
    attempt += 1;
  };

  const open = (t: Ticket) => {
    connections += 1;
    const reconnected = connections > 1;
    let last = 0;
    socket = o.connect(socketUrl(o.origin, t.path), t.protocol, {
      open: () => {
        if (stopped) return;
        socket?.send(JSON.stringify({ type: 'auth', ticket: t.ticket }));
        if (reconnected) o.onHint('all');
      },
      message: (data) => {
        const m = parse(data);
        if (!m || stopped) return;
        attempt = 0;
        if (m.seq > last + 1) o.onHint('all');
        last = Math.max(last, m.seq);
        switch (m.type) {
          case 'ping':
            socket?.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'context.changed':
            o.onHint('context');
            break;
          case 'notifications.changed':
            o.onHint('notifications');
            break;
          case 'session.ended':
            ended = true;
            o.onHint('session');
            break;
        }
      },
      close: (code) => {
        socket = null;
        if (stopped || ended) return;
        if (code === 4401 && attempt === 0) {
          attempt = 1;
          later(0);
          return;
        }
        retry();
      },
    });
  };

  const connect = async () => {
    if (stopped || o.memo.unsupported) return;
    let t: Ticket;
    try {
      t = await o.ticket();
    } catch (e) {
      const verdict = ticketVerdict(e);
      if (verdict === 'unsupported') o.memo.unsupported = true;
      if (verdict === 'retry') retry();
      return;
    }
    if (!stopped) open(t);
  };

  void connect();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    socket?.close(1000);
    socket = null;
  };
}

/**
 * Вошедший пользователь — по кэшу запросов, без наблюдателя /me/context: подписка на QueryCache видит и
 * `qc.clear()` при выходе (событие `removed`), и новый /me/context после входа (`added`/`updated`). Наблюдатель
 * с `skipToken` (W1.49 до возврата 1) очистку не видел и подменял `queryFn` запроса для `invalidateQueries`.
 */
function useSignedInUser(qc: QueryClient): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => qc.getQueryCache().subscribe(onChange),
    [qc],
  );
  const read = () => qc.getQueryData<MeContext>(ME_CONTEXT_KEY)?.userId ?? null;
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Канал вкладки, пока известен вошедший пользователь (/me/context в кэше — его загружает оболочка; хук сам
 * /me/context не запрашивает, поэтому на /auth/login запросов нет). Выход очищает кэш — канал закрывается
 * кодом 1000; повторный вход без перезагрузки — новый билет и новый сокет.
 */
export function useRealtime(connect: RealtimeConnect | null): void {
  const api = useApi();
  const qc = useQueryClient();
  const [memo] = useState<RealtimeMemo>(() => ({ unsupported: false }));
  const userId = useSignedInUser(qc);
  useEffect(() => {
    if (!connect || !userId) return undefined;
    return startRealtime({
      ticket: async () => unwrap(await api.POST('/api/v1/auth/realtime-tickets')),
      connect,
      origin: window.location.origin,
      memo,
      onHint: (hint) => {
        if (hint === 'all') void qc.invalidateQueries();
        else if (hint === 'notifications')
          void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        else void qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY });
      },
    });
  }, [connect, userId, api, qc, memo]);
}

/** Транспорт браузера: WebSocket с подпротоколом. */
export const browserSocket: RealtimeConnect = (url, protocol, on) => {
  const ws = new WebSocket(url, protocol);
  ws.onopen = () => on.open();
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data === 'string') on.message(e.data);
  };
  ws.onclose = (e: CloseEvent) => on.close(e.code);
  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: (code) => ws.close(code),
  };
};
