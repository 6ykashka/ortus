// W2.41 · e2e страницы `company-expense-categories` «Категории расходов» (D-12 комплекта, ответ владельца 17.10:
// справочник тенанта с посевом шести категорий, «Прочее» с обязательным комментарием; no-reference — экрана в эталоне
// нет, Q-W2.40-3). Вне меню, вход — «Связанные разделы» «Приёмки смен» (Q-W2.41-2). Обязательные пункты
// verification-protocol §1.3: прямой URL, загрузка, ошибка, только чтение, нет права, нет связи, клавиатура, axe,
// раскладка 390 / 1440. Форма расхода водителя из справочника — driver-today.spec.ts.
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { label, logisticsOn, realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Категории расходов';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const SEED = [
  'Топливо',
  'Мойка',
  'Парковка',
  'Платная дорога',
  'Шиномонтаж и мелкий ремонт',
  'Прочее',
];

const active = (page: Page) => page.getByRole('list', { name: 'Активные категории' });
const archived = (page: Page) => page.getByRole('list', { name: 'Категории в архиве' });
const row = (page: Page, name: string) =>
  active(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) });

/** Владелец «Альты» с подключённой «Логистикой» (пресет logistics-ready) на странице справочника. */
async function open(
  app: (route: string, o?: { persona?: Persona }) => Promise<unknown>,
  page: Page,
) {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app(`/t/${alta}/expense-categories`, { persona: 'owner' });
  await expect(h1(page, H1)).toBeVisible();
  return alta;
}

test.describe('company-expense-categories — категории расходов @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('вход из «Связанных разделов» «Приёмки смен» и прямой URL', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'owner' });
    await page
      .getByRole('navigation', { name: 'Связанные разделы' })
      .getByRole('button', { name: H1 })
      .click();
    await expect(page).toHaveURL(/\/expense-categories$/);
    await expect(h1(page, H1)).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  });

  test('шесть категорий посева по порядку; у «Прочее» комментарий обязателен и архива нет', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
    for (const [i, name] of SEED.entries()) {
      await expect(active(page).getByRole('listitem').nth(i)).toContainText(name);
    }
    await expect(row(page, 'Прочее')).toContainText('Комментарий обязателен');
    await expect(row(page, 'Прочее')).toContainText('Не убирается в архив');
    await expect(row(page, 'Прочее').getByRole('button')).toHaveCount(0);
    await expect(
      row(page, 'Мойка').getByRole('button', { name: 'Убрать в архив: Мойка' }),
    ).toBeVisible();
  });

  test('добавление: пустое название — ошибка поля; новая категория в списке, тост', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const form = page.getByRole('form', { name: 'Новая категория' });
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Укажите название категории');
    await form.getByLabel('Название').fill('Стоянка на ночь');
    await form.getByLabel('Комментарий обязателен').check();
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(toast(page)).toHaveText('Категория «Стоянка на ночь» добавлена');
    await expect(row(page, 'Стоянка на ночь')).toContainText('Комментарий обязателен');
    await expect(active(page).getByRole('listitem')).toHaveCount(7);
    await expect(form.getByLabel('Название')).toHaveValue('');
  });

  test('дубль подписи без учёта регистра — ошибка сервера под полем', async ({ app, page }) => {
    await open(app, page);
    const form = page.getByRole('form', { name: 'Новая категория' });
    await form.getByLabel('Название').fill(' мойка ');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Такая категория уже есть');
    await expect(form.getByLabel('Название')).toHaveAttribute('aria-invalid', 'true');
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
  });

  test('архивация с подтверждением: тост, категория в архиве с датой', async ({ app, page }) => {
    await open(app, page);
    await row(page, 'Платная дорога')
      .getByRole('button', { name: 'Убрать в архив: Платная дорога' })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Убрать «Платная дорога» в архив?' });
    await expect(dlg).toContainText('Водители больше не смогут выбрать её в новых расходах.');
    await dlg.getByRole('button', { name: 'Убрать в архив' }).click();
    await expect(toast(page)).toHaveText('Категория «Платная дорога» убрана в архив');
    await expect(dlg).toBeHidden();
    await expect(active(page).getByRole('listitem')).toHaveCount(5);
    await page.getByRole('button', { name: 'Показать архив (1)' }).click();
    await expect(archived(page).getByRole('listitem')).toHaveCount(1);
    await expect(archived(page)).toContainText('Платная дорога');
    await expect(archived(page)).toContainText(/В архиве с \d\d\.\d\d\.\d{4}/);
    await page.getByRole('button', { name: 'Скрыть архив' }).click();
    await expect(archived(page)).toBeHidden();
  });

  test('ошибка загрузки — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listExpenseCategories=rate_limited' });
    await app(`/t/${alta}/expense-categories`, { persona: 'owner' });
    await expect(page.getByText(/^Не удалось загрузить категории: /)).toHaveText(
      'Не удалось загрузить категории: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
  });

  test('загрузка — скелетон; крошка владельца; 1440 — боковая панель, 390 — нижняя навигация', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listExpenseCategories=delay=1500' });
    await app(`/t/${alta}/expense-categories`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
    await expect(
      page.locator('section[aria-labelledby="h-expense-categories"] .ox-rv-crumb'),
    ).toHaveText('Альта Групп · все подразделения');
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('нет связи при добавлении: тост «нет связи», название сохраняется', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const form = page.getByRole('form', { name: 'Новая категория' });
    await form.getByLabel('Название').fill('Ремни и стяжки');
    await devScenario(page, { scenario: 'createExpenseCategory=offline' });
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(form.getByLabel('Название')).toHaveValue('Ремни и стяжки');
    await devScenario(page, { scenario: null });
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
  });

  test('организация только для чтения: список виден, формы и архивации нет', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${alta}/expense-categories`, { persona: 'owner' });
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
    await expect(page.getByRole('form', { name: 'Новая категория' })).toHaveCount(0);
    await expect(active(page).getByRole('button', { name: /Убрать в архив/ })).toHaveCount(0);
  });

  test('менеджер без настроек модуля и водитель — гейт, ссылки в «Приёмке смен» нет', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'manager' });
    await expect(page.getByRole('heading', { level: 1, name: 'Приёмка смен' })).toBeVisible();
    await expect(page.getByRole('button', { name: H1 })).toHaveCount(0);
    for (const who of ['manager', 'driver'] as const) {
      await app(`/t/${alta}/expense-categories`, { persona: who });
      await expect(page.getByText(/Нет роли с доступом|Нет доступа/).first()).toBeVisible();
      await expect(active(page)).toHaveCount(0);
    }
  });

  test('клавиатура: Tab до «В архив», Enter — диалог, Escape закрывает, фокус возвращается; axe', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    const btn = row(page, 'Мойка').getByRole('button', { name: 'Убрать в архив: Мойка' });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await btn.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Убрать «Мойка» в архив?' });
    await expect(dlg).toBeVisible();
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(active(page).getByRole('listitem')).toHaveCount(6);
  });

  test('390: цели не меньше 44 px, без горизонтальной прокрутки; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (!phone(page)) return;
    const form = page.getByRole('form', { name: 'Новая категория' });
    expect(await hitHeight(form.getByLabel('Название'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(form.getByRole('button', { name: 'Добавить' }))).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      await hitHeight(row(page, 'Мойка').getByRole('button', { name: 'Убрать в архив: Мойка' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// Стенд (W2.41): справочник — tenant 0015 и модуль fleet/expenses на стенде слота. Строка добавляет свою категорию
// с меткой прогона и убирает её в архив — удаления у справочника нет (Q-W2.52-2), архивная остаётся в tenant DB
// стенда и не мешает следующим прогонам (подпись уникальна только среди активных).
// Возврат 1: дубль подписи — 422 сервера без violations (problem.Body), текст detail под полем, без тоста.
test.describe('company-expense-categories — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: посев, дубль подписи, добавление и архивация своей категории', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/expense-categories`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    for (const name of SEED) await expect(active(page)).toContainText(name);
    const form = page.getByRole('form', { name: 'Новая категория' });
    const before = await active(page).getByRole('listitem').count();
    await form.getByLabel('Название').fill(' мойка ');
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(form.getByRole('alert')).toHaveText('Такая категория уже есть', {
      timeout: 15_000,
    });
    await expect(form.getByLabel('Название')).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByLabel('Название')).toHaveValue(' мойка ');
    await expect(toast(page)).toHaveCount(0);
    await expect(active(page).getByRole('listitem')).toHaveCount(before);
    const name = `Стенд ${label(testInfo.project.name)}`;
    await form.getByLabel('Название').fill(name);
    await form.getByRole('button', { name: 'Добавить' }).click();
    await expect(toast(page)).toHaveText(`Категория «${name}» добавлена`, { timeout: 15_000 });
    await row(page, name)
      .getByRole('button', { name: `Убрать в архив: ${name}` })
      .click();
    await page
      .getByRole('dialog', { name: `Убрать «${name}» в архив?` })
      .getByRole('button', { name: 'Убрать в архив' })
      .click();
    await expect(toast(page)).toHaveText(`Категория «${name}» убрана в архив`, { timeout: 15_000 });
    await expect(row(page, name)).toHaveCount(0);
    const r = await call(
      page,
      'GET',
      `/api/v1/tenants/${s.tenant}/fleet/expense-categories?includeArchived=true`,
    );
    expect(r.status).toBe(200);
    const items = (r.body as { items: { label: string; state: string }[] }).items;
    expect(items.find((c) => c.label === name)?.state).toBe('archived');
  });
});
