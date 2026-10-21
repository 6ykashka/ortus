// W4.12 · Сверка «Задач и проектов» со снимком design-2026-10-19 (verification-protocol.md §3): владелец «Альты» на
// пяти экранах — `tasks-projects` (список), `tasks-project-new` (панель «Новый проект»), `tasks-board` (доска LOG),
// `tasks-card` (карточка T-65, 1440), `modal-new-task` (диалог «Новая задача»). Эталон — модуль «Задачи и проекты»,
// подключённый в «Ортус CRM.dc.html» (dc-import на pg.tasks), часы харнесса 01.10.2026 10:30. Снимок — область модуля
// (шапку и меню сверяет ключ `shell`). Расхождения — allowlist/<ключ>.md:
//   • строка «ДОК · Документы · маршруты» эталона (сид документов, этап 7) убирается перед снимком;
//   • вкладка «Список» и поле комментария в «Истории» реализации (no-reference) скрываются;
//   • «Закрытый» — подпись TP-03 «Только участники проекта» ставится эталону (Q-W4.00-tasks-2);
//   • на телефоне поля ввода реализации — 44 px (цели нажатия, PD-28): то же ставится эталону.
import type { Locator, Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const LOG = 'Логистика · Север';
const T65 = 'Заменить шины на ГАЗон Next (зимние)';
const CLOSED_TP03 = 'Только участники проекта';

type Step = 'list' | 'wizard' | 'board' | 'card' | 'modal';

/** Корень модуля: эталон — dc-import «Задачи и проекты», реализация — страница `.ox-tasks`. */
const refRoot = (p: Page): Locator => p.locator('.sc-host[data-sc-name="Задачи и проекты"]');
const appRoot = (p: Page): Locator => p.locator('.ox-tasks');
const phone = (p: Page): boolean => (p.viewportSize()?.width ?? 1440) < 640;

/** Эталон: пункт меню «Задачи» — боковая панель или рейл, на телефоне — «Ещё» → «Все разделы». */
async function openOnReference(page: Page): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side.locator('button[title="Задачи"], button:has-text("Задачи")').first().click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Задачи' }).click();
  }
  await refRoot(page).getByRole('heading', { level: 2, name: 'Проекты' }).waitFor();
  await page.waitForLoadState('networkidle');
}

/** Шаги экрана на одной стороне (подписи и роли одинаковы на обеих). */
async function act(p: Page, root: Locator, step: Step): Promise<void> {
  if (step === 'wizard') {
    await root.getByRole('button', { name: 'Новый проект' }).click();
    await root.getByRole('heading', { level: 3, name: 'Новый проект' }).waitFor();
    return;
  }
  if (step === 'list') return;
  await root
    .getByRole('button', { name: new RegExp(LOG) })
    .first()
    .click();
  await root.getByRole('tab', { name: 'Доска' }).waitFor();
  await root
    .getByRole('button', { name: new RegExp(T65.replace(/[()]/g, '.')) })
    .first()
    .waitFor();
  if (step === 'card') {
    await root
      .getByRole('button', { name: new RegExp(T65.replace(/[()]/g, '.')) })
      .first()
      .click();
    await root.getByRole('heading', { level: 3, name: T65 }).waitFor();
    await root.getByText('Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.').waitFor();
  }
  if (step === 'modal') {
    await root.getByRole('button', { name: 'Задача', exact: true }).click();
    await p.getByRole('dialog', { name: 'Новая задача' }).waitFor();
    await p
      .getByRole('dialog', { name: 'Новая задача' })
      .getByText('Новая', { exact: true })
      .first()
      .waitFor();
  }
}

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: Reference,
  step: Step,
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page);
  await act(ref.page, refRoot(ref.page), step);
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await app(`/t/${alta}/tasks`, { persona: 'owner' });
  await appRoot(page).locator('.ox-tk-prow').first().waitFor();
  await act(page, appRoot(page), step);
  // Реализация: вкладка «Список», поле комментария «Истории» и «К доске» — no-reference (Q-W4.00-tasks-11, -14).
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.ox-tk-tab'))) {
      if (el.textContent === 'Список') el.style.display = 'none';
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.ox-tk-note-row'))) {
      el.style.display = 'none';
    }
  });
  const narrow = phone(page);
  await ref.page.evaluate(
    (v) => {
      const host = document.querySelector('.sc-host[data-sc-name="Задачи и проекты"]');
      if (!host) throw new Error('нет модуля «Задачи и проекты» на эталоне');
      // Строка проекта документов (сид documents.js, этап 7) — out-of-stage.
      for (const b of Array.from(host.querySelectorAll('button, option'))) {
        if (b.textContent?.includes('Документы · маршруты')) b.remove();
      }
      // «Закрытый» по TP-03 (Q-W4.00-tasks-2).
      for (const s of Array.from(host.querySelectorAll('span'))) {
        if (s.textContent === 'Только участники проекта и владелец бизнеса')
          s.textContent = v.closed;
      }
      if (v.narrow) {
        const style = document.createElement('style');
        style.textContent =
          'input:not([type=checkbox]):not([type=file]), select { min-height: 44px !important; }';
        document.head.appendChild(style);
      }
    },
    { closed: CLOSED_TP03, narrow },
  );
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

/**
 * Пиксели области модуля: у эталона — корень dc-import «Задачи и проекты», у реализации — `.ox-tasks`; диалог —
 * окно «Новая задача» на обеих сторонах. Оболочка (шапка, меню — её высота на телефоне различается) в снимок не
 * входит: её сверяет ключ `shell`.
 */
async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  step: Step,
  key: string,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  const modal = step === 'modal';
  const implRoot = modal ? page.locator('.ox-tk-nf') : appRoot(page);
  const refRootOf = modal
    ? ref.page.getByRole('dialog', { name: 'Новая задача' }).locator('> div')
    : refRoot(ref.page);
  return compareShots(
    { target: { kind: 'app', page, root: implRoot, url: page.url() } },
    { target: { kind: 'reference', page: ref.page, root: refRootOf, url: ref.page.url() } },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

const CASES: { step: Step; key: string; desktopOnly?: boolean }[] = [
  { step: 'list', key: 'tasks-projects' },
  { step: 'wizard', key: 'tasks-project-new' },
  { step: 'board', key: 'tasks-board' },
  { step: 'card', key: 'tasks-card', desktopOnly: true },
  { step: 'modal', key: 'modal-new-task' },
];

for (const c of CASES) {
  test(`${c.key}: пиксели в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.skip(
      !!c.desktopOnly && phone(page),
      'карточка на телефоне — на всю ширину с «К доске» (no-reference, Q-W4.00-tasks-14)',
    );
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, c.step);
    const r = await pixels(page, ref, c.step, c.key, testInfo);
    console.log(`visual ${c.key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });

  test(`${c.key}: подписи совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    test.skip(!!c.desktopOnly && phone(page), 'карточка на телефоне — no-reference');
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, c.step);
    const areas = (p: Page, root: Locator): Locator[] =>
      c.step === 'modal' ? [p.getByRole('dialog', { name: 'Новая задача' })] : [root];
    const expected = await labelsOf(areas(ref.page, refRoot(ref.page)), c.key);
    const actual = await labelsOf(areas(page, appRoot(page)), c.key);
    expect(actual).toEqual(expected);
  });
}
