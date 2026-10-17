// W1.25 · Помощники e2e «Организаций» оператора: id организаций из listPlatformTenants (у оператора в /me/context
// организаций нет), строки списка и карточка, диалог команды с полем «Причина», общие проверки раскладки.
import { expect, type Locator, type Page } from '@playwright/test';

import { call } from './shell.helpers.ts';

export const ORGS = ['Альта Групп', 'SPA «Лотос»', 'Ремстрой Плюс', 'Карго Сити'] as const;
export type OrgName = (typeof ORGS)[number];

interface TenantDto {
  id: string;
  name: string;
  status: string;
  revision: number;
}

/** Организации платформы (оператор): имя → запись listPlatformTenants. */
export async function platformTenants(page: Page): Promise<Map<string, TenantDto>> {
  const r = await call(page, 'GET', '/api/v1/platform/tenants?limit=100');
  if (r.status !== 200) throw new Error(`listPlatformTenants ${r.status}`);
  const items = (r.body as { items: TenantDto[] }).items;
  return new Map(items.map((t) => [t.name, t]));
}

export async function platformTenantId(page: Page, name: OrgName): Promise<string> {
  const t = (await platformTenants(page)).get(name);
  if (!t) throw new Error(`нет организации «${name}» в listPlatformTenants`);
  return t.id;
}

/** Секция «Организации-клиенты». */
export const orgsSection = (page: Page): Locator =>
  page.locator('section[aria-labelledby="h-ten"]');

/** Строки списка организаций: кнопки aria-pressed (эталон :1838). */
export const orgRows = (page: Page): Locator => orgsSection(page).locator('button[aria-pressed]');

/** Строка организации: доступное имя начинается с названия (знак — aria-hidden). */
export const orgRow = (page: Page, name: OrgName): Locator =>
  orgRows(page).filter({ has: page.locator('.ox-org-name', { hasText: name }) });

/** Карточка выбранной организации: `<aside>`, имя области — заголовок h2. */
export const orgCard = (page: Page, name?: OrgName): Locator =>
  name ? page.getByRole('complementary', { name }) : orgsSection(page).locator('aside');

/** Значение строки `dl` карточки по подписи `dt`. */
export const cardValue = (card: Locator, label: string): Locator =>
  card.locator(`dt:text-is("${label}") + dd`);

/** Открытая страница «Организации» оператора после dev-входа. */
export async function openOrgs(
  app: (route: string, o?: { persona?: 'operator' }) => Promise<unknown>,
  page: Page,
  route = '/platform/tenants',
): Promise<void> {
  await app(route, { persona: 'operator' });
  await expect(page.getByRole('heading', { level: 1, name: 'Организации-клиенты' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(orgRows(page).first()).toBeVisible();
}

/** Диалог команды по заголовку. */
export const commandDialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog', { name: title });

/** Ввести причину и подтвердить команду кнопкой `confirm` диалога. */
export async function confirmWithReason(
  dialog: Locator,
  confirm: string,
  reason: string,
): Promise<void> {
  await dialog.getByLabel('Причина').fill(reason);
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
}

/** Ширина документа не больше окна: нет горизонтальной прокрутки. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll, 'горизонтальная прокрутка').toBeLessThanOrEqual(client);
}

/** Цели нажатия видимых кнопок области не меньше 44 px по высоте. */
export async function expectTargets44(area: Locator): Promise<void> {
  const small = await area.locator('button:visible').evaluateAll((els) =>
    els
      .map((e) => ({
        t: (e.textContent ?? '').trim().slice(0, 40),
        h: e.getBoundingClientRect().height,
      }))
      .filter((x) => x.h < 44),
  );
  expect(small, 'кнопки ниже 44 px').toEqual([]);
}
