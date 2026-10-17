// W2.22 · Помощники e2e экрана водителя (`driver-today`, `driver-cars`, `modal-finish-route`): вход Ильи Васильева
// с пресетом логистики, ссылка хранилища (PUT по билету загрузки) и проверка файлов в режиме mock, фото слота через
// выбор файла, осмотр, выезд, «Завершить рейс». Действия — кликами по ролям и подписям, как водитель.
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import { call, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

export const SIDES = ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр'] as const;
export const DEP_CHECKS = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
] as const;
export const RET_CHECKS = [
  'Груз выгружен полностью',
  'Личные вещи забраны',
  'Ключи и документы на месте',
] as const;

/** Минимальный JPEG (SOI + EOI): хранилище режима mock содержимое не проверяет. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/**
 * Водитель «Альты» на странице `segment` с пресетом `logistics-ready`. PUT по ссылке хранилища отвечает 200: в
 * режиме mock хранилища нет, а запрос из service worker MSW видит только маршрут контекста (бриф §10 п. 6).
 */
export async function openDriver(
  app: AppFn,
  page: Page,
  segment: 'today' | 'cars',
  o: { scenario?: string } = {},
): Promise<string> {
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  await app('/', { persona: 'driver' });
  const id = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await app(`/t/${id}/${segment}`, { persona: 'driver' });
  return id;
}

export const carCard = (page: Page, model: string): Locator =>
  page
    .locator('article')
    .filter({ has: page.locator('.ox-dr-car-model').getByText(model, { exact: true }) });

export const actionBar = (page: Page): Locator => page.locator('.ox-dr-act');

/** «Забронировать» у машины → «Осмотр перед выездом». */
export async function reserve(page: Page, model = 'ГАЗель Next'): Promise<void> {
  await carCard(page, model).getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Осмотр перед выездом' })).toBeVisible();
}

/** Фото слота через выбор файла (камера на телефоне — тот же input `capture`). */
export async function choosePhoto(page: Page, slot: Locator, name = 'photo.jpg'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await slot.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: JPEG });
}

/** Пять фото осмотра; проверка файлов завершается dev-маршрутом сценарного сервера (`scanFiles`). */
export async function fivePhotos(page: Page): Promise<void> {
  for (const side of SIDES) {
    await choosePhoto(page, page.getByRole('button', { name: new RegExp(`^${side}: `) }));
  }
  await scanUntil(page, page.getByText('Фото · 5 из 5'));
}

/** Завершает проверку загруженных файлов, пока `ready` не станет видимым. */
export async function scanUntil(page: Page, ready: Locator): Promise<void> {
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Пробег, «½» и пункты чек-листа. */
export async function fillInspection(
  page: Page,
  odometer: string,
  checks: readonly string[],
): Promise<void> {
  await page.getByLabel(/^Пробег по одометру, км/).fill(odometer);
  await page.getByRole('button', { name: '½', exact: true }).click();
  for (const c of checks) await page.getByLabel(c, { exact: true }).check();
}

/** Бронь, осмотр и «Выехать на маршрут» → «Маршрут». */
export async function depart(page: Page): Promise<void> {
  await reserve(page);
  await fivePhotos(page);
  await fillInspection(page, '84500', DEP_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Маршрут' })).toBeVisible();
}

export const finishDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: /^Завершить рейс / });
