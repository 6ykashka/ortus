// Сценарный сервер в браузере (W0.13): режим mock приложения (`VITE_ADAPTER=mock`). Service worker MSW отдаёт
// ответы /api/v1/*, состояние сервера живёт во вкладке (sessionStorage: новый контекст Playwright — свежий сид).
// Cookie сессии пишутся в document.cookie: ответ service worker не может поставить cookie, поэтому `ortus_sid`
// в режиме mock не HttpOnly (только e2e и локальная разработка; на стенде — cmd/api).
import { setupWorker } from 'msw/browser';

import { parseCookies, type SetCookie } from './core/session.ts';
import type { ScenarioState } from './core/state.ts';
import { type CookieJar, createScenarioServer, type ScenarioServer } from './server.ts';

const STORAGE_KEY = 'ortus:msw:state';

/** Cookie режима mock: чтение и запись через document.cookie. */
export const documentCookies: CookieJar = {
  read: (request) => ({
    ...parseCookies(request.headers.get('cookie')),
    ...parseCookies(document.cookie),
  }),
  write: (_headers, cookies: SetCookie[]) => {
    for (const c of cookies) {
      document.cookie = `${c.name}=${c.value}; Path=/; Max-Age=${c.maxAge}; SameSite=Lax`;
    }
  },
};

function load(): ScenarioState | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const s = raw ? (JSON.parse(raw) as ScenarioState) : undefined;
    return s?.v === 1 ? s : undefined;
  } catch {
    return undefined;
  }
}

function save(s: ScenarioState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Хранилище недоступно (приватный режим): состояние живёт до перезагрузки.
  }
}

export interface MockWorkerOptions {
  /** Хранить состояние во вкладке (по умолчанию — да). */
  persist?: boolean;
  /** Адрес service worker (по умолчанию — `/mockServiceWorker.js`, плагин `@ortus/adapter/vite`). */
  url?: string;
}

/** Запускает MSW в браузере до первого запроса приложения. */
export async function startMockWorker(o: MockWorkerOptions = {}): Promise<ScenarioServer> {
  const persist = o.persist !== false;
  const server = createScenarioServer({
    state: persist ? load() : undefined,
    cookies: documentCookies,
    onChange: persist ? save : undefined,
  });
  if (persist) save(server.state());
  const worker = setupWorker(...server.handlers);
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: o.url ?? '/mockServiceWorker.js' },
  });
  return server;
}
