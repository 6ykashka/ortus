// W4.13 · e2e старой доски `tasks-leads` «Заявки» (`/t/:tenantId/leads`; эталон design-2026-10-19 «Ортус CRM.dc.html»
// :1600–1705, tasksVM :4443–4504; Q-W4.00-tasks-15 — переносится как есть). Данные — MSW W4.03 (воронка ЗАЯ
// «Заявки · Ремонт», flow leads); backend — W4.11 (режим stand). Обязательные пункты verification-protocol §1.3.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';
import { leads, openLeads, openTasksFromMenu } from './tasks-settings.helpers.ts';

const cards = (page: Page): Locator => leads(page).locator('.ox-leads-card');
const card = (page: Page, key: string): Locator =>
  cards(page).filter({ has: page.locator('.ox-leads-id', { hasText: key }) });
const cols = (page: Page): Locator => leads(page).locator('.ox-leads-col');
const aside = (page: Page): Locator => page.getByRole('complementary', { name: 'Карточка задачи' });

async function open(
  app: Parameters<typeof openLeads>[0],
  page: Page,
  o: Parameters<typeof openLeads>[2] = {},
) {
  const id = await openLeads(app, page, o);
  await expect(h1(page, 'Заявки')).toBeVisible({ timeout: 15_000 });
  return id;
}

test.describe('tasks-leads — «Заявки» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из списка проектов «Задач» и по прямому URL: крошка, этапы воронки', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page);
    await expect(leads(page).locator('.ox-leads-crumb')).toHaveText('Проект ЗАЯ · Заявки · Ремонт');
    await expect(leads(page).locator('.ox-leads-colname')).toHaveText([
      'Новая',
      'Замер',
      'Смета',
      'Договор',
      'Объект',
    ]);
    await expect(cards(page)).toHaveCount(5);
    await expect(card(page, 'L-31')).toContainText('Квартира 64 м², Химки');
    await expect(card(page, 'L-31')).toContainText('срок 03.10');
    await leads(page).getByRole('button', { name: 'Все проекты' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/tasks`));
    await page.getByRole('button', { name: /Заявки · Ремонт/ }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/leads`));
    await expect(cards(page)).toHaveCount(5);
  });

  test('«Канбан / Список», «Мои задачи»', async ({ app, page }) => {
    await open(app, page);
    await leads(page)
      .getByRole('group', { name: 'Вид' })
      .getByRole('button', { name: 'Список' })
      .click();
    await expect(leads(page).locator('.ox-leads-row')).toHaveCount(5);
    await expect(leads(page).locator('.ox-leads-row').nth(3)).toContainText('Договор');
    await leads(page)
      .getByRole('combobox', { name: 'Исполнитель' })
      .selectOption({ label: 'Мои задачи' });
    await expect(leads(page).locator('.ox-leads-row')).toHaveCount(3);
  });

  test('карточка: «Перевести» — тост, чек-лист, комментарий; ?task= сохраняется', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await card(page, 'L-31').click();
    await expect(
      aside(page).getByRole('heading', { level: 2, name: 'Квартира 64 м², Химки' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/[?&]task=/);
    await expect(aside(page)).toContainText('L-31 · ЗАЯ');
    await expect(aside(page).getByRole('button', { name: '← Отказ' })).toBeVisible();
    await aside(page).getByRole('button', { name: 'Замер', exact: true }).click();
    await expect(toast(page)).toHaveText('L-31: Замер');
    await expect(cols(page).nth(1).locator('.ox-leads-count')).toHaveText('2');
    await aside(page).getByRole('checkbox', { name: 'Перезвонить и назначить замер' }).click();
    await expect(aside(page)).toContainText('Чек-лист · 1 из 1');
    await aside(page).getByRole('textbox', { name: 'Комментарий' }).fill('Замер в пятницу');
    await aside(page).getByRole('button', { name: 'Отправить комментарий' }).click();
    await expect(aside(page)).toContainText('Замер в пятницу');
    await page.reload();
    await expect(aside(page).getByRole('heading', { level: 2 })).toHaveText(
      'Квартира 64 м², Химки',
      {
        timeout: 15_000,
      },
    );
    await aside(page).getByRole('button', { name: 'Закрыть карточку' }).click();
    await expect(aside(page)).toHaveCount(0);
  });

  test('«Задача»: «Укажите название задачи», «Задача создана» — карточка ЗАЯ-101', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await leads(page).getByRole('button', { name: 'Задача', exact: true }).click();
    const form = leads(page).locator('.ox-leads-form');
    await form.getByRole('button', { name: 'Создать' }).click();
    await expect(form.getByRole('alert')).toHaveText('Укажите название задачи');
    await form.getByLabel('Название').fill('Квартира 70 м², Мытищи');
    await form.getByLabel('Приоритет').selectOption({ label: 'Высокий' });
    await form.getByLabel('Срок').fill('2026-10-12');
    await form.getByRole('button', { name: 'Создать' }).click();
    await expect(toast(page)).toHaveText('Задача создана');
    await expect(aside(page)).toContainText('ЗАЯ-101 · ЗАЯ');
    await expect(aside(page)).toContainText('12.10');
    await expect(cols(page).first().locator('.ox-leads-count')).toHaveText('2');
  });

  test('нет воронок — «Нет проектов в вашей области»; ошибка — «Повторить»', async ({
    app,
    page,
  }) => {
    // Возврат 1: без проекта эталон — крошка «Мои задачи» и h1 WORKFLOWS.tasks.items «Задачи».
    await openLeads(app, page, { persona: 'manager' });
    await expect(h1(page, 'Задачи')).toBeVisible({ timeout: 15_000 });
    await expect(leads(page).locator('.ox-leads-crumb')).toHaveText('Мои задачи');
    await expect(leads(page)).toContainText('Нет проектов в вашей области');
    await expect(leads(page).getByRole('button', { name: 'Задача', exact: true })).toHaveCount(0);
    await open(app, page, { scenario: 'listTasks=rate_limited' });
    await expect(leads(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await leads(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(cards(page)).toHaveCount(5, { timeout: 15_000 });
  });

  test('390 / 1440 — без горизонтальной прокрутки; клавиатура; axe; цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await card(page, 'L-24').click();
    await expect(aside(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const target = card(page, 'L-31');
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    expect(
      await hitHeight(leads(page).getByRole('button', { name: 'Все проекты' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(leads(page).getByRole('button', { name: 'Список' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(aside(page).getByRole('button', { name: 'Закрыть карточку' })),
    ).toBeGreaterThanOrEqual(44);
    // Возврат 3: строка чек-листа карточки — метка с флажком не ниже 44 px (PD-28), как флажки вкладок проекта.
    await card(page, 'L-31').click();
    const item = aside(page).locator('label.ox-leads-check', {
      has: page.getByRole('checkbox', { name: 'Перезвонить и назначить замер' }),
    });
    await expect(item).toBeVisible();
    expect(await hitHeight(item)).toBeGreaterThanOrEqual(44);
  });

  // Возврат 1: колонка пустеет после «Перевести» — «Пусто» на фоне колонки с контрастом ≥ 4,5:1 (axe color-contrast).
  test('пустая колонка после «Перевести» — «Пусто»; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await card(page, 'L-31').click();
    await aside(page).getByRole('button', { name: 'Замер', exact: true }).click();
    await expect(toast(page)).toHaveText('L-31: Замер');
    const empty = cols(page).first().locator('.ox-leads-colempty');
    await expect(empty).toHaveText('Пусто');
    // axe сверяет контраст видимого текста: тост ушёл, «Пусто» — в окне.
    await expect(toast(page)).toHaveCount(0, { timeout: 10_000 });
    await empty.scrollIntoViewIfNeeded();
    await page.waitForLoadState('networkidle');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

  // Возврат 1: обязательные пункты §1.3 — вход из меню «Задачи» → строка воронки; загрузка — скелетон.
  test('из меню «Задачи» → «Заявки · Ремонт»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await openTasksFromMenu(page);
    await page.getByRole('button', { name: /Заявки · Ремонт/ }).click();
    await expect(page).toHaveURL(/\/leads/);
    await expect(h1(page, 'Заявки')).toBeVisible();
    await expect(cards(page)).toHaveCount(5);
    await open(app, page, { scenario: 'listTasks=delay=1500' });
    await expect(leads(page).locator('.ox-tset-skel')).toBeVisible();
    await expect(cards(page)).toHaveCount(5, { timeout: 15_000 });
    await devScenario(page, { scenario: null });
  });
});

test.describe('tasks-leads — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // Возврат 2: backend W4.11 в main — воронка ЗАЯ сида на стенде.
  test('владелец на стенде: воронка «Заявки»', async ({ app, page }) => {
    test.slow();
    await open(app, page);
    await expect(leads(page).locator('.ox-leads-crumb')).toHaveText('Проект ЗАЯ · Заявки · Ремонт');
    await expect(card(page, 'L-31')).toContainText('Квартира 64 м², Химки');
  });
});
