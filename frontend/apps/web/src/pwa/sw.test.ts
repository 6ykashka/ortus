// @vitest-environment node
// W2.24 · Service worker приложения (`sw.js`, классический скрипт) в песочнице `vm`: установка кладёт предкэш
// сборки в кэш версии, активация удаляет кэши прошлых версий; навигация — «сеть, иначе оболочка из кэша»;
// файлы сборки — из кэша; `/api`, чужие хосты и не-GET — мимо service worker (ответов API в кэше нет).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://ortus.example';

type Listener = (e: unknown) => void;

/** Кэш в памяти по пути URL. */
class MemCache {
  readonly map = new Map<string, Response>();
  async addAll(urls: string[]) {
    for (const u of urls) {
      const r = await this.net({ url: new URL(u, ORIGIN).href });
      if (!r.ok) throw new TypeError(`addAll: ${u} ${String(r.status)}`);
      this.map.set(new URL(u, ORIGIN).pathname, r);
    }
  }
  async add(u: string) {
    await this.addAll([u]);
  }
  async put(req: { url: string } | string, res: Response) {
    this.map.set(new URL(typeof req === 'string' ? req : req.url, ORIGIN).pathname, res);
  }
  async match(req: { url: string } | string) {
    const key = new URL(typeof req === 'string' ? req : req.url, ORIGIN).pathname;
    return this.map.get(key)?.clone();
  }
  constructor(private readonly net: (r: { url: string }) => Promise<Response>) {}
}

function sandbox(o: {
  online: boolean;
  precache?: string[];
  lazy?: string[];
  version?: string;
  missing?: string[];
}) {
  const listeners = new Map<string, Listener>();
  const fetched: string[] = [];
  const net = async (r: { url: string }): Promise<Response> => {
    const path = new URL(r.url).pathname;
    fetched.push(path);
    if (!state.online) throw new TypeError('Failed to fetch');
    if (o.missing?.includes(path)) return new Response('nope', { status: 404 });
    return new Response(`net:${path}`, { status: 200 });
  };
  const state = { online: o.online };
  const caches = new Map<string, MemCache>();
  const cacheStorage = {
    open: async (name: string) => {
      let c = caches.get(name);
      if (!c) {
        c = new MemCache(net);
        caches.set(name, c);
      }
      return c;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async (req: { url: string } | string, opts?: { cacheName?: string }) => {
      const list = opts?.cacheName ? [caches.get(opts.cacheName)] : [...caches.values()];
      for (const c of list) {
        const hit = await c?.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  let claimed = false;
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    clients: { claim: async () => void (claimed = true) },
    __ORTUS_SW__: {
      version: o.version ?? 'v1',
      precache: o.precache ?? ['/index.html'],
      lazy: o.lazy ?? [],
    },
  };
  runInNewContext(SOURCE, {
    self,
    caches: cacheStorage,
    fetch: net,
    URL,
    Request,
    Response,
    Promise,
    console,
  });

  async function lifecycle(type: 'install' | 'activate'): Promise<void> {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  /** Ответ service worker на запрос или `null`, если он не перехватывает запрос. */
  async function request(path: string, init: { method?: string; navigate?: boolean } = {}) {
    // Запрос события — поля, которые читает service worker (Request с mode navigate в Node не создать).
    const req = {
      url: new URL(path, ORIGIN).href,
      method: init.method ?? 'GET',
      mode: init.navigate ? 'navigate' : 'cors',
    };
    let responded: Promise<Response> | null = null;
    listeners.get('fetch')?.({
      request: req,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    if (!responded) return null;
    try {
      const res: Response = await responded;
      return res.type === 'error' ? 'error' : await res.text();
    } catch {
      return 'error';
    }
  }

  return { lifecycle, request, caches, fetched, state, claimed: () => claimed };
}

describe('service worker', () => {
  it('установка: предкэш сборки в кэше версии', async () => {
    const sw = sandbox({ online: true, precache: ['/index.html', '/assets/a.js'] });
    await sw.lifecycle('install');
    expect([...sw.caches.keys()]).toEqual(['ortus-shell-v1']);
    expect([...(sw.caches.get('ortus-shell-v1')?.map.keys() ?? [])]).toEqual([
      '/index.html',
      '/assets/a.js',
    ]);
  });

  it('активация: кэши прошлых версий удалены, чужие кэши не тронуты, страницы под контролем', async () => {
    const sw = sandbox({ online: true, version: 'v2' });
    sw.caches.set('ortus-shell-v1', new MemCache(async () => new Response('')));
    sw.caches.set('other', new MemCache(async () => new Response('')));
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect([...sw.caches.keys()].sort()).toEqual(['ortus-shell-v2', 'other']);
    expect(sw.claimed()).toBe(true);
  });

  it('навигация: со связью — сеть, без связи — оболочка из кэша', async () => {
    const sw = sandbox({ online: true });
    await sw.lifecycle('install');
    expect(await sw.request('/t/abc/today', { navigate: true })).toBe('net:/t/abc/today');
    sw.state.online = false;
    expect(await sw.request('/t/abc/today', { navigate: true })).toBe('net:/index.html');
  });

  it('файлы предкэша — из кэша без сети; прочие — мимо service worker', async () => {
    const sw = sandbox({ online: true, precache: ['/index.html', '/assets/a.js'] });
    await sw.lifecycle('install');
    sw.state.online = false;
    sw.fetched.length = 0;
    expect(await sw.request('/assets/a.js')).toBe('net:/assets/a.js');
    expect(sw.fetched).toEqual([]);
    expect(await sw.request('/assets/other.js')).toBeNull();
  });

  // Возврат 1 (minor): крупные файлы (шрифт значков) не в установке — после активации догружаются по одному
  // (сбой одного не мешает), при запросе страницы — из кэша, иначе сеть с записью в кэш версии.
  it('отложенные файлы: не в установке; после активации — в кэше; сбой одного не мешает', async () => {
    const sw = sandbox({
      online: true,
      precache: ['/index.html'],
      lazy: ['/assets/icons.woff2', '/assets/gone.woff2'],
      missing: ['/assets/gone.woff2'],
    });
    await sw.lifecycle('install');
    expect([...(sw.caches.get('ortus-shell-v1')?.map.keys() ?? [])]).toEqual(['/index.html']);
    await sw.lifecycle('activate');
    await expect
      .poll(() => [...(sw.caches.get('ortus-shell-v1')?.map.keys() ?? [])].sort())
      .toEqual(['/assets/icons.woff2', '/index.html']);
  });

  it('отложенный файл по запросу: сеть с записью в кэш, без связи — из кэша', async () => {
    const sw = sandbox({ online: true, precache: ['/index.html'], lazy: ['/assets/icons.woff2'] });
    await sw.lifecycle('install');
    expect(await sw.request('/assets/icons.woff2')).toBe('net:/assets/icons.woff2');
    await expect
      .poll(() => sw.caches.get('ortus-shell-v1')?.map.has('/assets/icons.woff2'))
      .toBe(true);
    sw.state.online = false;
    sw.fetched.length = 0;
    expect(await sw.request('/assets/icons.woff2')).toBe('net:/assets/icons.woff2');
    expect(sw.fetched).toEqual([]);
  });

  it('/api, чужой хост и не-GET — мимо service worker', async () => {
    const sw = sandbox({ online: true });
    await sw.lifecycle('install');
    expect(await sw.request('/api/v1/me/context')).toBeNull();
    expect(await sw.request('https://storage.example.invalid/x')).toBeNull();
    expect(await sw.request('/index.html', { method: 'POST' })).toBeNull();
    expect(await sw.request('/mockServiceWorker.js')).toBeNull();
  });
});
