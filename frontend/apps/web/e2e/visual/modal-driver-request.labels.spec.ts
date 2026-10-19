// W2.23 · Структурная сверка `modal-driver-request` «Запросить водителя» со снимком design-stage-2
// (verification-protocol.md §3 п. 4): подписи диалога (кнопки, заголовки, label, aria-label) в порядке документа, с
// allowlist/modal-driver-request.md. Владелец открывает диалог Водителя #104 на Р-211 из «Ресурсного пула».
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { driverCard, openPool, POOL_H1 } from '../logistics-pool.helpers.ts';
import { connectLogisticsOnReference } from './logistics-pool.compare.ts';
import { openOnReference } from './modules.compare.ts';
import { labelsOf } from './shell.compare.ts';

const area = (page: Page) => page.getByRole('dialog');

test('modal-driver-request: подписи диалога «Запросить водителя» совпадают с эталоном @mock', async ({
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
  await ref.page.getByRole('button', { name: 'Запросить на рейс Р-211' }).first().click();
  await area(ref.page).waitFor();
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').getByRole('button').click();
  await area(page).waitFor();
  const expected = await labelsOf([area(ref.page)], 'modal-driver-request');
  const actual = await labelsOf([area(page)], 'modal-driver-request');
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(3);
});
