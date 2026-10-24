// W4.13 · e2e вкладки проекта `tasks-workflow` «Процесс» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :233–275, логика :456–477; DoR analysis/dor/tasks.md §1.3). Данные — MSW W4.03 (проект LOG, процесс v1
// «С согласованием»); backend — W4.11 (режим stand). Обязательные пункты verification-protocol §1.3.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';
import { openProjectTab, openTasksFromMenu, pane, tab, tabs } from './tasks-settings.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const chip = (page: Page): Locator => pane(page).locator('.ox-tset-ver');
const statuses = (page: Page): Locator => pane(page).locator('.ox-tset-status');
const rows = (page: Page): Locator => pane(page).locator('.ox-tset-tr');
const panel = (page: Page): Locator => pane(page).locator('.ox-tset-trpanel');
const btn = (page: Page, name: string): Locator =>
  pane(page).getByRole('button', { name, exact: true });

async function addStatus(page: Page, name: string): Promise<void> {
  await pane(page).getByRole('textbox', { name: 'Название статуса' }).fill(name);
  await btn(page, 'Добавить статус').click();
}

test.describe('tasks-workflow — «Процесс» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается по прямому URL и вкладкой: «Действует v1», статусы и переходы', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await tab(page, 'workflow').click();
    await expect(page).toHaveURL(/[?&]view=workflow/);
    await expect(chip(page)).toHaveText('Действует v1');
    await expect(statuses(page)).toHaveCount(5);
    await expect(statuses(page).first()).toContainText('Новая');
    await expect(statuses(page).first()).toContainText('К выполнению');
    await expect(pane(page).getByRole('heading', { level: 3, name: 'Переходы · 4' })).toBeVisible();
    await expect(rows(page).nth(2)).toContainText('Согласовать');
    await expect(rows(page).nth(2)).toContainText('На проверке → Готово');
    await expect(rows(page).nth(2)).toContainText('Согласующие');
    await expect(rows(page).nth(3)).toContainText('Любой → Отменена');
    await expect(rows(page).nth(0)).toContainText('Без правил');
    await page.reload();
    await expect(chip(page)).toHaveText('Действует v1', { timeout: 15_000 });
  });

  test('новый статус — черновик перед «Готово»; «Сбросить черновик» — тост эталона', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'workflow');
    await addStatus(page, 'Ждёт запчасть');
    await expect(chip(page)).toHaveText('Черновик · действует v1');
    await expect(statuses(page).nth(3)).toContainText('Ждёт запчасть');
    await expect(btn(page, 'Опубликовать v2')).toBeVisible();
    await btn(page, 'Сбросить черновик').click();
    await expect(toast(page)).toHaveText('Черновик сброшен');
    await expect(chip(page)).toHaveText('Действует v1');
    await expect(statuses(page)).toHaveCount(5);
  });

  test('переход: панель, «Кто может», согласование, проверки; «Опубликовать v2»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'workflow');
    await pane(page).getByRole('textbox', { name: 'Название перехода' }).fill('Пауза');
    await pane(page)
      .getByRole('combobox', { name: 'В статус' })
      .selectOption({ label: 'В работе' });
    await btn(page, 'Добавить переход').click();
    await expect(
      panel(page).getByRole('heading', { level: 3, name: 'Переход «Пауза»' }),
    ).toBeVisible();
    await expect(panel(page)).toContainText('Любой → В работе');
    await expect(chip(page)).toHaveText('Черновик · действует v1');
    await panel(page).getByRole('button', { name: 'исполнитель задачи' }).click();
    await expect(panel(page).getByRole('button', { name: 'исполнитель задачи' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await panel(page).getByRole('checkbox', { name: 'Переход выполняется согласованием' }).click();
    await expect(panel(page).getByRole('group', { name: 'Режим согласования' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Нужны все' }).click();
    await expect(rows(page).last()).toContainText('Согласование: все');
    await panel(page).getByRole('checkbox', { name: 'Комментарий обязателен' }).click();
    await expect(rows(page).last()).toContainText('Комментарий');
    await btn(page, 'Опубликовать v2').click();
    await expect(toast(page)).toHaveText('Процесс опубликован. Задачи остались в своих статусах');
    await expect(chip(page)).toHaveText('Действует v2');
    // Возврат 2: шапка проекта — хост W4.12 (.ox-tk-ptitle), версия процесса в подзаголовке после публикации.
    await expect(page.locator('.ox-tk-ptitle')).toContainText('процесс v2');
  });

  // Возврат 4: данные хоста W4.12 после публикации — доска того же проекта и список проектов («процесс v2», ЗП:361)
  // показывают новую версию сразу, без повторного входа в проект.
  test('«Опубликовать v2» → «Доска» — колонка нового статуса; «← Проекты» — «процесс v2»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'workflow');
    await addStatus(page, 'Ждёт запчасть');
    await expect(chip(page)).toHaveText('Черновик · действует v1');
    await btn(page, 'Опубликовать v2').click();
    await expect(chip(page)).toHaveText('Действует v2');
    await tabs(page).getByRole('tab', { name: 'Доска' }).click();
    await expect(page.locator('.ox-tk-col-name')).toHaveText([
      'Новая',
      'В работе',
      'На проверке',
      'Ждёт запчасть',
      'Готово',
      'Отменена',
    ]);
    await page.locator('.ox-tk-back').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible();
    await expect(
      page.locator('.ox-tk-prow').filter({ has: page.locator('.ox-tk-key', { hasText: /^LOG$/ }) }),
    ).toContainText('процесс v2');
  });

  test('ошибки эталона: дубль статуса, «Назовите переход», публикация без «Готово»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'workflow');
    await addStatus(page, 'в работе');
    await expect(toast(page)).toHaveText('Статус «в работе» уже есть');
    await btn(page, 'Добавить переход').click();
    await expect(toast(page)).toHaveText('Назовите переход');
    await btn(page, 'Удалить статус Отменена').click();
    await expect(chip(page)).toHaveText('Черновик · действует v1');
    await btn(page, 'Удалить статус Готово').click();
    await expect(statuses(page)).toHaveCount(3);
    await btn(page, 'Опубликовать v2').click();
    await expect(toast(page)).toHaveText('Нужен хотя бы один статус категории «Готово»');
    await expect(chip(page)).toHaveText('Черновик · действует v1');
  });

  test('без «Настраивать» (водитель) — только чтение; нет связи — тост', async ({ app, page }) => {
    await openProjectTab(app, page, 'workflow', { persona: 'driver' });
    await expect(chip(page)).toHaveText('Действует v1');
    await expect(pane(page).getByRole('textbox')).toHaveCount(0);
    await rows(page).nth(3).click();
    await expect(panel(page)).toBeVisible();
    for (const b of await panel(page).getByRole('button').all()) await expect(b).toBeDisabled();
    await expect(panel(page).getByRole('button', { name: 'Удалить переход' })).toHaveCount(0);
    await openProjectTab(app, page, 'workflow');
    await devScenario(page, { scenario: 'saveTaskWorkflowDraft=offline' });
    await addStatus(page, 'Пауза');
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(chip(page)).toHaveText('Действует v1');
    await devScenario(page, { scenario: null });
  });

  test('390 — без горизонтальной прокрутки; клавиатура; axe; цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openProjectTab(app, page, 'workflow');
    await rows(page).nth(2).click();
    await expect(panel(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const target = rows(page).first();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(
      'Переход «Взять в работу»',
    );
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(await hitHeight(btn(page, 'Добавить статус'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(btn(page, 'Удалить статус Новая'))).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(panel(page).getByRole('button', { name: 'автор задачи' })),
    ).toBeGreaterThanOrEqual(44);
    // Возврат 1: флажки панели — строка-метка с флажком не ниже 44 px (verification-protocol §1.3).
    for (const name of [
      'Переход выполняется согласованием',
      'Автор задачи не может выполнить переход',
      'Комментарий обязателен',
      'Чек-лист должен быть закрыт',
      'Подзадачи должны быть завершены',
      'После перехода назначить задачу на автора',
    ]) {
      const label = panel(page).locator('label', { has: page.getByRole('checkbox', { name }) });
      expect(await hitHeight(label), name).toBeGreaterThanOrEqual(44);
    }
  });

  // Возврат 1: обязательные пункты §1.3 — вход из меню «Задачи», скелетон загрузки, ошибка с «Повторить».
  test('из меню «Задачи» → проект → «Процесс»; загрузка — скелетон; ошибка — «Повторить»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await openTasksFromMenu(page);
    await page.getByRole('button', { name: /Логистика · Север/ }).click();
    await tab(page, 'workflow').click();
    await expect(tab(page, 'workflow')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]view=workflow/);
    await expect(chip(page)).toHaveText('Действует v1');
    await openProjectTab(app, page, 'workflow', { scenario: 'getTaskWorkflow=delay=1500' });
    await expect(pane(page).locator('.ox-tset-skel')).toBeVisible();
    await expect(chip(page)).toHaveText('Действует v1', { timeout: 15_000 });
    await openProjectTab(app, page, 'workflow', { scenario: 'getTaskWorkflow=rate_limited' });
    await expect(pane(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await pane(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(chip(page)).toHaveText('Действует v1', { timeout: 15_000 });
  });
});

test.describe('tasks-workflow — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // Возврат 2: backend W4.11 в main — процесс LOG сида на стенде.
  test('владелец на стенде: процесс LOG', async ({ app, page }) => {
    test.slow();
    await openProjectTab(app, page, 'workflow');
    await expect(chip(page)).toHaveText('Действует v1', { timeout: 15_000 });
    await expect(statuses(page)).toHaveCount(5);
    await expect(rows(page).nth(2)).toContainText('Согласовать');
  });
});
