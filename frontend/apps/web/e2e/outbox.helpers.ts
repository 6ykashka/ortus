// W2.24 · Помощники e2e очереди отправки (`driver-outbox`): связь, фото без связи, расход и сдача на устройстве,
// строки расходов, хранилище устройства (IndexedDB `ortus-device`) и Idempotency-Key команд. Действия — кликами по
// ролям и подписям, как водитель; путь до выезда — driver.helpers.ts (W2.22).
import { expect, type Locator, type Page, type Request } from '@playwright/test';

import {
  actionBar,
  choosePhoto,
  DEP_CHECKS,
  fillInspection,
  finishDialog,
  reserve,
  SIDES,
} from './driver.helpers.ts';
import { call } from './shell.helpers.ts';

/**
 * Завершает проверку загруженных файлов, пока `ready` не станет видимым. Запас — 45 с: под нагрузкой общего ПК
 * загрузка пяти фото на 390 шла дольше 15 с у `scanUntil` W2.22 (возврат 1, флейк driver-outbox :158).
 */
export async function scanFor(page: Page, ready: Locator, timeout = 45_000): Promise<void> {
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout });
}

/** Пять фото со связью до «Фото · 5 из 5» (как `fivePhotos` W2.22, с запасом времени загрузки). */
export async function photosOnline(page: Page): Promise<void> {
  for (const side of SIDES) await choosePhoto(page, slot(page, side));
  await scanFor(page, page.getByText('Фото · 5 из 5'));
}

/** Бронь, пять фото, осмотр и «Выехать на маршрут» → «Маршрут» (как `depart` W2.22, с запасом времени загрузки). */
export async function departed(page: Page): Promise<void> {
  await reserve(page);
  await photosOnline(page);
  await fillInspection(page, '84500', DEP_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Маршрут' })).toBeVisible({
    timeout: 15_000,
  });
}

export const net = (page: Page, online: boolean): Promise<void> =>
  page.context().setOffline(!online);

export const h2 = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 2, name });

/** Слот фото по ракурсу. */
export const slot = (page: Page, side: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${side}: `) });

/** Пять фото без связи: «На устройстве · ждёт связи», «Фото · 5 из 5» (проверки файлов нет). */
export async function photosOffline(page: Page): Promise<void> {
  for (const side of SIDES) await choosePhoto(page, slot(page, side));
  await expect(page.getByText('Фото · 5 из 5')).toBeVisible();
  await expect(
    page.locator('.ox-dr-slot-status').filter({ hasText: 'На устройстве · ждёт связи' }),
  ).toHaveCount(5);
}

/** «Завершить рейс» → подтверждение → «Осмотр при сдаче». */
export async function finishRoute(page: Page): Promise<void> {
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(h2(page, 'Осмотр при сдаче')).toBeVisible();
}

/** Строка расхода «{категория} · {сумма}». */
export const expenseRow = (page: Page, title: string): Locator =>
  page.locator('.ox-dr-exp').filter({ has: page.locator('.ox-dr-exp-title', { hasText: title }) });

/** Форма расхода без связи: «Мойка», 400 ₽, фото чека → «Сохранить на устройстве». */
export async function expenseOffline(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Добавить расход' }).click();
  await page.getByLabel('Категория').selectOption('wash');
  await page.getByLabel(/^Сумма, ₽/).fill('400');
  await choosePhoto(page, page.getByRole('button', { name: /^Чек: / }), 'receipt.jpg');
  await expect(
    page.locator('.ox-dr-receipt').getByText('На устройстве · ждёт связи'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить на устройстве' }).click();
}

/** Черновик осмотра в хранилище устройства (IndexedDB `ortus-device`, ключи `draft:…`). */
export async function savedDrafts(page: Page): Promise<{ odometer: string }[]> {
  return page.evaluate(
    () =>
      new Promise<{ odometer: string }[]>((resolve) => {
        const open = indexedDB.open('ortus-device', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readonly').objectStore('kv');
          const all = tx.getAll(IDBKeyRange.bound('draft:', 'draft:￿'));
          all.onsuccess = () =>
            resolve((all.result as { draft: { odometer: string } }[]).map((x) => x.draft));
          all.onerror = () => resolve([]);
        };
        open.onerror = () => resolve([]);
      }),
  );
}

/** Запросы команды `method path$` страницы (запросы MSW страница тоже видит). */
export function commands(page: Page, method: string, path: RegExp): { list: () => Request[] } {
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === method && path.test(new URL(r.url()).pathname)) seen.push(r);
  });
  return { list: () => [...seen] };
}

/** Idempotency-Key запросов. */
export const keysOf = async (list: Request[]): Promise<string[]> =>
  Promise.all(list.map(async (r) => (await r.allHeaders())['idempotency-key'] ?? ''));

/** Баннер оболочки над страницей по заголовку. */
export const banner = (page: Page, title: string): Locator =>
  page.locator('.ox-banner').filter({ hasText: title });

/**
 * Настоящий JPEG 640×480 (canvas страницы): на стенде фото проходит сжатие на клиенте, MinIO и проверку cmd/worker
 * (как journeys/stage2/driver-shift.spec.ts W2.90).
 */
export async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#3b7d6e';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#ffffff';
    g.font = '40px sans-serif';
    g.fillText('Ортус · без связи', 40, 250);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  });
  if (!b64) throw new Error('canvas: нет 2d-контекста');
  return Buffer.from(b64, 'base64');
}

/** Фото слота настоящим JPEG. */
export async function shoot(
  page: Page,
  target: Locator,
  file: Buffer,
  name: string,
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await target.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: file });
}
