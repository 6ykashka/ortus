// W1.23 · Сверка «Пользователей и ролей» с эталоном design-stage-1 (verification-protocol.md §3): переход на
// страницу и вкладку на эталоне (меню демо-персонажа владельца) и в реализации, маски областей, данные которых
// расходятся по решениям (роли модулей этапов 4–7, должность участника, назначения «Касса» и «Проект» — allowlist
// `company-users.md`, `company-roles.md`, `people-dialogs.md`), подписи основной области.
import type { Locator, Page } from '@playwright/test';

import { openUsers } from '../people.helpers.ts';

/** Шапка и меню сверяет ключ `shell`. */
export const CHROME = ['header', 'nav'];

export const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 640;

/** Эталон: владелец → «Пользователи и роли» (на телефоне — «Люди» нижней навигации) → вкладка. */
export async function referenceUsers(page: Page, tab?: string): Promise<void> {
  const nav = isWide(page)
    ? page.getByRole('navigation', { name: 'Основная навигация' })
    : page.getByRole('navigation', { name: 'Навигация', exact: true });
  await nav.getByRole('button', { name: isWide(page) ? 'Пользователи и роли' : 'Люди' }).click();
  await page.getByRole('heading', { level: 1, name: 'Пользователи и роли' }).waitFor();
  if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}

type AppFn = Parameters<typeof openUsers>[0];

/** Реализация: тот же экран по адресу. */
export async function implUsers(app: AppFn, page: Page, query = ''): Promise<void> {
  await openUsers(app, page, query ? { query } : {});
  await page.getByRole('tablist', { name: 'Разделы доступа' }).waitFor();
  await page.waitForLoadState('networkidle');
}

/**
 * Закрывает основную область ниже верхнего края `from` (до низа окна) сплошной заливкой — на обеих целях
 * одинаково: данные там расходятся по решениям allowlist, а высота блоков меняет раскладку ниже.
 */
export async function coverFrom(page: Page, from: Locator): Promise<void> {
  await coverAt(page, (await from.boundingBox())?.y ?? 0);
}

/** Та же заливка от высоты `top` (px окна) — чтобы закрыть обе цели с одной и той же строки. */
export async function coverAt(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    const main = document.querySelector('#ox-main') as HTMLElement | null;
    const r = main?.getBoundingClientRect();
    const cover = document.createElement('div');
    cover.setAttribute('data-visual-cover', '');
    Object.assign(cover.style, {
      position: 'fixed',
      zIndex: '40',
      left: `${r?.left ?? 0}px`,
      width: `${r?.width ?? window.innerWidth}px`,
      top: `${y}px`,
      bottom: '0',
      background: '#ff00ff',
    });
    document.body.append(cover);
  }, top);
}

/** n-й ребёнок секции страницы эталона (у эталона вкладки — прямые дети секции, :284–425). */
export const refBlock = (page: Page, n: number): Locator =>
  page.locator(`section[aria-labelledby="h-users"] > :nth-child(${n})`);
