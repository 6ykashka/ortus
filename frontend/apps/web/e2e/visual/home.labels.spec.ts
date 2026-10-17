// W2.25 · Структурная сверка `home` со снимком design-stage-2 (verification-protocol.md §3 п. 4): подписи «Главной»
// (кнопки, заголовки, aria-label) в порядке документа, с allowlist/home.md (источники и карточки модулей этапов 4–7 —
// out-of-stage). Персонажи: владелец «Альты» (стартовая страница) и логист без роли.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { openHome } from '../home.helpers.ts';
import { labelsOf } from './shell.compare.ts';

const area = (page: Page) => page.locator('section[aria-labelledby="h-home"]');

for (const persona of ['owner', 'manager'] as const) {
  test(`home: подписи «Главной» (${persona}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await reference(undefined, { persona, hidePanel: true });
    await area(ref.page).waitFor();
    await openHome(app, page, { persona });
    await expect(
      area(page).getByRole('heading', { level: 2, name: 'Последние события' }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    const expected = await labelsOf([area(ref.page)], 'home');
    const actual = await labelsOf([area(page)], 'home');
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(3);
  });
}
