/* global self, caches */
// W2.24 · Service worker приложения Ортус (S2-15, ADR-0002; 07-ux §6: «service worker может останавливаться,
// длительная передача не гарантирована»). Классический скрипт без зависимостей (Workbox не подключён — бриф §10 п. 1):
// плагин pwa() собирает `/sw.js` = `self.__ORTUS_SW__ = {version, precache, lazy}` + этот файл.
//   install  — предкэш оболочки и маршрутов водителя и входа (index.html, JS, CSS, шрифты текста, манифест, иконки)
//              в кэш версии; модулей других ролей в нём нет (возврат 1: установка на мобильной связи);
//   activate — кэши прошлых версий удаляются, открытые страницы переходят под контроль; затем отложенные крупные
//              файлы (шрифт значков) догружаются по одному — сбой одного не мешает ни установке, ни остальным;
//   fetch    — навигация: сеть, без связи — index.html из кэша (оболочка SPA); файлы предкэша — из кэша; отложенные —
//              из кэша, иначе сеть с записью в кэш версии; остальное (`/api`, хранилище файлов, чужие хосты, не-GET,
//              модули других ролей) — мимо: ответы API и данные не кэшируются.
// Новая версия ждёт закрытия всех вкладок (skipWaiting нет: старая вкладка не потеряет свои чанки).
const CONFIG = self.__ORTUS_SW__ || { version: 'dev', precache: [], lazy: [] };
const PREFIX = 'ortus-shell-';
const CACHE = PREFIX + CONFIG.version;
const SHELL = '/index.html';
const PRECACHE = new Set(CONFIG.precache);
const LAZY = new Set(CONFIG.lazy || []);

/** Отложенный файл: из кэша версии, иначе сеть; удачный ответ — в кэш. */
function lazyFetch(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            cache.put(req, copy).catch(() => undefined);
          }
          return res;
        }),
    ),
  );
}

/** Догрузить отложенные файлы по одному (уже в кэше — пропуск, сбой — пропуск). */
function fillLazy() {
  return caches.open(CACHE).then((cache) =>
    Promise.all(
      [...LAZY].map((u) =>
        cache
          .match(u)
          .then((hit) => hit || cache.add(u))
          .catch(() => undefined),
      ),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CONFIG.precache)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => {
        // Не задерживает активацию: страницы уже под контролем, отложенные файлы — фоном.
        void fillLazy();
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(SHELL, { cacheName: CACHE }).then((hit) => hit || Response.error()),
      ),
    );
    return;
  }
  if (LAZY.has(url.pathname)) {
    event.respondWith(lazyFetch(req));
    return;
  }
  if (!PRECACHE.has(url.pathname)) return;
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});
