// Vite @ortus/web (W0.09): один origin, прокси /api → API агента или стенда (план v2 §3.6, ADR-0001).
// Порт dev-сервера задаёт запуск (`--port 5200+slot`, харнесс W0.05), адрес API — env (apiOrigin).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { apiOrigin } from './src/app/api-origin.ts';

export default defineConfig({
  plugins: [react()],
  server: {
    // Host и Origin браузера сохраняются: API сверяет Origin с ALLOWED_ORIGINS (CSRF).
    proxy: { '/api': { target: apiOrigin(process.env), changeOrigin: false } },
  },
});
