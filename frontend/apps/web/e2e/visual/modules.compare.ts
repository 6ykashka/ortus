// W1.24 · Сверка страниц «Модули и место» и «Файлы» с эталоном design-stage-1: переход на эталоне по меню
// (маршрутов в прототипе нет — verification-protocol §3 п. 1), готовность страниц реализации.
import type { Page } from '@playwright/test';

/** Эталон: пункт меню по подписи — боковая панель или рейл (title), на телефоне — нижняя навигация или «Ещё». */
export async function openOnReference(page: Page, label: string, short?: string): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator(`button[title="${label}"], button:has-text("${label}")`).first().click();
  } else {
    const bottom = page.locator('nav[aria-label="Навигация"]');
    const direct = bottom.getByRole('button', { name: short ?? label, exact: true });
    if (await direct.count()) await direct.click();
    else {
      await bottom.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('dialog').getByRole('button', { name: label }).click();
    }
  }
  await page.getByRole('heading', { level: 1, name: label }).waitFor();
  await page.waitForLoadState('networkidle');
}

/** «Модули и место» реализации загружена: карточки, разбивка места и строки о ролях. */
export async function modulesReady(page: Page): Promise<void> {
  await page.locator('article').nth(2).waitFor();
  await page.locator('.ox-mod-break').nth(3).waitFor();
  await page.locator('.ox-mod-roles').nth(2).waitFor();
  await page.waitForLoadState('networkidle');
}
