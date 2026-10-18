// W2.90 · Путь показа 18.10 (облегчённый W2.32): смена водителя «Альты» целиком — бронь машины → осмотр с пятью фото →
// выезд → расход → «Завершить рейс» → осмотр при сдаче → «Сдать машину» — и логист: «Рабочее место логиста», очередь
// дефектов, «Приёмка смен». Изоляция: владелец «Лотоса» не видит рейсов «Альты». Сценарий — docs/demo/2026-10-18.md.
//   @mock  — сценарный сервер (пресет logistics-ready), приёмка менеджером в той же вкладке;
//   @stand — стенд с MinIO (docs/demo/demo-stand.mjs; e2e-stand — после MinIO в compose, integratorNotes W2.53): фото
//            через MinIO и cmd/worker, логист — второй контекст 1440, приёмка на сервере (reviewTrip, W2.06). На базовом
//            сиде строка сама подключает «Логистику» и даёт Котовой роль логиста (logistics.stand.ts), рейс — свой
//            (Р-208 сида, пока он не пройден, иначе новый рейс Ильи Васильева): строка повторяема в трёх проектах.
import { createNet, installClock, LOCALE, openApp, TIMEZONE } from '@ortus/e2e-kit';
import type { Browser, Locator, Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import {
  actionBar,
  carCard,
  DEP_CHECKS,
  finishDialog,
  RET_CHECKS,
  SIDES,
} from '../../driver.helpers.ts';
import { FLEET_H1 } from '../../logistics.helpers.ts';
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
  realClock,
  storageReachable,
  vehicle,
} from '../../logistics.stand.ts';
import { queueItem, REVIEW_H1, review } from '../../logistics-review.helpers.ts';
import { h1, toast } from '../../modules.helpers.ts';
import { platformTenantId } from '../../platform-orgs.helpers.ts';
import { ALTA, call, devScenario, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';

type Mode = 'mock' | 'stand';

const TRIP = 'Р-208';
/** Рейс смены: номер и название (mock — Р-208 пресета, стенд — свой рейс строки). */
type Trip = Pick<Plan, 'number' | 'title'>;
const R208: Trip = { number: TRIP, title: 'Северный маршрут' };
/** Пробег ГАЗели в сиде (mock): выезд +130 км, сдача +190 км — «Пройдено 60 км». */
const ODOMETER = 84370;
const DEFECTS_H1 = 'Очередь блокирующих дефектов';
/** Id, которого нет ни в одной организации. */
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const h2 = (page: Page, name: string): Locator => page.getByRole('heading', { level: 2, name });

/**
 * Настоящий JPEG 640×480 (canvas страницы): на стенде файл проходит сжатие на клиенте (W2.22), MinIO и проверку
 * cmd/worker; в mock содержимое не проверяется.
 */
async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#3b7d6e';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#ffffff';
    g.font = '40px sans-serif';
    g.fillText('Ортус · осмотр', 40, 250);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  });
  if (!b64) throw new Error('canvas: нет 2d-контекста');
  return Buffer.from(b64, 'base64');
}

/** Фото слота через выбор файла (камера телефона — тот же input `capture`). */
async function shoot(page: Page, slot: Locator, file: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await slot.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: file });
}

/** Ждёт `ready`: в mock проверку файлов завершает dev-маршрут сценарного сервера, на стенде — cmd/worker. */
async function untilReady(page: Page, mode: Mode, ready: Locator): Promise<void> {
  if (mode === 'stand') {
    await expect(ready).toBeVisible({ timeout: 60_000 });
    return;
  }
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/** Пять фото осмотра → «Фото · 5 из 5». */
async function fivePhotos(page: Page, mode: Mode, file: Buffer): Promise<void> {
  for (const side of SIDES) {
    await shoot(
      page,
      page.getByRole('button', { name: new RegExp(`^${side}: `) }),
      file,
      `${side}.jpg`,
    );
  }
  await untilReady(page, mode, page.getByText('Фото · 5 из 5'));
}

/** Пробег, «½» и пункты чек-листа. */
async function fillInspection(
  page: Page,
  odometer: string,
  checks: readonly string[],
): Promise<void> {
  await page.getByLabel(/^Пробег по одометру, км/).fill(odometer);
  await page.getByRole('button', { name: '½', exact: true }).click();
  for (const c of checks) await page.getByLabel(c, { exact: true }).check();
}

/** Ответ сервера на команду смены под нагрузкой стенда — дольше 5 с ожидания по умолчанию. */
const SERVER = { timeout: 15_000 };

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

/** Ответ Problem без полей запроса: 404 чужого и несуществующего сравниваются по сути. */
function problemShape(r: Reply): Record<string, unknown> {
  const b = { ...(r.body as Record<string, unknown>) };
  delete b.instance;
  delete b.requestId;
  delete b.traceId;
  return b;
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
    await page
      .context()
      .route('https://storage.example.invalid/**', (r) => r.fulfill({ status: 200 }));
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

/** Логист на компьютере: свой контекст 1440 с часами и сетью харнесса, вход персонажа; часы — настоящие. */
async function desktop(
  browser: Browser,
  o: { appURL: string; allowHosts: readonly string[] },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: o.appURL,
    viewport: { width: 1440, height: 900 },
    locale: LOCALE,
    timezoneId: TIMEZONE,
  });
  await installClock(context);
  await createNet(context, o.allowHosts);
  const page = await context.newPage();
  await realClock(page);
  return { page, close: () => context.close() };
}

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
    const logist = await desktop(browser, harness);
    try {
      await openApp(logist.page, { baseURL: harness.appURL, route: '/', persona: 'manager' });
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
    const logist = await desktop(browser, harness);
    try {
      await openApp(logist.page, { baseURL: harness.appURL, route: '/', persona: 'manager' });
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
      const missing = await call(page, 'GET', `/api/v1/tenants/${UNKNOWN}/${path}`);
      expect(foreign.status, path).toBe(404);
      expect(missing.status, path).toBe(404);
      expect(problemShape(foreign), path).toEqual(problemShape(missing));
      expect(JSON.stringify(foreign.body), path).not.toContain(TRIP);
    }
    await page.goto(`/t/${alta}/review`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена', {
      timeout: 15_000,
    });
    await expect(page.locator('#app')).not.toContainText(TRIP);
  });
});
