// @vitest-environment node
// W2.24 · PWA (S2-15, ADR-0002): манифест, иконки PNG, плагин Vite (dev-маршруты, теги index.html, sw.js сборки со
// списком предкэша) и правило регистрации service worker (MSW режима mock занимает область `/`).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { iconPng, ICONS } from './icons.ts';
import { BACKGROUND_COLOR, MANIFEST, MANIFEST_PATH, THEME_COLOR } from './manifest.ts';
import { headTags, precachePlan, pwa, swSource } from './plugin.ts';
import { shouldRegister } from './register.ts';

/** Размер и пиксели PNG (RGBA 8 бит, фильтр 0) — только для проверки. */
function decode(png: Uint8Array): {
  width: number;
  height: number;
  px: (x: number, y: number) => number[];
} {
  const buf = Buffer.from(png);
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(buf.subarray(12, 16).toString('latin1')).toBe('IHDR');
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  return {
    width,
    height,
    px: (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)],
  };
}

const hex = (rgb: number[]) =>
  `#${rgb
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

describe('манифест PWA', () => {
  it('«Ортус CRM», standalone, start_url и scope «/», цвета оболочки', () => {
    expect(MANIFEST).toMatchObject({
      name: 'Ортус CRM',
      short_name: 'Ортус',
      lang: 'ru',
      start_url: '/',
      scope: '/',
      id: '/',
      display: 'standalone',
      theme_color: THEME_COLOR,
      background_color: BACKGROUND_COLOR,
    });
    expect(THEME_COLOR).toBe('#1F6B52');
  });

  it('иконки 192 и 512 (any) и 512 maskable — PNG', () => {
    expect(MANIFEST.icons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    expect(ICONS.map((i) => i.path)).toEqual(MANIFEST.icons.map((i) => i.src));
  });
});

describe('иконки', () => {
  it('PNG заданного размера: фон — акцент, в центре — белый знак «О»', () => {
    const png = decode(iconPng(192, false));
    expect([png.width, png.height]).toEqual([192, 192]);
    expect(hex(png.px(4, 96))).toBe(THEME_COLOR);
    expect(hex(png.px(96, 96))).toBe(THEME_COLOR);
    // Кольцо «О»: точка на окружности белая.
    expect(hex(png.px(96, 96 - Math.round(192 * 0.23)))).toBe('#FFFFFF');
    expect(png.px(96, 96)[3]).toBe(255);
  });

  it('maskable: знак в безопасной зоне (круг 80 %), край — фон без прозрачности', () => {
    const png = decode(iconPng(512, true));
    expect([png.width, png.height]).toEqual([512, 512]);
    expect(png.px(0, 0)).toEqual([0x1f, 0x6b, 0x52, 255]);
    for (let x = 0; x < 512; x += 8) {
      const r = Math.hypot(x - 256, 0 - 256);
      if (r > 0.4 * 512) expect(hex(png.px(x, 0))).toBe(THEME_COLOR);
    }
  });
});

describe('плагин Vite pwa()', () => {
  it('теги index.html: манифест, theme-color, apple-touch-icon, значок вкладки (без 404 /favicon.ico)', () => {
    expect(headTags()).toEqual([
      { tag: 'link', attrs: { rel: 'manifest', href: MANIFEST_PATH }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR }, injectTo: 'head' },
      {
        tag: 'link',
        attrs: { rel: 'apple-touch-icon', href: '/pwa/icon-192.png' },
        injectTo: 'head',
      },
      {
        tag: 'link',
        attrs: { rel: 'icon', type: 'image/png', href: '/pwa/icon-192.png' },
        injectTo: 'head',
      },
    ]);
    const p = pwa();
    expect(p.name).toBe('ortus:pwa');
  });

  // Возврат 1 (minor): весь dist (~6,5 МБ, из них 5,4 МБ шрифт значков) в cache.addAll — установка на мобильной
  // связи водителя медленная и рвётся целиком от одного сбоя. Предкэш — оболочка и маршруты, нужные без связи
  // (водитель, вход); крупные файлы (> 512 КБ) — догружаются после установки и кэшируются при первом запросе;
  // модули других ролей не кэшируются (без связи им нечего делать).
  it('предкэш: оболочка и маршруты водителя и входа; крупные файлы — отложенно; модули других ролей — нет', () => {
    const SRC = '/repo/frontend/apps/web/src';
    const chunk = (
      o: Partial<{
        isEntry: boolean;
        facadeModuleId: string;
        imports: string[];
        dynamicImports: string[];
        css: string[];
      }> = {},
    ) => ({
      type: 'chunk' as const,
      isEntry: o.isEntry ?? false,
      facadeModuleId: o.facadeModuleId ?? null,
      imports: o.imports ?? [],
      dynamicImports: o.dynamicImports ?? [],
      viteMetadata: { importedCss: new Set(o.css ?? []), importedAssets: new Set<string>() },
    });
    const asset = (bytes = 100) => ({ type: 'asset' as const, source: new Uint8Array(bytes) });
    const bundle = {
      'index.html': asset(),
      'assets/index-a.js': chunk({
        isEntry: true,
        imports: ['assets/vendor-b.js'],
        dynamicImports: [
          'assets/today.page-c.js',
          'assets/users.page-d.js',
          'assets/LoginPage-j.js',
          'assets/browser-k.js',
        ],
        css: ['assets/index-a.css'],
      }),
      'assets/index-a.js.map': asset(),
      'assets/vendor-b.js': chunk(),
      'assets/today.page-c.js': chunk({
        facadeModuleId: `${SRC}/routes/logistics/driver/today.page.tsx`,
        imports: ['assets/model-e.js', 'assets/vendor-b.js'],
        dynamicImports: ['assets/lazy-f.js'],
        css: ['assets/today.page-c.css'],
      }),
      'assets/model-e.js': chunk(),
      'assets/lazy-f.js': chunk(),
      'assets/users.page-d.js': chunk({
        facadeModuleId: `${SRC}/routes/people/users.page.tsx`,
        imports: ['assets/table-g.js'],
        css: ['assets/users.page-d.css'],
      }),
      'assets/table-g.js': chunk(),
      'assets/LoginPage-j.js': chunk({ facadeModuleId: `${SRC}/routes/auth/LoginPage.tsx` }),
      'assets/browser-k.js': chunk({
        facadeModuleId: '/repo/frontend/packages/adapter/src/msw/browser.ts',
      }),
      'assets/index-a.css': asset(),
      'assets/today.page-c.css': asset(),
      'assets/users.page-d.css': asset(),
      'assets/golos-h.woff2': asset(30_000),
      'assets/material-symbols-rounded-i.woff2': asset(2_000_000),
      'sw.js': asset(),
      'mockServiceWorker.js': asset(),
      'manifest.webmanifest': asset(),
      'pwa/icon-192.png': asset(),
    };
    expect(precachePlan(bundle)).toEqual({
      precache: [
        '/assets/LoginPage-j.js',
        '/assets/golos-h.woff2',
        '/assets/index-a.css',
        '/assets/index-a.js',
        '/assets/lazy-f.js',
        '/assets/model-e.js',
        '/assets/today.page-c.css',
        '/assets/today.page-c.js',
        '/assets/vendor-b.js',
        '/index.html',
        '/manifest.webmanifest',
        '/pwa/icon-192.png',
      ],
      lazy: ['/assets/material-symbols-rounded-i.woff2'],
    });
  });

  it('предкэш на Windows: пути модулей с обратной косой чертой', () => {
    const plan = precachePlan({
      'assets/index-a.js': {
        type: 'chunk',
        isEntry: true,
        facadeModuleId: null,
        imports: [],
        dynamicImports: ['assets/cars.page-b.js'],
      },
      'assets/cars.page-b.js': {
        type: 'chunk',
        isEntry: false,
        facadeModuleId:
          'D:\\repo\\frontend\\apps\\web\\src\\routes\\logistics\\driver\\cars.page.tsx',
        imports: [],
        dynamicImports: [],
      },
    });
    expect(plan.precache).toEqual(['/assets/cars.page-b.js', '/assets/index-a.js']);
  });

  it('sw.js сборки: версия по спискам файлов, предкэш и отложенные, код service worker', () => {
    const a = swSource({ precache: ['/index.html', '/assets/a.js'], lazy: ['/assets/big.woff2'] });
    const b = swSource({ precache: ['/index.html', '/assets/b.js'], lazy: ['/assets/big.woff2'] });
    expect(a).toContain('self.__ORTUS_SW__ = {"version":"');
    expect(a).toContain('"precache":["/index.html","/assets/a.js"]');
    expect(a).toContain('"lazy":["/assets/big.woff2"]');
    expect(a).toContain("addEventListener('fetch'");
    const version = (s: string) => /"version":"([0-9a-f]+)"/.exec(s)?.[1];
    expect(version(a)).toMatch(/^[0-9a-f]{12}$/);
    expect(version(a)).not.toBe(version(b));
    expect(() => new Function(a)).not.toThrow();
  });
});

describe('регистрация service worker', () => {
  it('только production-сборка без MSW', () => {
    expect(shouldRegister({ PROD: true, VITE_ADAPTER: 'http' })).toBe(true);
    expect(shouldRegister({ PROD: true })).toBe(true);
    expect(shouldRegister({ PROD: true, VITE_ADAPTER: 'mock' })).toBe(false);
    expect(shouldRegister({ PROD: false, VITE_ADAPTER: 'http' })).toBe(false);
  });
});

// Возврат интегратора 1 (Q-W2.24-23): в mime.types nginx образа нет webmanifest — без своего location манифест
// уходит как application/octet-stream с nosniff, и браузер не ставит приложение.
describe('nginx образа web (web.Dockerfile)', () => {
  const conf = readFileSync(new URL('../../web.Dockerfile', import.meta.url), 'utf8');
  const block = (path: string): string =>
    new RegExp(`location = ${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\{([^}]*)\\}`).exec(
      conf,
    )?.[1] ?? '';

  it(`${MANIFEST_PATH}: application/manifest+json, no-cache, nosniff; карта типов server не заменяется`, () => {
    const b = block(MANIFEST_PATH);
    expect(b).toMatch(/default_type application\/manifest\+json;/);
    expect(b).toMatch(/add_header Cache-Control "no-cache" always;/);
    expect(b).toMatch(/add_header X-Content-Type-Options nosniff always;/);
    expect(b).toMatch(/try_files \$uri =404;/);
    expect(conf).not.toMatch(/^\s*types\s*\{/m);
  });
});
