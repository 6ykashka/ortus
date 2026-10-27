// W6.23 · Возврат 1: визуальная сверка `repair-schedule` «График» со снимком design-2026-10-19
// (verification-protocol.md §3, порог 0,01). Кадры: основная колонка (заголовок, чипы, переключатели, диаграмма с
// легендой на 1440 / «Ближайшие 3 недели» на 390) и карточка «Сдача объекта» правой панели. Шапку и меню сверяет ключ
// `shell`. Эталон — владелец подключает «Ремонт и стройку», открывает «ЖК Речной · квартира 42» → «График»;
// реализация — пресет repairs-ready, «сегодня» 20.10.2026. Расхождения — allowlist/repair-schedule.md:
//   • ширина раздела реализации ставится равной ширине вкладки эталона, заголовок — уровня вкладки (h2);
//   • «Новый базовый план» (no-reference, Q-W6.23-7) скрыт;
//   • отклонения «+N дн», деление «принято / на приёмке» и значки снабжения эталона — данные, которых нет в контракте
//     (Q-W6.23-1, Q-W6.23-2); на сверке скрываются (visibility) на обеих сторонах;
//   • карточка «Сдача объекта» снимается до абзаца «Последний перенос…» (причина со свободным текстом, Q-W6.23-9).
import { writeFileSync } from 'node:fs';

import type { TestInfo } from '@playwright/test';
import { comparePng } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import {
  alignBoth,
  hideDataOnly,
  openGanttOnApp,
  openGanttOnReference,
  shootMain,
  shootSummary,
} from './repair-schedule.compare.ts';

async function report(
  testInfo: TestInfo,
  key: string,
  actual: Buffer,
  expected: Buffer,
): Promise<{ pass: boolean; ratio: number; diffPixels: number }> {
  await testInfo.attach(`${key}-expected.png`, { body: expected, contentType: 'image/png' });
  await testInfo.attach(`${key}-actual.png`, { body: actual, contentType: 'image/png' });
  const dump = process.env.W623_DUMP;
  if (dump) {
    writeFileSync(`${dump}/${key}-expected.png`, expected);
    writeFileSync(`${dump}/${key}-actual.png`, actual);
  }
  let r;
  try {
    r = comparePng(actual, expected, { maxDiffPixelRatio: 0.01 });
  } catch (e) {
    // Размеры кадров разные — сверка не проходит; причина в сообщении.
    console.log(`visual repair-schedule ${key}: ${String(e)}`);
    return { pass: false, ratio: 1, diffPixels: -1 };
  }
  if (!r.pass) await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: 'image/png' });
  if (dump && !r.pass) writeFileSync(`${dump}/${key}-diff.png`, r.diff);
  console.log(`visual repair-schedule ${key}: ${r.diffPixels} px, ${r.ratio}`);
  return { pass: r.pass, ratio: r.ratio, diffPixels: r.diffPixels };
}

test('repair-schedule: основная колонка «Графика» и карточка «Сдача объекта» в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openGanttOnReference(ref.page);
  await openGanttOnApp(app, page);
  await alignBoth(page, ref.page);
  for (const p of [page, ref.page]) await hideDataOnly(p);
  const name = testInfo.project.name;
  const main = await report(
    testInfo,
    `repair-schedule-main-${name}`,
    await shootMain(page),
    await shootMain(ref.page),
  );
  const summary = await report(
    testInfo,
    `repair-schedule-summary-${name}`,
    await shootSummary(page),
    await shootSummary(ref.page),
  );
  expect(main.pass, `основная колонка: ${main.diffPixels} px, ${main.ratio}`).toBe(true);
  expect(summary.pass, `сводка: ${summary.diffPixels} px, ${summary.ratio}`).toBe(true);
});
