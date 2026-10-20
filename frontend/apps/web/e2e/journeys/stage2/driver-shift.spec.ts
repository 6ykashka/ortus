// W2.90 · Путь показа 18.10 (облегчённый W2.32): смена водителя «Альты» целиком — бронь машины → осмотр с пятью фото →
// выезд → расход → «Завершить рейс» → осмотр при сдаче → «Сдать машину» — и логист: «Рабочее место логиста», очередь
// дефектов, «Приёмка смен». Изоляция: владелец «Лотоса» не видит рейсов «Альты». Сценарий — docs/demo/2026-10-18.md.
//   @mock  — сценарный сервер (пресет logistics-ready), приёмка менеджером в той же вкладке;
//   @stand — стенд с MinIO (docs/demo/demo-stand.mjs; e2e-stand — после MinIO в compose, integratorNotes W2.53): фото
//            через MinIO и cmd/worker, логист — второй контекст 1440, приёмка на сервере (reviewTrip, W2.06). На базовом
//            сиде строка сама подключает «Логистику» и даёт Котовой роль логиста (logistics.stand.ts), рейс — свой
//            (Р-208 сида, пока он не пройден, иначе новый рейс Ильи Васильева): строка повторяема в трёх проектах.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import {
  actionBar,
  carCard,
  DEP_CHECKS,
  finishDialog,
  RET_CHECKS,
  SIDES,
} from '../../driver.helpers.ts';
import { FLEET_H1, stat } from '../../logistics.helpers.ts';
import {
  apiShift,
  approve,
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  NO_STORAGE,
  plan,
  type Plan,
  plans,
  realClock,
  storageReachable,
  vehicle,
} from '../../logistics.stand.ts';
import { queueItem, REVIEW_H1, review } from '../../logistics-review.helpers.ts';
import { h1, toast } from '../../modules.helpers.ts';
import { savedDrafts } from '../../outbox.helpers.ts';
import { platformTenantId } from '../../platform-orgs.helpers.ts';
import { ALTA, call, devScenario, LOTOS, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';

type Mode = J.Mode;

const TRIP = 'Р-208';
/** Рейс смены: номер и название (mock — Р-208 пресета, стенд — свой рейс строки). */
type Trip = Pick<Plan, 'number' | 'title'>;
const R208: Trip = { number: TRIP, title: 'Северный маршрут' };
/** Пробег ГАЗели в сиде (mock): выезд +130 км, сдача +190 км — «Пройдено 60 км». */
const ODOMETER = 84370;
const DEFECTS_H1 = 'Очередь блокирующих дефектов';

// W2.32 (refactor): фото, осмотр и ожидания — общие помощники журни (journey.ts).
const { h2, shoot, untilReady, fillInspection, SERVER } = J;
const jpeg = (page: Page): Promise<Buffer> => J.jpeg(page, 'Ортус · осмотр');
const fivePhotos = J.photos;
/** Водитель (Илья Васильев): бронь → осмотр → выезд → расход → «Завершить рейс» → сдача. */
async function driverShift(
  page: Page,
  mode: Mode,
  trip: Trip = R208,
  odometer = ODOMETER,
): Promise<void> {
  const file = await jpeg(page);
  await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
  await expect(h2(page, 'Выберите машину')).toBeVisible();

  // 1. Бронь машины: совместимая ГАЗель Next «Север Логистик».
  await expect(carCard(page, 'ГАЗель Next')).toContainText(
    'Подходит рейсу: масса, объём, длина и температура',
  );
  await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
  await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', SERVER);
  await expect(h2(page, 'Осмотр перед выездом')).toBeVisible(SERVER);

  // 2. Осмотр с пятью фото, пробег, топливо, чек-лист.
  await fivePhotos(page, mode, file);
  await fillInspection(page, String(odometer + 130), DEP_CHECKS);
  await expect(actionBar(page)).not.toContainText('Осталось');

  // 3. Выезд.
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(page)).toHaveText('Выезд подтверждён сервером', SERVER);
  await expect(h2(page, 'Маршрут')).toBeVisible(SERVER);
  await page.getByRole('button', { name: 'Прибыл' }).first().click();
  await expect(page.getByText('Отмечено 1 из 3')).toBeVisible();

  // 4. Расход «Топливо» с литрами и чеком.
  await page.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(page.getByLabel('Категория')).toHaveValue('fuel');
  await page.getByLabel(/^Сумма, ₽/).fill('2500');
  await page.getByLabel(/^Литры/).fill('40');
  await page.getByLabel(/^Комментарий/).fill('АЗС на Ленинградском шоссе');
  await shoot(page, page.getByRole('button', { name: /^Чек: / }), file, 'receipt.jpg');
  await untilReady(page, mode, page.locator('.ox-dr-receipt').getByText('Загружено'));
  await page.getByRole('button', { name: 'Сохранить расход' }).click();
  await expect(toast(page)).toHaveText('Расход принят сервером', SERVER);
  await expect(
    page.getByText('Топливо · 2 500 ₽').or(page.getByText('Топливо · 2 500 ₽')),
  ).toBeVisible();

  // 5. «Завершить рейс» → осмотр при сдаче → «Сдать машину».
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(h2(page, 'Осмотр при сдаче')).toBeVisible(SERVER);
  await fivePhotos(page, mode, file);
  await fillInspection(page, String(odometer + 190), RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
  await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки', SERVER);
  await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible(SERVER);
  await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
}

/** Логист на «Приёмке смен»: смена Ильи Васильева ждёт приёмки (`expense` — с расходом «Топливо»). */
async function shiftInReview(
  page: Page,
  tenant: string,
  trip: Trip = R208,
  expense = true,
): Promise<void> {
  await page.goto(`/t/${tenant}/review`);
  await expect(h1(page, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
  const item = queueItem(page, trip.number);
  await expect(item).toContainText(`${trip.number} · Илья Васильев`);
  await expect(item).toContainText('ГАЗель Next · А 412 МР 77');
  await expect(item).toContainText('Ожидает приёмки');
  await item.click();
  if (expense) await expect(review(page).locator('.ox-rv-expense')).toContainText('Топливо');
}

test.describe('путь показа 18.10 — смена водителя и приёмка @mock', () => {
  test.skip(
    ({ harness }) => harness.mode !== 'mock',
    'пресет logistics-ready — сценарный сервер mock',
  );

  test('водитель: бронь → пять фото → выезд → расход → сдача; менеджер принимает смену', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    // Хранилища в mock нет: PUT по билету загрузки отвечает 200 (как driver.helpers.ts W2.22).
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await driverShift(page, 'mock');

    // Логист «Альты» (Марина Котова) в той же вкладке: состояние сценарного сервера живёт во вкладке.
    await app(`/t/${alta}/fleet`, { persona: 'manager' });
    await expect(h1(page, FLEET_H1)).toBeVisible({ timeout: 15_000 });
    await shiftInReview(page, alta);
    await page.getByRole('button', { name: 'Принять смену' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул');

    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
  });
});

// W2.53: приёмка на сервере (reviewTrip, W2.06) в main — fixme снят; путь повторяем на сиде e2e-stand и сиде показа
// (logistics.stand.ts) и идёт во всех трёх проектах. Без хранилища стенда (e2e-stand без MinIO) — пропуск с причиной.
test.describe('путь показа 18.10 — смена водителя на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель: бронь → пять фото → выезд → расход → сдача; логист 1440 видит смену', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    // Стенд живёт по настоящим часам (окна рейсов — от «сейчас»): часы страниц — сейчас.
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const logist = await J.desktop(browser, harness, 'manager');
    try {
      await app('/', { persona: 'driver' });
      const trip = await driverTrip(
        page,
        logist.page,
        s,
        `Северный маршрут ${label(testInfo.project.name)}`,
      );
      test.skip(!(await storageReachable(page, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
      undo(`бронь рейса ${trip.number}`, () => closeTrip(page, s.owner, s.tenant, trip.id));
      const gazel = await vehicle(page, s.tenant);

      // Логист до выезда: рабочее место и рейс смены, очередь дефектов.
      await logist.page.goto(`/t/${s.tenant}/fleet`);
      await expect(h1(logist.page, FLEET_H1)).toBeVisible({ timeout: 15_000 });
      await expect(logist.page.getByText(trip.number).first()).toBeVisible();
      await logist.page.goto(`/t/${s.tenant}/defects`);
      await expect(h1(logist.page, DEFECTS_H1)).toBeVisible({ timeout: 15_000 });

      await app(`/t/${s.tenant}/today`, { persona: 'driver' });
      await driverShift(page, 'stand', trip, Number(gazel.odometerKm));

      // Логист после сдачи: смена в «Приёмке смен» (cmd/api, BFF, шлюз).
      await shiftInReview(logist.page, s.tenant, trip);
      // Уборка общего стенда: смена принимается, машина возвращается в пул (приёмку экраном — следующая строка).
      await approve(s.owner, s.tenant, trip.id);
    } finally {
      await logist.close();
    }
  });

  test('логист принимает смену на стенде — машина возвращается в пул', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const logist = await J.desktop(browser, harness, 'manager');
    try {
      await app('/', { persona: 'driver' });
      const trip = await driverTrip(
        page,
        logist.page,
        s,
        `Северный маршрут ${label(testInfo.project.name)}`,
      );
      test.skip(!(await storageReachable(page, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
      undo(`бронь рейса ${trip.number}`, () => closeTrip(page, s.owner, s.tenant, trip.id));
      // Смена сдана водителем (команды API из его сессии, фото — MinIO и cmd/worker).
      await apiShift(page, s.tenant, trip);
      await shiftInReview(logist.page, s.tenant, trip, false);
      await logist.page.getByRole('button', { name: 'Принять смену' }).click();
      await logist.page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
      await expect(toast(logist.page)).toHaveText('Смена принята. Машина вернулась в пул', {
        timeout: 15_000,
      });
      expect(((await plan(logist.page, s.tenant, trip.id)).body as { state: string }).state).toBe(
        'accepted',
      );
      await app(`/t/${s.tenant}/today`, { persona: 'driver' });
      await expect(h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
    } finally {
      await logist.close();
    }
  });
});
test.describe('путь показа 18.10 — изоляция «Лотоса» @stand @mock', () => {
  test('владелец «Лотоса» не видит рейсов «Альты»: 404 как у несуществующей, «Страница не найдена»', async ({
    app,
    page,
    session,
  }) => {
    test.slow();
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const alta = await platformTenantId(operator.page, ALTA);
    await app('/', { persona: 'owner@t-lotos' });
    const lotos = await tenantId(page, LOTOS);
    expect(lotos).not.toBe(alta);
    for (const path of ['fleet/trip-plans', 'fleet/vehicles', 'fleet/defects']) {
      const foreign = await call(page, 'GET', `/api/v1/tenants/${alta}/${path}`);
      const missing = await call(page, 'GET', `/api/v1/tenants/${J.UNKNOWN}/${path}`);
      expect(foreign.status, path).toBe(404);
      expect(missing.status, path).toBe(404);
      expect(J.problemShape(foreign), path).toEqual(J.problemShape(missing));
      expect(JSON.stringify(foreign.body), path).not.toContain(TRIP);
    }
    await page.goto(`/t/${alta}/review`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена', {
      timeout: 15_000,
    });
    await expect(page.locator('#app')).not.toContainText(TRIP);
  });
});

// W2.32 · Выход этапа 2: полная смена водителя (AC-05, S2-01…S2-12, S2-15) — бронь → осмотр с пятью фото, черновик на
// устройстве без связи и отправка после связи (D-09: выезд — только со связью) → выезд → расход по справочнику категорий
// (своя категория владельца, комментарий обязателен) → «Завершить рейс» → осмотр при сдаче → сдача → приёмка менеджером
// → машина свободна сразу (W2.56) → начисление у владельца; водителю начисления не видны ни в смене, ни в уведомлениях,
// ни в ответах API (AC-05). Mock — одна вкладка (состояние сценарного сервера живёт во вкладке), стенд — телефон
// водителя (проект), менеджер и владелец — свои контексты 1440.
const OFFLINE_DEPART =
  'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.';
const queued = (page: Page): Locator =>
  page.locator('.ox-dr-slot-status').filter({ hasText: 'На устройстве · ждёт связи' });
const ready = (page: Page): Locator =>
  page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' });

/** Своя категория расхода владельца на «Категории расходов» (комментарий обязателен). */
async function ownCategory(owner: Page, tenant: string, name: string): Promise<void> {
  await owner.goto(`/t/${tenant}/expense-categories`);
  await expect(J.h1(owner, 'Категории расходов')).toBeVisible({ timeout: 15_000 });
  const form = owner.getByRole('form', { name: 'Новая категория' });
  await form.getByLabel('Название').fill(name);
  await form.getByLabel('Комментарий обязателен').check();
  await form.getByRole('button', { name: 'Добавить' }).click();
  await expect(toast(owner)).toHaveText(`Категория «${name}» добавлена`, J.SERVER);
}

/** Пять загрузок осмотра готовы: в mock проверку файлов завершает dev-маршрут, на стенде — cmd/worker. */
async function allReady(page: Page, mode: Mode): Promise<void> {
  if (mode === 'stand') {
    await expect(ready(page)).toHaveCount(5, { timeout: 120_000 });
    return;
  }
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready(page)).toHaveCount(5, { timeout: 1000 });
  }).toPass({ timeout: 45_000 });
}

/**
 * Водитель на «Моей смене»: бронь ГАЗели → осмотр без связи (черновик на устройстве) → связь → выезд → расход своей
 * категории → «Завершить рейс» → осмотр при сдаче → «Сдать машину» → «Ожидает приёмки менеджером».
 */
async function fullShift(
  page: Page,
  mode: Mode,
  o: { trip: Trip; odometer: number; category: string },
): Promise<void> {
  const file = await J.jpeg(page, 'Ортус · смена W2.32');
  const departure = String(o.odometer + 130);
  await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`${o.trip.number} · ${o.trip.title}`)).toBeVisible();
  await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
  await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', J.SERVER);
  await expect(J.h2(page, 'Осмотр перед выездом')).toBeVisible(J.SERVER);

  // Без связи: пять фото, пробег, топливо и чек-лист — черновик на устройстве; выезд требует сервера (D-09).
  await page.context().setOffline(true);
  for (const side of SIDES) await J.shoot(page, J.slot(page, side), file, `${side}.jpg`);
  await expect(queued(page)).toHaveCount(5);
  await J.fillInspection(page, departure, DEP_CHECKS);
  await expect(actionBar(page)).toContainText(OFFLINE_DEPART);
  await expect(actionBar(page).getByRole('button', { name: 'Выехать на маршрут' })).toBeDisabled();
  await expect
    .poll(async () => (await savedDrafts(page)).map((d) => d.odometer))
    .toContain(departure);

  // Связь появилась: фото уходят сами (очередь отправки W2.24), выезд — подтверждение сервера.
  await page.context().setOffline(false);
  await allReady(page, mode);
  await expect(queued(page)).toHaveCount(0);
  await expect(actionBar(page)).not.toContainText('Осталось');
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(page)).toHaveText('Выезд подтверждён сервером', J.SERVER);
  await expect(J.h2(page, 'Маршрут')).toBeVisible(J.SERVER);

  // Расход по справочнику категорий: своя категория владельца, комментарий обязателен.
  await page.getByRole('button', { name: 'Добавить расход' }).click();
  await page.getByLabel('Категория').selectOption({ label: o.category });
  await page.getByLabel(/^Сумма, ₽/).fill('700');
  await J.shoot(page, page.getByRole('button', { name: /^Чек: / }), file, 'receipt.jpg');
  await J.untilReady(page, mode, page.locator('.ox-dr-receipt').getByText('Загружено'));
  await page.getByRole('button', { name: 'Сохранить расход' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Для категории' })).toHaveText(
    `Для категории «${o.category}» добавьте комментарий`,
  );
  await page.getByLabel(/^Комментарий/).fill('Охраняемая стоянка в Твери');
  await page.getByRole('button', { name: 'Сохранить расход' }).click();
  await expect(toast(page)).toHaveText('Расход принят сервером', J.SERVER);
  await expect(page.getByText(`${o.category} · 700 ₽`)).toBeVisible();

  // «Завершить рейс» → осмотр при сдаче → «Сдать машину».
  await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await finishDialog(page).getByRole('button', { name: 'Завершить рейс' }).click();
  await expect(J.h2(page, 'Осмотр при сдаче')).toBeVisible(J.SERVER);
  await J.photos(page, mode, file);
  await J.fillInspection(page, String(o.odometer + 190), RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сдать машину' }).click();
  await expect(toast(page)).toHaveText('Сдача принята сервером. Ожидайте приёмки', J.SERVER);
  await expect(J.h2(page, 'Ожидает приёмки менеджером')).toBeVisible(J.SERVER);
  await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
}

/** AC-05: водителю начисления не видны — DTO рейса, getTripEarnings, listTripEarnings, уведомления, экран. */
async function noEarnings(page: Page, tenant: string, tripId: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}`;
  const trip = await call(page, 'GET', `${base}/fleet/trip-plans/${tripId}`);
  expect(trip.status).toBe(200);
  expect(JSON.stringify(trip.body)).not.toMatch(/earning/i);
  for (const path of [`${base}/fleet/trips/${tripId}/earnings`, `${base}/fleet/earnings`]) {
    // 403 до чтения рейса: права нет ни в одной роли водителя (шлюз) или его закрывает функция «Водитель».
    const r = await call(page, 'GET', path);
    expect(r.status, path).toBe(403);
    expect(['forbidden_action', 'function_blocked'], path).toContain(
      (r.body as { code?: string }).code,
    );
    expect(JSON.stringify(r.body), path).not.toMatch(/amount/i);
  }
  const inbox = await call(page, 'GET', `/api/v1/me/notifications?tenantId=${tenant}&limit=50`);
  expect(inbox.status).toBe(200);
  expect(JSON.stringify(inbox.body)).not.toContain('Начислен');
  await expect(page.locator('#ox-main')).not.toContainText('Начислен');
}

/** Счётчик области на «Рабочем месте логиста» (число). */
async function counter(manager: Page, label: string): Promise<number> {
  const v = stat(manager, label);
  await expect(v).toHaveText(/^\d+$/, J.SERVER);
  return Number(await v.textContent());
}

/**
 * Менеджер на «Приёмке смен» принимает смену водителя: диалог «Принять смену …?», тост; машина свободна сразу —
 * на «Рабочем месте логиста» «свободно» +1, «ждут приёмки» −1 (W2.56).
 */
async function accept(manager: Page, tenant: string, trip: Trip): Promise<void> {
  await manager.goto(`/t/${tenant}/fleet`);
  await expect(J.h1(manager, FLEET_H1)).toBeVisible({ timeout: 15_000 });
  const free = await counter(manager, 'свободно');
  const waiting = await counter(manager, 'ждут приёмки');
  expect(waiting).toBeGreaterThan(0);
  await shiftInReview(manager, tenant, trip, false);
  await manager.getByRole('button', { name: 'Принять смену' }).click();
  const dlg = manager.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: `Принять смену ${trip.number}?` })).toBeVisible();
  await expect(dlg).toContainText('Машина вернётся в пул свободных');
  await dlg.getByRole('button', { name: 'Принять смену' }).click();
  await expect(toast(manager)).toHaveText('Смена принята. Машина вернулась в пул', J.SERVER);
  await expect(queueItem(manager, trip.number)).toContainText('Принят');
  await manager.goto(`/t/${tenant}/fleet`);
  await expect(J.h1(manager, FLEET_H1)).toBeVisible({ timeout: 15_000 });
  await expect(stat(manager, 'свободно')).toHaveText(String(free + 1), J.SERVER);
  await expect(stat(manager, 'ждут приёмки')).toHaveText(String(waiting - 1));
}

/** Начисление водителю за рейс у владельца на «Начислениях водителям»; `set` — сумма владельцем (стенд). */
async function earningsOf(owner: Page, tenant: string, trip: Trip, set?: string): Promise<void> {
  await owner.goto(`/t/${tenant}/earnings`);
  await expect(J.h1(owner, 'Начисления водителям')).toBeVisible({ timeout: 15_000 });
  const row = owner.getByRole('listitem').filter({ hasText: trip.number });
  await expect(row).toContainText(`${trip.number} · ${trip.title}`);
  await expect(row).toContainText('Илья Васильев');
  if (set) {
    await row.getByRole('button', { name: `Изменить начисление по рейсу ${trip.number}` }).click();
    const dlg = owner.getByRole('dialog', { name: `Начисление по рейсу ${trip.number}` });
    await dlg.getByLabel('Сумма, ₽').fill(set);
    await dlg.getByLabel('Как рассчитано').fill('Ставка за смену · W2.32');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(owner)).toHaveText(`Начисление по рейсу ${trip.number} изменено`, J.SERVER);
  }
  await expect(owner.getByRole('listitem').filter({ hasText: trip.number })).toContainText(
    J.nb('4 500 ₽'),
  );
}

test.describe('выход этапа 2 — полная смена водителя @mock', () => {
  test.skip(
    ({ harness }) => harness.mode !== 'mock',
    'пресет logistics-ready — сценарный сервер mock',
  );

  test('бронь → черновик осмотра без связи и отправка → выезд → своя категория расхода → сдача → приёмка → машина свободна → начисление; водитель без начислений', async ({
    app,
    page,
  }) => {
    test.setTimeout(240_000);
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await ownCategory(page, alta, 'Стоянка на ночь');

    await app(`/t/${alta}/today`, { persona: 'driver' });
    await fullShift(page, 'mock', { trip: R208, odometer: ODOMETER, category: 'Стоянка на ночь' });
    const tripId = (await plans(page, alta)).find((p) => p.number === TRIP)?.id ?? '';
    await noEarnings(page, alta, tripId);

    await app(`/t/${alta}/fleet`, { persona: 'manager' });
    await accept(page, alta, R208);
    const gazel = await vehicle(page, alta);
    expect([gazel.status, gazel.odometerKm]).toEqual(['available', String(ODOMETER + 190)]);

    await app(`/t/${alta}/home`, { persona: 'owner' });
    await earningsOf(page, alta, R208);

    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
    await noEarnings(page, alta, tripId);
  });
});

// Ревью r2: уборка упавшей попытки на стенде не заархивировала категорию — страница владельца перезагружалась, запрос
// уборки из страницы упал «Execution context was destroyed». Помощник уборки `J.settled` повторяет идемпотентную
// уборку после `load`; строка воспроизводит перезагрузку детерминированно (сценарный сервер mock).
test.describe('уборка стенда — запрос уборки переживает перезагрузку страницы @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарный сервер mock');

  test('страница перезагружается во время запроса уборки — повтор после load, ответ 200', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    let tries = 0;
    const r = await J.settled(page, async () => {
      tries += 1;
      if (tries === 1) {
        // Первая попытка: страница уходит на перезагрузку, пока запрос ещё идёт.
        await page.evaluate(
          () =>
            new Promise((done) => {
              setTimeout(() => location.reload(), 100);
              setTimeout(done, 5000);
            }),
        );
      }
      return call(page, 'GET', '/api/v1/me/context');
    });
    expect([tries, r.status]).toEqual([2, 200]);
  });

  // Ревью r3: повторяется только уничтоженный контекст страницы. Посторонняя ошибка, в тексте которой есть слово
  // «navigating» (тайм-аут `page.goto` внутри `fn`), уходит сразу, без повторов.
  test('посторонняя ошибка со словом «navigating» (тайм-аут перехода) — без повтора', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    let tries = 0;
    const error = await J.settled(page, async () => {
      tries += 1;
      await page.goto('/', { timeout: 1 });
    }).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(error).toMatch(/Timeout 1ms exceeded[\s\S]*navigating/);
    expect(tries).toBe(1);
  });
});

test.describe('выход этапа 2 — полная смена водителя на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('телефон водителя и менеджер 1440: черновик без связи, категория справочника, приёмка, машина свободна сразу, начисление', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await J.desktop(browser, harness, 'manager');
    const owner = await J.desktop(browser, harness, 'owner');
    // Контексты 1440 закрываются последними: уборка смены и категории идёт их запросами (undo — в обратном порядке).
    undo('контексты 1440', async () => {
      await manager.close();
      await owner.close();
    });
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(
      page,
      manager.page,
      s,
      `Смена W2.32 ${label(testInfo.project.name)}`,
    );
    expect(await storageReachable(page, s.tenant, trip.id, harness.allowHosts), NO_STORAGE).toBe(
      true,
    );
    // Упавшая строка могла оставить страницу без связи — уборка идёт запросами страницы водителя.
    undo(`смена рейса ${trip.number}`, async () => {
      await page.context().setOffline(false);
      // closeTrip идёт по состоянию рейса — повтор после перезагрузки страницы водителя безопасен.
      await J.settled(page, () => closeTrip(page, manager.page, s.tenant, trip.id));
    });
    const category = `Стоянка ${label(testInfo.project.name)}`;
    await ownCategory(owner.page, s.tenant, category);
    // Страница владельца в момент уборки могла перезагружаться — повтор после load (ревью r2).
    undo(`категория «${category}»`, () =>
      J.settled(owner.page, () => archiveCategory(owner.page, s.tenant, category)),
    );
    const gazel = await vehicle(page, s.tenant);

    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await fullShift(page, 'stand', { trip, odometer: Number(gazel.odometerKm), category });
    await noEarnings(page, s.tenant, trip.id);

    await accept(manager.page, s.tenant, trip);
    const after = await vehicle(manager.page, s.tenant);
    expect([after.status, after.odometerKm]).toEqual([
      'available',
      String(Number(gazel.odometerKm) + 190),
    ]);
    expect(((await plan(manager.page, s.tenant, trip.id)).body as { state: string }).state).toBe(
      'accepted',
    );
    await earningsOf(owner.page, s.tenant, trip, '4500');

    await page.reload();
    await expect(h2(page, 'Смена принята')).toBeVisible({ timeout: 15_000 });
    await noEarnings(page, s.tenant, trip.id);
  });
});

/** Своя категория строки — в архив (уборка стенда: подпись уникальна только среди активных; ETag «rev-N»). */
async function archiveCategory(owner: Page, tenant: string, name: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet/expense-categories`;
  const list = J.expectOk(await call(owner, 'GET', base), 'listExpenseCategories').body as {
    items: { code: string; label: string; state: string; revision?: number }[];
  };
  const c = list.items.find((x) => x.label === name && x.state === 'active');
  if (!c) return;
  J.expectOk(
    await call(owner, 'POST', `${base}/${c.code}/archive`, { ifMatch: `"rev-${c.revision ?? 1}"` }),
    'archiveExpenseCategory',
  );
}
