// W0.09 · ревью: неудачный dev-вход ?persona= в --mode e2e не оставляет пустой #app — приложение рендерится
// с сообщением об ошибке входа, а <html> получает data-e2e-login-error вместо data-e2e-persona.
// Сеть — настоящий node:http на случайном порту (tdd-protocol §3).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApiClient } from '@ortus/api-client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { App } from './App.tsx';
import { devLoginFromLocation } from './dev-login.ts';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/problem+json' }).end(
      JSON.stringify({
        type: 'https://docs.ortus.example/errors/session_expired',
        title: 'Нет или истекла сессия',
        status: 401,
        code: 'session_expired',
        requestId: 'r-login',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.e2ePersona;
  delete document.documentElement.dataset.e2eLoginError;
});

describe('неудачный dev-вход ?persona=', () => {
  it('401 BFF: промис не отклоняется, ошибка возвращается и отмечена на <html>', async () => {
    window.history.replaceState(null, '', '/?persona=nobody');
    const outcome = await devLoginFromLocation('e2e', { baseUrl });
    expect(outcome.persona).toBe('nobody');
    expect(outcome.error).toContain('session_expired');
    expect(document.documentElement.dataset.e2ePersona).toBeUndefined();
    expect(document.documentElement.dataset.e2eLoginError).toContain('session_expired');
  });

  it('нет API: ошибка сети тоже возвращается, а не бросается', async () => {
    window.history.replaceState(null, '', '/?persona=owner');
    const outcome = await devLoginFromLocation('e2e', { baseUrl: 'http://127.0.0.1:1' });
    expect(outcome.error).toBeTruthy();
  });

  it('без ?persona= вход не выполняется и ошибки нет', async () => {
    window.history.replaceState(null, '', '/');
    expect(await devLoginFromLocation('e2e', { baseUrl })).toEqual({});
  });

  it('приложение рендерится с сообщением об ошибке входа', async () => {
    render(
      <App
        api={createApiClient({ baseUrl })}
        initialUrl="/auth/login"
        devLogin={{ persona: 'nobody', error: 'session_expired' }}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('nobody');
    expect(alert.textContent).toContain('session_expired');
  });
});
