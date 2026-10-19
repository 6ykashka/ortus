// W2.31 · Помощники e2e матрицы устройств: профиль проекта, камера (кадр фальшивого устройства Chromium или холст,
// отданный в `input capture`), тела PUT хранилища (сбой, задержка, медленный канал), медленная сеть, размер JPEG.
// Путь водителя до выезда и офлайн — driver.helpers.ts (W2.22) и outbox.helpers.ts (W2.24).
import { writeFileSync } from 'node:fs';

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { withGps } from '../../src/routes/core/files/upload/metadata.fixtures.test-util.ts';
import { scanFor } from '../outbox.helpers.ts';
import { devScenario } from '../shell.helpers.ts';

import type { DeviceMeta } from './projects.ts';

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
export const STORAGE = 'https://storage.example.invalid/**';

type Bytes = Uint8Array<ArrayBuffer>;

/** Кадр основной камеры телефона — 12 Мп (4032×3024). */
export const CAMERA = { width: 4032, height: 3024 } as const;

export function deviceOf(info: TestInfo): DeviceMeta {
  const d = (info.project.metadata as { device?: DeviceMeta } | undefined)?.device;
  if (!d)
    throw new Error(`проект ${info.project.name} — не проект устройства (e2e/devices/projects.ts)`);
  return d;
}

/** Нажатие как на устройстве: касание у проектов с touch, иначе щелчок. */
export async function press(target: Locator, info: TestInfo): Promise<void> {
  if (info.project.use.hasTouch) await target.tap();
  else await target.click();
}

/**
 * Кадр камеры: фальшивое устройство Chromium (`getUserMedia`, тыловая камера) — кадр видеопотока, растянутый до
 * 12 Мп; без него (WebKit) — кадр холста. JPEG 0,9 без метаданных; геоданные телефона добавляет `withGps`.
 */
export async function cameraFrame(page: Page, fake: boolean, n: number): Promise<Bytes> {
  const b64 = await page.evaluate(
    async ({ width, height, fake, n }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d');
      if (!g) return '';
      if (fake) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        await new Promise<void>((r) => {
          if (video.videoWidth > 0) r();
          else video.addEventListener('loadeddata', () => r(), { once: true });
        });
        g.drawImage(video, 0, 0, width, height);
        stream.getTracks().forEach((t) => t.stop());
      } else {
        const grad = g.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, '#3b7d6e');
        grad.addColorStop(1, '#d9e6e1');
        g.fillStyle = grad;
        g.fillRect(0, 0, width, height);
      }
      g.fillStyle = '#ffffff';
      g.font = '160px sans-serif';
      g.fillText(`Ортус · кадр ${String(n)}`, 160, height / 2);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) return '';
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(s);
    },
    { ...CAMERA, fake, n },
  );
  if (!b64) throw new Error('камера: нет кадра (холст или getUserMedia)');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Кадр камеры телефона с геоданными (снимается заранее: под WebKit без связи холст не читается). */
export async function frame(page: Page, info: TestInfo, n: number): Promise<Bytes> {
  return withGps(await cameraFrame(page, deviceOf(info).fakeCamera, n));
}

/**
 * Снимок телефоном: кадр камеры с геоданными в `input capture` слота (касание слота открывает камеру). `ready` —
 * кадр, снятый заранее (`frame`).
 */
export async function snap(
  page: Page,
  info: TestInfo,
  slot: Locator,
  n: number,
  ready?: Bytes,
): Promise<Bytes> {
  const shot = ready ?? (await frame(page, info, n));
  // Файл на диске (каталог результатов теста): WebKit под Windows не читает файл из буфера (NotReadableError).
  const file = info.outputPath(`IMG_${String(n).padStart(4, '0')}.jpg`);
  writeFileSync(file, shot);
  const chooser = page.waitForEvent('filechooser');
  await press(slot, info);
  await (await chooser).setFiles(file);
  return shot;
}

export interface StorageOptions {
  /** Столько первых PUT — сбой (500 или обрыв). */
  fail?: number;
  /** Задержка ответа хранилища, мс. */
  latencyMs?: number;
  /** Канал отправки, кбит/с (задержка по размеру тела). */
  kbps?: number;
}

export interface Storage {
  /** Тела принятых PUT. */
  bodies: () => Promise<Bytes[]>;
  /** Все попытки PUT (вместе с отказами). */
  attempts: () => Promise<number>;
}

interface PagePuts {
  fail: number;
  latencyMs: number;
  kbps: number;
  attempts: number;
  bodies: string[];
}

/**
 * До открытия приложения. WebKit: маршрут контекста не видит запросы service worker MSW, поэтому PUT обслуживает
 * хранилище mock вкладки (W2.53, sessionStorage `ortus:msw:storage`), а сбой, задержку и тела ведёт обёртка
 * XMLHttpRequest страницы. Chromium — без подготовки: PUT перехватывает маршрут контекста (`storage`).
 */
export async function prepareStorage(page: Page, info: TestInfo): Promise<void> {
  if (deviceOf(info).engine !== 'webkit') return;
  await page.addInitScript((origin) => {
    sessionStorage.setItem('ortus:msw:storage', 'on');
    const puts: PagePuts = { fail: 0, latencyMs: 0, kbps: 0, attempts: 0, bodies: [] };
    (window as unknown as { __ortusPuts: PagePuts }).__ortusPuts = puts;
    const proto = XMLHttpRequest.prototype;
    const open = proto.open as (this: XMLHttpRequest, ...a: unknown[]) => void;
    const send = proto.send;
    const target = new WeakMap<XMLHttpRequest, string>();
    proto.open = function (this: XMLHttpRequest, ...a: unknown[]) {
      target.set(this, `${String(a[0])} ${String(a[1])}`);
      open.apply(this, a);
    } as typeof proto.open;
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (!target.get(this)?.startsWith(`PUT ${origin}`)) {
        send.call(this, body);
        return;
      }
      puts.attempts += 1;
      const size = body instanceof Blob ? body.size : 0;
      const ms = puts.latencyMs + (puts.kbps ? (size * 8) / puts.kbps : 0);
      setTimeout(() => {
        if (puts.fail > 0) {
          puts.fail -= 1;
          this.dispatchEvent(new ProgressEvent('error'));
          return;
        }
        if (body instanceof Blob) {
          void body.arrayBuffer().then((b) => {
            let s = '';
            const u = new Uint8Array(b);
            for (let i = 0; i < u.length; i += 0x8000) {
              s += String.fromCharCode(...u.subarray(i, i + 0x8000));
            }
            puts.bodies.push(btoa(s));
          });
        }
        send.call(this, body);
      }, ms);
    };
  }, 'https://storage.example.invalid');
}

/**
 * Хранилище по билету загрузки: `fail` первых PUT — сбой, `latencyMs` — задержка ответа, `kbps` — канал отправки.
 * Chromium — маршрут контекста поверх маршрута `openDriver` (последний маршрут сильнее); WebKit — `prepareStorage`.
 */
export async function storage(
  page: Page,
  info: TestInfo,
  o: StorageOptions = {},
): Promise<Storage> {
  if (deviceOf(info).engine === 'webkit') {
    await page.evaluate((opt) => {
      const puts = (window as unknown as { __ortusPuts?: PagePuts }).__ortusPuts;
      if (!puts) throw new Error('prepareStorage не вызван до открытия приложения');
      Object.assign(puts, {
        fail: opt.fail ?? 0,
        latencyMs: opt.latencyMs ?? 0,
        kbps: opt.kbps ?? 0,
      });
    }, o);
    const read = () =>
      page.evaluate(() => (window as unknown as { __ortusPuts: PagePuts }).__ortusPuts);
    return {
      bodies: async () =>
        (await read()).bodies.map((b) => new Uint8Array(Buffer.from(b, 'base64'))),
      attempts: async () => (await read()).attempts,
    };
  }
  const bodies: Bytes[] = [];
  let n = 0;
  await page.context().route(STORAGE, async (r) => {
    n += 1;
    const body = r.request().postDataBuffer();
    const ms = (o.latencyMs ?? 0) + (o.kbps && body ? (body.length * 8) / o.kbps : 0);
    if (ms > 0) await new Promise((res) => setTimeout(res, ms));
    if (n <= (o.fail ?? 0)) {
      await r.fulfill({ status: 500 });
      return;
    }
    if (body) bodies.push(new Uint8Array(body));
    await r.fulfill({ status: 200 });
  });
  return { bodies: () => Promise.resolve([...bodies]), attempts: () => Promise.resolve(n) };
}
/** Размер JPEG по маркеру SOF (baseline или progressive) и наличие сегмента Exif. */
export function jpegInfo(b: Bytes): { width: number; height: number; exif: boolean } {
  expect(b[0] === 0xff && b[1] === 0xd8, 'JPEG: нет SOI').toBe(true);
  let exif = false;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1] ?? 0;
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') exif = true;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0);
      const width = ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0);
      return { width, height, exif };
    }
    i += 2 + len;
  }
  throw new Error('JPEG: нет SOF');
}

/**
 * Медленная сеть: ответы API сценарного сервера с задержкой `apiMs` (в режиме mock их даёт service worker MSW —
 * троттлинг браузера их не замедляет) и троттлинг Chromium (загрузка модулей, шрифтов) — как мобильный 3G.
 */
export async function slowNetwork(page: Page, info: TestInfo, apiMs: number): Promise<void> {
  await devScenario(page, { scenario: `delay=${String(apiMs)}` });
  if (deviceOf(info).engine !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: (1_600 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

/** Счётчик вызовов геолокации страницы (до загрузки приложения). */
export async function watchGeolocation(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __geoCalls: number };
    w.__geoCalls = 0;
    const geo = navigator.geolocation as Geolocation | undefined;
    if (!geo) return;
    const count =
      <A extends unknown[], R>(fn: (...a: A) => R) =>
      (...a: A): R => {
        w.__geoCalls += 1;
        return fn(...a);
      };
    geo.getCurrentPosition = count(geo.getCurrentPosition.bind(geo));
    geo.watchPosition = count(geo.watchPosition.bind(geo));
  });
  return () => page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls);
}

/** Пять ракурсов камерой до «Фото · 5 из 5» (проверка файлов — `scanFiles` сценарного сервера). */
export async function fiveShots(
  page: Page,
  info: TestInfo,
  sides: readonly string[],
): Promise<void> {
  let n = 0;
  for (const side of sides) {
    n += 1;
    await snap(page, info, page.getByRole('button', { name: new RegExp(`^${side}: `) }), n);
  }
  await scanFor(page, page.getByText('Фото · 5 из 5'));
}
