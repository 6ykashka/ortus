// W4.12 · e2e экрана `tasks-projects` «Проекты» модуля «Задачи и проекты» (эталон design-2026-10-19
// «Задачи и проекты.dc.html» ЗП:24–47, 352–362; разбор docs/plan/v2/analysis/dor/tasks.md §1.3). Проекты —
// listTaskProjects сценарного сервера W4.03 на сиде W4.10 («Альта»: LOG и воронка ЗАЯ). Обязательные пункты
// verification-protocol §1.3: меню и URL, состояния (загрузка, ошибка, пусто/403), клавиатура, axe, 390 / 1440.
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight, noHorizontalScroll, openPage } from './modules.helpers.ts';
import { devScenario, LOTOS } from './shell.helpers.ts';
import {
  LEADS,
  LOG,
  openTasks,
  phone,
  projectRow,
  projectRows,
  projectsReady,
  ringVisible,
  root,
  tab,
  tabTo,
} from './tasks.helpers.ts';

const HINT =
  'Права в проекте отдельно не настраиваются: действуют роли из «Пользователей и ролей» с областью фирмы, региона или самого проекта. Одна роль — одинаковые права во всех проектах.';

test.describe('tasks-projects — «Проекты» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню «Задачи» и по прямому URL: заголовок, подпись, таблица, подсказка', async ({
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
    await projectsReady(page);
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(root(page)).toContainText('Видны проекты, где у вас есть право «Задачи · Читать»');
    await expect(root(page).locator('.ox-tk-thead')).toHaveText(
      /Проект\s*Область\s*Доступ\s*Людей\s*Открыто/,
    );
    await expect(root(page)).toContainText(HINT);
    await page.reload();
    await expect(projectRows(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('владелец: LOG и воронка ЗАЯ — ключ, владелец и процесс, область, доступ, людей, открыто', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await projectsReady(page);
    await expect(projectRows(page)).toHaveCount(2);
    const log = projectRow(page, LOG);
    await expect(log.locator('.ox-tk-key')).toHaveText('LOG');
    await expect(log).toContainText('Марина Котова · процесс v1');
    await expect(log).toContainText('Север Логистик');
    await expect(log).toContainText('Ограниченный');
    await expect(log.locator('.ox-tk-num').first()).toHaveText('3');
    await expect(log.locator('.ox-tk-num').last()).toHaveText('5');
    const leads = projectRow(page, LEADS);
    await expect(leads.locator('.ox-tk-key')).toHaveText('ЗАЯ');
    await expect(leads).toContainText('Дарья Зимина · воронка заявок');
    await expect(leads).toContainText('Воронка');
    await expect(leads.locator('.ox-tk-num').first()).toHaveText('—');
    await expect(root(page).getByRole('button', { name: 'Новый проект' })).toBeVisible();
  });

  test('строка открывает доску проекта (?project=), «Проекты» возвращает; воронка — старая доска', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await projectsReady(page);
    await projectRow(page, LOG).click();
    await expect(tab(page, 'Доска')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]project=/);
    await root(page).getByRole('button', { name: 'Проекты', exact: true }).click();
    await projectsReady(page);
    await expect(page).not.toHaveURL(/project=/);
    await projectRow(page, LEADS).click();
    await expect(page).toHaveURL(/\/leads$/);
  });

  test('прораб: «Проектов, доступных вам, пока нет», без «Новый проект» (403 listTaskProjects)', async ({
    app,
    page,
  }) => {
    await openTasks(app, page, { persona: 'foreman' });
    await projectsReady(page);
    await expect(root(page)).toContainText('Проектов, доступных вам, пока нет');
    await expect(projectRows(page)).toHaveCount(0);
    await expect(root(page).getByRole('button', { name: 'Новый проект' })).toHaveCount(0);
  });

  // Возврат 1: пустой список прораба на 390 прокручивается — контейнер фокусируем (axe scrollable-region-focusable).
  test('прораб, пустой список: axe без serious; прокручиваемая таблица фокусируема с клавиатуры', async ({
    app,
    page,
    axe,
  }) => {
    await openTasks(app, page, { persona: 'foreman' });
    await projectsReady(page);
    await expect(root(page)).toContainText('Проектов, доступных вам, пока нет');
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    const table = root(page).getByRole('region', { name: 'Таблица проектов' });
    expect(await tabTo(page, table, 60)).toBe(true);
    expect(await ringVisible(table)).toBe(true);
  });

  test('логист (руководитель LOG): только LOG, без «Новый проект» (PD-53)', async ({
    app,
    page,
  }) => {
    await openTasks(app, page, { persona: 'manager' });
    await projectsReady(page);
    await expect(projectRow(page, LOG)).toBeVisible();
    await expect(root(page).getByRole('button', { name: 'Новый проект' })).toHaveCount(0);
  });

  test('владелец «Лотоса»: «Салон · Тверская» — SPA, процесс v1 (Q-W4.00-tasks-3)', async ({
    app,
    page,
  }) => {
    await openTasks(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await projectsReady(page);
    await expect(projectRow(page, 'Салон · Тверская').locator('.ox-tk-key')).toHaveText('SPA');
    await expect(projectRow(page, 'Салон · Тверская')).toContainText('Ирина Белова · процесс v1');
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    const id = await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'listTaskProjects=rate_limited' });
    await app(`/t/${id}/tasks`, { persona: 'owner' });
    await expect(root(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: 'listTaskProjects=delay=1500' });
    await root(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(root(page).getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(projectRows(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('1440 — боковая панель; 390 — нижняя навигация, таблица прокручивается в карточке', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await projectsReady(page);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      const table = root(page).locator('.ox-tk-table');
      expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до строки проекта, Enter открывает доску; фокус виден', async ({
    app,
    page,
  }) => {
    await openTasks(app, page);
    await projectsReady(page);
    const target = projectRow(page, LOG);
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(tab(page, 'Доска')).toHaveAttribute('aria-selected', 'true');
  });

  test('axe без serious; 390 — цели не меньше 44 px', async ({ app, page, axe }) => {
    await openTasks(app, page);
    await projectsReady(page);
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(await hitHeight(projectRow(page, LOG))).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(root(page).getByRole('button', { name: 'Новый проект' })),
    ).toBeGreaterThanOrEqual(44);
  });
});

// Backend задач — W4.11 (Go-сид: проекты LOG и воронка, задача T-65).
test.describe('tasks-projects — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: проекты Go-сида (W4.11)', async ({ app, page }) => {
    test.slow();
    await openTasks(app, page);
    await projectsReady(page);
    await expect(projectRow(page, LOG)).toBeVisible();
  });
});
