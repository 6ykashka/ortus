// W4.41 · Сверка `core-calendar` «Календарь» со снимком design-2026-10-19 (verification-protocol.md §3): владелец
// «Альты» (у реализации — пресет logistics-ready: машины и рейс видит тот, у кого подключена «Логистика»), день
// 01.10.2026 по часам харнесса. Расхождения — allowlist/core-calendar.md:
//   • строка даты закрыта маской на обеих сторонах (эталон пишет «Среда» строкой, 01.10.2026 — четверг; Q-61);
//   • строки ресурсов эталона переставляются в порядок сервера (вид, затем имя — контракт W4.06; Q-W4.41-1);
//   • навигация по датам реализации (no-reference, Q-W4.06-4) скрывается перед снимком и подписями;
//   • на телефоне зазор рядов фильтра — 8 px вместо 6 (цели нажатия 44 px, PD-28) — тот же зазор ставится эталону.
// Шапка и меню закрыты маской — их сверяет ключ `shell`.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
const H1 = 'Календарь ресурсов';
const MASSAGE = 'Классический массаж · Мария К., 10:00–11:00';
const DATE_LINE =
  'section[aria-labelledby="h-cal"] > div:first-child > div:first-child > div:first-child';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-cal"]');

/** Эталон: пункт меню «Календарь» — боковая панель или рейл, на телефоне — «Ещё» → «Все разделы». */
async function openOnReference(page: Page): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator('button[title="Календарь"], button:has-text("Календарь")').first().click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Календарь' }).click();
  }
  await page.getByRole('heading', { level: 1, name: H1 }).waitFor();
  await page.waitForLoadState('networkidle');
}

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

/** Одно действие на обеих сторонах: выбрать бронь визита и (по желанию) попробовать перенос на 11:00. */
async function act(p: Page, o: { select?: boolean; conflict?: boolean }): Promise<void> {
  if (!o.select) return;
  await section(p).getByRole('button', { name: MASSAGE, exact: true }).first().click();
  await section(p)
    .getByRole('heading', { level: 2, name: 'Классический массаж · Мария К.' })
    .waitFor();
  if (!o.conflict) return;
  await section(p).getByLabel('Перенести начало на').selectOption({ label: '11:00' });
  await section(p).getByRole('button', { name: 'Проверить и перенести' }).click();
  await section(p).getByRole('alert').getByRole('button', { name: '08:30' }).waitFor();
}

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: Reference,
  o: { select?: boolean; conflict?: boolean } = {},
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page);
  await act(ref.page, o);
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app(`/t/${alta}/calendar`, { persona: 'owner' });
  await section(page).getByRole('button', { name: 'Плановое ТО, 08:00–20:00' }).waitFor();
  await act(page, o);
  // Навигация по датам — no-reference (Q-W4.06-4): ни пикселей, ни подписей.
  await section(page)
    .getByRole('group', { name: 'Период' })
    .evaluate((el) => ((el as HTMLElement).style.display = 'none'));
  const order = await section(page).locator('.ox-cal-name').allTextContents();
  const phone = (page.viewportSize()?.width ?? 1440) < 640;
  await section(ref.page).evaluate(
    (el, v) => {
      // Строки эталона — в порядок сервера (вид, затем имя; контракт W4.06, Q-W4.41-1).
      const grid = el.querySelector('[style*="min-width: 640px"]');
      if (!grid) throw new Error('нет сетки календаря эталона');
      const rows = Array.from(grid.children).slice(1);
      const name = (r: Element) =>
        r.querySelector('span[style*="font-weight: 500"]')?.textContent?.trim() ?? '';
      for (const n of v.order) {
        const row = rows.find((r) => name(r) === n);
        if (row) grid.appendChild(row);
      }
      // Брони в строке — в порядке начала, как список сервера (эталон — порядок сида; Q-W4.41-1): на пиксели не
      // влияет (блоки не перекрываются), порядок подписей и обхода Tab — по времени.
      for (const track of Array.from(el.querySelectorAll('div[style*="height: 52px"]'))) {
        const kids = Array.from(track.children);
        const pairs: Element[][] = [];
        for (let i = 0; i + 1 < kids.length; i += 2)
          pairs.push([kids[i], kids[i + 1]] as Element[]);
        const left = (p: Element[]) => parseFloat((p[1] as HTMLElement).style.left);
        pairs.sort((a, b) => left(a) - left(b));
        for (const p of pairs) for (const k of p) track.appendChild(k);
      }
      if (v.phone) {
        const group = el.querySelector<HTMLElement>('[role="group"][aria-label="Тип ресурса"]');
        if (group) group.style.rowGap = '8px';
      }
    },
    { order, phone },
  );
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  key: string,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
  return compareShots(
    { target: impl, mask: [...CHROME, DATE_LINE].map((s) => page.locator(s)) },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: [...CHROME, DATE_LINE].map((s) => ref.page.locator(s)),
    },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

test('core-calendar: день владельца в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.setTimeout(90_000);
  const ref = await openBoth(app, page, reference);
  const r = await pixels(page, ref, 'core-calendar', testInfo);
  console.log(`visual core-calendar ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('core-calendar: панель визита и конфликт 11:00 со слотами в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.setTimeout(90_000);
  const ref = await openBoth(app, page, reference, { select: true, conflict: true });
  const r = await pixels(page, ref, 'core-calendar-conflict', testInfo);
  console.log(
    `visual core-calendar-conflict ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('core-calendar: стили фильтра, сетки, брони, панели и конфликта как у эталона @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'сверка стилей — режим mock');
  test.setTimeout(90_000);
  const ref = await openBoth(app, page, reference, { select: true, conflict: true });
  /** Элемент секции: селектор и (необязательно) точный текст; первый по порядку документа. */
  type Find = { sel: string; text?: string };
  const pairs: [string, Find, Find?][] = [
    ['фильтр', { sel: 'button', text: 'Машины' }],
    ['выбранный фильтр', { sel: 'button', text: 'Все ресурсы' }],
    ['подпись «Ресурс»', { sel: 'span', text: 'Ресурс' }],
    ['час', { sel: 'span', text: '10:00' }],
    ['имя ресурса', { sel: 'span', text: 'Кабинет № 2' }],
    ['полоса', { sel: '.ox-cal-track' }, { sel: 'div[style*="height: 52px"]' }],
    ['бронь', { sel: '[aria-label="Плановое ТО, 08:00–20:00"]' }],
    ['выбранная бронь', { sel: `[aria-label="${MASSAGE}"]` }],
    [
      'буфер',
      { sel: '.ox-cal-buf' },
      { sel: 'span[aria-hidden="true"][style*="position: absolute"]' },
    ],
    ['легенда', { sel: 'span', text: 'подготовка и уборка — ресурс занят' }],
    ['заголовок брони', { sel: 'h2' }],
    [
      'мета',
      { sel: 'span', text: '10:00–11:00 · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2' },
    ],
    ['кнопка источника', { sel: 'button', text: 'open_in_newОткрыть визит' }],
    ['подпись поля', { sel: 'label' }],
    ['выбор времени', { sel: 'select' }],
    ['«Проверить и перенести»', { sel: 'button', text: 'Проверить и перенести' }],
    ['конфликт', { sel: '[role="alert"]' }],
    ['слот', { sel: 'button', text: '08:15' }],
  ];
  const styles = (root: Locator, f: Find) =>
    root.evaluate((el, q) => {
      const node = Array.from(el.querySelectorAll<HTMLElement>(q.sel)).find(
        (n) => q.text === undefined || n.textContent?.trim() === q.text,
      );
      if (!node) return null;
      const s = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return {
        height: Math.round(r.height),
        padding: s.padding,
        gap: s.gap,
        font: s.font,
        color: s.color,
        background: s.backgroundColor,
        image: s.backgroundImage,
        border: s.borderTop,
        radius: s.borderRadius,
        minHeight: s.minHeight,
        align: s.textAlign,
        letterSpacing: s.letterSpacing,
      };
    }, f);
  for (const [what, impl, refFind] of pairs) {
    const a = await styles(section(page), impl);
    const b = await styles(section(ref.page), refFind ?? impl);
    expect(a, `${what}: нет в реализации`).not.toBeNull();
    expect(a, what).toEqual(b);
  }
});

test('core-calendar: подписи совпадают с эталоном — день и панель с конфликтом @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.setTimeout(90_000);
  const ref = await openBoth(app, page, reference, { select: true, conflict: true });
  const expected = await labelsOf([section(ref.page)], 'core-calendar');
  const actual = await labelsOf([section(page)], 'core-calendar');
  expect(actual).toEqual(expected);
  expect(actual).toContain('h1:Календарь ресурсов');
  expect(actual).toContain('aria:Тип ресурса');
  expect(actual).toContain(`aria:${MASSAGE}`);
  expect(actual).toContain('button:Проверить и перенести');
});
