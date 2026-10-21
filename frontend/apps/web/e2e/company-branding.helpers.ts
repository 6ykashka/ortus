// W4.62 · Помощники e2e «Оформления» (`company-branding`): переход по меню (на телефоне — «Ещё» → «Все разделы»),
// поля и области страницы по подписям эталона, файлы PNG с заданными размерами, значения CSS-переменных акцента.
import type { Locator, Page } from '@playwright/test';

const BOTTOM_NAV = { name: 'Навигация', exact: true } as const;

export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

/** Пункт меню по подписи: на телефоне — через «Ещё» → «Все разделы», иначе — боковая панель или рейл. */
export async function fromMenu(page: Page, label: string): Promise<void> {
  if (phone(page)) {
    await page.getByRole('navigation', BOTTOM_NAV).getByRole('button', { name: 'Ещё' }).click();
    await page
      .getByRole('dialog', { name: 'Все разделы' })
      .getByRole('button', { name: label })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label })
      .click();
  }
}

/** Подписи всех пунктов меню: боковая панель (title) или лист «Все разделы» на телефоне. */
export async function menuLabels(page: Page): Promise<string[]> {
  if (phone(page)) {
    await page.getByRole('navigation', BOTTOM_NAV).getByRole('button', { name: 'Ещё' }).click();
    const sheet = page.getByRole('dialog', { name: 'Все разделы' });
    const out = await sheet.locator('.ox-nav-label').allTextContents();
    await sheet.getByRole('button', { name: 'Закрыть' }).click();
    return out;
  }
  return page
    .getByRole('navigation', { name: 'Основная навигация' })
    .locator('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
}

export const main = (page: Page): Locator => page.locator('#ox-main');
export const preview = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Предпросмотр' });
export const palette = (page: Page): Locator => page.getByRole('radiogroup', { name: 'Палитра' });
export const swatch = (page: Page, name: string): Locator =>
  palette(page).getByRole('radio', { name });
export const hex = (page: Page): Locator => page.getByLabel('Свой цвет в формате HEX');
export const nameField = (page: Page): Locator => page.getByLabel(/^Название организации/);
export const shortField = (page: Page): Locator => page.getByLabel(/^Короткое имя/);
export const save = (page: Page): Locator =>
  page.getByRole('button', { name: 'Сохранить для всех' });
export const panel = (page: Page): Locator => page.locator('.ox-br-panel');

/** Строка меню по стандартной подписи пункта. */
export const menuRow = (page: Page, def: string): Locator =>
  page.locator('.ox-br-row').filter({ has: page.getByLabel(`Название пункта «${def}»`) });

/** Строка термина по подписи («Смена», «Визит»…). */
export const termRow = (page: Page, label: string): Locator =>
  page.locator('.ox-br-term').filter({ has: page.locator('strong', { hasText: label }) });

/** Поле файла карточки «Логотип и знак»: 0 — логотип, 1 — знак. */
export const fileInput = (page: Page, i: 0 | 1): Locator =>
  page.locator('#ox-main input[type=file]').nth(i);

/** Значение CSS-переменной на :root. */
export const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(),
    name,
  );

/** Минимальный PNG w×h (сигнатура и IHDR — сервер читает размеры по заголовку). */
export function pngFile(w: number, h: number, name = 'brand.png') {
  const buffer = Buffer.alloc(64);
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  ]).copy(buffer);
  buffer.writeUInt32BE(w, 16);
  buffer.writeUInt32BE(h, 20);
  return { name, mimeType: 'image/png', buffer };
}
