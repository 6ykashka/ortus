// Корень приложения: клиент API, TanStack Query и роутер.
import type { ApiClient } from '@ortus/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiProvider } from './api.tsx';
import type { DevLoginOutcome } from './dev-login.ts';
import { createAppRouter } from './router.tsx';
import { T } from './texts.ts';

export interface AppProps {
  api: ApiClient;
  /** Начальный адрес в памяти (тесты); без него — адресная строка браузера. */
  initialUrl?: string;
  /** Итог dev-входа ?persona= (только --mode e2e): ошибка показывается над приложением. */
  devLogin?: DevLoginOutcome;
}

function newQueryClient() {
  // 4xx не повторяются: 401 — это «нужен вход», а не сбой сети.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

export function App({ api, initialUrl, devLogin }: AppProps) {
  const [queryClient] = useState(newQueryClient);
  const [router] = useState(() => createAppRouter(initialUrl));
  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        {devLogin?.error ? (
          <p role="alert">{T.devLoginFailed(devLogin.persona ?? '', devLogin.error)}</p>
        ) : null}
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>
  );
}
