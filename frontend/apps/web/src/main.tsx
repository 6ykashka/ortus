// Точка входа SPA: в режиме mock (`VITE_ADAPTER=mock`) — сценарный сервер MSW W0.13 до первого запроса,
// затем dev-вход ?persona= (только --mode e2e) и рендер в #app. Неудачный вход не мешает рендеру:
// приложение показывает ошибку входа (devLoginFromLocation не отклоняется).
import { createApiClient } from '@ortus/api-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.tsx';
import { devLoginFromLocation } from './app/dev-login.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app не найден в index.html');

if (import.meta.env.VITE_ADAPTER === 'mock') {
  const { startMockWorker } = await import('@ortus/adapter/msw/browser');
  await startMockWorker();
}

const devLogin = await devLoginFromLocation(import.meta.env.MODE);

createRoot(root).render(
  <StrictMode>
    <App api={createApiClient()} devLogin={devLogin} />
  </StrictMode>,
);
