// W1.20 · Структурная сверка `shell` со снимком design-stage-1 (verification-protocol.md §3 п. 4): подписи
// шапки и меню (кнопки, ссылки, заголовки, aria-label) в порядке документа, с учётом allowlist/shell.md.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { labelsOf } from './shell.compare.ts';

/** Шапка и меню своей ширины: в эталоне второе меню в DOM отсутствует (sc-if), в реализации скрыто CSS. */
const areas = (page: Page) => [
  page.locator('header'),
  page.locator(
    (page.viewportSize()?.width ?? 0) < 640
      ? 'nav[aria-label="Навигация"]'
      : 'nav[aria-label="Основная навигация"]',
  ),
];

// Сотрудники (водитель, массажист, прораб) — меню рабочего места и нижняя навигация 390 по эталону.
for (const persona of ['owner', 'operator', 'manager', 'driver', 'therapist', 'foreman'] as const) {
  test(`shell: подписи шапки и меню (${persona}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await reference(undefined, { persona, hidePanel: true });
    await app('/', { persona });
    await expect(page.locator('nav.ox-sidebar .ox-nav-item').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    // У логиста — свой файл allowlist: расхождения меню по данным /me/context (PD-53, D-23 комплекта); у массажиста
    // «Альты» — вместе с общим: «Касса» по праву cash.* (W1.49, этап 5).
    const key =
      persona === 'manager'
        ? 'shell-manager'
        : persona === 'therapist'
          ? ['shell', 'shell-therapist']
          : 'shell';
    const expected = await labelsOf(areas(ref.page), key);
    const actual = await labelsOf(areas(page), key);
    expect(actual).toEqual(expected);
  });
}
