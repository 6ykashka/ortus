// W4.61 · Помощники e2e страниц шага 4.6: «Подписка и места» владельца и «Использование», «Заявки на тариф»,
// «Пользователи», «Тарифная сетка» оператора. Вход персонажа и прямой URL, секции страниц по `aria-labelledby`
// эталона, диалог opConfirm, данные сценарного сервера через API из страницы (оператор — /platform/**).
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import { call } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Страницы оператора: сегмент маршрута → id заголовка секции эталона и текст `h1`. */
export const PLATFORM_PAGES = {
  usage: { id: 'h-usage', h1: 'Использование' },
  requests: { id: 'h-req', h1: 'Заявки на изменение тарифа' },
  accounts: { id: 'h-acc', h1: 'Пользователи платформы' },
  plans: { id: 'h-pb', h1: 'Тарифная сетка' },
} as const;

export type PlatformSegment = keyof typeof PLATFORM_PAGES;

/** Секция страницы по id заголовка эталона (`h-usage`, `h-req`, `h-acc`, `h-pb`, `h-bill`). */
export const section = (page: Page, id: string): Locator =>
  page.locator(`section[aria-labelledby="${id}"]`);

/** Страница оператора по прямому URL после dev-входа; ждёт `h1` и конец загрузки области. */
export async function openPlatform(
  app: AppFn,
  page: Page,
  segment: PlatformSegment,
  o: { query?: string; persona?: Persona } = {},
): Promise<Locator> {
  const p = PLATFORM_PAGES[segment];
  await app(`/platform/${segment}${o.query ?? ''}`, { persona: o.persona ?? 'operator' });
  await expect(page.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible({
    timeout: 15_000,
  });
  const root = section(page, p.id);
  await expect(root.getByRole('status', { name: 'Загрузка' })).toHaveCount(0, { timeout: 15_000 });
  return root;
}

/** Секция «Подписка и места». */
export const billingSection = (page: Page): Locator => section(page, 'h-bill');

/** Диалог opConfirm по заголовку. */
export const confirmDialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog', { name: title });

/** Текст тоста оболочки. */
export const toastText = (page: Page): Locator => page.locator('.ox-toast .ox-toast-text');

/** Текст области без лишних пробелов (неразрывные пробелы разрядов → обычные). */
export async function textOf(loc: Locator): Promise<string> {
  return ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

interface UsageDto {
  summary: { activeMembers: number; activeMembers7d: number };
  tenants: { tenantId: string; name: string }[];
}

/** «Использование» сценарного сервера (оператор). */
export async function platformUsage(page: Page): Promise<UsageDto> {
  const r = await call(page, 'GET', '/api/v1/platform/usage');
  if (r.status !== 200) throw new Error(`getPlatformUsage ${r.status}`);
  return r.body as UsageDto;
}

interface UserDto {
  id: string;
  displayName: string;
  email: string;
}

/** Аккаунт каталога по имени (оператор). */
export async function platformUser(page: Page, name: string): Promise<UserDto> {
  const r = await call(page, 'GET', `/api/v1/platform/users?q=${encodeURIComponent(name)}`);
  const u = (r.body as { items: UserDto[] }).items.find((x) => x.displayName === name);
  if (!u) throw new Error(`нет аккаунта «${name}»`);
  return u;
}
