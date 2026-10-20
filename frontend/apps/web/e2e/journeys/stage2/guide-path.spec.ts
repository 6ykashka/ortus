// W2.32 · «Путь проверки» эталона в части пилота (design-stage-2, «Ортус CRM.dc.html» guideVM :2893–2931;
// docs/plan/analysis/01-shell.md §6): восемь шагов основного пути и семь негативных проверок — кликами по ролям и
// подписям реализации (демо-панели и гида в продукте нет, PD-54; флажки эталона «Конфликт брони» и «Нет связи» —
// сценарий сервера и обрыв связи контекста). `@smoke` — pre-push изменённых страниц.
//   @mock  — сид прототипа без пресета: «Логистика» не подключена, у Марины Котовой нет роли (03-logistics.md :80);
//   @stand — базовый сид W2.54: «Логистика» в «Альте» уже подключена (шаг 1 — проверка карточки), роль Котовой —
//            диалогом «Назначить роль» (уборка снимает), смена — свой рейс водителя на проект.
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { assignmentsOf, revoke, roleId } from '../../_stand/stand.ts';
import {
  actionBar,
  carCard,
  choosePhoto,
  DEP_CHECKS,
  depart,
  fillInspection,
  finishDialog,
  fivePhotos,
  openDriver,
  RET_CHECKS,
  reserve,
  scanUntil,
} from '../../driver.helpers.ts';
import { queueItem, REVIEW_H1 } from '../../logistics-review.helpers.ts';
import {
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  MANAGER_ROLE,
  NO_STORAGE,
  plan,
  realClock,
  storageReachable,
  vehicle,
} from '../../logistics.stand.ts';
import { moduleCard, toast } from '../../modules.helpers.ts';
import { banner, expenseRow, net } from '../../outbox.helpers.ts';
import { dialog, personRow } from '../../people.helpers.ts';
import { call, devScenario, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/**
 * До шага 1 (сид без пресета): «Логистика» не подключена — рейсы водителя и машины логиста закрыты модулем
 * (403 `module_not_installed`); затем снова владелец.
 */
async function noLogisticsYet(app: AppFn, page: Page, tenant: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const probes = [
    ['driver', `${base}/trip-plans?limit=20`],
    ['manager', `${base}/vehicles?limit=20`],
  ] as const;
  for (const [persona, path] of probes) {
    await app(`/t/${tenant}/home`, { persona });
    const r = await call(page, 'GET', path);
    expect([r.status, (r.body as { code?: string }).code], `${persona}: ${path}`).toEqual([
      403,
      'module_not_installed',
    ]);
  }
  await app(`/t/${tenant}/home`, { persona: 'owner' });
}

/** Шаг 1: владелец на «Модули и место» подключает «Логистику». */
async function enableLogistics(page: Page, tenant: string): Promise<void> {
  await page.goto(`/t/${tenant}/modules`);
  await expect(J.h1(page, 'Модули и место')).toBeVisible({ timeout: 15_000 });
  await moduleCard(page, 'Логистика').getByRole('button', { name: 'Подключить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подключить' }).click();
  await expect(toast(page)).toHaveText('Модуль «Логистика» подключён', J.SERVER);
  await expect(moduleCard(page, 'Логистика')).toContainText('Подключён');
}

/** Шаг 2: «Пользователи и роли» → Марина Котова → «Назначить роль» → «Менеджер логистики», область «Фирма». */
async function assignKotova(page: Page, tenant: string): Promise<void> {
  await page.goto(`/t/${tenant}/users`);
  await expect(J.h1(page, 'Пользователи и роли')).toBeVisible({ timeout: 15_000 });
  await personRow(page, 'Марина Котова').getByRole('button', { name: 'Назначить роль' }).click();
  const dlg = dialog(page, 'Назначить роль');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Роль').selectOption({ label: MANAGER_ROLE });
  await expect(dlg).toContainText('Менеджер логистики · Москва / Север Логистик');
  await dlg.getByRole('button', { name: 'Назначить' }).click();
  await expect(toast(page)).toHaveText('Роль «Менеджер логистики» назначена', J.SERVER);
  await expect(dlg).toBeHidden();
  await expect(personRow(page, 'Марина Котова')).toContainText('Менеджер логистики');
}

/**
 * Шаги 4–7 водителя на «Моей смене»: бронь совместимой машины → осмотр и выезд → расход «Топливо» → «Завершить
 * рейс», осмотр при сдаче, «Сдать машину».
 */
async function driverSteps(page: Page, mode: J.Mode, odometer: number): Promise<void> {
  const file = await J.jpeg(page, 'Ортус · путь проверки');
  await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  // 4. «Забронировать совместимую машину».
  await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
  await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', J.SERVER);
  // 5. «Заполнить осмотр и выехать».
  await expect(J.h2(page, 'Осмотр перед выездом')).toBeVisible(J.SERVER);
  await J.photos(page, mode, file);
  await J.fillInspection(page, String(odometer + 130), DEP_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(page)).toHaveText('Выезд подтверждён сервером', J.SERVER);
  await expect(J.h2(page, 'Маршрут')).toBeVisible(J.SERVER);
  // 6. «Добавить расход».
  await page.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(page.getByLabel('Категория')).toHaveValue('fuel');
  await page.getByLabel(/^Сумма, ₽/).fill('2500');
  await page.getByLabel(/^Литры/).fill('42');
  await J.shoot(page, page.getByRole('button', { name: /^Чек: / }), file, 'receipt.jpg');
  await J.untilReady(page, mode, page.locator('.ox-dr-receipt').getByText('Загружено'));
  await page.getByRole('button', { name: 'Сохранить расход' }).click();
  await expect(toast(page)).toHaveText('Расход принят сервером', J.SERVER);
  await expect(
    expenseRow(page, 'Топливо · 2 500 ₽').or(expenseRow(page, J.nb('Топливо · 2 500 ₽'))),
  ).toContainText('Принято сервером');
  // 7. «Сдать машину».
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(J.h2(page, 'Осмотр при сдаче')).toBeVisible(J.SERVER);
  await J.photos(page, mode, file);
  await J.fillInspection(page, String(odometer + 190), RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
  await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки', J.SERVER);
  await expect(J.h2(page, 'Ожидает приёмки менеджером')).toBeVisible(J.SERVER);
}

/** Шаг 8: «Логист: принять смену» на «Приёмке смен». */
async function acceptShift(manager: Page, tenant: string, trip: string): Promise<void> {
  await manager.goto(`/t/${tenant}/review`);
  await expect(J.h1(manager, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
  await queueItem(manager, trip).click();
  await manager.getByRole('button', { name: 'Принять смену' }).click();
  await manager.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
  await expect(toast(manager)).toHaveText('Смена принята. Машина вернулась в пул', J.SERVER);
  await expect(queueItem(manager, trip)).toContainText('Принят');
}

test.describe('«Путь проверки» — основной путь @mock @smoke', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');

  test('1–8: «Логистика» → роль Котовой → водитель → бронь → осмотр и выезд → расход → сдача → приёмка', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    // До шага 1: водитель и логист без доступа к «Логистике».
    await noLogisticsYet(app, page, alta);
    await enableLogistics(page, alta);
    await assignKotova(page, alta);
    // 3. «Переключиться на водителя».
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await driverSteps(page, 'mock', 84370);
    await app(`/t/${alta}/home`, { persona: 'manager' });
    await acceptShift(page, alta, 'Р-208');
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(J.h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('«Путь проверки» — негативные проверки @mock @smoke', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');
  test.describe.configure({ timeout: 120_000 });

  test('1. Несовместимая машина: Hyundai Porter и Ford Transit для Р-208 — бронь недоступна, причина указана', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    for (const [model, reason] of [
      ['Hyundai Porter', 'Грузоподъёмность: 0,9 т, нужно от 1,1 т'],
      ['Ford Transit', 'Объём: 11 м³, нужно от 12 м³'],
    ] as const) {
      await expect(carCard(page, model)).toContainText(reason);
      await expect(
        carCard(page, model).getByRole('button', { name: 'Не подходит рейсу' }),
      ).toBeDisabled();
    }
  });

  test('2. Незавершённый осмотр: «Выехать» неактивна, показан список недостающего', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await expect(actionBar(page)).toContainText(
      'Осталось: 5 фото, пробег, уровень топлива, 3 пункта чек-листа',
    );
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await choosePhoto(page, J.slot(page, 'Спереди'));
    await scanUntil(page, page.getByText('Фото · 1 из 5'));
    await expect(actionBar(page)).toContainText('Осталось: 4 фото');
  });

  test('3. Отрицательный расход: «-500» — «Сумма должна быть больше нуля»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    await page.getByRole('button', { name: 'Добавить расход' }).click();
    const amount = page.getByLabel(/^Сумма, ₽/);
    await amount.fill('-500');
    await page.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(page.getByText('Сумма должна быть больше нуля')).toBeVisible();
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Расходов пока нет')).toBeVisible();
  });

  test('4. Пробег при сдаче меньше начального — ошибка, сдача невозможна', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(J.h2(page, 'Осмотр при сдаче')).toBeVisible();
    await fivePhotos(page);
    await fillInspection(page, '84400', RET_CHECKS);
    await expect(page.getByText('Пробег не может быть меньше 84 500 км')).toBeVisible();
    await expect(page.getByLabel(/^Пробег по одометру, км/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(actionBar(page).getByRole('button', { name: 'Сдать машину' })).toBeDisabled();
  });

  test('5. Водитель: начислений нет ни в смене, ни в уведомлениях, ни в ответе API', async ({
    app,
    page,
  }) => {
    const tenant = await openDriver(app, page, 'today');
    const trip = (
      (await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`)).body as {
        items: { id: string; number: string }[];
      }
    ).items.find((p) => p.number === 'Р-208');
    // Начисление есть у владельца после приёмки (logistics-earnings), водителю — нигде.
    for (const path of [
      `/api/v1/tenants/${tenant}/fleet/trips/${trip?.id ?? ''}/earnings`,
      `/api/v1/tenants/${tenant}/fleet/earnings`,
    ]) {
      const r = await call(page, 'GET', path);
      expect(r.status, path).toBe(403);
      expect(JSON.stringify(r.body)).not.toMatch(/amount/i);
    }
    const plans = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`);
    expect(JSON.stringify(plans.body)).not.toMatch(/earning/i);
    const inbox = await call(page, 'GET', `/api/v1/me/notifications?tenantId=${tenant}&limit=50`);
    expect(JSON.stringify(inbox.body)).not.toContain('Начислен');
    await expect(page.locator('#ox-main')).not.toContainText('Начислен');
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Уведомления/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).not.toContainText('Начислен');
  });

  test('6. Конфликт брони — конфликт и предложение обновить список', async ({ app, page }) => {
    await openDriver(app, page, 'today', { scenario: 'reserveVehicle=reservation_overlap' });
    await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
    const alert = page.locator('.ox-dr').getByRole('alert');
    await expect(alert).toContainText('Конфликт брони');
    await expect(alert.getByRole('button', { name: 'Обновить список' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Обновить список' }).click();
    await expect(toast(page)).toHaveText('Список обновлён');
  });

  test('7. Нет связи — расходы и сдача сохраняются на устройстве, бронь и выезд блокируются', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    await net(page, false);
    await expect(page.getByText('Нет связи: бронь требует подтверждения сервера.')).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Бронь недоступна' }),
    ).toBeDisabled();
    await net(page, true);
    await reserve(page);
    await net(page, false);
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await expect(actionBar(page)).toContainText(
      'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
    );
    await net(page, true);
    await fivePhotos(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(J.h2(page, 'Маршрут')).toBeVisible();
    await net(page, false);
    await page.getByRole('button', { name: 'Добавить расход' }).click();
    await page.getByLabel('Категория').selectOption('wash');
    await page.getByLabel(/^Сумма, ₽/).fill('400');
    await choosePhoto(page, page.getByRole('button', { name: /^Чек: / }), 'receipt.jpg');
    await page.getByRole('button', { name: 'Сохранить на устройстве' }).click();
    await expect(expenseRow(page, 'Мойка · 400 ₽')).toContainText('Локальный черновик');
    await expect(banner(page, 'Нет связи.')).toContainText('(ожидают отправки: 1)');
    // «Завершить рейс» — со связью (команда сервера), затем осмотр при сдаче без связи.
    await net(page, true);
    await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(J.h2(page, 'Осмотр при сдаче')).toBeVisible({ timeout: 30_000 });
    await net(page, false);
    for (const side of ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр']) {
      await choosePhoto(page, J.slot(page, side));
    }
    await fillInspection(page, '84560', RET_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
    await expect(toast(page)).toHaveText('Сдача сохранена на устройстве и ещё не принята сервером');
    await expect(J.h2(page, 'Сдача сохранена на устройстве')).toBeVisible();
    await net(page, true);
  });
});

test.describe('«Путь проверки» на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('1–8 на стенде: «Логистика» подключена, роль Котовой диалогом, смена водителя на телефоне, приёмка 1440', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(360_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const owner = await J.desktop(browser, harness, 'owner');
    const manager = await J.desktop(browser, harness, 'manager');
    undo('контексты 1440', async () => {
      await manager.close();
      await owner.close();
    });
    // Шаг 2 — диалогом: роль, выданная logisticsOn, снимается и назначается снова на экране; уборка снимает её.
    const role = await roleId(owner.page, s.tenant, MANAGER_ROLE);
    for (const a of (await assignmentsOf(owner.page, s.tenant, s.members.kotova)).filter(
      (x) => x.roleId === role,
    )) {
      await revoke(owner.page, s.tenant, a.id);
    }
    undo('Марина Котова — «Менеджер логистики» (диалог)', async () => {
      for (const a of (await assignmentsOf(owner.page, s.tenant, s.members.kotova)).filter(
        (x) => x.roleId === role,
      )) {
        await revoke(owner.page, s.tenant, a.id);
      }
    });

    // 1. «Логистика» подключена (базовый сид W2.54).
    await owner.page.goto(`/t/${s.tenant}/modules`);
    await expect(J.h1(owner.page, 'Модули и место')).toBeVisible({ timeout: 15_000 });
    await expect(moduleCard(owner.page, 'Логистика')).toContainText('Подключён');
    // 2. «Назначить Марине Котовой роль и область».
    await assignKotova(owner.page, s.tenant);

    // 3–7. Водитель на телефоне: свой рейс проекта.
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(
      page,
      owner.page,
      s,
      `Путь W2.32 ${label(testInfo.project.name)}`,
    );
    expect(await storageReachable(page, s.tenant, trip.id, harness.allowHosts), NO_STORAGE).toBe(
      true,
    );
    undo(`смена рейса ${trip.number}`, () => closeTrip(page, owner.page, s.tenant, trip.id));
    const gazel = await vehicle(page, s.tenant);
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible({ timeout: 15_000 });
    await driverSteps(page, 'stand', Number(gazel.odometerKm));

    // 8. Логист Котова (роль из шага 2) на компьютере принимает смену.
    await manager.page.reload();
    await acceptShift(manager.page, s.tenant, trip.number);
    expect(((await plan(manager.page, s.tenant, trip.id)).body as { state: string }).state).toBe(
      'accepted',
    );
    await page.reload();
    await expect(J.h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
  });
});
