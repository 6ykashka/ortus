// W4.23 · Сверка вкладок формы «Формы и опросы» со снимком design-2026-10-19 (verification-protocol.md §3): эталон —
// «Ортус CRM.dc.html» → пункт меню «Формы и опросы» (модуль «Формы и опросы.dc.html» внутри CRM, dc-import) → «Осмотр
// машины» → вкладка; реализация — тот же персонаж dev-входом, `?form=&tab=`. Снимок — область модуля (оболочку сверяет
// ключ `shell`). Ключи: forms-settings, forms-actions, forms-responses (сводка, лента, таблица), forms-versions,
// modal-form-share. Расхождения — allowlist/<ключ>.md:
//   • «По персональному приглашению» — неактивен с подсказкой «Появится позже…» (Q-W4.00-forms-10): строка скрыта на обеих
//     сторонах;
//   • журнал ленты эталона начинает строка задачи T-61 из `db.tasks` по `source` — у ответа контракта журнал только из
//     FormResponse.actions (Q-W4.23-3): строка задачи эталона убирается перед снимком;
//   • на телефоне поля ввода и выбора реализации — 44 px (цели нажатия, PD-28): то же ставится эталону.
import type { Locator, Page } from '@playwright/test';

import { formIdOf } from '../forms-results.helpers.ts';
import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

type Tab = 'settings' | 'actions' | 'responses' | 'versions';
interface Step {
  key: string;
  tab: Tab;
  view?: 'Лента' | 'Таблица';
  share?: boolean;
}

const LABEL: Record<Tab, string> = {
  settings: 'Настройки',
  actions: 'Действия после ответа',
  responses: 'Ответы',
  versions: 'Версии',
};

const refRoot = (p: Page): Locator => p.locator('.sc-host[data-sc-name="Формы и опросы"]');
/** Корень модуля «Формы и опросы» W4.22 (шапка редактора, вкладки и панель вкладки W4.23) — как у forms.visual.spec. */
const appRoot = (p: Page): Locator => p.locator('.ox-fm');
/**
 * Цели нажатия на телефоне (PD-28): правила модуля W4.22 (forms.css, @media max-width 639px — кнопки, поля, списки и
 * флажки «Форм» не ниже 44 px, кнопки-значки не уже 44 px) действуют и во вкладках W4.23 — те же размеры эталону, как
 * в forms.visual.spec W4.22.
 */
const PHONE_PARITY = [
  `.sc-host button { min-height: 44px !important; }`,
  `.sc-host button[aria-label] { min-width: 44px !important; }`,
  `.sc-host input:not([type='checkbox']), .sc-host select, .sc-host label:has(> input[type='checkbox']) { min-height: 44px !important; }`,
].join('\n');
const phone = (p: Page): boolean => (p.viewportSize()?.width ?? 1440) < 640;

/** Эталон: пункт меню «Формы и опросы» — боковая панель или рейл, на телефоне — «Ещё» → «Все разделы». */
async function openOnReference(page: Page): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side
      .locator('button[title="Формы и опросы"], button:has-text("Формы и опросы")')
      .first()
      .click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Формы и опросы' }).click();
  }
  await refRoot(page).getByRole('heading', { level: 1, name: 'Формы и опросы' }).waitFor();
  await refRoot(page).getByText('Осмотр машины', { exact: true }).first().click();
  await refRoot(page).getByRole('tablist', { name: 'Разделы формы' }).waitFor();
  await page.waitForLoadState('networkidle');
}

async function act(p: Page, root: Locator, s: Step): Promise<void> {
  await root
    .getByRole('tab', { name: new RegExp(`^${LABEL[s.tab]}`) })
    .first()
    .click();
  if (s.tab === 'settings') await root.getByText('Кто может ответить').waitFor();
  if (s.tab === 'actions') await root.getByText('Сохранить в Базу знаний').first().waitFor();
  if (s.tab === 'versions') await root.getByText('Структура версии 3 · неизменяема').waitFor();
  if (s.tab === 'responses') {
    await root.getByText('2 ответа').waitFor();
    if (s.view) await root.getByRole('button', { name: s.view, exact: true }).click();
    if (s.view === 'Лента') await root.getByText('Журнал действий').waitFor();
    if (s.view === 'Таблица') await root.locator('table').waitFor();
    if (!s.view) await root.getByText('Пробег по одометру, км').first().waitFor();
  }
  if (s.share) {
    await root.getByRole('button', { name: 'Поделиться' }).click();
    await p.getByRole('dialog').getByText('Поделиться формой').waitFor();
  }
  await p.waitForTimeout(400);
}

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: Reference,
  s: Step,
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page);
  await act(ref.page, refRoot(ref.page), s);
  await app('/', { persona: 'owner' });
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  const form = await formIdOf(page, alta, 'Осмотр машины');
  await app(`/t/${alta}/forms?form=${form}&tab=build`, { persona: 'owner' });
  await appRoot(page).getByRole('tablist', { name: 'Разделы формы' }).waitFor();
  await act(page, appRoot(page), s);
  // «По персональному приглашению» (Q-W4.00-forms-10) — без пиксельной сверки на обеих сторонах.
  for (const p of [page, ref.page]) {
    await p.evaluate(() => {
      for (const b of Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'))) {
        if (b.textContent?.includes('По персональному приглашению')) b.style.visibility = 'hidden';
      }
    });
  }
  // Журнал эталона: строка задачи T-61 из db.tasks (Q-W4.23-3) — убирается.
  await ref.page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div'))) {
      if (
        el.children.length &&
        el.firstElementChild?.textContent === 'add_task' &&
        el.textContent?.includes('Задача T-61')
      )
        el.remove();
    }
  });
  // Правило au-1 сида — устаревшая задача без вида: эталон пишет её текст (a.text), контракт требует FormRuleTask —
  // текст карточки собирается из названия и исполнителя (Q-W4.23-4); эталону ставится текст реализации.
  await ref.page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent === 'Ответ принят → задача менеджеру «Проверить осмотр»')
        n.textContent = 'Задача «Проверить осмотр» → Марина Котова';
    }
  });
  // Корень модуля «Формы и опросы» W4.22 и эталона — под той же крошкой CRM, на той же дробной координате: без
  // выравнивания (как forms.visual.spec W4.22).
  if (phone(page)) {
    await ref.page.addStyleTag({ content: PHONE_PARITY });
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  s: Step,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  const implRoot = s.share ? page.locator('.ox-fr-dialog') : appRoot(page);
  const refR = s.share ? ref.page.getByRole('dialog').locator('> div') : refRoot(ref.page);
  // Отладка расхождений: снимки обеих сторон в каталог FR_SHOTS (вне репозитория отчётов).
  const dir = process.env.FR_SHOTS;
  if (dir) {
    const name = `${s.key}-${testInfo.project.name}`;
    await implRoot.screenshot({ path: `${dir}/${name}-actual.png` });
    await refR.screenshot({ path: `${dir}/${name}-expected.png` });
  }
  return compareShots(
    { target: { kind: 'app', page, root: implRoot, url: page.url() } },
    { target: { kind: 'reference', page: ref.page, root: refR, url: ref.page.url() } },
    `${s.key}-${testInfo.project.name}`,
    testInfo,
  );
}

const CASES: Step[] = [
  { key: 'forms-settings', tab: 'settings' },
  { key: 'forms-actions', tab: 'actions' },
  { key: 'forms-responses', tab: 'responses' },
  { key: 'forms-responses-feed', tab: 'responses', view: 'Лента' },
  { key: 'forms-responses-table', tab: 'responses', view: 'Таблица' },
  { key: 'forms-versions', tab: 'versions' },
  { key: 'modal-form-share', tab: 'settings', share: true },
];

const allowKey = (key: string): string =>
  key.startsWith('forms-responses') ? 'forms-responses' : key;

for (const c of CASES) {
  test(`${c.key}: пиксели в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, c);
    const r = await pixels(page, ref, c, testInfo);
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
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, c);
    const areas = (p: Page, root: Locator): Locator[] =>
      c.share ? [p.getByRole('dialog')] : [root];
    const expected = await labelsOf(areas(ref.page, refRoot(ref.page)), allowKey(c.key));
    const actual = await labelsOf(areas(page, appRoot(page)), allowKey(c.key));
    expect(actual).toEqual(expected);
  });
}
