// W2.23 · Структурная сверка `logistics-pool` «Ресурсный пул» со снимком design-stage-2 (verification-protocol.md §3
// п. 4): подписи раздела (кнопки, заголовки, label, aria-label) в порядке документа, с allowlist/logistics-pool.md.
// Персонаж — владелец (на эталоне логист Котова без роли): «Логистика» подключается в «Модули и место», затем меню
// «Пул» — два свободных водителя сида, «Запросить на рейс Р-211». Логиста Котову e2e сверяет по подписям.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { driverCard, openPool, POOL_H1 } from '../logistics-pool.helpers.ts';
import { connectLogisticsOnReference } from './logistics-pool.compare.ts';
import { openOnReference } from './modules.compare.ts';
import { labelsOf } from './shell.compare.ts';

const area = (page: Page) => page.locator('section[aria-labelledby="h-pool"]');

test('logistics-pool: подписи «Ресурсного пула» (владелец) совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await connectLogisticsOnReference(ref.page);
  await openOnReference(ref.page, POOL_H1, 'Пул');
  await area(ref.page).waitFor();
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #117').getByRole('button').waitFor();
  await page.waitForLoadState('networkidle');
  const expected = await labelsOf([area(ref.page)], 'logistics-pool');
  const actual = await labelsOf([area(page)], 'logistics-pool');
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(3);
});
