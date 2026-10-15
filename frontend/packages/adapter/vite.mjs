// Плагин Vite для режима mock (W0.13): отдаёт service worker MSW (`/mockServiceWorker.js`) из пакета msw
// адаптера — без копии файла в public/ приложения. В сборке с VITE_ADAPTER=mock файл кладётся в бандл.
//   frontend/apps/web/vite.config.ts: plugins: [react(), mswWorker()]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const WORKER_PATH = '/mockServiceWorker.js';

/** @returns {import('vite').Plugin} */
export function mswWorker() {
  const file = require.resolve('msw/mockServiceWorker.js');
  return {
    name: 'ortus-msw-worker',
    configureServer(server) {
      server.middlewares.use(WORKER_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (process.env.VITE_ADAPTER !== 'mock') return;
      this.emitFile({
        type: 'asset',
        fileName: WORKER_PATH.slice(1),
        source: readFileSync(file),
      });
    },
  };
}
