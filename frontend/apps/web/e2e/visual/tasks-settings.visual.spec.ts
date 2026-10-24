// W4.13 · Сверка вкладок проекта `tasks-people`, `tasks-workflow`, `tasks-automation` со снимком design-2026-10-19
// (verification-protocol.md §3): «Ортус CRM.dc.html» → «Задачи» (модуль «Задачи и проекты.dc.html» внутри оболочки) →
// проект LOG «Логистика · Север» → вкладка; владелец «Альты», часы харнесса 01.10.2026. Шапка и меню закрыты маской —
// их сверяет ключ `shell`. Расхождения — allowlist/tasks-people.md, tasks-workflow.md, tasks-automation.md.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { tenantId } from '../shell.helpers.ts';
import { projectId } from '../tasks-settings.helpers.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

type View = 'people' | 'workflow' | 'automation';
const TAB: Record<View, string> = {
  people: 'Участники',
  workflow: 'Процесс',
  automation: 'Автоматизация',
};
const CHROME = ['header', 'nav'];

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

/** Карточка проекта: шапка, вкладки и содержимое вкладки (эталон — div с рамкой вокруг tablist). */
const card = (page: Page): Locator =>
  page.locator('div:has(> [role="tablist"][aria-label="Разделы проекта"])').first();

/** Эталон: «Задачи» в меню (боковая панель или «Ещё» на телефоне) → строка проекта LOG → вкладка. */
async function openOnReference(page: Page, view: View): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator('button[title="Задачи"], button:has-text("Задачи")').first().click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Задачи' }).click();
  }
  await page
    .getByRole('button', { name: /Логистика · Север/ })
    .first()
    .click();
  await page.getByRole('tab', { name: TAB[view] }).click();
  await page.waitForLoadState('networkidle');
}

/** Одно состояние на обеих сторонах: в «Процессе» — выбран переход «Согласовать» (панель перехода). */
async function act(p: Page, view: View): Promise<void> {
  if (view !== 'workflow') return;
  await card(p)
    .getByRole('button', { name: /^Согласовать/ })
    .first()
    .click();
  await card(p).getByRole('heading', { level: 3, name: 'Переход «Согласовать»' }).waitFor();
}

/**
 * Телефон (< 640 px): те же поправки целей нажатия, что у реализации (PD-28, allowlist) — поля, списки и метки
 * флажков 44 px, зазор рядов: строки добавления 10 px, чипы статусов и «Кто может» 14 px.
 */
async function phoneTweaks(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) >= 640) return;
  await card(page).evaluate((root) => {
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>('select, input:not([type="checkbox"])'),
    )) {
      el.style.minHeight = '44px';
    }
    // Возврат 1: метки флажков («Переход выполняется согласованием», «Проверки и действия», «Включено») — 44 px.
    for (const l of Array.from(root.querySelectorAll<HTMLElement>('label'))) {
      if (l.querySelector(':scope > input[type="checkbox"]')) l.style.minHeight = '44px';
    }
    const gap = (el: Element | null | undefined, px: number) => {
      if (el instanceof HTMLElement) el.style.rowGap = `${String(px)}px`;
    };
    const main = root.querySelector('select[aria-label="Сотрудник"]');
    if (main && !main.closest('aside')) gap(main.parentElement, 10);
    gap(root.querySelector('input[aria-label="Название статуса"]')?.parentElement, 10);
    gap(root.querySelector('input[aria-label="Название перехода"]')?.parentElement, 10);
    for (const h of Array.from(root.querySelectorAll('h3'))) {
      if (h.textContent?.trim() === 'Статусы') gap(h.nextElementSibling, 14);
    }
    for (const s of Array.from(root.querySelectorAll('span'))) {
      if (s.textContent?.trim() === 'Кто может') gap(s.nextElementSibling, 14);
    }
  });
}

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: Reference,
  view: View,
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page, view);
  await act(ref.page, view);
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  const log = await projectId(page, alta, 'LOG');
  await app(`/t/${alta}/tasks?project=${log}&view=${view}`, { persona: 'owner' });
  await page.locator('.ox-tset').waitFor();
  await page.locator('.ox-tset-skel').waitFor({ state: 'detached' });
  await act(page, view);
  // Возврат 2: вкладка «Список» хоста W4.12 — no-reference (Q-W4.12-1, allowlist), на сверке скрывается, как в
  // tasks.visual.spec.ts W4.12.
  await card(page).evaluate((root) => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      if (el.textContent === 'Список') el.style.display = 'none';
    }
  });
  await phoneTweaks(ref.page);
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
  mask: string[] = [],
) {
  // Выбор перехода прокручивает страницу — снимки обеих сторон с начала страницы.
  for (const p of [page, ref.page]) {
    await p.evaluate(() => {
      for (const el of [
        document.scrollingElement,
        ...Array.from(document.querySelectorAll('main, #ox-main')),
      ]) {
        if (el) el.scrollTop = 0;
      }
    });
  }
  const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
  return compareShots(
    { target: impl, mask: [...CHROME, ...mask].map((s) => page.locator(s)) },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: [...CHROME, ...mask].map((s) => ref.page.locator(s)),
    },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

for (const view of ['people', 'workflow', 'automation'] as const) {
  const key = `tasks-${view}`;

  test(`${key}: вкладка «${TAB[view]}» в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, view);
    const r = await pixels(page, ref, key, testInfo);
    console.log(`visual ${key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });

  test(`${key}: подписи совпадают с эталоном @mock`, async ({ app, page, reference, harness }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, view);
    const expected = await labelsOf([card(ref.page)], key);
    const actual = await labelsOf([card(page)], key);
    expect(actual).toEqual(expected);
  });
}
