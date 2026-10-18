// W2.22 · e2e страницы `driver-cars` «Автомобили» (эталон design-stage-2, «Ортус CRM.dc.html» pg.cars :850–867,
// carCards :3403; 03-logistics.md §9, §14 п. 48): заголовок и пояснение, фильтр, карточки по рейсу смены,
// «Забронировать» → «Сегодня», пусто, офлайн, ошибка, клавиатура, axe, 390.
import type { Page } from '@playwright/test';

import { carCard, openDriver } from './driver.helpers.ts';
import { expect, test } from './_stand/fixtures.ts';
import {
  closeTrip,
  driverTrip,
  GAZEL,
  label,
  logisticsOn,
  persona,
  realClock,
  reservationOf,
} from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const filter = (page: Page) => page.getByRole('group', { name: 'Фильтр' });
const models = (page: Page) => page.locator('.ox-dr-car-model');

test.describe('driver-cars — «Автомобили» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  // Путь с пятью загрузками и проверкой файлов — дольше 30 с под нагрузкой общего ПК.
  test.describe.configure({ timeout: 90_000 });

  test('меню «Автомобили» и прямой URL: h1, пояснение, фильтр «Все»', async ({ app, page }) => {
    await openDriver(app, page, 'today');
    const nav = phone(page)
      ? page.getByRole('navigation', { name: 'Навигация', exact: true })
      : page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Автомобили' }).click();
    await expect(page).toHaveURL(/\/cars$/);
    await expect(h1(page, 'Автомобили')).toBeVisible();
    await expect(
      page.getByText('Машины вашей фирмы и их состояние. Бронь подтверждает сервер.'),
    ).toBeVisible();
    await expect(filter(page).getByRole('button')).toHaveText([
      'Все',
      'Подходят к рейсу',
      'Свободны',
    ]);
    await expect(filter(page).getByRole('button', { name: 'Все' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(models(page)).toHaveCount(5);
    await expect(page.locator('#ox-main')).not.toContainText('Подходит рейсу');
    await expect(carCard(page, 'Ford Transit').getByRole('button')).toHaveCount(0);
    await page.reload();
    await expect(h1(page, 'Автомобили')).toBeVisible();
  });

  test('фильтры: «Подходят к рейсу», «Свободны»', async ({ app, page }) => {
    await openDriver(app, page, 'cars');
    await expect(models(page)).toHaveCount(5);
    await filter(page).getByRole('button', { name: 'Подходят к рейсу' }).click();
    await expect(models(page)).toHaveText(['ГАЗель Next', 'Mercedes Sprinter', 'ГАЗон Next']);
    await filter(page).getByRole('button', { name: 'Свободны' }).click();
    await expect(models(page).filter({ hasText: 'ГАЗон Next' })).toHaveCount(0);
  });

  test('«Забронировать» ведёт на «Сегодня» с подтверждённой бронью', async ({ app, page }) => {
    await openDriver(app, page, 'cars');
    await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByText(/Бронь подтверждена сервером · ГАЗель Next/)).toBeVisible();
  });

  test('«По фильтру машин нет»', async ({ app, page }) => {
    await openDriver(app, page, 'cars', { scenario: 'listVehicles=empty' });
    await expect(page.getByText('По фильтру машин нет')).toBeVisible();
  });

  test('нет связи: кнопок брони нет', async ({ app, page }) => {
    await openDriver(app, page, 'cars');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByRole('button', { name: 'Забронировать' })).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Забронировать' }).first()).toBeVisible();
  });

  test('состояния: загрузка, ошибка и «Повторить»', async ({ app, page }) => {
    await openDriver(app, page, 'cars', { scenario: 'listVehicles=delay=1500' });
    await expect(page.locator('#ox-main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(models(page)).toHaveCount(5);
    await devScenario(page, { scenario: 'listVehicles=rate_limited' });
    await page.reload();
    await expect(page.locator('.ox-dr').getByRole('alert')).toContainText(
      'Не удалось загрузить машины: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.locator('.ox-dr').getByRole('button', { name: 'Повторить' }).click();
    await expect(models(page)).toHaveCount(5);
  });

  test('клавиатура, axe, 390: без горизонтальной прокрутки, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openDriver(app, page, 'cars');
    await expect(models(page)).toHaveCount(5);
    const all = filter(page).getByRole('button', { name: 'Все' });
    await all.focus();
    await page.keyboard.press('Tab');
    await expect(filter(page).getByRole('button', { name: 'Подходят к рейсу' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(models(page)).toHaveCount(3);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      expect(
        await hitHeight(
          carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
        ),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(filter(page).getByRole('button', { name: 'Все' })),
      ).toBeGreaterThanOrEqual(44);
    }
  });
});

// W2.53: backend машин и брони (W2.02) в main — fixme снят. Сид e2e-stand и уборка — logistics.stand.ts.
test.describe('driver-cars — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель на стенде: машины фирмы, «Подходят к рейсу», бронь → «Сегодня»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(page, manager, s, `Стенд ${label(testInfo.project.name)}`);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(page, manager, s.tenant, trip.id));
    await app(`/t/${s.tenant}/cars`, { persona: 'driver' });
    await expect(h1(page, 'Автомобили')).toBeVisible({ timeout: 15_000 });
    // Машины фирмы водителя («Север Логистик»); порядок — совместимые с рейсом смены первыми.
    await expect(models(page)).toHaveCount(5);
    expect((await models(page).allTextContents()).sort()).toEqual(
      ['ГАЗель Next', 'Mercedes Sprinter', 'Ford Transit', 'Hyundai Porter', 'ГАЗон Next'].sort(),
    );
    await filter(page).getByRole('button', { name: 'Подходят к рейсу' }).click();
    await expect(models(page)).toHaveText(['ГАЗель Next', 'Mercedes Sprinter', 'ГАЗон Next']);
    await filter(page).getByRole('button', { name: 'Все' }).click();
    await carCard(page, GAZEL).getByRole('button', { name: 'Забронировать' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(
      page.getByText(new RegExp(`Бронь подтверждена сервером · ${GAZEL}`)),
    ).toBeVisible();
    expect((await reservationOf(manager, s.tenant, trip.id))?.state).toBe('held');
  });
});
