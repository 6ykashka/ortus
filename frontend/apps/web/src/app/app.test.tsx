// W0.09 · каркас @ortus/web (бриф §5, тест T12). Сеть — настоящий node:http на случайном порту
// (прямой мок fetch запрещён, tdd-protocol §3); роутер — в памяти, QueryClient без повторов.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApiClient } from '@ortus/api-client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { App } from './App.tsx';
import { apiOrigin } from './api-origin.ts';
import { personaFromUrl } from './dev-login.ts';

const ME = {
  userId: '0281a55e-725e-53b1-920f-4189ab46e08a',
  displayName: 'Дарья Зимина',
  platformOperator: false,
  permissionVersion: '1',
  tenants: [
    {
      tenantId: 'f04f636e-b66d-509e-ae10-9c27a18e3baa',
      name: 'Альта Групп',
      membershipId: 'b8df06ec-317e-5f46-b54c-e76603e41b5b',
      membershipStatus: 'active',
      orgUnitIds: [],
      modules: [],
      capabilities: [],
    },
  ],
};

let reply: 'ok' | '401' = 'ok';
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== '/api/v1/me/context') {
      res.writeHead(404).end();
    } else if (reply === 'ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ME));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/problem+json' }).end(
        JSON.stringify({
          type: 'https://docs.ortus.example/errors/session_expired',
          title: 'Нет или истекла сессия',
          status: 401,
          code: 'session_expired',
          requestId: 'r',
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
afterEach(() => cleanup());

const show = (url: string, api = createApiClient({ baseUrl })) =>
  render(<App api={api} initialUrl={url} />);

describe('экран контекста /', () => {
  it('показывает пользователя и его организации из GET /me/context', async () => {
    reply = 'ok';
    show('/');
    expect(await screen.findByRole('heading', { name: 'Дарья Зимина' })).toBeTruthy();
    expect(screen.getByText('Альта Групп')).toBeTruthy();
  });

  it('401 session_expired → «Нужен вход» со ссылкой на /auth/login', async () => {
    reply = '401';
    show('/');
    const link = await screen.findByRole('link', { name: 'Войти' });
    expect(link.getAttribute('href')).toBe('/auth/login');
    expect(screen.getByText('Нужен вход')).toBeTruthy();
  });

  it('сервер недоступен → «Нет связи с сервером»', async () => {
    show('/', createApiClient({ baseUrl: 'http://127.0.0.1:1' }));
    expect(await screen.findByText('Нет связи с сервером')).toBeTruthy();
  });
});

describe('маршрут /auth/login', () => {
  it('заглушка входа до W1.22', async () => {
    show('/auth/login');
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeTruthy();
  });
});

describe('dev-вход ?persona= (PD-54, бриф W0.05 §4.4)', () => {
  it('в сборке --mode e2e читает персонажа из любого маршрута', () => {
    expect(personaFromUrl('http://x/t/t-alta/home?persona=owner', 'e2e')).toBe('owner');
    expect(personaFromUrl('http://x/?persona=owner%40t-lotos', 'e2e')).toBe('owner@t-lotos');
  });

  it('в обычной сборке параметр игнорируется', () => {
    expect(personaFromUrl('http://x/?persona=owner', 'development')).toBeUndefined();
    expect(personaFromUrl('http://x/?persona=owner', 'production')).toBeUndefined();
  });

  it('пустой и недопустимый персонаж игнорируются', () => {
    expect(personaFromUrl('http://x/?persona=', 'e2e')).toBeUndefined();
    expect(personaFromUrl('http://x/?persona=<script>', 'e2e')).toBeUndefined();
  });
});

describe('прокси Vite /api (план v2 §3.6: адрес API из env по слоту)', () => {
  it('ORTUS_API_ORIGIN (харнесс W0.05) важнее HTTP_ADDR', () => {
    expect(apiOrigin({ ORTUS_API_ORIGIN: 'http://127.0.0.1:8113', HTTP_ADDR: '127.0.0.1:9' })).toBe(
      'http://127.0.0.1:8113',
    );
  });

  it('иначе http://HTTP_ADDR, иначе 127.0.0.1:8080', () => {
    expect(apiOrigin({ HTTP_ADDR: '127.0.0.1:8113' })).toBe('http://127.0.0.1:8113');
    expect(apiOrigin({})).toBe('http://127.0.0.1:8080');
  });
});
