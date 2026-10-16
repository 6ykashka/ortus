// Корень приложения: клиент API, TanStack Query, тост и хук команд оболочки (W1.20), роутер.
// Стили: токены, локальные шрифты и глобальные правила эталона (@ortus/tokens), оболочка (shell.css).
import '@ortus/tokens/tokens.css';
import '@ortus/tokens/fonts.css';
import '@ortus/tokens/base.css';
import '../shell/shell.css';

import type { ApiClient } from '@ortus/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { type RealtimeConnect, useRealtime } from '../shell/realtime.ts';
import { RunProvider } from '../shell/run.tsx';
import { ToastProvider } from '../shell/toast.tsx';
import { ApiProvider } from './api.tsx';
import type { DevLoginOutcome } from './dev-login.ts';
import { type AppRouter, createAppRouter } from './router.tsx';
import { T } from './texts.ts';

export interface AppProps {
  api: ApiClient;
  /** Начальный адрес в памяти (тесты); без него — адресная строка браузера. */
  initialUrl?: string;
  /** Готовый роутер (экранные тесты читают его адрес). */
  router?: AppRouter;
  /** Итог dev-входа ?persona= (только --mode e2e): ошибка показывается над приложением. */
  devLogin?: DevLoginOutcome;
  /** Транспорт канала реального времени (W1.49); `null` — канала нет (режим mock, экранные тесты). */
  realtime?: RealtimeConnect | null;
}

function newQueryClient() {
  // 4xx не повторяются: 401 — это «нужен вход», а не сбой сети.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

/** Канал реального времени вкладки (W1.49, ADR-0015): подсказки перечитывают /me/context и входящие. */
function Realtime({ connect }: { connect: RealtimeConnect | null }): null {
  useRealtime(connect);
  return null;
}

export function App({ api, initialUrl, router: given, devLogin, realtime = null }: AppProps) {
  const [queryClient] = useState(newQueryClient);
  const [router] = useState(() => given ?? createAppRouter(initialUrl));
  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <Realtime connect={realtime} />
        <ToastProvider>
          <RunProvider>
            {devLogin?.error ? (
              <p role="alert">{T.devLoginFailed(devLogin.persona ?? '', devLogin.error)}</p>
            ) : null}
            <RouterProvider router={router} />
          </RunProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
