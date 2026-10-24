// @vitest-environment node
// W4.72 · Прокси dev-сервера Vite (план v2 §3.6, Q-W4.60-1): cmd/api отдаёт не только /api, но и публичные файлы
// оформления /brand-assets/{sha}.{ext} (логотипы и знаки организаций, W4.60) — без пересылки в режиме stand они
// не грузятся. Оба пути — на один адрес API из env по слоту (apiOrigin).
import type { ProxyOptions } from 'vite';
import { describe, expect, it } from 'vitest';

import config from '../../vite.config.ts';
import { apiOrigin } from './api-origin.ts';

const proxy = (config.server?.proxy ?? {}) as Record<string, ProxyOptions>;

describe('прокси Vite: /api и /brand-assets → cmd/api (Q-W4.60-1)', () => {
  it('/api — адрес API из env, сокет реального времени, Origin браузера сохраняется', () => {
    expect(proxy['/api']).toEqual({
      target: apiOrigin(process.env),
      changeOrigin: false,
      ws: true,
    });
  });

  it('/brand-assets — на тот же адрес API, что и /api', () => {
    expect(proxy['/brand-assets']).toEqual({ target: apiOrigin(process.env), changeOrigin: false });
  });

  it('других путей прокси нет', () => {
    expect(Object.keys(proxy).sort()).toEqual(['/api', '/brand-assets']);
  });
});
