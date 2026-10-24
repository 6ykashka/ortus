// Vite @ortus/web (W0.09): один origin, прокси /api → API агента или стенда (план v2 §3.6, ADR-0001).
// Порт dev-сервера задаёт запуск (`--port 5200+slot`, харнесс W0.05), адрес API — env (apiOrigin).
// Режим mock (W0.13): /mockServiceWorker.js отдаёт плагин @ortus/adapter/vite, ответы /api — MSW в браузере.
// PWA (W2.24): манифест, иконки и /sw.js — плагин src/pwa/plugin.ts.
// W4.72 (Q-W4.60-1): /brand-assets/{sha}.{ext} — логотипы и знаки организаций, cmd/api отдаёт их вне /api/v1.
import { mswWorker } from '@ortus/adapter/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { apiOrigin } from './src/app/api-origin.ts';
import { pwa } from './src/pwa/plugin.ts';

const api = apiOrigin(process.env);

export default defineConfig({
  plugins: [react(), mswWorker(), pwa()],
  server: {
    // Host и Origin браузера сохраняются: API сверяет Origin с ALLOWED_ORIGINS (CSRF и апгрейд сокета).
    // ws: true — сокет канала реального времени /api/v1/realtime (W1.42, ADR-0015, Q-W1.49-4).
    proxy: {
      '/api': { target: api, changeOrigin: false, ws: true },
      '/brand-assets': { target: api, changeOrigin: false },
    },
  },
});
