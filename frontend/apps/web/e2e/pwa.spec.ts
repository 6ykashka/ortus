// W2.24 · e2e установки PWA (S2-15, ADR-0002): манифест, иконки, service worker. В режиме mock service worker
// приложения не регистрируется (область `/` занята MSW) — установка и работа без связи проверяются на
// production-сборке, которую spec собирает (`vite build`, адаптер http) и раздаёт своим статическим сервером на
// свободном порту (без API: /api отвечает 503). Экрана в эталоне нет (no-reference).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { openDriver } from './driver.helpers.ts';
import { expect, test } from './fixtures/index.ts';
import { noHorizontalScroll } from './modules.helpers.ts';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Размер PNG по заголовку IHDR. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

test.describe('PWA — манифест и service worker @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'dev-сервер режима mock');
  // Соседний воркер может собирать production-сборку (beforeAll ниже) — запас времени dev-серверу.
  test.describe.configure({ timeout: 90_000 });

  test('index.html: <link rel="manifest">, theme-color, apple-touch-icon', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1F6B52');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/pwa/icon-192.png',
    );
  });

  test('манифест: «Ортус CRM», standalone, start_url «/», иконки 192/512 и maskable — PNG нужного размера', async ({
    page,
    harness,
  }) => {
    const r = await page.request.get(`${harness.appURL}/manifest.webmanifest`);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('application/manifest+json');
    const m = (await r.json()) as Manifest;
    expect(m).toMatchObject({
      name: 'Ортус CRM',
      short_name: 'Ортус',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#1F6B52',
    });
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of m.icons) {
      const png = await page.request.get(`${harness.appURL}${icon.src}`);
      expect(png.status(), icon.src).toBe(200);
      expect(png.headers()['content-type']).toBe('image/png');
      const [w, h] = pngSize(await png.body());
      expect(`${String(w)}x${String(h)}`).toBe(icon.sizes);
    }
    const sw = await page.request.get(`${harness.appURL}/sw.js`);
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain("addEventListener('fetch'");
  });

  test('режим mock: service worker приложения не регистрируется, MSW работает', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await expect(page.getByRole('heading', { level: 1, name: 'Моя смена' })).toBeVisible();
    const scripts = await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map(
        (r) => new URL((r.active ?? r.waiting ?? r.installing)?.scriptURL ?? '').pathname,
      ),
    );
    expect(scripts).toEqual(['/mockServiceWorker.js']);
  });
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** Статический сервер сборки: файлы dist, иначе index.html (SPA); /api — 503 (API нет). */
function serve(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (path.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/problem+json' });
      res.end(JSON.stringify({ status: 503, code: 'dependency_unavailable', title: 'Нет API' }));
      return;
    }
    const file = normalize(join(dir, path));
    const hit = file.startsWith(dir) && existsSync(file) && statSync(file).isFile();
    const target = hit ? file : join(dir, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(readFileSync(target));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${String(port)}` });
    }),
  );
}

/** Production-сборка приложения в test-results (адаптер http, как образ ortus-web). */
function build(outDir: string): void {
  const vite = join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: APP_DIR,
    env: { ...process.env, VITE_ADAPTER: 'http' },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`vite build: ${r.stderr || r.stdout}`);
}

const DIST = join(APP_DIR, 'test-results', 'pwa-dist');
const LOCK = `${DIST}.lock`;
const DONE = join(DIST, '.built');
/** Прогон Playwright: у воркеров один родитель — раннер; сборка прошлого прогона не годится. */
const RUN = String(process.ppid);
const STALE_LOCK_MS = 5 * 60_000;

const built = (): boolean => existsSync(DONE) && readFileSync(DONE, 'utf8') === RUN;

/**
 * Одна сборка на прогон для всех проектов (возврат 1: две параллельные `vite build` в beforeAll под --workers=2
 * тормозили соседние тесты до таймаута). Первый воркер собирает под замком-каталогом, остальные ждут метки.
 */
async function buildOnce(): Promise<string> {
  for (;;) {
    if (built()) return DIST;
    try {
      mkdirSync(LOCK, { recursive: false });
    } catch {
      if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) {
        rmSync(LOCK, { recursive: true, force: true });
      }
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    try {
      if (!built()) {
        build(DIST);
        writeFileSync(DONE, RUN);
      }
    } finally {
      rmSync(LOCK, { recursive: true, force: true });
    }
    return DIST;
  }
}

test.describe('PWA — production-сборка', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  let site: { server: Server; base: string } | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let out: string | undefined;

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    testInfo.setTimeout(300_000);
    out = normalize(await buildOnce());
    site = await serve(out);
    // Свой контекст: сервер сборки — не хост харнесса (сеть фикстуры его бы заблокировала).
    context = await browser.newContext({ baseURL: site.base, serviceWorkers: 'allow' });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((r) => site?.server.close(r));
  });

  test('service worker активен, Chromium: ошибок установки нет', async () => {
    if (!page) throw new Error('нет страницы');
    await page.goto('/');
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, script: reg.active?.scriptURL ?? '' };
    });
    expect(new URL(scope.scope).pathname).toBe('/');
    expect(new URL(scope.script).pathname).toBe('/sw.js');
    await expect.poll(() => page?.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cdp = await context?.newCDPSession(page);
    const errors = (await cdp?.send('Page.getInstallabilityErrors')) as
      { installabilityErrors: { errorId: string }[] } | undefined;
    expect(errors?.installabilityErrors ?? null).toEqual([]);
  });

  // Возврат 1 (minor): установка на мобильной связи — предкэш только оболочки и маршрутов водителя и входа; шрифт
  // значков (5,4 МБ) — отложенно после установки; модули других ролей не кэшируются.
  test('предкэш сборки: оболочка и маршруты водителя ≤ 1,5 МБ, шрифт значков — отложенно', async () => {
    if (!page || !out) throw new Error('нет страницы');
    const source = await (await page.request.get('/sw.js')).text();
    const json = /self\.__ORTUS_SW__ = (\{.*?\});\n/.exec(source)?.[1] ?? '{}';
    const config = JSON.parse(json) as { precache: string[]; lazy: string[] };
    const dist = out;
    const size = (urls: string[]) =>
      urls.reduce((n, u) => n + statSync(join(dist, u.slice(1))).size, 0);
    expect(config.precache).toContain('/index.html');
    expect(config.precache.some((u) => /\/today\.page-[\w-]+\.js$/.test(u))).toBe(true);
    expect(config.precache.some((u) => /\/LoginPage-[\w-]+\.js$/.test(u))).toBe(true);
    expect(config.precache.some((u) => /\/users\.page-[\w-]+\.js$/.test(u))).toBe(false);
    expect(config.precache.some((u) => u.includes('material-symbols'))).toBe(false);
    expect(config.lazy.some((u) => u.includes('material-symbols'))).toBe(true);
    expect(size(config.precache)).toBeLessThan(1.5 * 1024 * 1024);
  });

  test('без связи: перезагрузка — оболочка из кэша, /api мимо кэша; «Нет связи.», axe, 390 и 1440', async ({
    axe,
  }) => {
    if (!page || !context) throw new Error('нет страницы');
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const n of names) {
        for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
      }
      return { names, urls };
    });
    expect(cached.names).toHaveLength(1);
    expect(cached.names[0]).toMatch(/^ortus-shell-[0-9a-f]{12}$/);
    expect(cached.urls).toContain('/index.html');
    expect(cached.urls).toContain('/manifest.webmanifest');
    expect(cached.urls.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
    expect(cached.urls.filter((u) => u.startsWith('/api/'))).toEqual([]);
    // Шрифт значков — отложенно после активации, к работе без связи он уже в кэше.
    await expect
      .poll(
        () =>
          page?.evaluate(async () => {
            const names = await caches.keys();
            const cache = await caches.open(names[0] ?? '');
            return (await cache.keys()).some((r) => r.url.includes('material-symbols'));
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveTitle('Ортус CRM');
    await expect(page.locator('#app')).not.toBeEmpty();
    await page.goto('/t/any/today');
    await expect(page.locator('#app')).not.toBeEmpty();

    // Возврат 2 (minor ревью и проверяющего pwa-install): запуск приложения без связи — /me/context не приходит,
    // кадр загрузки оболочки с баннером «Нет связи.» эталона и «Нет связи» в шапке (раньше — «Загрузка…» и ошибка
    // загрузки без баннера); axe без serious/critical и без прокрутки вбок на 390 и 1440. Запуск — новая страница:
    // у перезагруженной страницы Chromium под Playwright оставляет navigator.onLine = true при отключённой сети.
    const launch = await context.newPage();
    try {
      await launch.goto('/');
      expect(await launch.evaluate(() => navigator.onLine)).toBe(false);
      const offline = launch.locator('.ox-banner').filter({ hasText: 'Нет связи.' });
      await expect(offline.locator('.ox-banner-body')).toHaveText(
        'Нет связи. Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.',
      );
      await expect(launch.locator('.ox-offline-pill')).toBeVisible();
      await expect(launch.getByRole('alert')).toHaveCount(0);
      for (const width of [390, 1440]) {
        await launch.setViewportSize({ width, height: width < 640 ? 844 : 900 });
        const serious = (await axe(launch)).violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          serious.map((v) => v.id),
          `axe ${String(width)}`,
        ).toEqual([]);
        expect(await noHorizontalScroll(launch), `прокрутка вбок ${String(width)}`).toBe(true);
      }
      await launch.goto('/t/any/today');
      await expect(offline).toBeVisible();
    } finally {
      await launch.close();
    }
    await context.setOffline(false);
  });
});
