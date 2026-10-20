// W2.61 · e2e `driver-today` (h1 «Моя смена»; эталон design-stage-2 pg.today :663–848): начатый рейс не зависит от
// списка машин (Q-W2.32-2). В продолжении временного водителя после срока окна (D09, W2.57) `listVehicles` отвечает
// 403 `forbidden_action` — в mock это сценарий `listVehicles=forbidden_action` после выезда. Экран берёт машину и рейс
// из рейса: «Маршрут», «Завершить рейс», осмотр при сдаче и «Сдать машину» — на экране, без «Не удалось загрузить
// машины». До выезда список машин нужен («Выберите машину») — его ошибка остаётся с «Повторить». Стенд — строка
// журни AC-06 `journeys/stage2/temporary-driver.spec.ts` «сдача временного водителя на экране после срока» (@stand,
// узкая роль «Временный водитель»): MSW не выдаёт эту роль (Q-W2.32-6, W2.62).
import type { Page } from '@playwright/test';

import {
  actionBar,
  depart,
  fillInspection,
  finishDialog,
  fivePhotos,
  openDriver,
  RET_CHECKS,
} from './driver.helpers.ts';
import { expect, test } from './_stand/fixtures.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const failed = (page: Page) => page.getByText(/Не удалось загрузить/);
const FORBIDDEN =
  'Не удалось загрузить машины: Нет права на это действие: ни одна ваша роль его не разрешает.';

test.describe('driver-today — начатый рейс без списка машин @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(120_000);

  test('после выезда listVehicles 403: «Маршрут», «Завершить рейс», осмотр при сдаче, «Сдать машину»', async ({
    app,
    page,
    axe,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    // Машин рейса больше не видно (продолжение после срока): экран открывается заново, без кэша списка.
    await devScenario(page, { scenario: 'listVehicles=forbidden_action' });
    await page.reload();
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(h2(page, 'Маршрут')).toBeVisible();
    await expect(page.getByText('Р-208 · Северный маршрут')).toBeVisible();
    await expect(page.locator('.ox-dr-trip')).toContainText('В рейсе');
    await expect(failed(page)).toHaveCount(0);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);

    await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(toast(page)).toHaveText('Рейс завершён. Заполните осмотр при сдаче');
    await expect(h2(page, 'Осмотр при сдаче')).toBeVisible();
    // Машина неизвестна: подзаголовок без пустых «модель · номер».
    await expect(page.locator('.ox-dr-insp .ox-dr-sub').first()).toHaveText('Сравнение с выездом');
    await expect(failed(page)).toHaveCount(0);
    await fivePhotos(page);
    await fillInspection(page, '84500', RET_CHECKS);
    await expect(page.getByText('Пробег не может быть меньше 84 500 км')).toHaveCount(0);
    if (phone(page)) {
      // Тост «Рейс завершён…» лежит над панелью действия (как в эталоне) — меряем после него.
      await expect(toast(page)).toBeHidden({ timeout: 10_000 });
      expect(
        await hitHeight(actionBar(page).getByRole('button', { name: 'Сдать машину' })),
      ).toBeGreaterThanOrEqual(44);
    }
    await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
    await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки');
    await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible();
    await expect(failed(page)).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('до выезда список машин нужен: ошибка listVehicles — «Не удалось загрузить машины» и «Повторить»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today', { scenario: 'listVehicles=forbidden_action' });
    await expect(h1(page, 'Моя смена')).toBeVisible();
    const alert = page.locator('.ox-dr').getByRole('alert');
    await expect(alert).toContainText(FORBIDDEN);
    await devScenario(page, { scenario: null });
    await page.locator('.ox-dr').getByRole('button', { name: 'Повторить' }).click();
    await expect(h2(page, 'Выберите машину')).toBeVisible();
    await expect(failed(page)).toHaveCount(0);
  });
});
