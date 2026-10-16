// W1.20 · Помощник экранных тестов: приложение на MSW-сценарном сервере W0.13 (msw/node, сид W0.12) с
// cookie-сессией в памяти и dev-входом персонажа; роутер в памяти, QueryClient без повторов (tdd-protocol §3:
// прямой мок fetch запрещён — сеть отвечает сценарный сервер по контракту).
import { createApiClient, devLogin } from '@ortus/api-client';
import type { CookieJar, PresetName, ScenarioServer } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { render, type RenderResult } from '@testing-library/react';

import type { RealtimeConnect } from '../shell/realtime.ts';
import { App } from './App.tsx';
import { createAppRouter } from './router.tsx';

export const BASE_URL = 'http://ortus.test';

/** Cookie сессии в памяти теста: сервер пишет их ответом, клиент читает CSRF. */
function memoryJar(): { jar: CookieJar; get: (name: string) => string | undefined } {
  const store = new Map<string, string>();
  return {
    jar: {
      read: () => Object.fromEntries(store),
      write: (_headers, cookies) => {
        for (const c of cookies) {
          if (c.maxAge === 0) store.delete(c.name);
          else store.set(c.name, c.value);
        }
      },
    },
    get: (name) => store.get(name),
  };
}

/** Ответ сценарного сервера приложению (журнал экранного теста). */
export interface SeenResponse {
  method: string;
  path: string;
  status: number;
}

export interface MockApp extends RenderResult {
  router: ReturnType<typeof createAppRouter>;
  scenario: ScenarioServer;
  /** Текущий путь роутера. */
  path(): string;
  /** Ответы сервера с начала рендера, в порядке получения. */
  responses(): readonly SeenResponse[];
  close(): void;
}

export interface MockAppOptions {
  persona?: string;
  preset?: PresetName;
  /** Постоянный сценарий X-Test-Scenario (PD-31). */
  scenario?: string;
  /** Правка состояния сервера до первого запроса приложения. */
  setup?: (scenario: ScenarioServer) => void;
  /** Транспорт канала реального времени (без него, как в режиме mock, канала нет). */
  realtime?: RealtimeConnect;
}

/** Рендерит приложение на `url` после dev-входа персонажа (как `?persona=` e2e-сборки). */
export async function renderMockApp(url: string, o: MockAppOptions = {}): Promise<MockApp> {
  const { jar, get } = memoryJar();
  const { server, scenario } = createNodeServer({ cookies: jar });
  server.listen({ onUnhandledRequest: 'error' });
  if (o.preset) scenario.applyPreset(o.preset);
  if (o.persona) await devLogin(o.persona, { baseUrl: BASE_URL });
  o.setup?.(scenario);
  if (o.scenario) scenario.setScenario(o.scenario);
  const api = createApiClient({ baseUrl: BASE_URL, csrfToken: () => get('ortus_csrf') });
  const seen: SeenResponse[] = [];
  server.events.on('response:mocked', ({ request, response }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
    });
  });
  const router = createAppRouter(url);
  const view = render(<App api={api} router={router} realtime={o.realtime ?? null} />);
  return {
    ...view,
    router,
    scenario,
    path: () => router.state.location.pathname,
    responses: () => seen,
    close: () => {
      view.unmount();
      server.close();
    },
  };
}

/** Id организации сида по имени (UUID v5 сида, PD-30) — из состояния сценарного сервера. */
export function tenantIdOf(scenario: ScenarioServer, name: string): string {
  const t = scenario.state().tenants.find((x) => x.name === name);
  if (!t) throw new Error(`нет организации «${name}» в сиде`);
  return t.id;
}
