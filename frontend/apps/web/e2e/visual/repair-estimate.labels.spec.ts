// W6.21 · Структурная сверка `repair-estimate` «Смета» со снимком design-2026-10-19 (verification-protocol.md §3 п. 4):
// подписи области вкладки (кнопки, заголовки, label, aria-label) в порядке документа, с allowlist/repair-estimate.md.
// Кадры: действующая версия 2 и сравнение версий 1 и 2. Эталон — «Ремонт и стройка.dc.html» (объект obj-42).
import { expect, test } from '../fixtures/index.ts';
import { OBJ, openRepair } from '../repair.tabs.helpers.ts';
import { REPAIR_REFERENCE, openRepairTabOnReference, tabArea } from './repair.compare.ts';
import { labelsOf } from './shell.compare.ts';

for (const frame of ['default', 'compare'] as const) {
  test(`repair-estimate: подписи «Сметы» (${frame}) совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.slow();
    const ref = await reference(REPAIR_REFERENCE);
    await openRepairTabOnReference(ref.page, 'Смета', 'h-est');
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate', persona: 'owner' });
    const area = (p: typeof page) => tabArea(p, 'h-est');
    await area(page).getByRole('group', { name: 'Версии сметы' }).waitFor();
    await page.waitForLoadState('networkidle');
    if (frame === 'compare') {
      for (const p of [ref.page, page]) {
        await area(p).getByRole('button', { name: 'Сравнить с версией 1' }).click();
        await area(p).getByRole('columnheader', { name: 'Разница' }).waitFor();
      }
    }
    const expected = await labelsOf([area(ref.page)], 'repair-estimate');
    const actual = await labelsOf([area(page)], 'repair-estimate');
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(8);
  });
}
