// W4.62 · Помощники e2e «Оформления» (`company-branding`): переход по меню (на телефоне — «Ещё» → «Все разделы»),
// поля и области страницы по подписям эталона, файлы PNG с заданными размерами, значения CSS-переменных акцента.
// W4.72: цвет палитры, отличный от сохранённого, тело возврата оформления, настоящий PNG для cmd/api стенда.
import { deflateSync } from 'node:zlib';

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

/** Цвета палитры, которыми пользуется строка стенда (эталон :3681, brandingVM). */
export const SWATCHES = {
  blue: { name: 'Синий', hex: '#2B5479' },
  plum: { name: 'Сливовый', hex: '#7A3E79' },
} as const;

/** Цвет палитры, отличный от сохранённого: выбор того же цвета черновик не меняет (Q-W4.60-6). */
export const otherSwatch = (savedHex: string) =>
  savedHex.toUpperCase() === SWATCHES.blue.hex ? SWATCHES.plum : SWATCHES.blue;

interface AssetRef {
  id: string;
  url: string;
}

/** Действующее оформление (`Branding` контракта) — поля, нужные для возврата целиком (PUT заменяет версию). */
export interface SavedBranding {
  displayName: string;
  shortName?: string | null;
  accentHex: string;
  logo?: AssetRef | null;
  mark?: AssetRef | null;
  terms: Record<string, unknown>;
  menu: { items: Record<string, unknown>; order: string[] };
  poweredBy: boolean;
}

/** Тело `updateTenantBranding` из прочитанной версии: та же версия по содержанию. */
export const brandingBody = (b: SavedBranding) => ({
  displayName: b.displayName,
  shortName: b.shortName ?? null,
  accentHex: b.accentHex,
  logoAssetId: b.logo?.id ?? null,
  markAssetId: b.mark?.id ?? null,
  terms: b.terms,
  menu: b.menu,
  poweredBy: b.poweredBy,
});

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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * Настоящий PNG w×h одного цвета (RGB, контрольные суммы чанков): cmd/api проверяет его `png.DecodeConfig`
 * (W4.60, знак — квадрат не меньше 512×512), браузер рисует фоном. Для сценарного сервера mock хватает `pngFile`.
 */
export function solidPng(w: number, h: number, rgb: [number, number, number], name = 'brand.png') {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 бит, RGB, deflate, фильтры, без чересстрочности
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { name, mimeType: 'image/png', buffer };
}
