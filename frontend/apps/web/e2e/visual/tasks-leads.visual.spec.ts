// W4.13 · Сверка старой доски `tasks-leads` «Заявки» со снимком design-2026-10-19 (verification-protocol.md §3):
// «Ортус CRM.dc.html» → «Задачи» → строка «Заявки · Ремонт» (старая доска :1600–1705), владелец «Альты», часы харнесса
// 01.10.2026; у реализации — `/t/:tenantId/leads`. Шапка и меню закрыты маской. Расхождения — allowlist/tasks-leads.md.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { tenantId } from '../shell.helpers.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-tasks"]');

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

async function openOnReference(page: Page): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator('button[title="Задачи"], button:has-text("Задачи")').first().click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Задачи' }).click();
  }
  await page
    .getByRole('button', { name: /Заявки · Ремонт/ })
    .first()
    .click();
  await section(page).getByRole('heading', { level: 1, name: 'Заявки' }).waitFor();
  await page.waitForLoadState('networkidle');
}

/** Одно действие на обеих сторонах: открыть карточку L-31. */
async function act(p: Page, open: boolean): Promise<void> {
  if (!open) return;
  await section(p)
    .getByRole('button', { name: /Квартира 64 м², Химки/ })
    .first()
    .click();
  await section(p).getByRole('heading', { level: 2, name: 'Квартира 64 м², Химки' }).waitFor();
}

/**
 * Данных эталона, которых нет в контракте (клиент · источник · сумма заявки, «☑ n/m» карточки — allowlist
 * tasks-leads.md), на эталоне перед снимком убираются; на телефоне — те же цели нажатия, что у реализации.
 */
async function align(ref: Page): Promise<void> {
  const phone = (ref.viewportSize()?.width ?? 1440) < 640;
  await section(ref).evaluate((root, isPhone) => {
    for (const card of Array.from(root.querySelectorAll('button[aria-pressed]'))) {
      for (const s of Array.from(card.querySelectorAll(':scope > span'))) {
        const t = s.textContent ?? '';
        if (/ · (Сайт|Рекомендация|Авито)/.test(t)) s.remove();
      }
      for (const s of Array.from(card.querySelectorAll('span span'))) {
        if ((s.textContent ?? '').startsWith('☑')) s.remove();
      }
    }
    if (!isPhone) return;
    const who = root.querySelector<HTMLElement>('select[aria-label="Исполнитель"]');
    if (who) who.style.minHeight = '44px';
    for (const b of Array.from(
      root.querySelectorAll<HTMLElement>('[role="group"][aria-label="Вид"] > button'),
    )) {
      b.style.minHeight = '44px';
    }
    // Возврат 3: строка чек-листа карточки (CRM:1684, min-height 40px) — 44 px, как у реализации (PD-28).
    for (const l of Array.from(root.querySelectorAll<HTMLElement>('label'))) {
      if (l.querySelector('input[type="checkbox"]')) l.style.minHeight = '44px';
    }
  }, phone);
}

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: Reference,
  open = false,
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page);
  await act(ref.page, open);
  await align(ref.page);
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await app(`/t/${alta}/leads`, { persona: 'owner' });
  await section(page).locator('.ox-leads-card').first().waitFor();
  await act(page, open);
  await page.waitForLoadState('networkidle');
  for (const p of [page, ref.page]) {
    await p.evaluate(() => document.fonts.ready.then(() => undefined));
    await p.evaluate(() => {
      for (const el of [
        document.scrollingElement,
        ...Array.from(document.querySelectorAll('main, #ox-main')),
      ]) {
        if (el) el.scrollTop = 0;
      }
    });
  }
  return ref;
}

async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  key: string,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  return compareShots(
    {
      target: { kind: 'app', page, root: page.locator('#app'), url: page.url() },
      mask: CHROME.map((s) => page.locator(s)),
    },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: CHROME.map((s) => ref.page.locator(s)),
    },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

test('tasks-leads: доска «Заявки» в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.setTimeout(120_000);
  const ref = await openBoth(app, page, reference);
  const r = await pixels(page, ref, 'tasks-leads', testInfo);
  console.log(`visual tasks-leads ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('tasks-leads: карточка заявки L-31 в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.setTimeout(120_000);
  const ref = await openBoth(app, page, reference, true);
  const r = await pixels(page, ref, 'tasks-leads-card', testInfo);
  console.log(`visual tasks-leads-card ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('tasks-leads: подписи совпадают с эталоном — доска и карточка @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.setTimeout(120_000);
  const ref = await openBoth(app, page, reference, true);
  const expected = await labelsOf([section(ref.page)], 'tasks-leads');
  const actual = await labelsOf([section(page)], 'tasks-leads');
  expect(actual).toEqual(expected);
  expect(actual).toContain('h1:Заявки');
});
