// W4.23 · e2e экрана `forms-versions` — вкладка «Версии» (эталон design-2026-10-19 «Формы и опросы.dc.html» dc:440–454,
// versVM dc:1012–1020; разбор forms.md §1.9). «Осмотр машины» «Альты»: v1 (02.09), v2 (10.09), v3 (24.09, действует).
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  devScenario,
  editor,
  formIdOf,
  FOREMAN,
  INSP,
  openForm,
  phone,
  reopen,
  serious,
  smallTargets,
  tab,
} from './forms-results.helpers.ts';
import { noHorizontalScroll } from './modules.helpers.ts';
import { tenantId } from './shell.helpers.ts';

const panel = (page: Page) => page.locator('.ox-fr-vs');
const list = (page: Page) => panel(page).locator('.ox-fr-vlist > button');
const ver = (page: Page) => panel(page).locator('.ox-fr-ver');
const q = (page: Page, label: string) =>
  ver(page)
    .locator('.ox-fr-vq')
    .filter({ has: page.getByText(label, { exact: true }) });

test.describe('forms-versions — «Версии» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.setTimeout(90_000);

  test('список версий: новая первой, «Действует», мета; структура v3 с отличиями от v2', async ({
    app,
    page,
  }) => {
    await openForm(app, page, { tab: 'versions' });
    await expect(tab(page, 'versions')).toContainText('3');
    await expect(list(page).locator('strong')).toHaveText(['Версия 3', 'Версия 2', 'Версия 1']);
    await expect(list(page).first()).toContainText('Действует');
    await expect(list(page).first()).toContainText('24.09.2026 · Дарья Зимина · вопросов: 7');
    await expect(list(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(ver(page).getByRole('heading', { level: 3 })).toHaveText(
      'Структура версии 3 · неизменяема',
    );
    await expect(ver(page).locator('.ox-fr-vpage')).toHaveText([
      'Фото',
      'Показания',
      'Проверка',
      'Дефекты',
    ]);
    await expect(q(page, 'Пробег по одометру, км')).toContainText(
      'ID q-odo · Число · обязательный',
    );
    await expect(q(page, 'Пробег по одометру, км').locator('.ox-fr-chip')).toHaveCount(0);
    await expect(q(page, 'Уровень топлива')).toContainText('Добавлено');
    await expect(q(page, 'Описание дефекта')).toContainText(
      'ID q-defect-text · Короткий текст · обязательный · если «Есть дефекты?» = да',
    );
    await expect(ver(page)).toContainText(
      'Убрано относительно предыдущей версии: «Уровень топлива»',
    );
  });

  test('выбор v2 — «Текст изменён» у вопросов v1; v1 — без отличий', async ({ app, page }) => {
    await openForm(app, page, { tab: 'versions' });
    await list(page).nth(1).click();
    await expect(list(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(ver(page).getByRole('heading', { level: 3 })).toHaveText(
      'Структура версии 2 · неизменяема',
    );
    await expect(q(page, 'Пробег по одометру, км')).toContainText('Текст изменён');
    await expect(q(page, 'Чек-лист: кузов, шины, документы')).toContainText('Добавлено');
    await list(page).nth(2).click();
    await expect(ver(page).locator('.ox-fr-chip')).toHaveCount(0);
  });

  test('черновик без версий — «Форма ещё не публиковалась»', async ({ app, page }) => {
    await openForm(app, page, { tab: 'versions', name: FOREMAN });
    await expect(panel(page)).toContainText('Форма ещё не публиковалась');
    await expect(tab(page, 'versions')).toContainText('0');
  });

  test('ошибка загрузки версий — «Повторить» (цель 44 px на телефоне)', async ({ app, page }) => {
    // Редактор W4.22 читает версии сам (флаги и заметки конструктора): отказ — с первого чтения, по прямому URL.
    await openForm(app, page, {
      tab: 'versions',
      before: () => devScenario(page, { scenario: 'listFormVersions=rate_limited' }),
    });
    await expect(panel(page).getByRole('alert')).toContainText('Не удалось загрузить данные');
    if (phone(page)) expect(await smallTargets(panel(page))).toEqual([]);
    await devScenario(page, { scenario: null });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(list(page)).toHaveCount(3);
  });

  test('открывается из меню «Формы и опросы» и по прямому URL с `&tab=versions`', async ({
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
    await tab(page, 'versions').click();
    await expect(page).toHaveURL(/[?&]tab=versions/);
    await expect(list(page)).toHaveCount(3);
    // Прямой URL заново — через фикстуру `app` (ждёт service worker MSW): голый page.reload изредка уходит мимо MSW.
    await reopen(app, page);
    await expect(tab(page, 'versions')).toHaveAttribute('aria-selected', 'true');
    await expect(list(page)).toHaveCount(3);
  });

  test('загрузка — скелет во всю ширину вкладки', async ({ app, page }) => {
    await openForm(app, page, {
      tab: 'versions',
      before: () => devScenario(page, { scenario: 'listFormVersions=loading' }),
    });
    const sk = panel(page).getByRole('status', { name: 'Загрузка' });
    await expect(sk).toBeVisible();
    const box = await sk.locator('span').first().boundingBox();
    const outer = await panel(page).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan((outer?.width ?? 0) * 0.9);
    await devScenario(page, { scenario: null });
  });

  test('нет связи — «Не удалось загрузить данные: Нет связи…», «Повторить»', async ({
    app,
    page,
  }) => {
    await openForm(app, page, {
      tab: 'versions',
      before: () => devScenario(page, { scenario: 'listFormVersions=offline' }),
    });
    await expect(panel(page).getByRole('alert')).toContainText('Не удалось загрузить данные');
    await devScenario(page, { scenario: null });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(list(page)).toHaveCount(3);
  });

  test('логист — только просмотр: плашка, версии читаются и выбираются', async ({ app, page }) => {
    await openForm(app, page, { tab: 'versions', persona: 'manager' });
    await expect(editor(page)).toContainText('Только просмотр · нет права «Настраивать» формы');
    await expect(list(page)).toHaveCount(3);
    await list(page).nth(1).click();
    await expect(ver(page).getByRole('heading', { level: 3 })).toHaveText(
      'Структура версии 2 · неизменяема',
    );
  });

  test('нет права: логист без роли в «Формах» — раздел закрыт', async ({ app, page }) => {
    // Без пресета «Логистика подключена» у Марины Котовой нет роли с правами «Форм».
    await app('/', { persona: 'owner' });
    await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
      .catch(() => undefined);
    const tenant = await tenantId(page);
    const form = await formIdOf(page, tenant, INSP);
    await app(`/t/${tenant}/forms?form=${form}&tab=versions`, { persona: 'manager' });
    await expect(page.getByRole('heading', { name: /Нет доступа|не подключ/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel(page)).toHaveCount(0);
  });

  test('клавиатура: Tab по версиям, Enter выбирает версию', async ({ app, page }) => {
    await openForm(app, page, { tab: 'versions' });
    await list(page).first().focus();
    await page.keyboard.press('Tab');
    await expect(list(page).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(ver(page).getByRole('heading', { level: 3 })).toHaveText(
      'Структура версии 2 · неизменяема',
    );
  });

  test('390 / 1440: без горизонтальной прокрутки, цели 44 px, axe', async ({ app, page, axe }) => {
    await openForm(app, page, { tab: 'versions' });
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) expect(await smallTargets(panel(page))).toEqual([]);
    expect(await serious(page, axe)).toEqual([]);
  });
});

test.describe('forms-versions — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('владелец на стенде: версии «Осмотра машины»', async ({ app, page }) => {
    // W4.21: listFormVersions стенда — до W4.21 тег Forms отвечает 501.
    await openForm(app, page, { tab: 'versions' });
    await expect(list(page)).toHaveCount(3);
  });
});
