// W5.32 · Структурная сверка `cash` «Касса» со снимком design-2026-10-19 (verification-protocol.md §3 п. 4): подписи
// области модуля (заголовок, вкладки, кнопки, подписи полей, чипы) в порядке документа, с учётом allowlist/cash.md.
// Данные эталона, которых нет в контракте 0.12.0 или в сиде mock (подразделение «Салон SPA», номера K-3xx, подпись
// вкладки «Подотчёт» W5.33), — записи allowlist; поведение без эталона — там же.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { labelsOf } from './shell.compare.ts';

const TABS = ['Кассы', 'Входящие', 'Смены', 'Настройки'] as const;

const area = (page: Page): Locator => page.locator('#ox-main');
const tabOf = (page: Page, name: string): Locator =>
  area(page)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .first();

for (const tab of TABS) {
  test(`cash: подписи «${tab}» совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openOnReference(ref.page, 'Касса');
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/cash`, { persona: 'owner' });
    await expect(page.locator('.ox-ca-op').first()).toBeVisible();
    if (tab !== 'Кассы') {
      await tabOf(ref.page, tab).click();
      await tabOf(page, tab).click();
    }
    await page.waitForLoadState('networkidle');
    const expected = await labelsOf([area(ref.page)], 'cash');
    const actual = await labelsOf([area(page)], 'cash');
    expect(actual).toEqual(expected);
    expect(actual).toContain('h1:Касса');
  });
}
