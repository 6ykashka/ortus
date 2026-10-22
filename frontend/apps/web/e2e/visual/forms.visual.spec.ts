// W4.22 · Сверка «Форм и опросов» со снимком design-2026-10-19 (verification-protocol.md §3): владелец «Альты» на
// экранах `forms-list` (список), `forms-builder` («Осмотр машины», свёрнутые вопросы и карточка вопроса),
// `forms-preview` («Предпросмотр» на телефоне) и `modal-form-publish` (черновик прораба — «Сначала исправьте форму»).
// Эталон — модуль «Формы и опросы», подключённый в «Ортус CRM.dc.html» (dc-import на pg.forms), часы харнесса.
// Снимок — область модуля (крошку, шапку и меню сверяет ключ `shell`). Расхождения — allowlist/forms.md:
//   • группы эталона живут в памяти окна (STORE.groups — «Логистика и машины» с «Осмотром машины»), у сервера —
//     общие группы организации (FM-03): реализации та же группа ставится командами до снимка;
//   • «изменена {дд.мм}» строки — дата сервера (у сида эталона даты нет): убирается перед снимком;
//   • на телефоне цели нажатия 44 px (PD-28): те же размеры ставятся эталону.
import type { Locator, Page } from '@playwright/test';

import { call, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

type Step = 'list' | 'templates' | 'builder' | 'card' | 'picker' | 'preview' | 'publish';

/** Корень модуля: эталон — dc-import «Формы и опросы», реализация — `.ox-fm`. */
const HOST = '.sc-host[data-sc-name="Формы и опросы"]';
const refRoot = (p: Page): Locator => p.locator(HOST);
const appRoot = (p: Page): Locator => p.locator('.ox-fm');
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
  await page.waitForLoadState('networkidle');
}

/** Шаги экрана на одной стороне (подписи и роли одинаковы на обеих). */
async function act(p: Page, root: Locator, step: Step): Promise<void> {
  if (step === 'list') return;
  if (step === 'templates') {
    await root.getByRole('button', { name: /Все шаблоны · 15/ }).click();
    await root.getByRole('searchbox', { name: 'Поиск шаблона' }).waitFor();
    return;
  }
  const name = step === 'publish' ? 'Ежедневный отчёт прораба' : 'Осмотр машины';
  await root
    .getByRole('button', { name: new RegExp(`^.*${name}`) })
    .first()
    .click();
  await root.getByRole('tab', { name: 'Конструктор' }).waitFor();
  await root.getByRole('navigation', { name: 'Содержание формы' }).waitFor();
  if (step === 'card') {
    await root.locator('button', { hasText: 'Уровень топлива' }).last().click();
    await root.getByRole('combobox', { name: 'Тип вопроса' }).waitFor();
  }
  if (step === 'picker') {
    await root.getByRole('button', { name: 'Добавить вопрос' }).first().click();
    await root.getByRole('button', { name: 'Показать все вопросы' }).click();
    await root.getByText('Данные CRM').waitFor();
  }
  if (step === 'preview') {
    await root.getByRole('button', { name: 'Предпросмотр' }).click();
    await root.getByText('Предпросмотр черновика. Ответ не сохраняется.').waitFor();
  }
  if (step === 'publish') {
    await root.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await p.getByRole('dialog', { name: 'Сначала исправьте форму' }).waitFor();
  }
}

type Reference = (
  file?: string,
  o?: { persona?: 'owner'; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;

/** Реализации — группа эталона «Логистика и машины» с «Осмотром машины» (STORE dc:472). */
async function seedGroup(page: Page, alta: string): Promise<void> {
  const base = `/api/v1/tenants/${alta}`;
  const forms = (await call(page, 'GET', `${base}/forms`)).body as {
    items: { id: string; name: string }[];
  };
  const insp = forms.items.find((f) => f.name === 'Осмотр машины');
  const g = await call(page, 'POST', `${base}/form-groups`, {
    body: { name: 'Логистика и машины' },
  });
  const gid = (g.body as { id: string }).id;
  const cur = await call(page, 'GET', `${base}/forms/${insp?.id ?? ''}`);
  await call(page, 'PATCH', `${base}/forms/${insp?.id ?? ''}`, {
    body: { groupId: gid },
    ifMatch: cur.headers.etag ?? '',
  });
}

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
  await seedGroup(page, alta);
  await app(`/t/${alta}/forms`, { persona: 'owner' });
  await appRoot(page).locator('.ox-fm-row').first().waitFor();
  await act(page, appRoot(page), step);
  // Дата «изменена» строки — данные сервера (у сида эталона её нет, allowlist).
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.ox-fm-row-text > span'))) {
      el.textContent = (el.textContent ?? '').replace(/ · изменена \d\d\.\d\d$/, '');
    }
  });
  if (phone(page)) {
    // Цели 44 px на телефоне (PD-28): эталону — те же размеры контролов.
    await ref.page.addStyleTag({
      content: [
        `${HOST} button { min-height: 44px !important; }`,
        `${HOST} button[aria-label] { min-width: 44px !important; }`,
        `${HOST} input:not([type=checkbox]), ${HOST} select, ${HOST} label:has(> input[type=checkbox]) { min-height: 44px !important; }`,
        // Название страницы конструктора — на всю строку, «Страница i из n» и кнопки — второй строкой (< 480 px).
        `${HOST} section[data-page] > div:first-child { flex-wrap: wrap !important; }`,
        `${HOST} section[data-page] > div:first-child > input { flex: 1 1 100% !important; }`,
      ].join('\n'),
    });
    // Снимок области модуля целиком (строки форм, «Все шаблоны», все страницы конструктора): высокое окно на
    // обеих сторонах — корень не обрезается прокруткой оболочки.
    const bottom = async (p: Page, r: Locator) =>
      r.evaluate((el) => Math.ceil(el.getBoundingClientRect().top + el.scrollHeight + 80));
    const h = Math.max(
      await bottom(ref.page, refRoot(ref.page)),
      await bottom(page, appRoot(page)),
    );
    for (const p of [page, ref.page]) {
      const vp = p.viewportSize();
      if (vp && h > vp.height) await p.setViewportSize({ width: vp.width, height: h });
    }
  }
  await page.waitForLoadState('networkidle');
  // Без наведения и прокрутки после клика по строке списка (hover пунктов «Содержания», прокрутка страницы).
  for (const p of [page, ref.page]) {
    await p.mouse.move(0, 0);
    await p.evaluate(() => {
      window.scrollTo(0, 0);
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        if (el.scrollTop) el.scrollTop = 0;
      }
    });
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  step: Step,
  key: string,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  const modal = step === 'publish';
  const implRoot = modal ? page.locator('.ox-fm-modal-box') : appRoot(page);
  const refRootOf = modal
    ? ref.page.getByRole('dialog', { name: 'Сначала исправьте форму' }).locator('> div')
    : refRoot(ref.page);
  return compareShots(
    { target: { kind: 'app', page, root: implRoot, url: page.url() } },
    { target: { kind: 'reference', page: ref.page, root: refRootOf, url: ref.page.url() } },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

const CASES: { step: Step; key: string }[] = [
  { step: 'list', key: 'forms-list' },
  { step: 'templates', key: 'forms-list-templates' },
  { step: 'builder', key: 'forms-builder' },
  { step: 'card', key: 'forms-builder-card' },
  { step: 'picker', key: 'forms-builder-picker' },
  { step: 'preview', key: 'forms-preview' },
  { step: 'publish', key: 'modal-form-publish' },
];

for (const c of CASES) {
  test(`${c.key}: пиксели в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
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
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, c.step);
    const areas = (p: Page, root: Locator): Locator[] =>
      c.step === 'publish' ? [p.getByRole('dialog')] : [root];
    const expected = await labelsOf(areas(ref.page, refRoot(ref.page)), 'forms');
    const actual = await labelsOf(areas(page, appRoot(page)), 'forms');
    expect(actual).toEqual(expected);
  });
}
