// W6.20 · Помощники e2e страницы `repair` «Объекты»: вход персонажа с пресетом `repairs-ready` («Ремонт и стройка»
// подключён, сегодня 20.10.2026), часы страницы (даты «через N дней» считаются от них), переход к объекту, фото
// отметки через выбор файла (PUT по билету хранилища отвечает 200 — в режиме mock хранилища нет).
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import { devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

/** Минимальный JPEG (SOI + EOI): хранилище режима mock содержимое не проверяет. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** «Сегодня» сценария ремонта (Q-W4.00-repair-15). */
export const TODAY = new Date('2026-10-20T10:30:00+03:00');

export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

export interface OpenOptions {
  persona?: 'owner' | 'foreman';
  /** Параметры адреса: `obj`, `tab`, `filter`, `q`. */
  search?: Record<string, string>;
  scenario?: string;
}

/** Страница «Объекты» персонажа на пресете `repairs-ready`; возвращает id организации. */
export async function openRepair(app: AppFn, page: Page, o: OpenOptions = {}): Promise<string> {
  const persona = o.persona ?? 'owner';
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  await app('/', { persona });
  const id = await tenantId(page);
  await devScenario(page, { preset: 'repairs-ready' });
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await page.clock.setSystemTime(TODAY);
  const query = new URLSearchParams(o.search ?? {}).toString();
  await app(`/t/${id}/repair${query ? `?${query}` : ''}`, { persona });
  return id;
}

/** Id объекта эталона по имени — кликом в списке (id — служебные, видимы только в адресе). */
export const rowOf = (page: Page, name: string): Locator =>
  page.locator('tr, .ox-rp-obj').filter({ has: page.getByText(name, { exact: true }) });

export const heading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

/** Фото через выбор файла (камера на телефоне — тот же input `capture`). */
export async function addPhoto(page: Page, button: Locator, name = 'photo.jpg'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: JPEG });
}

export async function openObject(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
  await expect(heading(page, name)).toBeVisible();
}

/**
 * Перезагрузка с явным ожиданием готовности: после `reload` сценарный сервер (MSW) стартует заново, а под нагрузкой
 * полного прогона 5 секунд ожидания `expect` не хватало (возврат 5, mobile-390). Ждём заголовок страницы дольше.
 */
export async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('#ox-main').getByRole('heading', { level: 1 })).toBeVisible({
    timeout: 30_000,
  });
}
