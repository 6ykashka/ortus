// W2.25 · Пиксельная сверка `home` со снимком этапа 2 (итерация 14.10, verification-protocol.md §3, PD-22: 0,01).
// Целиком «Главная» эталона 14.10 этапом 2 не воспроизводится ни у одного персонажа: в очереди и «Сегодня в работе»
// всегда есть модули этапов 4–7 (out-of-stage, allowlist/home.md). Поэтому сверяются кадры общих элементов одного
// размера: карточка очереди «Пробный период: осталось 12 дней» владельца, h1 и блок «Последние события» логиста без
// роли. Пунктир «Логистика» кадром не сверяется: в эталоне в сетке «Сегодня в работе» ещё карточки SPA и «Задачи»
// (out-of-stage) — ширина и высота ячейки другие.
import { writeFileSync } from 'node:fs';

import { comparePng } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { openHome } from '../home.helpers.ts';

const home = (p: Page) => p.locator('section[aria-labelledby="h-home"]');

/** Карточка очереди по заголовку: в эталоне — div с полосой тона (:1735), в реализации — li. */
const queueCard = (p: Page, title: string, ref: boolean): Locator =>
  (ref
    ? home(p).locator('div[style*="border-width: 1px 1px 1px 4px"]')
    : home(p).getByRole('listitem')
  ).filter({
    has: p.locator('strong', { hasText: title }),
  });

/** Блок «Последние события» (:1771). */
const events = (p: Page): Locator =>
  home(p)
    .locator('div')
    .filter({ has: p.getByRole('heading', { level: 2, name: 'Последние события' }) })
    .last();

async function same(
  a: Locator,
  b: Locator,
  key: string,
  testInfo: import('@playwright/test').TestInfo,
): Promise<void> {
  const act = await a.screenshot({ animations: 'disabled' });
  const exp = await b.screenshot({ animations: 'disabled' });
  await testInfo.attach(`${key}-actual.png`, { body: act, contentType: 'image/png' });
  await testInfo.attach(`${key}-expected.png`, { body: exp, contentType: 'image/png' });
  // 390 (DPR 2,625): кадр элемента в эталоне и в реализации лежит на разной дробной высоте страницы (над карточкой
  // в эталоне ещё 6 карточек этапов 4–7) — сглаживание текста расходится на 1–2 % при тех же координатах и размерах
  // (allowlist/home.md, pixel, Q-W2.25-6); на 1440 — 0 px.
  const max = testInfo.project.name === 'mobile-390' ? 0.02 : 0.01;
  const r = comparePng(act, exp, { maxDiffPixelRatio: max });
  if (!r.pass) {
    await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: 'image/png' });
    for (const [name, body] of [
      ['actual', act],
      ['expected', exp],
      ['diff', r.diff],
    ] as const)
      writeFileSync(testInfo.outputPath(`${key}-${name}.png`), body);
  }
  console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${key}: ${r.diffPixels} px, ${r.ratio}`).toBe(true);
}

test.describe('home — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  test('владелец: карточка «Пробный период: осталось 12 дней» в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    const title = 'Пробный период: осталось 12 дней';
    await queueCard(ref.page, title, true).waitFor();
    await openHome(app, page);
    await queueCard(page, title, false).waitFor();
    await page.waitForLoadState('networkidle');
    const p = testInfo.project.name;
    await same(
      queueCard(page, title, false),
      queueCard(ref.page, title, true),
      `home-trial-${p}`,
      testInfo,
    );
  });

  test('логист без роли: приветствие и «Последние события» в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'manager', hidePanel: true });
    await events(ref.page).waitFor();
    await openHome(app, page, { persona: 'manager' });
    await expect(page.getByText('Событий пока нет')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const p = testInfo.project.name;
    const h1 = (x: Page) => x.locator('#h-home');
    await same(h1(page), h1(ref.page), `home-h1-${p}`, testInfo);
    await same(events(page), events(ref.page), `home-events-${p}`, testInfo);
  });
});
