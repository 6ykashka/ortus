// W1.49 · Клиент канала реального времени (ADR-0015, PD-58; контракт createRealtimeTicket, протокол — отчёт W1.07):
// билет → сокет с подпротоколом → кадр auth; pong на ping; подсказки → перечитывание; разрыв seq, обрыв и 4401 —
// переподключение; 501/404 билета (стенд до W1.42) — тишина без повторов. Билет и сокет — поддельные зависимости.
import { ProblemError, type components } from '@ortus/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RealtimeConnect,
  type RealtimeHint,
  type RealtimeMemo,
  startRealtime,
} from './realtime.ts';

type Ticket = components['schemas']['RealtimeTicket'];
type Code = components['schemas']['Problem']['code'];

const TICKET: Ticket = {
  ticket: 'rt1.0123456789abcdef0123456789abcdef',
  path: '/api/v1/realtime',
  protocol: 'ortus.realtime.v1',
  expiresAt: '2026-10-15T10:01:00Z',
  heartbeatSeconds: 25,
};

const problem = (status: number, code: Code) =>
  new ProblemError(status, {
    type: `https://ortus.example/problems/${code}`,
    title: code,
    status,
    code,
    requestId: 'req-1',
  });

interface FakeSocket {
  url: string;
  protocol: string;
  sent: unknown[];
  closedWith: number | undefined;
  open(): void;
  push(msg: object): void;
  drop(code: number): void;
}

function harness(tickets: (() => Promise<Ticket>)[] = []) {
  const sockets: FakeSocket[] = [];
  const hints: RealtimeHint[] = [];
  const ticket = vi.fn(async () => {
    const next = tickets.shift();
    return next ? next() : TICKET;
  });
  const connect: RealtimeConnect = (url, protocol, on) => {
    const s: FakeSocket = {
      url,
      protocol,
      sent: [],
      closedWith: undefined,
      open: () => on.open(),
      push: (msg) => on.message(JSON.stringify(msg)),
      drop: (code) => on.close(code),
    };
    sockets.push(s);
    return {
      send: (data) => s.sent.push(JSON.parse(data) as unknown),
      close: (code) => {
        s.closedWith = code;
      },
    };
  };
  const memo: RealtimeMemo = { unsupported: false };
  const start = () =>
    startRealtime({
      ticket,
      connect,
      origin: 'http://127.0.0.1:5203',
      onHint: (h) => hints.push(h),
      memo,
    });
  return { sockets, hints, ticket, memo, start };
}

const at = (seq: number, type: string, extra: object = {}) => ({
  type,
  seq,
  at: '2026-10-15T10:00:00Z',
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('билет недоступен до W1.42 — тишина', () => {
  for (const [status, code] of [
    [501, 'not_implemented'],
    [404, 'not_found'],
  ] as const) {
    it(`${status} ${code}: сокета нет, повторов нет, следующий запуск билет не просит`, async () => {
      const h = harness([() => Promise.reject(problem(status, code))]);
      const stop = h.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(h.ticket).toHaveBeenCalledTimes(1);
      expect(h.sockets).toEqual([]);
      expect(h.hints).toEqual([]);
      expect(h.memo.unsupported).toBe(true);
      stop();
      const again = h.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.ticket).toHaveBeenCalledTimes(1);
      again();
    });
  }

  it('401 и 403 билета: сокета нет и повторов нет (сессию показывает оболочка)', async () => {
    for (const [status, code] of [
      [401, 'session_expired'],
      [403, 'csrf_failed'],
    ] as const) {
      const h = harness([() => Promise.reject(problem(status, code))]);
      const stop = h.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(h.ticket).toHaveBeenCalledTimes(1);
      expect(h.sockets).toEqual([]);
      stop();
    }
  });

  it('нет связи или 429 при выдаче билета — повтор с паузой', async () => {
    const h = harness([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(problem(429, 'rate_limited')),
    ]);
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ticket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.ticket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.ticket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.ticket).toHaveBeenCalledTimes(3);
    expect(h.sockets).toHaveLength(1);
    stop();
  });
});

describe('сокет и подсказки', () => {
  it('сокет на path билета с подпротоколом; первый кадр — auth с билетом, билета нет в адресе', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = h.sockets[0];
    expect(s?.url).toBe('ws://127.0.0.1:5203/api/v1/realtime');
    expect(s?.protocol).toBe('ortus.realtime.v1');
    expect(s?.sent).toEqual([]);
    s?.open();
    expect(s?.sent).toEqual([{ type: 'auth', ticket: TICKET.ticket }]);
    expect(s?.url).not.toContain(TICKET.ticket);
    stop();
  });

  it('https → wss', async () => {
    const h = harness();
    const stop = startRealtime({
      ticket: h.ticket,
      connect: (url, protocol, on) => {
        expect(url).toBe('wss://crm.example/api/v1/realtime');
        expect(protocol).toBe('ortus.realtime.v1');
        void on;
        return { send: () => undefined, close: () => undefined };
      },
      origin: 'https://crm.example',
      onHint: () => undefined,
      memo: h.memo,
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
  });

  it('ping → pong; context.changed, notifications.changed, session.ended — подсказки', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = h.sockets[0] as FakeSocket;
    s.open();
    s.push(at(1, 'ping'));
    expect(s.sent.at(-1)).toEqual({ type: 'pong' });
    s.push(at(2, 'context.changed', { tenantId: 'f04f636e-b66d-509e-ae10-9c27a18e3baa' }));
    s.push(at(3, 'notifications.changed'));
    expect(h.hints).toEqual(['context', 'notifications']);
    s.push(at(4, 'session.ended', { reason: 'logout' }));
    expect(h.hints.at(-1)).toBe('session');
    s.drop(1000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.ticket).toHaveBeenCalledTimes(1);
    expect(h.sockets).toHaveLength(1);
    stop();
  });

  it('разрыв seq — полное перечитывание, затем сама подсказка', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = h.sockets[0] as FakeSocket;
    s.open();
    s.push(at(1, 'ping'));
    s.push(at(3, 'notifications.changed'));
    expect(h.hints).toEqual(['all', 'notifications']);
    stop();
  });

  it('кадр не по протоколу игнорируется', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = h.sockets[0] as FakeSocket;
    s.open();
    expect(() => s.push({ nonsense: true })).not.toThrow();
    expect(h.hints).toEqual([]);
    stop();
  });
});

describe('переподключение', () => {
  it('4401 — сразу новый билет и новый сокет', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    h.sockets[0]?.open();
    h.sockets[0]?.drop(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ticket).toHaveBeenCalledTimes(2);
    expect(h.sockets).toHaveLength(2);
    stop();
  });

  for (const code of [1001, 1006, 1011, 1013]) {
    it(`закрытие ${code} — переподключение с паузой и полное перечитывание после открытия`, async () => {
      const h = harness();
      const stop = h.start();
      await vi.advanceTimersByTimeAsync(0);
      h.sockets[0]?.open();
      h.sockets[0]?.drop(code);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.sockets).toHaveLength(2);
      expect(h.hints).toEqual([]);
      h.sockets[1]?.open();
      expect(h.hints).toEqual(['all']);
      stop();
    });
  }

  it('stop — закрывает сокет кодом 1000 и больше не подключается', async () => {
    const h = harness();
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = h.sockets[0] as FakeSocket;
    s.open();
    stop();
    expect(s.closedWith).toBe(1000);
    s.drop(1000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.ticket).toHaveBeenCalledTimes(1);
  });

  it('stop до ответа билета — сокет не открывается', async () => {
    let release: (t: Ticket) => void = () => undefined;
    const h = harness([() => new Promise<Ticket>((r) => (release = r))]);
    const stop = h.start();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    release(TICKET);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sockets).toEqual([]);
  });
});
