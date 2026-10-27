// W5.33 · Помощники e2e страницы `cash-self` «Мой подотчёт»: право `cash.advance.self` держателям (в шаблонах
// «Водитель» и «Прораб» контракта 0.12.0-stage5 его нет — Q-W5.33-7), вход персонажа на страницу, выбор файла чека.
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import { call, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Минимальный JPEG (SOI + EOI): хранилище режима mock содержимое не проверяет. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

interface RoleDto {
  id: string;
  name: string;
  permissions: string[];
  revision: number;
}

/**
 * Владелец добавляет ключ `cash.advance.self` ролям «Водитель» и «Прораб» (шаблонный вариант Q-W5.33-7: пока
 * шаблоны контракта его не содержат). Состояние сценарного сервера общее для персонажей одной сессии.
 */
export async function grantAdvanceSelf(
  app: AppFn,
  page: Page,
  roles: readonly string[] = ['Водитель', 'Прораб'],
): Promise<string> {
  await app('/', { persona: 'owner' });
  const id = await tenantId(page);
  const list = await call(page, 'GET', `/api/v1/tenants/${id}/roles`);
  const items = (list.body as { items: RoleDto[] }).items;
  for (const name of roles) {
    const role = items.find((r) => r.name === name);
    if (!role || role.permissions.includes('cash.advance.self')) continue;
    const one = await call(page, 'GET', `/api/v1/tenants/${id}/roles/${role.id}`);
    const r = await call(page, 'PATCH', `/api/v1/tenants/${id}/roles/${role.id}`, {
      body: { permissions: [...role.permissions, 'cash.advance.self'] },
      ifMatch: one.headers['etag'] ?? `"${role.revision}"`,
    });
    if (r.status !== 200)
      throw new Error(`PATCH роли ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return id;
}

/** Держатель подотчёта на странице «Мой подотчёт». */
export async function openCashSelf(
  app: AppFn,
  page: Page,
  persona: 'driver' | 'foreman' = 'driver',
): Promise<string> {
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  const id = await grantAdvanceSelf(app, page);
  await app(`/t/${id}/cash-self`, { persona });
  return id;
}

/** Файл чека через выбор файла (камера на телефоне — тот же input `capture`). */
export async function chooseReceiptPhoto(page: Page, tile: Locator): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await tile.click();
  await (await chooser).setFiles({ name: 'check.jpg', mimeType: 'image/jpeg', buffer: JPEG });
}

export const selfCard = (page: Page): Locator => page.locator('.ox-cs');

export async function expectBalance(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.locator('.ox-cs-bal')).toHaveText(text);
}
