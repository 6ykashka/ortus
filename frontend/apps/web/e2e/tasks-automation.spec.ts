// W4.13 · e2e вкладки проекта `tasks-automation` «Автоматизация» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :277–311, логика :478–489; DoR analysis/dor/tasks.md §1.3). Данные — MSW W4.03 (правила ar-1, ar-2 и журнал
// проекта LOG); backend — W4.11 (режим stand). Обязательные пункты verification-protocol §1.3.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';
import {
  openProjectTab,
  openTasksFromMenu,
  pane,
  primaryText,
  tab,
} from './tasks-settings.helpers.ts';

const AR1 = 'Срочная задача → назначить руководителю проекта';
const AR2 = 'Задача готова → напомнить про путевой лист';

const rules = (page: Page): Locator => pane(page).locator('.ox-tset-rule');
const rule = (page: Page, name: string): Locator =>
  rules(page).filter({ has: page.locator('strong', { hasText: name }) });
const form = (page: Page): Locator => pane(page).locator('.ox-tset-newrule');
const runs = (page: Page): Locator => pane(page).locator('.ox-tset-run');

test.describe('tasks-automation — «Автоматизация» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается вкладкой и по прямому URL: правила ar-1, ar-2 и журнал запусков', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await tab(page, 'automation').click();
    await expect(page).toHaveURL(/[?&]view=automation/);
    await expect(rules(page)).toHaveCount(2);
    await expect(rule(page, AR1)).toContainText(
      'Когда задача создана, если приоритет «Срочно» → назначить на Марина Котова',
    );
    await expect(rule(page, AR1)).toContainText('От имени Марина Котова · v1 · запусков: 2');
    await expect(rule(page, AR1).getByRole('checkbox', { name: 'Включено' })).toBeChecked();
    await expect(rule(page, AR2)).toContainText(
      'Когда задача перешла в «Готово» → комментарий «Проверьте, что путевой лист сдан в бухгалтерию»',
    );
    await expect(rule(page, AR2).getByRole('checkbox', { name: 'Включено' })).not.toBeChecked();
    await expect(
      pane(page).getByRole('heading', { level: 3, name: 'Журнал запусков' }),
    ).toBeVisible();
    await expect(runs(page)).toHaveCount(2);
    await expect(runs(page).first()).toContainText('T-64 назначена: Марина Котова');
    await expect(runs(page).first()).toContainText(
      '09:12 · Срочная задача → назначить руководителю проекта v1',
    );
    await page.reload();
    await expect(rules(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('«Включено» — «Правило включено / выключено»; удаление — «Правило удалено»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'automation');
    await rule(page, AR2).getByRole('checkbox', { name: 'Включено' }).click();
    await expect(toast(page)).toHaveText('Правило включено');
    await expect(rule(page, AR2).getByRole('checkbox', { name: 'Включено' })).toBeChecked();
    await rule(page, AR2).getByRole('checkbox', { name: 'Включено' }).click();
    await expect(toast(page)).toHaveText('Правило выключено');
    await rule(page, AR2).getByRole('button', { name: 'Удалить правило' }).click();
    await expect(toast(page)).toHaveText('Правило удалено');
    await expect(rules(page)).toHaveCount(1);
  });

  test('«Новое правило»: ошибки в форме, «Правило добавлено», форма очищена', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'automation');
    await expect(
      form(page).getByRole('heading', { level: 3, name: 'Новое правило' }),
    ).toBeVisible();
    await form(page).getByRole('button', { name: 'Добавить правило' }).click();
    await expect(form(page).getByRole('alert')).toHaveText('Назовите правило');
    await form(page)
      .getByRole('textbox', { name: 'Название правила' })
      .fill('На проверке — срочно');
    await expect(form(page).getByRole('alert')).toHaveCount(0);
    await form(page)
      .getByRole('combobox', { name: 'Триггер' })
      .selectOption({ label: 'Задача перешла в статус' });
    await form(page)
      .getByRole('combobox', { name: 'Статус' })
      .selectOption({ label: 'На проверке' });
    await form(page)
      .getByRole('combobox', { name: 'Условие' })
      .selectOption({ label: 'Приоритет «Высокий»' });
    await form(page)
      .getByRole('combobox', { name: 'Действие' })
      .selectOption({ label: 'Поставить приоритет' });
    await form(page).getByRole('button', { name: 'Добавить правило' }).click();
    await expect(form(page).getByRole('alert')).toHaveText('Заполните действие');
    await form(page).getByRole('combobox', { name: 'Приоритет' }).selectOption({ label: 'Срочно' });
    await form(page).getByRole('button', { name: 'Добавить правило' }).click();
    await expect(toast(page)).toHaveText('Правило добавлено');
    await expect(rule(page, 'На проверке — срочно')).toContainText(
      'Когда задача перешла в «На проверке», если приоритет «Высокий» → приоритет «Срочно»',
    );
    await expect(form(page).getByRole('textbox', { name: 'Название правила' })).toHaveValue('');
  });

  test('без «Настраивать» (водитель) — только чтение; нет связи — тост', async ({ app, page }) => {
    await openProjectTab(app, page, 'automation', { persona: 'driver' });
    await expect(rules(page)).toHaveCount(2);
    await expect(form(page)).toHaveCount(0);
    for (const c of await pane(page).getByRole('checkbox').all()) await expect(c).toBeDisabled();
    await expect(pane(page).getByRole('button', { name: 'Удалить правило' })).toHaveCount(0);
    await openProjectTab(app, page, 'automation');
    await devScenario(page, { scenario: 'updateTaskAutomation=offline' });
    await rule(page, AR2).getByRole('checkbox', { name: 'Включено' }).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(rule(page, AR2).getByRole('checkbox', { name: 'Включено' })).not.toBeChecked();
    await devScenario(page, { scenario: null });
  });

  test('390 — без горизонтальной прокрутки; клавиатура; axe; цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openProjectTab(app, page, 'automation');
    await expect(rules(page)).toHaveCount(2);
    expect(await noHorizontalScroll(page)).toBe(true);
    const target = form(page).getByRole('textbox', { name: 'Название правила' });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    // Возврат 2: в хосте W4.12 (.ox-tasks button { color: inherit }) главная кнопка — белый текст 500, как у эталона.
    expect(await primaryText(page)).toEqual({ color: 'rgb(255, 255, 255)', weight: '500' });
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(
      await hitHeight(rule(page, AR1).getByRole('button', { name: 'Удалить правило' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(form(page).getByRole('button', { name: 'Добавить правило' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(target)).toBeGreaterThanOrEqual(44);
    // Возврат 1: флажок «Включено» — метка с флажком не ниже 44 px (verification-protocol §1.3).
    for (const name of [AR1, AR2]) {
      const label = rule(page, name).locator('label', { has: page.getByRole('checkbox') });
      expect(await hitHeight(label), name).toBeGreaterThanOrEqual(44);
    }
  });

  // Возврат 3: обязательные пункты §1.3 — вход из меню «Задачи», скелетон загрузки, ошибка с «Повторить».
  test('из меню «Задачи» → проект → «Автоматизация»; загрузка — скелетон; ошибка — «Повторить»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await openTasksFromMenu(page);
    await page.getByRole('button', { name: /Логистика · Север/ }).click();
    await tab(page, 'automation').click();
    await expect(tab(page, 'automation')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]view=automation/);
    await expect(rules(page)).toHaveCount(2);
    await openProjectTab(app, page, 'automation', {
      scenario: 'listTaskAutomations=delay=1500',
    });
    await expect(pane(page).locator('.ox-tset-skel')).toBeVisible();
    await expect(rules(page)).toHaveCount(2, { timeout: 15_000 });
    await openProjectTab(app, page, 'automation', {
      scenario: 'listTaskAutomations=rate_limited',
    });
    await expect(pane(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await pane(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(rules(page)).toHaveCount(2, { timeout: 15_000 });
  });

  // Возврат 3: пустые состояния эталона (ЗП:287, :308) — «Правил пока нет.» и «Запусков пока не было.».
  test('нет правил и запусков — «Правил пока нет.», «Запусков пока не было.»; форма доступна', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'automation', {
      scenario: 'listTaskAutomations=empty,listTaskAutomationRuns=empty',
    });
    await expect(pane(page).locator('.ox-tset-empty')).toHaveText('Правил пока нет.', {
      timeout: 15_000,
    });
    await expect(rules(page)).toHaveCount(0);
    await expect(pane(page).locator('.ox-tset-runs')).toContainText('Запусков пока не было.');
    await expect(runs(page)).toHaveCount(0);
    await expect(form(page).getByRole('button', { name: 'Добавить правило' })).toBeVisible();
    await devScenario(page, { scenario: null });
  });
});

test.describe('tasks-automation — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // Возврат 2: backend W4.11 в main — правила LOG сида на стенде.
  test('владелец на стенде: правила LOG', async ({ app, page }) => {
    test.slow();
    await openProjectTab(app, page, 'automation');
    await expect(rule(page, AR1)).toContainText('назначить на Марина Котова', { timeout: 15_000 });
  });
});
