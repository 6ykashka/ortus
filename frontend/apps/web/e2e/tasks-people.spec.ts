// W4.13 · e2e вкладки проекта `tasks-people` «Участники» (эталон design-2026-10-19 «Задачи и проекты.dc.html»
// :197–231, логика :439–455; DoR analysis/dor/tasks.md §1.3). Данные — MSW W4.03 (сид «Альты», проект LOG
// «Логистика · Север»); backend — W4.11 (режим stand). Обязательные пункты verification-protocol §1.3: меню и URL,
// состояния (загрузка, ошибка, нет связи, только чтение), клавиатура, axe, 390 / 1440.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';
import {
  checkBox,
  memberRows,
  openProjectTab,
  pane,
  primaryText,
  tab,
} from './tasks-settings.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const ROWS = ['Дарья Зимина', 'Марина Котова', 'Илья Васильев', 'Вера Котельникова'];

const levels = (page: Page): Locator => pane(page).getByRole('group', { name: 'Уровень доступа' });
const row = (page: Page, name: string): Locator =>
  memberRows(page).filter({ has: page.locator('.ox-tset-mname', { hasText: name }) });
const names = (page: Page): Locator => memberRows(page).locator('.ox-tset-mname');
const add = (page: Page): Locator => pane(page).locator('.ox-tset-add');

test.describe('tasks-people — «Участники» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню «Задачи» → проект → «Участники» и по прямому URL', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: 'Задачи' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Задачи' })
        .click();
    }
    await page.getByRole('button', { name: /Логистика · Север/ }).click();
    await tab(page, 'people').click();
    await expect(tab(page, 'people')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]view=people/);
    await expect(names(page)).toHaveText(ROWS);
    await page.reload();
    await expect(names(page)).toHaveText(ROWS, { timeout: 15_000 });
    await expect(tab(page, 'people')).toHaveAttribute('aria-selected', 'true');
  });

  test('«Кто видит проект»: описание, переключатель, тост «Доступ: открытый»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await expect(pane(page)).toContainText('Кто видит проект');
    await expect(pane(page)).toContainText(
      'Все в области видят; создают и меняют задачи участники проекта',
    );
    await expect(levels(page).getByRole('button')).toHaveText([
      'Открытый',
      'Ограниченный',
      'Закрытый',
    ]);
    await expect(levels(page).getByRole('button', { name: 'Ограниченный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await levels(page).getByRole('button', { name: 'Открытый' }).click();
    await expect(toast(page)).toHaveText('Доступ: открытый');
    await expect(pane(page)).toContainText(
      'Все с правом «Задачи» в области видят и работают с задачами',
    );
  });

  // Возврат 3: список проектов хоста W4.12 смонтирован всё время — после смены уровня его столбец «Доступ» новый.
  test('уровень → «← Проекты» → у LOG в столбце «Доступ» новый уровень; «Закрытый» без роли — LOG нет', async ({
    app,
    page,
  }) => {
    const logRow = page
      .locator('.ox-tk-prow')
      .filter({ has: page.locator('.ox-tk-key', { hasText: 'LOG' }) });
    const logAccess = logRow.locator('.ox-tk-acc');
    await openProjectTab(app, page, 'people');
    await expect(names(page)).toHaveText(ROWS);
    await levels(page).getByRole('button', { name: 'Открытый' }).click();
    await expect(toast(page)).toHaveText('Доступ: открытый');
    await page.locator('.ox-tk-back').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible();
    await expect(logAccess).toContainText('Открытый');
    await page.getByRole('button', { name: /Логистика · Север/ }).click();
    await tab(page, 'people').click();
    await expect(names(page)).toHaveText(ROWS);
    await levels(page).getByRole('button', { name: 'Закрытый' }).click();
    await expect(toast(page)).toHaveText('Доступ: закрытый');
    // Владелец без роли в закрытом проекте теряет к нему доступ (Q-W4.10-4, Q-W4.10-6: закрытый — только по роли в
    // проекте, в списке его нет) — хост возвращает к списку, где LOG уже нет, а не «Ограниченный».
    await expect(page.getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.ox-tk-prow').first()).toBeVisible();
    await expect(logRow).toHaveCount(0);
  });

  test('логист (роль в проекте): «Закрытый» → «← Проекты» — у LOG «Закрытый»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people', { persona: 'manager' });
    await expect(names(page)).toHaveText(ROWS);
    await levels(page).getByRole('button', { name: 'Закрытый' }).click();
    await expect(toast(page)).toHaveText('Доступ: закрытый');
    await page.locator('.ox-tk-back').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible();
    await expect(
      page
        .locator('.ox-tk-prow')
        .filter({ has: page.locator('.ox-tk-key', { hasText: 'LOG' }) })
        .locator('.ox-tk-acc'),
    ).toContainText('Закрытый');
  });

  test('таблица: роль, «Откуда доступ», «Что может», замок системной роли', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await expect(names(page)).toHaveText(ROWS);
    const owner = row(page, 'Дарья Зимина');
    await expect(owner).toContainText('Владелец бизнеса');
    await expect(owner).toContainText('Системная роль, вся организация');
    await expect(owner.getByRole('combobox')).toHaveCount(0);
    await expect(
      row(page, 'Марина Котова').getByRole('combobox', { name: 'Роль: Марина Котова' }),
    ).toHaveValue(/.+/);
    await expect(row(page, 'Илья Васильев')).toContainText(
      'Назначен через группу «Водители Север»',
    );
    await expect(row(page, 'Илья Васильев').locator('.ox-tset-cap')).toHaveText([
      'Читать',
      'Создавать',
      'Менять статус',
      'финансы скрыты',
    ]);
    await expect(pane(page)).toContainText(
      'Роль в проекте — это назначение роли с областью «проект»; оно видно и в «Пользователях и ролях». Унаследованный доступ (замок) меняется только там.',
    );
  });

  test('«Добавить» — «Роль назначена»; смена роли — «Роль изменена»; «Исключить»', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await add(page)
      .getByRole('combobox', { name: 'Сотрудник' })
      .selectOption({ label: 'Алексей Соколов' });
    await expect(add(page).getByRole('combobox', { name: 'Роль в проекте' })).toHaveValue(/.+/);
    await add(page)
      .getByRole('combobox', { name: 'Роль в проекте' })
      .selectOption({ label: 'Наблюдатель' });
    await add(page).getByRole('button', { name: 'Добавить' }).click();
    await expect(toast(page)).toHaveText('Роль назначена');
    await expect(names(page)).toContainText(['Алексей Соколов']);
    await row(page, 'Вера Котельникова')
      .getByRole('combobox', { name: 'Роль: Вера Котельникова' })
      .selectOption({ label: 'Исполнитель' });
    await expect(toast(page)).toHaveText('Роль изменена');
    await pane(page).getByRole('button', { name: 'Исключить Вера Котельникова' }).click();
    await expect(toast(page)).toHaveText('Вера Котельникова исключён из проекта');
    await expect(row(page, 'Вера Котельникова')).toHaveCount(0);
  });

  test('«Проверить доступ»: может / не может с причиной; «Роли проекта»', async ({ app, page }) => {
    await openProjectTab(app, page, 'people');
    const box = checkBox(page);
    await expect(box.getByRole('heading', { level: 3, name: 'Проверить доступ' })).toBeVisible();
    await expect(box.locator('.ox-tset-chk-text')).toHaveText(
      'Марина Котова может: назначен в проекте (роль «Руководитель проекта»)',
    );
    await box.getByRole('combobox', { name: 'Сотрудник' }).selectOption({ label: 'Илья Васильев' });
    await expect(box.locator('.ox-tset-chk-text')).toHaveText(
      'Илья Васильев не может: роль «Исполнитель» не даёт «Согласовывать»',
    );
    await box.getByRole('combobox', { name: 'Действие' }).selectOption({ label: 'Создавать' });
    await expect(box.locator('.ox-tset-chk-text')).toHaveText(
      'Илья Васильев может: назначен через группу «водители север» (роль «Исполнитель»)',
    );
    await expect(pane(page).locator('.ox-tset-role')).toHaveCount(4);
    await expect(pane(page)).toContainText('Состав прав ролей меняется в «Пользователях и ролях».');
  });

  test('исполнитель (водитель) — только чтение, «Проверить доступ» скрыт', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people', { persona: 'driver' });
    await expect(names(page)).toHaveText(ROWS);
    for (const b of await levels(page).getByRole('button').all()) await expect(b).toBeDisabled();
    await expect(add(page)).toHaveCount(0);
    await expect(pane(page).getByRole('button', { name: /^Исключить/ })).toHaveCount(0);
    await expect(checkBox(page)).toHaveCount(0);
  });

  test('ошибка загрузки — «Повторить»; нет связи при смене роли — тост', async ({ app, page }) => {
    await openProjectTab(app, page, 'people', { scenario: 'listTaskProjectMembers=rate_limited' });
    await expect(pane(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: 'setTaskProjectMemberRole=offline' });
    await pane(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(names(page)).toHaveText(ROWS, { timeout: 15_000 });
    await row(page, 'Вера Котельникова')
      .getByRole('combobox', { name: 'Роль: Вера Котельникова' })
      .selectOption({ label: 'Наблюдатель' });
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
  });

  test('1440 — боковая панель, 390 — нижняя навигация, таблица прокручивается в карточке', async ({
    app,
    page,
  }) => {
    await openProjectTab(app, page, 'people');
    await expect(names(page)).toHaveText(ROWS);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      const table = pane(page).locator('.ox-tset-table');
      expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до «Открытый», фокус виден; axe без serious; 390 — цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openProjectTab(app, page, 'people');
    await expect(names(page)).toHaveText(ROWS);
    const target = levels(page).getByRole('button', { name: 'Открытый' });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
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
    expect(await hitHeight(target)).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(add(page).getByRole('button', { name: 'Добавить' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(add(page).getByRole('combobox', { name: 'Сотрудник' })),
    ).toBeGreaterThanOrEqual(44);
  });

  // Возврат 1: у водителя (только чтение) в таблице нет полей — область прокрутки «Участники» берёт фокус сама
  // (axe scrollable-region-focusable), столбцы справа доступны с клавиатуры.
  test('водитель: таблица «Участники» — фокус с клавиатуры, прокрутка стрелкой; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openProjectTab(app, page, 'people', { persona: 'driver' });
    await expect(names(page)).toHaveText(ROWS);
    const table = pane(page).getByRole('region', { name: 'Участники' });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await table.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await table.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    if (phone(page)) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});

test.describe('tasks-people — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // Возврат 2: backend W4.11 в main — участники LOG сида на стенде.
  test('владелец на стенде: участники LOG', async ({ app, page }) => {
    test.slow();
    await openProjectTab(app, page, 'people');
    await expect(memberRows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(names(page)).toContainText(['Марина Котова']);
  });
});
