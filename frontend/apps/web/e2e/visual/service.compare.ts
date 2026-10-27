// W7.32 · Общие части сверки `service` «Обращения» с эталоном: переход на странице эталона по меню (маршрутов в прототипе
// нет, verification-protocol §3 п. 1) и состояния «Очередь», «Низкие оценки», «Карточка» (МАС-41).
// Отличие от `openOnReference` (modules.compare.ts): у встроенного модуля «Обращения» нет h1 оболочки — заголовок страницы
// эталона это h2 самого модуля (Обращения.dc.html:34), его и ждём.
import type { Locator, Page } from '@playwright/test';

export const SERVICE_STATES = ['Очередь', 'Низкие оценки', 'Карточка'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** Эталон: пункт «Обращения» боковой панели или рейла, на телефоне — нижняя навигация или «Ещё». */
export async function openServiceOnReference(page: Page): Promise<void> {
  const label = 'Обращения';
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator(`button[title="${label}"], button:has-text("${label}")`).first().click();
  } else {
    const bottom = page.locator('nav[aria-label="Навигация"]');
    const direct = bottom.getByRole('button', { name: label, exact: true });
    if (await direct.count()) await direct.click();
    else {
      await bottom.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('dialog').getByRole('button', { name: label }).click();
    }
  }
  await page.getByRole('heading', { level: 2, name: label }).first().waitFor();
  await page.getByRole('button', { name: 'ГРЗ-57', exact: true }).first().waitFor();
  await page.waitForLoadState('networkidle');
}

/** Одинаково на эталоне и в реализации: очередь «Низкие оценки» и карточка МАС-41. */
export async function showServiceState(root: Locator, state: ServiceState): Promise<void> {
  if (state === 'Низкие оценки') {
    await root
      .getByRole('button', { name: /Низкие оценки/ })
      .first()
      .click();
  }
  if (state === 'Карточка') {
    await root.getByRole('button', { name: 'МАС-41', exact: true }).first().click();
  }
}
