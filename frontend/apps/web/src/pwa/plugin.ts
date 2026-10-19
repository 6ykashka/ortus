// W2.24 · Плагин Vite `pwa()` (S2-15, ADR-0002): установка приложения без внешних зависимостей (Workbox не подключён,
// бриф §10 п. 1).
//   index.html     — <link rel="manifest">, theme-color, apple-touch-icon, значок вкладки;
//   dev-сервер     — маршруты /manifest.webmanifest, /pwa/*.png, /sw.js (dev — без предкэша; в dev и в режиме mock
//                    service worker не регистрируется: область `/` у MSW, register.ts);
//   сборка         — манифест и иконки в dist, затем dist/sw.js с планом предкэша по графу сборки: оболочка и
//                    маршруты водителя и входа; крупные файлы (шрифт значков) — отложенно; модули других ролей —
//                    нет (возврат 1; версия кэша — хэш списков и кода service worker).
// Подключается одной строкой в vite.config.ts (точка интегратора).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Connect, HtmlTagDescriptor, Plugin } from 'vite';

import { iconPng, ICONS } from './icons.ts';
import { MANIFEST, MANIFEST_PATH, SW_PATH, THEME_COLOR } from './manifest.ts';

const SW_CODE = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

export function headTags(): HtmlTagDescriptor[] {
  return [
    { tag: 'link', attrs: { rel: 'manifest', href: MANIFEST_PATH }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR }, injectTo: 'head' },
    {
      tag: 'link',
      attrs: { rel: 'apple-touch-icon', href: ICONS[0]?.path ?? '' },
      injectTo: 'head',
    },
    // Значок вкладки — та же иконка: без него браузер просит /favicon.ico (404 в консоли).
    {
      tag: 'link',
      attrs: { rel: 'icon', type: 'image/png', href: ICONS[0]?.path ?? '' },
      injectTo: 'head',
    },
  ];
}

const SKIP = new Set(['sw.js', 'mockServiceWorker.js']);

/** Маршруты, нужные без связи: экраны водителя (S2-15) и вход. Модули других ролей без связи не открываются. */
const OFFLINE_ROUTE = /[\\/]src[\\/]routes[\\/](?:logistics[\\/]driver|auth)[\\/]/;

/** Файл крупнее — не в установке (cache.addAll), а отложенно после активации и при первом запросе, байт. */
export const LARGE_BYTES = 512 * 1024;

/** Файл сборки (OutputBundle Rollup) — поля, которые нужны плану предкэша. */
export type BundleFile =
  | {
      type: 'chunk';
      isEntry: boolean;
      facadeModuleId: string | null;
      imports: readonly string[];
      dynamicImports: readonly string[];
      viteMetadata?: { importedCss: ReadonlySet<string> };
    }
  | { type: 'asset'; source?: string | Uint8Array };

export interface PrecachePlan {
  /** Установка: оболочка и маршруты без связи (cache.addAll — всё или ничего). */
  precache: string[];
  /** После активации по одному и при первом запросе (шрифт значков). */
  lazy: string[];
}

const sizeOf = (source: string | Uint8Array | undefined): number =>
  typeof source === 'string' ? Buffer.byteLength(source) : (source?.byteLength ?? 0);

/**
 * План предкэша по графу сборки (возврат 1: весь dist ~6,5 МБ в одной установке рвался на мобильной связи):
 *   чанки — вход и его статические импорты; маршруты без связи (OFFLINE_ROUTE) с их статическими и динамическими
 *   импортами; прочие чанки (модули других ролей, MSW) — нет;
 *   CSS — подключённые этими чанками и ничьи; CSS исключённых чанков — нет;
 *   прочие файлы (index.html, манифест, иконки, шрифты) — да, крупнее LARGE_BYTES — в `lazy`;
 *   карты исходников, sw.js и mockServiceWorker.js — нет.
 */
export function precachePlan(
  bundle: Readonly<Record<string, BundleFile>>,
  o: { offline?: RegExp; large?: number } = {},
): PrecachePlan {
  const offline = o.offline ?? OFFLINE_ROUTE;
  const large = o.large ?? LARGE_BYTES;
  const chunks = new Map<string, Extract<BundleFile, { type: 'chunk' }>>();
  for (const [name, f] of Object.entries(bundle)) if (f.type === 'chunk') chunks.set(name, f);
  const keep = new Set<string>();
  const visit = (name: string, dynamic: boolean) => {
    if (keep.has(name)) return;
    const c = chunks.get(name);
    if (!c) return;
    keep.add(name);
    for (const i of c.imports) visit(i, dynamic);
    if (dynamic) for (const i of c.dynamicImports) visit(i, true);
  };
  for (const [name, c] of chunks) if (c.isEntry) visit(name, false);
  for (const [name, c] of chunks) {
    if (c.facadeModuleId && offline.test(c.facadeModuleId)) visit(name, true);
  }
  const cssOf = (names: Iterable<string>) =>
    new Set([...names].flatMap((n) => [...(chunks.get(n)?.viteMetadata?.importedCss ?? [])]));
  const keptCss = cssOf(keep);
  const anyCss = cssOf(chunks.keys());
  const precache: string[] = [];
  const lazy: string[] = [];
  for (const [name, f] of Object.entries(bundle)) {
    const file = name.replaceAll('\\', '/');
    if (file.endsWith('.map') || SKIP.has(file)) continue;
    if (f.type === 'chunk') {
      if (keep.has(name)) precache.push(`/${file}`);
      continue;
    }
    if (file.endsWith('.css') && anyCss.has(name) && !keptCss.has(name)) continue;
    (sizeOf(f.source) > large ? lazy : precache).push(`/${file}`);
  }
  return { precache: precache.sort(), lazy: lazy.sort() };
}

/** Текст /sw.js: конфигурация (версия кэша, предкэш и отложенные файлы) и код service worker. */
export function swSource(plan: PrecachePlan): string {
  const { precache, lazy } = plan;
  const version = createHash('sha256')
    .update(JSON.stringify({ precache, lazy }))
    .update(SW_CODE)
    .digest('hex')
    .slice(0, 12);
  return `self.__ORTUS_SW__ = ${JSON.stringify({ version, precache, lazy })};\n${SW_CODE}`;
}

const manifestJson = (): string => JSON.stringify(MANIFEST, null, 2);

/** Маршруты dev-сервера: манифест, иконки и sw.js (без предкэша). */
function routes(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === MANIFEST_PATH) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.end(manifestJson());
      return;
    }
    if (path === SW_PATH) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(swSource({ precache: [], lazy: [] }));
      return;
    }
    const icon = ICONS.find((i) => i.path === path);
    if (icon) {
      res.setHeader('Content-Type', 'image/png');
      res.end(Buffer.from(iconPng(icon.size, icon.maskable)));
      return;
    }
    next();
  };
}

export function pwa(): Plugin {
  return {
    name: 'ortus:pwa',
    transformIndexHtml: () => headTags(),
    configureServer(server) {
      server.middlewares.use(routes());
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MANIFEST_PATH.slice(1), source: manifestJson() });
      for (const i of ICONS) {
        this.emitFile({
          type: 'asset',
          fileName: i.path.slice(1),
          source: iconPng(i.size, i.maskable),
        });
      }
    },
    writeBundle(options, bundle) {
      if (!options.dir) return;
      writeFileSync(
        join(options.dir, 'sw.js'),
        swSource(precachePlan(bundle as unknown as Record<string, BundleFile>)),
      );
    },
  };
}
