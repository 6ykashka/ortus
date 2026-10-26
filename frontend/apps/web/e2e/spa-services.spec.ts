// W5.21 · e2e страницы `spa-services` «Салон и SPA» — услуги и техкарты (no-reference, B-6: в прототипе нет экрана
// правки услуги; состав — API 0.12.0-stage5, screens.yaml `spa-services`; подписи по правилам эталона). Режим mock —
// MSW W5.21 на сиде «Альты» (три услуги эталона: техкарты масла 30/40/20 мл, крема 20 г; буферы визитов). Пункты
// verification-protocol §1.3: меню и URL, состояния, клавиатура, axe, 390 / 1440. Режим stand — после W5.20.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-spa"]');
const service = (page: Page, name: string): Locator => section(page).getByRole('article', { name });
const services = (page: Page): Locator => section(page).locator('article.ox-spa-service');

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { persona?: 'owner' | 'therapist'; search?: string } = {},
): Promise<void> {
  await openPage(app, page, `spa${o.search ?? '?tab=services'}`, { persona: o.persona ?? 'owner' });
  await expect(h1(page, o.persona === 'therapist' ? 'Мой день' : 'Салон и SPA')).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('spa-services — «Салон и SPA», услуги и техкарты @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('вкладка «Услуги и техкарты»: три услуги эталона с длительностью, буферами, ценой и техкартой', async ({
    app,
    page,
  }) => {
    await open(app, page, { search: '' });
    const tab = section(page).getByRole('tab', { name: 'Услуги и техкарты' });
    await expect(section(page).getByRole('tab', { name: 'Визиты' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await tab.click();
    await expect(page).toHaveURL(/[?&]tab=services/);
    await expect(services(page)).toHaveCount(3);
    const c = service(page, 'Классический массаж');
    await expect(c).toContainText('Длительность: 60 мин · уборка 15 мин · Цена: 3 200 ₽');
    await expect(c).toContainText('Оборудование: без оборудования');
    await expect(c).toContainText('Масло массажное 30 мл');
    await expect(c).toContainText('Версия 1');
    const r = service(page, 'SPA-ритуал');
    await expect(r).toContainText(
      'Длительность: 90 мин · подготовка 15 мин · уборка 15 мин · Цена: 6 500 ₽',
    );
    await expect(r).toContainText('Оборудование: Стол с подогревом');
    await expect(r.getByRole('listitem')).toHaveText([
      'Масло массажное 40 мл',
      'Крем восстанавливающий 20 г',
    ]);
    await page.reload();
    await expect(services(page)).toHaveCount(3, { timeout: 15_000 });
    await section(page).getByRole('tab', { name: 'Визиты' }).click();
    await expect(page).not.toHaveURL(/tab=services/);
  });

  test('новая услуга: ошибки полей, затем создание с техкартой', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новая услуга' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Новая услуга' })).toBeVisible();
    await d.getByRole('button', { name: 'Добавить услугу' }).click();
    await expect(d).toContainText('Укажите название');
    await expect(d).toContainText('Укажите цену числом');
    await d.getByLabel('Название').fill('Массаж лица');
    await d.getByLabel('Длительность').fill('30');
    await d.getByLabel('Цена').fill('1 800,50');
    await d.getByLabel('Уборка после визита').fill('10');
    await d.getByRole('button', { name: 'Добавить позицию' }).click();
    await d.getByRole('button', { name: 'Добавить услугу' }).click();
    await expect(d).toContainText('Выберите позицию в каждой строке техкарты');
    await d.getByLabel('Позиция 1').selectOption({ label: 'Масло массажное' });
    await d.getByLabel('Количество 1').fill('10');
    await d.getByRole('button', { name: 'Добавить услугу' }).click();
    await expect(toast(page)).toHaveText('Услуга «Массаж лица» добавлена');
    await expect(dialog(page)).toHaveCount(0);
    await expect(services(page)).toHaveCount(4);
    const n = service(page, 'Массаж лица');
    await expect(n).toContainText('Длительность: 30 мин · уборка 10 мин · Цена: 1 800,50 ₽');
    await expect(n).toContainText('Масло массажное 10 мл');
  });

  test('повтор названия — ошибка под полем «Название»', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новая услуга' }).click();
    const d = dialog(page);
    await d.getByLabel('Название').fill('SPA-ритуал');
    await d.getByLabel('Цена').fill('100');
    await d.getByRole('button', { name: 'Добавить услугу' }).click();
    await expect(d).toContainText('Услуга «SPA-ритуал» уже есть.');
    await expect(toast(page)).toHaveCount(0);
    await expect(d).toBeVisible();
  });

  test('правка услуги: версия растёт, длительность и цена обновляются', async ({ app, page }) => {
    await open(app, page);
    await service(page, 'Классический массаж')
      .getByRole('button', { name: /^Изменить/ })
      .click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Услуга «Классический массаж»' })).toBeVisible();
    await expect(d.getByLabel('Название')).toHaveValue('Классический массаж');
    await expect(d.getByLabel('Длительность')).toHaveValue('60');
    await expect(d.getByLabel('Цена')).toHaveValue('3200');
    await d.getByLabel('Длительность').fill('75');
    await d.getByLabel('Количество 1').fill('35');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Услуга «Классический массаж» сохранена');
    const c = service(page, 'Классический массаж');
    await expect(c).toContainText('Длительность: 75 мин');
    await expect(c).toContainText('Масло массажное 35 мл');
    await expect(c).toContainText('Версия 2');
  });

  test('специалист: вкладки услуг нет, адрес ?tab=services открывает визиты', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'therapist' });
    await expect(section(page).getByRole('tab')).toHaveCount(0);
    await expect(section(page).locator('article.ox-spa-card')).toHaveCount(3);
    await expect(services(page)).toHaveCount(0);
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home');
    const tenant = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listSpaServices=rate_limited' });
    await app(`/t/${tenant}/spa?tab=services`, { persona: 'owner' });
    await expect(section(page).getByRole('alert').first()).toContainText('Слишком много запросов');
    await devScenario(page, { scenario: 'listSpaServices=delay=1500' });
    await section(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(services(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test('клавиатура: Tab доходит до «Изменить», Enter открывает диалог, Escape возвращает фокус', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const target = service(page, 'Классический массаж').getByRole('button', { name: /^Изменить/ });
    await expect(target).toBeVisible();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(target).toBeFocused();
  });

  test('1440 — боковая панель, 390 — нижняя навигация; axe без serious; цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await expect(services(page)).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await bad()).toEqual([]);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      expect(
        await hitHeight(section(page).getByRole('button', { name: 'Новая услуга' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(
          service(page, 'Классический массаж').getByRole('button', { name: /^Изменить/ }),
        ),
      ).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await section(page).getByRole('button', { name: 'Новая услуга' }).click();
    await dialog(page).getByRole('button', { name: 'Добавить позицию' }).click();
    expect(await bad()).toEqual([]);
  });
});

test.describe('spa-services — «Салон и SPA», услуги и техкарты @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('@stand-spec услуги на настоящем backend (причина: backend SPA — W5.20, ещё не в main)', () => {});
});
