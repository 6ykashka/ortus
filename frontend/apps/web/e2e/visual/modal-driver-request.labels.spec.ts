// W2.23 · Структурная сверка `modal-driver-request` «Запросить водителя» (verification-protocol.md §3 п. 4): подписи
// диалога (кнопки, заголовки, label, aria-label) в порядке документа, с allowlist/modal-driver-request.md.
// W2.73 (S2-20, D-35): эталон диалога — макет 1a «Временный водитель - варианты.dc.html» (design-2026-10-19b, :144–184),
// а не модалка request эталона 14.10: владелец открывает диалог Водителя #104 (обычная машина Hyundai HD-35, правка
// mock) на Р-211; на макете — состояния tweaks «Наша + можно свою» и «обычная не подходит».
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { driverCard, openPool } from '../logistics-pool.helpers.ts';
import { patchUsual } from '../logistics-pool-s220.helpers.ts';
import { S220_FILE, setProps } from './s220.compare.ts';
import { labelsOf } from './shell.compare.ts';

const area = (page: Page) => page.getByRole('dialog');

for (const fits of [true, false]) {
  test(`modal-driver-request: подписи диалога 1a совпадают с макетом (обычная ${fits ? 'подходит' : 'не подходит'}) @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.slow();
    const ref = await reference(S220_FILE);
    if (!fits) await setProps(ref.page, { homeCarFits: false });
    const refArea = ref.page.locator('[id="1a"] [role="dialog"]');
    const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
    await patchUsual(page, alta, fits);
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await driverCard(page, 'Водитель #104').getByRole('button').click();
    await area(page).waitFor();
    const expected = await labelsOf([refArea], 'modal-driver-request');
    const actual = await labelsOf([area(page)], 'modal-driver-request');
    expect(actual).toEqual(expected);
    expect(actual).toContain('radio:Едет на своей обычной');
    expect(actual.length).toBeGreaterThan(5);
  });
}
