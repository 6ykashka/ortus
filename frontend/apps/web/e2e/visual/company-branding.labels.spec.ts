// W4.62 · Структурная сверка `company-branding` со снимком design-2026-10-19 (verification-protocol.md §3 п. 4):
// подписи основной области (кнопки, ссылки, заголовки, label, aria-label) в порядке документа, с
// allowlist/company-branding.md. Варианты: «Альта» (верх и меню с открытыми иконками), письмо, «Лотос».
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { type Frame, frame, openImpl, openRef } from './company-branding.compare.ts';
import { labelsOf } from './shell.compare.ts';

/**
 * Строка редактора меню без пары на другой цели (allowlist/company-branding.md): «Структура» — пункт реализации без
 * эталона (W1.54), «Обучение» — пункт эталона вне реестра плана (Q-W2.70-16). Строка снимается до сбора подписей.
 */
async function dropRow(page: Page, def: string): Promise<void> {
  await page.evaluate((label) => {
    const input = document.querySelector(`input[aria-label="Название пункта «${label}»"]`);
    let row = input?.parentElement ?? null;
    while (row && !row.querySelector('button[aria-label^="Сменить иконку"]'))
      row = row.parentElement;
    row?.parentElement?.removeChild(row);
  }, def);
}

const VARIANTS: readonly (readonly [name: string, persona: Persona, f: Frame])[] = [
  ['page', 'owner', 'top'],
  ['menu', 'owner', 'menu'],
  ['mail', 'owner', 'mail'],
  ['lotos', 'owner@t-lotos', 'top'],
];

for (const [name, persona, f] of VARIANTS) {
  test(`company-branding: подписи (${name}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.slow();
    const ref = await reference(undefined, { persona, hidePanel: true });
    await openRef(ref.page);
    await frame(ref.page, f);
    await openImpl(app, page, persona);
    await frame(page, f);
    await dropRow(ref.page, 'Обучение');
    await dropRow(page, 'Структура');
    const expected = await labelsOf(
      [ref.page.locator('#ox-main, main').first()],
      'company-branding',
    );
    const actual = await labelsOf([page.locator('#ox-main')], 'company-branding');
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(20);
  });
}
