// W2.20 · e2e страницы `logistics-plan` «Планирование рейса» (S2-13; no-reference — design-requests.md
// `logistics-plan`, 14-stage2-dor.md §4): форма на рабочем месте логиста (`/t/:id/fleet?plan=new`, ADR-0001 —
// состояние страницы в search-параметрах), createTripPlan, загрузка по участкам (legs домена), 422 по точкам.
// Пиксельной и структурной сверки нет (allowlist/logistics-plan.md), e2e и проходка — да.
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { FLEET_H1, openFleet, PLAN_H1, phone, tab, tabs } from './logistics.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const form = (page: Page) => page.getByRole('form', { name: PLAN_H1 });
const stop = (page: Page, n: number) => page.getByRole('group', { name: `Точка ${n}` });
const fill = async (
  scope: ReturnType<typeof form>,
  label: string,
  value: string,
): Promise<void> => {
  await scope.getByLabel(label, { exact: true }).fill(value);
};

/** Открыть форму с рабочего места кнопкой «Запланировать рейс». */
async function openPlan(page: Page): Promise<void> {
  await expect(h1(page, FLEET_H1)).toBeVisible();
  await page.getByRole('button', { name: 'Запланировать рейс' }).click();
  await expect(page).toHaveURL(/[?&]plan=new/);
  await expect(h1(page, PLAN_H1)).toBeVisible();
}

/** Рейс «Вечерний развоз»: 0,8 т и 6 м³ — погрузка в Лобне, выгрузка в Химках. */
async function fillTrip(page: Page, o: { unloadMass?: string } = {}): Promise<void> {
  const f = form(page);
  await fill(f, 'Название рейса', 'Вечерний развоз');
  await fill(f, 'Начало', '18:00');
  await fill(f, 'Окончание', '21:00');
  await fill(f, 'Что везём', 'Сухой груз · 4 паллеты');
  await fill(f, 'Масса груза', '0,8');
  await fill(f, 'Объём груза', '6');
  await fill(f, 'Длина кузова от', '2,5');
  await fill(f, 'Расстояние', '24');
  const s1 = stop(page, 1);
  await s1.getByLabel('Адрес').fill('Склад № 1, Лобня');
  await s1.getByLabel('Время').fill('18:00');
  await s1.getByLabel('Масса').fill('0,8');
  await s1.getByLabel('Объём').fill('6');
  const s2 = stop(page, 2);
  await s2.getByLabel('Адрес').fill('Химки, ул. Заводская, 8');
  await s2.getByLabel('Время').fill('19:00');
  await s2.getByLabel('Масса').fill(o.unloadMass ?? '0,8');
  await s2.getByLabel('Объём').fill('6');
}

test.describe('logistics-plan — «Планирование рейса» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('«Запланировать рейс» на рабочем месте открывает форму; прямой URL; «Отмена» возвращает', async ({
    app,
    page,
  }) => {
    const alta = await openFleet(app, page);
    await openPlan(page);
    await expect(form(page)).toBeVisible();
    await expect(stop(page, 1).getByLabel('Действие')).toHaveValue('load');
    await expect(stop(page, 2).getByLabel('Действие')).toHaveValue('unload');
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet$`));
    await expect(h1(page, FLEET_H1)).toBeVisible();
    await app(`/t/${alta}/fleet?plan=new`, { persona: 'manager' });
    await expect(h1(page, PLAN_H1)).toBeVisible();
  });

  test('загрузка по участкам пересчитывается при вводе; выгрузка больше загрузки — ошибка под точкой', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await openPlan(page);
    await fillTrip(page, { unloadMass: '1' });
    const legs = page.getByRole('list', { name: 'Загрузка по участкам' });
    await expect(legs.getByRole('listitem').first()).toContainText('Погрузка +6 м³ · 0,8 т');
    await expect(legs.getByRole('listitem').first()).toContainText(
      'В кузове после точки: 6 м³ · 0,8 т',
    );
    await expect(stop(page, 2)).toContainText(
      'Выгрузка больше, чем в кузове после предыдущей точки',
    );
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(h1(page, PLAN_H1)).toBeVisible();
    await stop(page, 2).getByLabel('Масса').fill('0,8');
    await expect(stop(page, 2)).not.toContainText('Выгрузка больше');
    await expect(legs.getByRole('listitem').nth(1)).toContainText(
      'В кузове после точки: 0 м³ · 0 т',
    );
  });

  test('пустая форма: ошибки обязательных полей, запроса нет', async ({ app, page }) => {
    await openFleet(app, page);
    await openPlan(page);
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(form(page)).toContainText('Укажите название рейса');
    await expect(form(page)).toContainText('Опишите груз');
    await expect(stop(page, 1)).toContainText('Укажите адрес');
    await expect(form(page).getByLabel('Название рейса', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('точки: «Добавить точку» и «Удалить точку 3»', async ({ app, page }) => {
    await openFleet(app, page);
    await openPlan(page);
    await page.getByRole('button', { name: 'Добавить точку' }).click();
    await expect(stop(page, 3)).toBeVisible();
    await expect(stop(page, 3).getByLabel('Действие')).toHaveValue('unload');
    await page.getByRole('button', { name: 'Удалить точку 3' }).click();
    await expect(stop(page, 3)).toHaveCount(0);
  });

  test('водитель: в списке сотрудники с профилем «Водитель»; «Запланировать» создаёт рейс и выбирает его', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await openPlan(page);
    await fillTrip(page);
    const driver = form(page).getByLabel('Водитель');
    await expect(driver.locator('option')).toContainText([
      'Без водителя — назначить позже',
      'Илья Васильев',
    ]);
    await driver.selectOption({ label: 'Илья Васильев' });
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(toast(page)).toHaveText('Рейс Р-212 запланирован');
    await expect(h1(page, FLEET_H1)).toBeVisible();
    await expect(page).toHaveURL(/[?&]trip=/);
    const created = tab(page, /Р-212 · Вечерний развоз/);
    await expect(created).toHaveAttribute('aria-selected', 'true');
    await expect(created).toContainText('18:00–21:00 · Запланирован');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Подбор транспорта · Р-212' }),
    ).toBeVisible();
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
  });

  test('ошибка сервера 422 по точке — под полем точки, форма открыта', async ({ app, page }) => {
    await openFleet(app, page);
    await openPlan(page);
    await fillTrip(page);
    await devScenario(page, { scenario: 'createTripPlan=validation_failed', once: true });
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(stop(page, 2)).toContainText(
      'Выгрузка больше, чем в кузове после предыдущей точки',
    );
    await expect(h1(page, PLAN_H1)).toBeVisible();
  });

  test('нет связи: тост warn, форма сохраняет ввод; повтор создаёт один рейс', async ({
    app,
    page,
  }) => {
    await openFleet(app, page);
    await openPlan(page);
    await fillTrip(page);
    await devScenario(page, { scenario: 'createTripPlan=offline', once: true });
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(form(page).getByLabel('Название рейса', { exact: true })).toHaveValue(
      'Вечерний развоз',
    );
    await page.getByRole('button', { name: 'Запланировать' }).click();
    await expect(toast(page)).toHaveText('Рейс Р-212 запланирован');
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
  });

  test('только чтение (модуль отключён с историей): формы нет, пояснение', async ({
    app,
    page,
  }) => {
    const alta = await openFleet(app, page, { persona: 'owner', off: true });
    await app(`/t/${alta}/fleet?plan=new`, { persona: 'owner' });
    await expect(h1(page, PLAN_H1)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('Модуль отключён: новые рейсы не планируются.')).toBeVisible();
  });

  test('владелец: поле «Подразделение» — фирмы организации, по умолчанию «Москва / Север Логистик»', async ({
    app,
    page,
  }) => {
    await openFleet(app, page, { persona: 'owner' });
    await openPlan(page);
    const unit = form(page).getByLabel('Подразделение');
    await expect(unit.locator('option:checked')).toHaveText('Москва / Север Логистик');
    await expect(unit.locator('option')).toContainText([
      'Москва / Юг Транс',
      'Самара / Волга Логистик',
    ]);
  });

  test('Escape в поле не закрывает форму; Tab обходит поля по порядку', async ({ app, page }) => {
    await openFleet(app, page);
    await openPlan(page);
    const title = form(page).getByLabel('Название рейса', { exact: true });
    await title.focus();
    await page.keyboard.press('Tab');
    await expect(form(page).getByLabel('Дата')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(h1(page, PLAN_H1)).toBeVisible();
  });

  test('axe и раскладка: 390 — без горизонтальной прокрутки, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openFleet(app, page);
    await openPlan(page);
    const r = await axe(page);
    expect(r.violations.map((v) => v.id)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      expect(
        await hitHeight(page.getByRole('button', { name: 'Добавить точку' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(page.getByRole('button', { name: 'Запланировать' })),
      ).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('logistics-plan — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test('логист на стенде планирует рейс', () => {
    test.fixme(
      true,
      'backend W2.03 (createTripPlan, планирование рейса) не в main: на стенде — 501',
    );
  });
});
