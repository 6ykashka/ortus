// W2.32 · Выход этапа 2, AC-03 (design/docs/15-quality-security.md, CAL-04): параллельные брони одной машины на один
// интервал — один 201, остальные 409. Встречный рейс Тимура Ахмедова на окно рейса Ильи Васильева; брони ГАЗели идут
// одновременно на оба рейса. Затем водитель, у которого на экране старый список, нажимает «Забронировать» — сервер
// отвечает 409 reservation_overlap, экран показывает «Конфликт брони» и «Обновить список» (J3 «Конфликт брони»).
//   @mock  — одна вкладка: брони «за спиной» экрана идут из сессии владельца (dev-вход в той же вкладке), затем
//            водитель входит снова — список на экране не перечитан;
//   @stand — водитель — страница проекта, владелец — свой контекст 1440; брони обеих сессий — одновременно.
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { carCard } from '../../driver.helpers.ts';
import {
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  type Plan,
  plan,
  plans,
  realClock,
  reservationOf,
  vehicle,
} from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, devScenario, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';

/**
 * Конфликты одной машины на одном интервале (Q-W2.32-9): машина занята бронью другого рейса — `reservation_overlap`;
 * свой рейс уже держит бронь (запросы одного рейса идут по очереди под блокировкой строки рейса и видят его в
 * `inspection`) — `invalid_transition`. `resources_unavailable` (водитель занят другой бронью) у водителей гонки
 * невозможен — это был бы посторонний захват водителя, строка его не принимает.
 */
const CONFLICTS = ['reservation_overlap', 'invalid_transition'];

/** Встречный рейс «Север Логистик» на окно `window` с водителем `driver` под груз ГАЗели (владелец). */
async function rivalTrip(
  owner: Page,
  tenant: string,
  o: { unitId: string; window: Plan['plannedWindow']; driver: string; title: string },
): Promise<Plan> {
  const r = await call(owner, 'POST', `/api/v1/tenants/${tenant}/fleet/trip-plans`, {
    body: {
      orgUnitId: o.unitId,
      title: o.title,
      plannedWindow: o.window,
      distanceKm: '20',
      cargo: {
        description: 'Сухой груз · 14 паллет-мест',
        weightKg: '1100',
        volumeM3: '12',
        lengthM: '3',
      },
      stops: [
        { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '1100', volumeM3: '12' },
        {
          sequence: 2,
          op: 'unload',
          address: 'Химки, ул. Заводская, 8',
          weightKg: '1100',
          volumeM3: '12',
        },
      ],
      driverMemberId: o.driver,
    },
  });
  return J.expectOk(r, 'createTripPlan встречного рейса').body as Plan;
}

const reserveBody = (vehicleId: string, trip: Plan) => ({
  vehicleId,
  driverMemberId: trip.driverMemberId,
  window: trip.plannedWindow,
  tripId: trip.id,
});

/** AC-03: из всех параллельных броней одной машины на один интервал принята одна, остальные — 409 конфликта. */
function oneWinner(all: { status: number; code: string }[]): void {
  expect(
    all.filter((r) => r.status === 201),
    JSON.stringify(all),
  ).toHaveLength(1);
  const rest = all.filter((r) => r.status !== 201);
  expect(rest.map((r) => r.status)).toEqual(rest.map(() => 409));
  for (const r of rest) expect(CONFLICTS).toContain(r.code);
}

/**
 * Машина за встречным рейсом: если гонку выиграл рейс водителя, его бронь снимается (менеджер, releaseReservation) и
 * ГАЗель бронируется на встречный рейс — у водителя на экране старый список.
 */
async function rivalHolds(owner: Page, tenant: string, gazel: string, mine: Plan, rival: Plan) {
  const held = await reservationOf(owner, tenant, mine.id);
  if (held?.state === 'held') {
    J.expectOk(
      await call(owner, 'PATCH', `/api/v1/tenants/${tenant}/fleet/reservations/${held.id}`, {
        body: { action: 'release', reason: 'W2.32: машина — встречному рейсу' },
        ifMatch: held.etag,
      }),
      'releaseReservation',
    );
    J.expectOk(
      await call(owner, 'POST', `/api/v1/tenants/${tenant}/fleet/reservations`, {
        body: reserveBody(gazel, rival),
      }),
      'reserveVehicle встречного рейса',
    );
  }
  expect((await reservationOf(owner, tenant, rival.id))?.state).toBe('held');
}

/** Водитель со старым списком: «Забронировать» → «Конфликт брони» → «Обновить список» → ГАЗель «Забронирована». */
async function conflictOnScreen(page: Page): Promise<void> {
  const book = carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' });
  await expect(book).toBeEnabled();
  await book.click();
  const alert = page.locator('.ox-dr').getByRole('alert');
  await expect(alert).toContainText('Конфликт брони', J.SERVER);
  await alert.getByRole('button', { name: 'Обновить список' }).click();
  await expect(toast(page)).toHaveText('Список обновлён', J.SERVER);
  await expect(page.getByText('Конфликт брони')).toHaveCount(0);
  await expect(carCard(page, 'ГАЗель Next')).toContainText('Забронирована');
  await expect(
    carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
  ).toHaveCount(0);
}

test.describe('выход этапа 2 — AC-03 конкурентная бронь @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты — сценарный сервер mock');

  test('параллельные брони ГАЗели двумя рейсами — один 201, остальные 409; у водителя «Конфликт брони» и «Обновить список»', async ({
    app,
    page,
  }) => {
    test.setTimeout(120_000);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    const T = `/api/v1/tenants/${alta}`;
    const units = (await call(page, 'GET', `${T}/org-units?limit=200`)).body as {
      items: { id: string; name: string }[];
    };
    const members = (await call(page, 'GET', `${T}/members?limit=200`)).body as {
      items: { id: string; displayName: string }[];
    };
    const mine = (
      (await call(page, 'GET', `${T}/fleet/trip-plans?limit=200`)).body as {
        items: Plan[];
      }
    ).items.find((p) => p.number === 'Р-208') as Plan;
    const rival = await rivalTrip(page, alta, {
      unitId: units.items.find((u) => u.name === 'Север Логистик')?.id ?? '',
      window: mine.plannedWindow,
      driver: members.items.find((m) => m.displayName === 'Тимур Ахмедов')?.id ?? '',
      title: 'Встречный',
    });
    const gazel = (await vehicle(page, alta)).id;

    // Водитель открыл «Мою смену»: список машин загружен, ГАЗель свободна.
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(J.h1(page, 'Моя смена')).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
    ).toBeEnabled();

    // «За спиной» экрана: десять одновременных броней ГАЗели на оба рейса (владелец за водителей).
    await J.relogin(page, 'owner');
    const all = await J.burst(
      page,
      `${T}/fleet/reservations`,
      Array.from({ length: 10 }, (_, i) => reserveBody(gazel, i % 2 ? mine : rival)),
    );
    oneWinner(all);
    await rivalHolds(page, alta, gazel, mine, rival);

    await J.relogin(page, 'driver');
    await conflictOnScreen(page);
    expect(((await plan(page, alta, mine.id)).body as { state: string }).state).toBe('planned');
  });
});

test.describe('выход этапа 2 — AC-03 конкурентная бронь на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель и владелец одновременно бронируют ГАЗель на пересекающиеся окна — один 201; водитель со старым списком видит «Конфликт брони»', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(240_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const owner = await J.desktop(browser, harness, 'owner');
    undo('контекст 1440', () => owner.close());
    // Встречный водитель — карточка без входа (бронь за него делает владелец): встречный рейс без отмены не занимает
    // окна водителей сида, нужных другим строкам (Тимур Ахмедов — временный водитель AC-06).
    const rivalDriver = await J.cardDriver(
      owner.page,
      s.tenant,
      s.unitId,
      'Встречный водитель W2.32',
    );
    await app('/', { persona: 'driver' });
    const mine = await driverTrip(
      page,
      owner.page,
      s,
      `Гонка W2.32 ${label(testInfo.project.name)}`,
    );
    undo(`смена рейса ${mine.number}`, () => closeTrip(page, owner.page, s.tenant, mine.id));
    // Встречный рейс прошлого проекта на это же окно остаётся запланированным (рейс без брони не отменить) — берётся он.
    const left = (await plans(owner.page, s.tenant)).find(
      (p) =>
        p.title.startsWith('Встречный W2.32') &&
        p.state === 'planned' &&
        p.driverMemberId === rivalDriver &&
        p.plannedWindow.startsAt === mine.plannedWindow.startsAt,
    );
    const rival =
      left ??
      (await rivalTrip(owner.page, s.tenant, {
        unitId: s.unitId,
        window: mine.plannedWindow,
        driver: rivalDriver,
        title: `Встречный W2.32 ${label(testInfo.project.name)}`,
      }));
    undo(`бронь встречного рейса ${rival.number}`, () =>
      closeTrip(owner.page, owner.page, s.tenant, rival.id),
    );
    const gazel = (await vehicle(page, s.tenant)).id;

    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${mine.number} · ${mine.title}`)).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }),
    ).toBeEnabled();

    // Две сессии одновременно: водитель — на свой рейс, владелец — на встречный; по пять запросов.
    const path = `/api/v1/tenants/${s.tenant}/fleet/reservations`;
    const [a, b] = await Promise.all([
      J.burst(
        page,
        path,
        Array.from({ length: 5 }, () => reserveBody(gazel, mine)),
      ),
      J.burst(
        owner.page,
        path,
        Array.from({ length: 5 }, () => reserveBody(gazel, rival)),
      ),
    ]);
    oneWinner([...a, ...b]);
    await rivalHolds(owner.page, s.tenant, gazel, mine, rival);

    await conflictOnScreen(page);
    expect(((await plan(page, s.tenant, mine.id)).body as { state: string }).state).toBe('planned');
  });
});
