// W2.26 · Сверка `core-data` «Данные» со снимком эталона (verification-protocol.md §3): владелец «Альты», набор
// «Поездки» по умолчанию. W4.80: наборы этапа 4 «Ответы на осмотр» и «Задачи» (dataVM :4189) есть и в реализации;
// наборы «Кассы» (этап 5) — out-of-stage (allowlist/core-data.md), перед снимком они снимаются с эталона. Шапка и меню
// закрыты маской — их сверяет ключ `shell`.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
/**
 * Наборы эталона будущих этапов (out-of-stage). W4.50: снимок design-2026-10-19 добавил наборы «Кассы» (этап 5) —
 * «Кассовые операции», «Смены кассы». W4.80: «Ответы на осмотр» и «Задачи» — наборы этапа 4, сверяются.
 */
const LATER = ['Кассовые операции', 'Смены кассы'];

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-data"]');

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: (
    file?: string,
    o?: { persona?: 'owner'; hidePanel?: boolean },
  ) => Promise<{ page: Page; root: Locator }>,
  o: { dropLater?: boolean } = {},
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page, 'Данные');
  if (o.dropLater) {
    await section(ref.page).evaluate((el, later) => {
      for (const t of Array.from(el.querySelectorAll('[role="tab"]'))) {
        if (later.some((l) => t.textContent?.includes(l))) t.remove();
      }
    }, LATER);
  }
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app(`/t/${alta}/data`, { persona: 'owner' });
  await section(page).locator('tbody tr').nth(1).waitFor();
  await expect(section(page).getByRole('tab', { name: /Расходы/ })).toHaveText(/0$/);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

test('core-data: «Данные» владельца в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  const ref = await openBoth(app, page, reference, { dropLater: true });
  const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: CHROME.map((s) => ref.page.locator(s)),
    },
    `core-data-${testInfo.project.name}`,
    testInfo,
  );
  console.log(`visual core-data ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('core-data: стили вкладки, поля, кнопки, заголовка колонки и ячейки как у эталона @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'сверка стилей — режим mock');
  const ref = await openBoth(app, page, reference);
  const style = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      height: Math.round(r.height),
      padding: s.padding,
      gap: s.gap,
      font: s.font,
      color: s.color,
      background: s.backgroundColor,
      border: s.borderTop,
      borderBottom: s.borderBottom,
      radius: s.borderRadius,
      minHeight: s.minHeight,
    };
  };
  const pairs: [string, (p: Page) => Locator][] = [
    ['вкладка', (p) => section(p).getByRole('tab', { name: /Автомобили/ })],
    ['выбранная вкладка', (p) => section(p).locator('[role="tab"][aria-selected="true"]')],
    ['фильтр', (p) => section(p).getByLabel('Фильтр')],
    ['вид', (p) => section(p).getByLabel('Вид')],
    ['«Выгрузить»', (p) => section(p).getByRole('button', { name: 'Выгрузить' })],
    ['заголовок колонки', (p) => section(p).locator('thead th').first()],
    ['ячейка', (p) => section(p).locator('tbody td').first()],
    ['подвал', (p) => section(p).locator(':scope > div').last()],
  ];
  for (const [what, at] of pairs) {
    expect(await at(page).evaluate(style), what).toEqual(await at(ref.page).evaluate(style));
  }
});

test('core-data: подписи совпадают с эталоном @mock', async ({ app, page, reference, harness }) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  const ref = await openBoth(app, page, reference);
  const expected = await labelsOf([section(ref.page)], 'core-data');
  const actual = await labelsOf([section(page)], 'core-data');
  expect(actual).toEqual(expected);
  expect(actual).toContain('h1:Данные');
  expect(actual).toContain('tab:Поездки2');
});
