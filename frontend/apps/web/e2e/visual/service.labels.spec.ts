// W7.32 · Структурная сверка `service` «Обращения» со снимком design-2026-10-19 (verification-protocol.md §3 п. 4): подписи
// области модуля (заголовки, кнопки, чипы, поля) в порядке документа, с учётом allowlist/service.md. Состояния — «Очередь»,
// «Низкие оценки», «Карточка» (МАС-41). Данные эталона, которых нет в контракте 0.12.0-stage7 или в сиде mock, — записи
// allowlist; поведение без эталона — там же.
import type { Locator, Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openServiceOnReference, SERVICE_STATES, showServiceState } from './service.compare.ts';
import { labelsOf } from './shell.compare.ts';

const area = (page: Page): Locator => page.locator('#ox-main');

for (const state of SERVICE_STATES) {
  test(`service: подписи «${state}» совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.setTimeout(120_000);
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openServiceOnReference(ref.page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/service`, { persona: 'owner' });
    await expect(page.getByRole('heading', { level: 1, name: 'Обращения' })).toBeVisible();
    await expect(page.locator('.ox-sv-row').nth(1)).toBeVisible();
    await showServiceState(ref.page.locator('#dc-root'), state);
    await showServiceState(area(page), state);
    await page.waitForLoadState('networkidle');
    const expected = await labelsOf([area(ref.page)], 'service');
    const actual = await labelsOf([area(page)], 'service');
    expect(actual).toEqual(expected);
  });
}
