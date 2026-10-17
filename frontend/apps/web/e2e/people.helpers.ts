// W1.23 · Помощники e2e «Пользователи и роли» (company-users, company-roles, people-dialogs): вход владельца,
// переход на страницу и вкладку, локаторы строк людей, ролей и диалогов по ролям и дословным подписям эталона
// design-stage-1 («Ортус CRM.dc.html» :283–427, :2203–2262).
import type { Locator, Page } from '@playwright/test';

import { tenantId } from './shell.helpers.ts';

export type PersonaName = 'owner' | 'owner@t-lotos' | 'manager' | 'driver';
type AppFn = (route: string, o?: { persona?: PersonaName }) => Promise<unknown>;

export const USERS_H1 = 'Пользователи и роли';
export const TABS = { name: 'Разделы доступа' } as const;

/** Вход персонажа и переход на `/t/<организация>/users[?…]`; возвращает id организации. */
export async function openUsers(
  app: AppFn,
  page: Page,
  o: { persona?: PersonaName; query?: string; tenant?: string } = {},
): Promise<string> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const id = await tenantId(page, o.tenant);
  await app(`/t/${id}/users${o.query ? `?${o.query}` : ''}`, { persona });
  await page.getByRole('heading', { level: 1, name: USERS_H1 }).waitFor();
  return id;
}

export const tabs = (page: Page) => page.getByRole('tablist', TABS);
export const tab = (page: Page, label: string) =>
  tabs(page).getByRole('tab', { name: new RegExp(`^${label}`) });

/** Строка участника во вкладке «Люди». */
export const personRow = (page: Page, name: string): Locator =>
  page.getByRole('list', { name: 'Участники' }).getByRole('listitem').filter({ hasText: name });

/** Кнопка роли во вкладке «Роли» (имя кнопки начинается с названия роли). */
export const roleButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${name}\\s?(Системная|Шаблон|Своя)`) });

/**
 * Диалог по точному заголовку: подтверждение поверх карточки («Заблокировать сотрудника «Тимур Ахмедов»?») содержит
 * имя карточки, а пока оно закрывается, оба диалога в DOM.
 */
export const dialog = (page: Page, name: string): Locator =>
  page.getByRole('dialog', { name, exact: true });

/** Текст тоста оболочки (aria-live="polite"; без лигатуры иконки). */
export const toast = (page: Page): Locator => page.locator('.ox-toast .ox-toast-text');

/** Нет горизонтальной прокрутки страницы. */
export async function noHorizontalScroll(page: Page): Promise<boolean> {
  const width = page.viewportSize()?.width ?? 0;
  const scroll = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
  return scroll <= width;
}

/** Уникальный суффикс для данных стенда (сид общий для строк прогона). */
export const runTag = (): string => Date.now().toString(36).slice(-6);
