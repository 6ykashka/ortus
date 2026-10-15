// W0.09 · @ortus/api-client (бриф §4.2, тест T11). Сервер — настоящий node:http на случайном порту:
// прямой мок fetch запрещён (tdd-protocol §3), поэтому проверяется то, что уходит по сети.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import {
  createApiClient,
  CSRF_HEADER,
  devLogin,
  devLogout,
  ProblemError,
  readCookie,
  unwrap,
} from '../src/index.ts';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const seen: Seen[] = [];
let baseUrl = '';
const credentials: RequestCredentials[] = [];

const ME = {
  userId: '0281a55e-725e-53b1-920f-4189ab46e08a',
  displayName: 'Дарья Зимина',
  platformOperator: false,
  tenants: [],
  permissionVersion: '0',
};

function problem(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { 'Content-Type': 'application/problem+json' });
  res.end(
    JSON.stringify({
      type: `https://docs.ortus.example/errors/${code}`,
      title: code,
      status,
      code,
      requestId: 'rid-1',
    }) + '\n',
  );
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c: Buffer) => (body += c.toString('utf8')));
  req.on('end', () => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    if (req.url === '/api/v1/me/context' && req.headers.cookie?.includes('ortus_sid=ok')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ME));
    } else if (req.url === '/api/v1/me/context') {
      problem(res, 401, 'session_expired');
    } else if (req.url === '/api/v1/dev/login') {
      const { persona } = JSON.parse(body) as { persona: string };
      if (persona !== 'owner') return problem(res, 401, 'session_expired');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ userId: ME.userId, csrfToken: 'tok' }));
    } else if (req.url === '/api/v1/dev/logout') {
      res.writeHead(204).end();
    } else {
      problem(res, 404, 'not_found');
    }
  });
});

const recordingFetch: typeof fetch = (input, init) => {
  if (input instanceof Request) credentials.push(input.credentials);
  return fetch(input, init);
};

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe('createApiClient', () => {
  it('ходит на baseUrl с credentials: include (cookie сессии BFF)', async () => {
    const api = createApiClient({ baseUrl, fetch: recordingFetch });
    const me = await unwrap(
      await api.GET('/api/v1/me/context', { headers: { Cookie: 'ortus_sid=ok' } }),
    );
    assert.equal(me.displayName, 'Дарья Зимина');
    assert.equal(credentials.at(-1), 'include');
  });

  it('problem+json → ProblemError с кодом и статусом', async () => {
    const api = createApiClient({ baseUrl, fetch: recordingFetch });
    await assert.rejects(
      async () => unwrap(await api.GET('/api/v1/me/context')),
      (e: unknown) =>
        e instanceof ProblemError &&
        e.status === 401 &&
        e.code === 'session_expired' &&
        e.problem?.requestId === 'rid-1',
    );
  });

  it('X-CSRF-Token — только на изменяющих запросах (double-submit, cookie ortus_csrf)', async () => {
    const api = createApiClient({ baseUrl, fetch: recordingFetch, csrfToken: () => 'csrf-1' });
    await api.GET('/api/v1/me/context');
    assert.equal(seen.at(-1)?.headers[CSRF_HEADER.toLowerCase()], undefined);
    await api.POST('/api/v1/tenants/{tenantId}/invitations', {
      params: { path: { tenantId: ME.userId }, header: { 'Idempotency-Key': '0123456789abcdef' } },
      body: {} as never,
    });
    assert.equal(seen.at(-1)?.method, 'POST');
    assert.equal(seen.at(-1)?.headers[CSRF_HEADER.toLowerCase()], 'csrf-1');
  });
});

describe('dev-вход BFF (вне контракта, только local и e2e)', () => {
  it('devLogin отправляет персонажа и возвращает userId и csrfToken', async () => {
    const r = await devLogin('owner', { baseUrl, fetch: recordingFetch });
    assert.deepEqual(r, { userId: ME.userId, csrfToken: 'tok' });
    const req = seen.at(-1);
    assert.equal(req?.method, 'POST');
    assert.equal(req?.url, '/api/v1/dev/login');
    assert.deepEqual(JSON.parse(req?.body ?? ''), { persona: 'owner' });
    assert.equal(credentials.at(-1), 'include');
  });

  it('отказ dev-входа → ProblemError session_expired', async () => {
    await assert.rejects(
      () => devLogin('nobody', { baseUrl }),
      (e: unknown) => e instanceof ProblemError && e.code === 'session_expired',
    );
  });

  it('devLogout отправляет X-CSRF-Token', async () => {
    await devLogout({ baseUrl, csrfToken: 'tok' });
    assert.equal(seen.at(-1)?.url, '/api/v1/dev/logout');
    assert.equal(seen.at(-1)?.headers[CSRF_HEADER.toLowerCase()], 'tok');
  });
});

describe('readCookie', () => {
  it('читает значение по имени, без похожих имён', () => {
    assert.equal(readCookie('a=1; ortus_csrf=x%3Dy; b=2', 'ortus_csrf'), 'x=y');
    assert.equal(readCookie('my_ortus_csrf=1', 'ortus_csrf'), undefined);
    assert.equal(readCookie('', 'ortus_csrf'), undefined);
  });
});
