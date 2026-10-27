// W6.23 · Возврат 1: структурная сверка `repair-schedule` «График» со снимком design-2026-10-19 (verification-protocol.md §3
// п. 4): подписи раздела `h-gantt` (кнопки, заголовки, label, aria-label) в порядке документа, с allowlist/repair-schedule.md.
// Эталон — владелец подключает «Ремонт и стройку» → «Объекты» → «ЖК Речной · квартира 42» → «График»; реализация —
// пресет repairs-ready, «сегодня» 20.10.2026. Нормализация (описана в allowlist):
//   • заголовок страницы реализации — h1, вкладки эталона — h2 (страница-маршрут до встраивания вкладки W6.20);
//   • «+N дн» у этапов, значки снабжения и их строки — данные, которых нет в контракте (Q-W6.23-1, Q-W6.23-2);
//   • чип идущего этапа «Принято 53%, на приёмке 8%» — у реализации «В работе» (в API нет принятой доли, Q-W6.23-2).
import { writeFileSync } from 'node:fs';

import { expect, test } from '../fixtures/index.ts';
import { openGanttOnApp, openGanttOnReference, section } from './repair-schedule.compare.ts';
import { labelsOf } from './shell.compare.ts';

const KEY = 'repair-schedule';

/** Эталон: убирает данные, которых нет у реализации (см. allowlist `state`-записи). */
function normalizeReference(labels: string[]): string[] {
  return labels
    .filter((l) => !/не закуплено/.test(l))
    .map((l) =>
      l
        .replace(/(person_off|inventory_2)/g, '')
        .replace(/ \+\d+ дн$/, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/(button:[^ ]+(?: [^ ]+)*?) ?(?=\d\d\.\d\d)/, '$1 '),
    );
}

function normalizeImpl(labels: string[]): string[] {
  return labels.map((l) =>
    (l === 'h1:График работ' ? 'h2:График работ' : l).replace(
      /В работе(?=Критический)/,
      'Принято 53%, на приёмке 8%',
    ),
  );
}

test('repair-schedule: подписи «Графика» совпадают с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openGanttOnReference(ref.page);
  await openGanttOnApp(app, page);
  const expected = normalizeReference(await labelsOf([section(ref.page)], KEY));
  const actual = normalizeImpl(await labelsOf([section(page)], KEY));
  const dump = process.env.W623_DUMP;
  if (dump) {
    writeFileSync(`${dump}/labels-ref-${testInfo.project.name}.txt`, expected.join('\n'));
    writeFileSync(`${dump}/labels-impl-${testInfo.project.name}.txt`, actual.join('\n'));
  }
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(20);
});

const ASIDE = 'aside[aria-label="Сводка графика и этап"]';

test('repair-schedule: панель этапа «Штукатурка стен» совпадает с эталоном @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openGanttOnReference(ref.page);
  await openGanttOnApp(app, page);
  for (const p of [ref.page, page]) {
    if ((p.viewportSize()?.width ?? 1440) < 640) {
      await section(p).getByRole('button', { name: 'Диаграмма' }).click();
    }
    await section(p)
      .getByRole('button', { name: /^Штукатурка стен/ })
      .first()
      .click();
    await section(p).getByRole('heading', { level: 3, name: 'Штукатурка стен' }).waitFor();
  }
  // Подпись поля «Исполнитель» эталона содержит варианты списка (участники организации) — данные, не подпись.
  const expected = (await labelsOf([ref.page.locator(ASIDE)], KEY)).map((l) =>
    l.replace(/^(label:Исполнитель).+/, '$1'),
  );
  const actual = await labelsOf([page.locator(ASIDE)], KEY);
  const dump = process.env.W623_DUMP;
  if (dump) {
    writeFileSync(`${dump}/panel-ref-${testInfo.project.name}.txt`, expected.join('\n'));
    writeFileSync(`${dump}/panel-impl-${testInfo.project.name}.txt`, actual.join('\n'));
  }
  expect(actual).toEqual(expected);
});
