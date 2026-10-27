// W6.21 · Визуальная сверка `repair-estimate` «Смета» со снимком design-2026-10-19 (verification-protocol.md §3,
// порог 0,01): эталон — «Ремонт и стройка.dc.html» :104–276 (объект obj-42, версии 1 и 2, допработа ДР-1),
// реализация — вкладка на хосте `repair?obj=&tab=estimate` (пресет repairs-ready). Кадры: действующая версия 2,
// сравнение версий 1 и 2 (после «Сравнить с версией 1»). Шапку объекта и меню сверяют W6.20 и `shell`.
// Отличия — allowlist/repair-estimate.md.
import type { Page, TestInfo } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { OBJ, openRepair } from '../repair.tabs.helpers.ts';
import {
  REPAIR_REFERENCE,
  compareAreas,
  dropContractGaps,
  openRepairTabOnReference,
  syncInputValues,
  tabArea,
} from './repair.compare.ts';

const area = (page: Page) => tabArea(page, 'h-est');

type Frame = 'default' | 'compare';

async function shoot(frame: Frame, page: Page, ref: Page, testInfo: TestInfo): Promise<void> {
  if (frame === 'compare') {
    for (const p of [ref, page]) {
      await area(p).getByRole('button', { name: 'Сравнить с версией 1' }).click();
      await area(p).getByRole('columnheader', { name: 'Разница' }).waitFor();
    }
  }
  await syncInputValues(area(ref), area(page));
  await dropContractGaps(area(ref));
  const r = await compareAreas(
    area(page),
    area(ref),
    `repair-estimate-${frame}-${testInfo.project.name}`,
    testInfo,
    // 768: у части строк широкой таблицы базовая линия текста смещена на 1 px (allowlist/repair-estimate.md, pixel).
    page.viewportSize()?.width === 768 ? 0.015 : 0.01,
  );
  console.log(
    `visual repair-estimate ${frame} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}, высота ${r.heights.join(' / ')}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}, высота ${r.heights.join(' / ')}`).toBe(true);
}

const FRAMES: [Frame, string][] = [
  ['default', '«Смета» кв. 42, версия 2 · действует, в допуске 0,01'],
  ['compare', 'сравнение версий 1 и 2 в допуске 0,01'],
];

for (const [frame, title] of FRAMES) {
  test(`repair-estimate: ${title} @mock`, async ({ app, page, reference, harness }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.slow();
    const ref = await reference(REPAIR_REFERENCE);
    await openRepairTabOnReference(ref.page, 'Смета', 'h-est');
    await openRepair(app, page, { obj: OBJ.kv42, tab: 'estimate', persona: 'owner' });
    await area(page).getByRole('group', { name: 'Версии сметы' }).waitFor();
    await page.waitForLoadState('networkidle');
    await shoot(frame, page, ref.page, testInfo);
  });
}
