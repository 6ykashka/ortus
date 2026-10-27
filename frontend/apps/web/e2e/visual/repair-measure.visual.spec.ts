// W6.21 · Визуальная сверка `repair-measure` «Замер» со снимком design-2026-10-19 (verification-protocol.md §3,
// порог 0,01): эталон — «Ремонт и стройка.dc.html» :74–100 (объект obj-42), реализация — вкладка на хосте
// `repair?obj=&tab=measure` (пресет repairs-ready). Сверяется область вкладки; шапку объекта и меню — W6.20 и `shell`.
// «Открыть смету» без права финансов скрыта (Q-W4.00-repair-24) — владелец её видит, как на эталоне.
// Отличия — allowlist/repair-measure.md.
import { expect, test } from '../fixtures/index.ts';
import { OBJ, openRepair } from '../repair.tabs.helpers.ts';
import {
  REPAIR_REFERENCE,
  compareAreas,
  openRepairTabOnReference,
  syncInputValues,
  tabArea,
} from './repair.compare.ts';

test('repair-measure: «Замер» кв. 42 владельца в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(REPAIR_REFERENCE);
  await openRepairTabOnReference(ref.page, 'Замер', 'h-meas');
  await openRepair(app, page, { obj: OBJ.kv42, tab: 'measure', persona: 'owner' });
  await tabArea(page, 'h-meas').getByRole('table').waitFor();
  await page.waitForLoadState('networkidle');
  expect(await syncInputValues(tabArea(ref.page, 'h-meas'), tabArea(page, 'h-meas'))).toBe(16);
  const r = await compareAreas(
    tabArea(page, 'h-meas'),
    tabArea(ref.page, 'h-meas'),
    `repair-measure-owner-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual repair-measure owner ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}, высота ${r.heights.join(' / ')}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}, высота ${r.heights.join(' / ')}`).toBe(true);
});
