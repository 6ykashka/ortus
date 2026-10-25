// W4.23 · e2e экрана `forms-responses` — вкладка «Ответы» редактора формы: «Сводка», «Лента» с журналом действий,
// «Таблица», «Выгрузить CSV» (эталон design-2026-10-19 «Формы и опросы.dc.html» dc:411–439, respVM dc:986–1011;
// разбор forms.md §1.8). «Принять» / «Отклонить» — no-reference (Q-W4.00-forms-18). Данные — MSW W4.05: ответы
// R-0988 (v2) и R-1012 (v3) формы «Осмотр машины» «Альты»; backend — W4.21 (режим stand).
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  call,
  devScenario,
  editor,
  formIdOf,
  FOREMAN,
  formsApi,
  INSP,
  OFFLINE,
  type Opened,
  openForm,
  openStandForm,
  phone,
  reopen,
  responseIdOf,
  serious,
  smallTargets,
  tab,
  toast,
} from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';
import { tenantId } from './shell.helpers.ts';

const panel = (page: Page) => page.locator('.ox-fr-rs');
const view = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Вид ответов' }).getByRole('button', { name, exact: true });
const stat = (page: Page, label: string) =>
  panel(page)
    .locator('.ox-fr-stat')
    .filter({ has: page.getByText(label, { exact: true }) });
const feedRow = (page: Page, id: string) =>
  panel(page).locator('.ox-fr-feed button').filter({ hasText: id });
const card = (page: Page) => panel(page).locator('.ox-fr-resp');
const journal = (page: Page) => panel(page).locator('.ox-fr-journal');
const row = (page: Page, label: string) =>
  card(page)
    .locator('.ox-fr-resp-row')
    .filter({ has: page.getByText(label, { exact: true }) });

const SP = `[\\s${String.fromCharCode(160)}]`;

/** Ответ сотрудника на v3 «Осмотра машины» через API (обязательные вопросы; фото — id файла). */
async function submit(page: Page, o: Opened): Promise<string> {
  const vs = await call(page, 'GET', `${formsApi(o)}/versions`);
  const v3 = (vs.body as { items: { id: string; number: number }[] }).items.find(
    (x) => x.number === 3,
  );
  const r = await call(page, 'POST', `${formsApi(o)}/responses`, {
    body: {
      versionId: v3?.id,
      answers: [
        {
          fieldKey: 'q-photos',
          value: { type: 'files', value: ['0b1f6a3c-1d2e-4f50-8a6b-7c8d9e0f1a2b'] },
        },
        { fieldKey: 'q-odo', value: { type: 'decimal', value: '85000' } },
        { fieldKey: 'q-fuel', value: { type: 'choices', value: ['o4'] } },
        { fieldKey: 'q-checks', value: { type: 'choices', value: ['o1', 'o2', 'o3'] } },
        { fieldKey: 'q-defect', value: { type: 'boolean', value: false } },
      ],
    },
  });
  if (r.status !== 201)
    throw new Error(`submitFormResponse ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body as { number: string }).number;
}

test.describe('forms-responses — «Ответы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('«Сводка»: «2 ответа», карточки вопросов всех версий — полосы, числа, тексты', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'responses' });
    await expect(tab(page, 'responses')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'responses')).toContainText('2');
    await expect(view(page, 'Сводка')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toContainText('2 ответа');
    await expect(panel(page).locator('.ox-fr-stat strong')).toHaveText([
      'Фото: спереди, сзади, слева, справа, одометр',
      'Пробег по одометру, км',
      'Уровень топлива',
      'Чек-лист: кузов, шины, документы',
      'Есть дефекты?',
      'Описание дефекта',
      'Дефект критический',
      'Уровень топлива',
    ]);
    const odo = stat(page, 'Пробег по одометру, км');
    await expect(odo).toContainText('Число · ответили 2 из 2');
    await expect(odo).toContainText(
      new RegExp(`Среднее 84${SP}056 · мин 83${SP}902 · макс 84${SP}210`),
    );
    const fuel = panel(page).locator('.ox-fr-stat').nth(2);
    await expect(fuel).toContainText('Один вариант · ответили 1 из 2');
    await expect(fuel.locator('.ox-fr-bar-head')).toHaveText([
      '¼0 · 0%',
      '½0 · 0%',
      '¾1 · 100%',
      'Полный0 · 0%',
    ]);
    await expect(stat(page, 'Есть дефекты?').locator('.ox-fr-bar-head')).toHaveText([
      'да0 · 0%',
      'нет1 · 100%',
    ]);
    await expect(stat(page, 'Описание дефекта')).toContainText('Пока без ответов');
  });

  test('«Лента»: новый ответ первым; карточка по структуре версии; журнал действий; R-0988 — v2', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'responses' });
    await view(page, 'Лента').click();
    await expect(panel(page).locator('.ox-fr-feed button')).toHaveCount(2);
    await expect(feedRow(page, 'R-1012')).toHaveAttribute('aria-pressed', 'true');
    await expect(feedRow(page, 'R-1012')).toContainText('R-1012 · Рейс Р-196');
    await expect(feedRow(page, 'R-1012')).toContainText('Илья Васильев · 27.09 09:05');
    await expect(feedRow(page, 'R-1012')).toContainText('v3');
    await expect(card(page).getByRole('heading', { level: 3 })).toHaveText('R-1012 · Рейс Р-196');
    await expect(card(page)).toContainText('Принят');
    await expect(card(page)).toContainText(
      'Илья Васильев · 27.09 09:05 · показан по структуре версии v3',
    );
    await expect(row(page, 'Уровень топлива')).toContainText('¾');
    await expect(row(page, 'Есть дефекты?')).toContainText('нет');
    await expect(row(page, 'Описание дефекта')).toContainText('Не показывался по условию');
    await expect(journal(page).getByRole('heading', { level: 3 })).toHaveText('Журнал действий');
    await expect(journal(page)).toContainText(
      'Строка в таблице «Осмотры» · страница «Журнал осмотров машин» · 27.09 09:12 · правило v1',
    );
    await expect(journal(page).getByRole('button', { name: 'Открыть страницу' })).toBeVisible();
    await expect(journal(page)).toContainText(
      'Повторная обработка не создаёт вторую задачу или строку.',
    );
    await feedRow(page, 'R-0988').click();
    await expect(card(page)).toContainText(
      'Кирилл Громов · 18.09 08:41 · показан по структуре версии v2 (действует v3)',
    );
    await expect(row(page, 'Уровень топлива')).toContainText('почти полный');
    await expect(page).toHaveURL(/resp=/);
  });

  test('«Открыть страницу» журнала — страница «Базы знаний» с таблицей «Осмотры»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'responses' });
    await view(page, 'Лента').click();
    await journal(page).getByRole('button', { name: 'Открыть страницу' }).click();
    await expect(page).toHaveURL(/\/knowledge\?space=.+&page=/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Журнал осмотров машин' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('«Таблица»: колонки эталона и вопросы всех версий, «—» у пустых', async ({ app, page }) => {
    await openForm(app, page, { tab: 'responses' });
    await view(page, 'Таблица').click();
    const head = panel(page).locator('table thead th');
    await expect(head).toHaveText([
      'Ответ',
      'Дата',
      'Автор',
      'Объект',
      'Версия',
      'Фото: спереди, сзади, слева, справа, одометр',
      'Пробег по одометру, км',
      'Уровень топлива',
      'Чек-лист: кузов, шины, документы',
      'Есть дефекты?',
      'Описание дефекта',
      'Дефект критический',
      'Уровень топлива',
    ]);
    const first = panel(page).locator('table tbody tr').first().locator('td');
    await expect(first.nth(0)).toHaveText('R-1012');
    await expect(first.nth(1)).toHaveText('27.09 09:05');
    await expect(first.nth(4)).toHaveText('v3');
    await expect(first.nth(10)).toHaveText('—');
    await expect(first.nth(12)).toHaveText('—');
  });

  test('«Выгрузить CSV» — файл «Осмотр машины.csv» с BOM, «;» и колонкой «Статус»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'responses' });
    const wait = page.waitForEvent('download');
    await panel(page).getByRole('button', { name: 'Выгрузить CSV' }).click();
    const file = await wait;
    expect(file.suggestedFilename()).toBe('Осмотр машины.csv');
    const text = readFileSync((await file.path()) ?? '', 'utf8');
    expect(text.startsWith('﻿Ответ;Дата;Автор;Объект;Версия;Статус;')).toBe(true);
    expect(text).toContain('R-1012;');
  });

  test('«Выгрузить ответы в CSV» меню «Ещё»; нет связи — тост', async ({ app, page }) => {
    await openForm(app, page, { tab: 'responses' });
    await devScenario(page, { scenario: 'exportFormResponses=offline' });
    await panel(page).getByRole('button', { name: 'Выгрузить CSV' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    const wait = page.waitForEvent('download');
    await editor(page).getByRole('button', { name: 'Ещё действия с формой' }).click();
    await page.getByRole('menuitem', { name: 'Выгрузить ответы в CSV' }).click();
    expect((await wait).suggestedFilename()).toBe('Осмотр машины.csv');
  });

  test('черновик без ответов: «Ответов нет: форма ещё не опубликована.», CSV недоступна', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'responses', name: FOREMAN });
    await expect(panel(page)).toContainText('Ответов нет: форма ещё не опубликована.');
    await expect(panel(page).getByRole('button', { name: 'Выгрузить CSV' })).toBeDisabled();
    await expect(panel(page)).toContainText('0 ответов');
  });

  test('без ответов: опубликована — «Ответов пока нет…», приём закрыт — «Ответов нет, приём закрыт.»', async ({
    app,
    page,
  }) => {
    const o = await openForm(app, page, {
      tab: 'responses',
      name: FOREMAN,
      before: async (x) => {
        // Публикация черновика «Ежедневного отчёта прораба» (у «Явки бригады» сид не задал вариантов — добавляем)
        // — опубликованная форма без ответов.
        const d = await call(page, 'GET', `${formsApi(x)}/draft`);
        type Fld = { type: string; options?: { key: string; label: string }[] };
        const def = (d.body as { definition: { fields: Fld[] } }).definition;
        for (const q of def.fields)
          if (q.options && !q.options.length)
            q.options = [
              { key: 'o1', label: 'да' },
              { key: 'o2', label: 'нет' },
            ];
        const s = await call(page, 'PUT', `${formsApi(x)}/draft`, {
          body: { definition: def },
          ifMatch: d.headers.etag ?? '',
        });
        if (s.status !== 200)
          throw new Error(`saveFormDraft ${s.status}: ${JSON.stringify(s.body)}`);
        const f = await call(page, 'GET', formsApi(x));
        const p = await call(page, 'POST', `${formsApi(x)}/publish`, {
          body: { draftRevision: (s.body as { revision: number }).revision },
          ifMatch: f.headers.etag ?? '',
        });
        if (p.status !== 200) throw new Error(`publishForm ${p.status}: ${JSON.stringify(p.body)}`);
      },
    });
    await expect(panel(page)).toContainText('Ответов пока нет. Отправьте ссылку из «Поделиться».');
    await expect(panel(page)).toContainText('0 ответов');
    const f = await call(page, 'GET', formsApi(o));
    const c = await call(page, 'PATCH', formsApi(o), {
      body: { status: 'closed' },
      ifMatch: f.headers.etag ?? '',
    });
    expect(c.status).toBe(200);
    // Заново по адресу через фикстуру `app` (ждёт service worker MSW): голый page.reload изредка уходит мимо MSW.
    await reopen(app, page);
    await expect(panel(page)).toContainText('Ответов нет, приём закрыт.');
    await expect(panel(page)).not.toContainText('Ответов пока нет');
  });

  test('открывается из меню «Формы и опросы»: список → «Осмотр машины» → «Ответы»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'build' });
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: 'Формы и опросы' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Формы и опросы' })
        .click();
    }
    await expect(page).toHaveURL(/\/forms$/);
    await page.locator('.ox-fm-row').filter({ hasText: INSP }).locator('.ox-fm-row-open').click();
    await tab(page, 'responses').click();
    await expect(page).toHaveURL(/[?&]tab=responses/);
    await expect(panel(page)).toContainText('2 ответа');
  });

  test('нет права: логист без роли в «Формах» — раздел закрыт', async ({ app, page }) => {
    // Без пресета «Логистика подключена» у Марины Котовой нет роли с правами «Форм».
    await app('/', { persona: 'owner' });
    await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
      .catch(() => undefined);
    const tenant = await tenantId(page);
    const form = await formIdOf(page, tenant, INSP);
    await app(`/t/${tenant}/forms?form=${form}&tab=responses`, { persona: 'manager' });
    await expect(page.getByRole('heading', { name: /Нет доступа|не подключ/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel(page)).toHaveCount(0);
  });

  test('клавиатура: «Сводка / Лента / Таблица» — Tab и Enter / пробел', async ({ app, page }) => {
    await openForm(app, page, { tab: 'responses' });
    await view(page, 'Сводка').focus();
    await page.keyboard.press('Tab');
    await expect(view(page, 'Лента')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(view(page, 'Лента')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page)).toBeVisible();
    await view(page, 'Лента').focus();
    await page.keyboard.press('Tab');
    await expect(view(page, 'Таблица')).toBeFocused();
    await page.keyboard.press(' ');
    await expect(view(page, 'Таблица')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).locator('table')).toBeVisible();
  });

  test('новый ответ сотрудника: первым в ленте, журнал — задача по правилу и строка в «Осмотры»', async ({
    app,
    page,
  }) => {
    let num = '';
    await openForm(app, page, {
      tab: 'responses',
      before: async (o) => {
        num = await submit(page, o);
      },
    });
    await expect(panel(page)).toContainText('3 ответа');
    await view(page, 'Лента').click();
    await expect(feedRow(page, num)).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page)).toContainText('· 01.10 10:30 · показан по структуре версии v3');
    await expect(journal(page)).toContainText(/Задача LOG-\d+ «Проверить осмотр» · Марина Котова/);
    await expect(journal(page)).toContainText(
      'Строка в таблице «Осмотры» · страница «Журнал осмотров машин» · 01.10 10:30 · правило v1',
    );
    // «Повторить» после ошибки «в БЗ» — экранный тест responses.test.tsx: ошибку на сценарном сервере снаружи не вызвать
    // (архив страницы kbRun не останавливает).
    await expect(journal(page).getByRole('button', { name: 'Повторить' })).toHaveCount(0);
  });
  test('ответ на проверке: «Принять» — статус «Принят», задача по правилу в журнале', async ({
    app,
    page,
  }) => {
    await openForm(app, page, {
      tab: 'responses',
      before: async (o) => {
        const list = await call(page, 'GET', `${formsApi(o)}/responses`);
        const r = (list.body as { items: { id: string; number: string }[] }).items.find(
          (x) => x.number === 'R-1012',
        );
        const one = await call(page, 'GET', `${formsApi(o)}/responses/${r?.id}`);
        const p = await call(page, 'PATCH', `${formsApi(o)}/responses/${r?.id}`, {
          body: { reviewStatus: 'pending' },
          ifMatch: one.headers.etag ?? '',
        });
        if (p.status !== 200) throw new Error(`review ${p.status}`);
      },
    });
    await view(page, 'Лента').click();
    await expect(card(page)).toContainText('На проверке');
    await card(page).getByRole('button', { name: 'Принять' }).click();
    await expect(toast(page)).toHaveText('Ответ R-1012 принят');
    await expect(card(page).locator('.ox-fr-resp-status')).toHaveText('Принят');
    await expect(journal(page)).toContainText(/Задача LOG-\d+ «Проверить осмотр» · Марина Котова/);
  });

  test('прямая ссылка `&resp=` — «Лента» с выбранным ответом (переход из задачи и «Данных»)', async ({
    app,
    page,
  }) => {
    let id = '';
    await openForm(app, page, {
      tab: 'responses',
      before: async (o) => {
        const list = await call(page, 'GET', `${formsApi(o)}/responses`);
        id =
          (list.body as { items: { id: string; number: string }[] }).items.find(
            (x) => x.number === 'R-0988',
          )?.id ?? '';
      },
      extra: '',
    });
    // Переход через фикстуру `app` (ждёт service worker MSW), а не голый page.goto: на 768 запросы после
    // перезагрузки изредка уходили мимо MSW в прокси Vite (ECONNREFUSED :8102) — возврат 2.
    const u = new URL(page.url());
    await app(`${u.pathname}${u.search}&resp=${id}`, { persona: 'owner' });
    await expect(view(page, 'Лента')).toHaveAttribute('aria-pressed', 'true');
    await expect(feedRow(page, 'R-0988')).toHaveAttribute('aria-pressed', 'true');
  });

  test('ошибка «Сводки» — «Повторить»; загрузка — role=status', async ({ app, page }) => {
    await openForm(app, page, { tab: 'versions' });
    await devScenario(page, { scenario: 'getFormResponseSummary=rate_limited' });
    await tab(page, 'responses').click();
    await expect(panel(page).getByRole('alert')).toContainText('Не удалось загрузить данные');
    await devScenario(page, { scenario: 'getFormResponseSummary=delay=1500' });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(panel(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(panel(page).locator('.ox-fr-stat').first()).toBeVisible({ timeout: 10_000 });
    await devScenario(page, { scenario: null });
  });

  test('логист Котова — ответы и CSV без «Повторить»', async ({ app, page }) => {
    await openForm(app, page, { tab: 'responses', persona: 'manager' });
    await view(page, 'Лента').click();
    await expect(card(page)).toBeVisible();
    await expect(journal(page).getByRole('button', { name: 'Повторить' })).toHaveCount(0);
  });

  test('390 / 1440: лента под списком на телефоне, без горизонтальной прокрутки, цели 44 px, axe', async ({
    app,
    page,
    axe,
  }) => {
    await openForm(app, page, { tab: 'responses' });
    for (const v of ['Сводка', 'Лента', 'Таблица']) {
      await view(page, v).click();
      expect(await noHorizontalScroll(page), v).toBe(true);
      if (phone(page)) expect(await smallTargets(panel(page)), v).toEqual([]);
      expect(await serious(page, axe), v).toEqual([]);
    }
  });
});

test.describe('forms-responses — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // W4.73: ответы сида W4.21 — R-0988 (v2, Кирилл Громов) и R-1012 (v3, Илья Васильев, Рейс Р-196) с записью au-2 «в БЗ».
  // Число ответов не фиксируется: осмотры водителя соседних строк стенда (W4.24) добавляют ответы «Осмотра машины»;
  // R-1012 выбирается прямой ссылкой `&resp=`, а не позицией в ленте. Строка только читает.
  test('владелец на стенде: сводка и лента «Осмотра машины»', async ({ app, page }) => {
    const o = await openStandForm(app, page, { tab: 'responses' });
    await expect(tab(page, 'responses')).toHaveAttribute('aria-selected', 'true');
    await expect(view(page, 'Сводка')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).locator('.ox-fr-rs-count')).toHaveText(/^\d+ ответ(|а|ов)$/);
    await expect(stat(page, 'Пробег по одометру, км')).toContainText(/Число · ответили \d+ из \d+/);
    await expect(stat(page, 'Есть дефекты?').locator('.ox-fr-bar-head span').first()).toHaveText(
      'да',
    );
    await expect(panel(page).getByRole('button', { name: 'Выгрузить CSV' })).toBeEnabled();
    const id = await responseIdOf(page, o, 'R-1012');
    const u = new URL(page.url());
    await app(`${u.pathname}${u.search}&resp=${id}`, { persona: 'owner' });
    await expect(view(page, 'Лента')).toHaveAttribute('aria-pressed', 'true');
    await expect(feedRow(page, 'R-1012')).toHaveAttribute('aria-pressed', 'true');
    await expect(feedRow(page, 'R-1012')).toContainText('Илья Васильев · 27.09 09:05');
    await expect(feedRow(page, 'R-0988')).toContainText('v2');
    await expect(card(page).getByRole('heading', { level: 3 })).toHaveText('R-1012 · Рейс Р-196');
    await expect(card(page).locator('.ox-fr-resp-status')).toHaveText('Принят');
    await expect(card(page)).toContainText(
      'Илья Васильев · 27.09 09:05 · показан по структуре версии v3',
    );
    await expect(row(page, 'Уровень топлива')).toContainText('¾');
    await expect(row(page, 'Есть дефекты?')).toContainText('нет');
    await expect(row(page, 'Описание дефекта')).toContainText('Не показывался по условию');
    await expect(journal(page).getByRole('heading', { level: 3 })).toHaveText('Журнал действий');
    await expect(journal(page)).toContainText(
      'Строка в таблице «Осмотры» · страница «Журнал осмотров машин» · 27.09 09:12 · правило v1',
    );
  });
});
