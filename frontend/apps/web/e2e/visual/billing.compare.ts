// W4.61 · Сверка страниц шага 4.6 со снимком design-2026-10-19 (verification-protocol.md §3): переход на экран
// эталона по подписи меню, высокое окно (вся страница в одном снимке `#ox-main`), приведение текстов эталона к
// данным сценарного сервера там, где сид MSW и демо-данные эталона расходятся (allowlist ключа страницы).
import { expect, type Locator, type Page } from '@playwright/test';

import type { Target } from '@ortus/e2e-kit';

/** Область страницы: `#ox-main` (шапка и меню — сверка shell W1.20). */
export const mainTarget = (t: Target): Target => ({ ...t, root: t.page.locator('#ox-main') });

/** Корень `locator` внутри цели. */
export const areaTarget = (t: Target, selector: string): Target => ({
  ...t,
  root: t.page.locator(selector).first(),
});

/** Высота окна, при которой `#ox-main` вмещает страницу целиком на любой ширине проекта. */
export async function tall(page: Page, height = 3200): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) throw new Error('нет viewport проекта');
  await page.setViewportSize({ width: vp.width, height });
}

/** Переход на экран эталона кнопкой меню (боковое меню или нижняя навигация и лист «Все разделы»). */
export async function goReference(page: Page, label: string, h1: string): Promise<void> {
  const heading = page.getByRole('heading', { level: 1, name: h1 });
  // Пункт с бейджем («Заявки на тариф 1») — по подписи с необязательным числом в конце.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nav = page.locator('nav').getByRole('button', { name: new RegExp(`^${escaped}( \\d+)?$`) });
  if ((await nav.count()) > 0 && (await nav.first().isVisible())) {
    await nav.first().click();
  } else {
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Все разделы' })
      .getByRole('button', { name: label })
      .click();
  }
  await expect(heading).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Тексты узлов `selector` цели (в порядке документа, пробелы нормализованы). */
export async function textsOf(root: Locator, selector: string): Promise<string[]> {
  return root
    .locator(selector)
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}
