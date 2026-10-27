// W6.21 · Структурная сверка `repair-measure` «Замер» со снимком design-2026-10-19 (verification-protocol.md §3 п. 4):
// подписи области вкладки (кнопки, заголовки, label, aria-label) в порядке документа, с allowlist/repair-measure.md.
// Эталон — «Ремонт и стройка.dc.html» (объект obj-42), реализация — вкладка на хосте `repair?obj=&tab=measure`.
import { expect, test } from '../fixtures/index.ts';
import { OBJ, openRepair } from '../repair.tabs.helpers.ts';
import { REPAIR_REFERENCE, openRepairTabOnReference, tabArea } from './repair.compare.ts';
import { labelsOf } from './shell.compare.ts';

test('repair-measure: подписи «Замера» (владелец) совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(REPAIR_REFERENCE);
  await openRepairTabOnReference(ref.page, 'Замер', 'h-meas');
  await openRepair(app, page, { obj: OBJ.kv42, tab: 'measure', persona: 'owner' });
  await tabArea(page, 'h-meas').getByRole('table').waitFor();
  await page.waitForLoadState('networkidle');
  const expected = await labelsOf([tabArea(ref.page, 'h-meas')], 'repair-measure');
  const actual = await labelsOf([tabArea(page, 'h-meas')], 'repair-measure');
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(15);
});
