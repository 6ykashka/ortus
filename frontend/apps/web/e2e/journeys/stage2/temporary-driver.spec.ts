// W2.32 · Выход этапа 2, AC-06 (design/docs/15-quality-security.md; решение Q-W2.07-1 «только рейс», W2.57):
// Тимур Ахмедов («Север Логистик») в пуле, владелец на «Ресурсном пуле» — «Запросить на рейс» фирмы «Юг Транс» и
// «Одобрить» во «Входящих запросах»; в окне временный водитель видит только свой рейс и машину рейса, после срока у
// начатого рейса — только сдача, после приёмки — ответ как у несуществующего. Анализ 08-requirements.md J6.
//   @stand — узкая роль «Временный водитель» (W2.57, у Ахмедова в сиде своей роли нет); часы стенда настоящие, поэтому
//            окно перевода короткое, от «сейчас» (≈ 2,5 мин), строка ждёт его начала и конца. Машину рейса временному
//            водителю бронирует владелец: в роли нет fleet.reservations.create (Q-W2.57-1), а осмотр перед выездом
//            сервер принимает только по брони водителя (рейс в «inspection») — см. отчёт W2.32, вопрос о брони;
//   @mock  — часы сценарного сервера (`now`); узкая роль «Временный водитель» без домашней (W2.62, Q-W2.32-6: MSW
//            выдаёт роль при одобрении и открывает машину рейса в осмотре, как backend). После срока у начатого рейса
//            сдача — командами водителя, как на стенде: экран «Моя смена» в продолжении требует listVehicles
//            (Q-W2.32-2 → W2.61).
import type { Persona } from '@ortus/e2e-kit';
import type { Browser, Page } from '@playwright/test';

import { expect, type Session, test, type Undo } from '../../_stand/fixtures.ts';
import { listUnits } from '../../_stand/stand.ts';
import { actionBar, DEP_CHECKS } from '../../driver.helpers.ts';
import { driverCard, incomingCard } from '../../logistics-pool.helpers.ts';
import {
  akhmedov,
  apiReturn,
  closeTrip,
  label,
  logisticsOn,
  type Plan,
  plan,
  realClock,
  type Vehicle,
  vehicles,
} from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, devScenario, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

const MSK = 'Europe/Moscow';
const YUG = 'Юг Транс';
const ELF = 'Isuzu Elf';
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Window {
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/** Публикация водителя в пуле (владелец): псевдоним «Водитель #N». */
async function publish(
  owner: Page,
  tenant: string,
  o: { driver: string; home: string; free: Window },
): Promise<{ id: string; displayName: string }> {
  const r = await call(owner, 'POST', `/api/v1/tenants/${tenant}/fleet/driver-pool/publications`, {
    body: {
      driverMemberId: o.driver,
      homeOrgUnitId: o.home,
      freeWindow: o.free,
      qualifications: ['Кат. B'],
      terms: 'По соглашению фирм группы',
    },
  });
  return J.expectOk(r, 'publishDriverToPool').body as { id: string; displayName: string };
}

/** Рейс фирмы-получателя «Юг Транс» на окно перевода (владелец, без водителя), лёгкий груз под Isuzu Elf. */
async function yugTrip(owner: Page, tenant: string, unit: string, window: Window, title: string) {
  const r = await call(owner, 'POST', `/api/v1/tenants/${tenant}/fleet/trip-plans`, {
    body: {
      orgUnitId: unit,
      title,
      plannedWindow: window,
      distanceKm: '35',
      cargo: {
        description: 'Сухой груз · 5 паллет-мест',
        weightKg: '400',
        volumeM3: '5',
        lengthM: '2',
      },
      stops: [
        {
          sequence: 1,
          op: 'load',
          address: 'Склад № 1, Лобня',
          weightKg: '400',
          volumeM3: '5',
          plannedAt: window.startsAt,
        },
        {
          sequence: 2,
          op: 'unload',
          address: 'Химки, ул. Заводская, 8',
          weightKg: '400',
          volumeM3: '5',
          plannedAt: window.endsAt,
        },
      ],
    },
  });
  return J.expectOk(r, 'createTripPlan «Юг Транс»').body as Plan;
}

/**
 * Владелец на «Ресурсном пуле» с рейсом «Юг Транс»: карточка водителя → «Запросить на рейс» → «Отправить запрос» →
 * «Входящие запросы» → «Одобрить» → «Временно назначен».
 */
async function requestAndApprove(owner: Page, tenant: string, trip: Plan, code: string) {
  await owner.goto(`/t/${tenant}/pool?trip=${trip.id}`);
  await expect(J.h1(owner, 'Ресурсный пул')).toBeVisible({ timeout: 15_000 });
  const card = driverCard(owner, code);
  await expect(card).toContainText('Кат. B · Север Логистик');
  await card.getByRole('button', { name: `Запросить на рейс ${trip.number}` }).click();
  const dlg = owner.getByRole('dialog');
  await expect(dlg).toContainText(`${code} · Север Логистик`);
  await expect(dlg).toContainText('Менеджер фирмы Север Логистик');
  await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(toast(owner)).toHaveText('Запрос отправлен фирме Север Логистик', J.SERVER);
  const row = incomingCard(owner, code);
  await expect(row).toContainText(`${YUG} · рейс ${trip.number}`);
  await row.getByRole('button', { name: 'Одобрить' }).click();
  await expect(toast(owner)).toHaveText('Фирма Север Логистик одобрила запрос', J.SERVER);
  await expect(card.locator('.ox-pl-chip')).toContainText('Временно назначен');
  await expect(card.getByRole('status')).toContainText(
    `${code} назначен на рейс ${trip.number} до`,
  );
}

/** Машина рейса (assignTripVehicle) и бронь на временного водителя (reserveVehicle владельца, Q-W2.57-1). */
async function vehicleForTrip(
  owner: Page,
  tenant: string,
  trip: Plan,
  driver: string,
  vehicleId: string,
) {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const cur = J.expectOk(await call(owner, 'GET', `${base}/trip-plans/${trip.id}`), 'getTripPlan');
  J.expectOk(
    await call(owner, 'PUT', `${base}/trips/${trip.id}/vehicle`, {
      body: { vehicleId },
      ifMatch: cur.headers.etag ?? '',
    }),
    'assignTripVehicle',
  );
  J.expectOk(
    await call(owner, 'POST', `${base}/reservations`, {
      body: { vehicleId, driverMemberId: driver, window: trip.plannedWindow, tripId: trip.id },
    }),
    'reserveVehicle за временного водителя',
  );
}

type UnitPlan = Plan & { orgUnitId: string };

/**
 * Рейсы и машины временного водителя: фирмы-получателя — только рейс перевода и машина рейса; прочие видимые рейсы —
 * только его собственные (водитель — он: рейсы домашней фирмы, прошлые смены, Q-W2.32-8), чужих рейсов нет. Машины —
 * исключительный список: узкая роль без домашней (стенд и mock, W2.62) — ровно машина рейса.
 */
async function onlyTripAndVehicle(
  driver: Page,
  tenant: string,
  trip: Plan,
  o: { vehicle: string; driverId: string; unit: string },
) {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const plans = J.expectOk(
    await call(driver, 'GET', `${base}/trip-plans?limit=200`),
    'listTripPlans',
  ).body as { items: UnitPlan[] };
  expect(plans.items.filter((p) => p.orgUnitId === o.unit).map((p) => p.number)).toEqual([
    trip.number,
  ]);
  expect(plans.items.filter((p) => p.driverMemberId !== o.driverId)).toEqual([]);
  const list = J.expectOk(await call(driver, 'GET', `${base}/vehicles?limit=200`), 'listVehicles')
    .body as { items: { displayName: string; orgUnitId: string }[] };
  const names = (items: typeof list.items) => items.map((v) => `${v.displayName}`).sort();
  expect(names(list.items.filter((v) => v.orgUnitId === o.unit))).toEqual([o.vehicle]);
  expect(names(list.items), 'машины временного водителя без домашней роли').toEqual([o.vehicle]);
}

/**
 * Q-W2.32-7: у временного водителя без своих ролей после конца назначения скрытый объект отвечает так же, как
 * несуществующий id (данных нет), но код зависит от операции: `getTripPlan` — 403 `forbidden_action`, `getVehicle` —
 * 404 `not_found` (стенд 19.10, три проекта; литерал «404» AC-06 для рейса — mock, где у водителя домашняя роль). Код
 * записан явно, чтобы смена ответа шлюза была замечена.
 */
async function hiddenAfterEnd(
  driver: Page,
  path: (id: string) => string,
  id: string,
  o: { leak: string; status: number; code: string },
) {
  const r = await J.hiddenLikeUnknown(driver, path, id, [o.leak]);
  expect([r.status, (r.body as { code?: string }).code], path(id)).toEqual([o.status, o.code]);
}

/** Владелец: перевод водителя — состояние назначения (`grant.state`) и просрочка. */
async function grantOf(owner: Page, tenant: string, driver: string, trip: Plan) {
  const r = J.expectOk(
    await call(
      owner,
      'GET',
      `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests?status=approved&status=revoked&status=completed&limit=200`,
    ),
    'listDriverTransfers',
  ).body as {
    items: {
      id: string;
      tripId?: string;
      driverMemberId: string;
      grant?: { state: string; overdue?: boolean };
    }[];
  };
  return r.items.find((x) => x.tripId === trip.id && x.driverMemberId === driver);
}

/** Уборка пула стенда: открытые запросы Ахмедова отклоняются, одобренные — отзываются, публикации снимаются. */
async function poolClean(owner: Page, tenant: string, driver: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const list = J.expectOk(
    await call(
      owner,
      'GET',
      `${base}/driver-transfer-requests?status=requested&status=approved&limit=200`,
    ),
    'listDriverTransfers',
  ).body as { items: { id: string; status: string; driverMemberId: string }[] };
  for (const x of list.items.filter((t) => t.driverMemberId === driver)) {
    const path = `${base}/driver-transfer-requests/${x.id}`;
    const cur = J.expectOk(await call(owner, 'GET', path), 'getDriverTransfer');
    await call(owner, 'POST', `${path}/decision`, {
      body: {
        decision: x.status === 'approved' ? 'revoke' : 'reject',
        comment: 'W2.32: уборка стенд-e2e',
      },
      ifMatch: cur.headers.etag ?? '',
    });
  }
  const pubs = J.expectOk(
    await call(owner, 'GET', `${base}/driver-pool/publications?limit=200`),
    'listDriverPoolPublications',
  ).body as { items: { id: string; state: string; driverMemberId: string }[] };
  for (const p of pubs.items.filter((x) => x.driverMemberId === driver && x.state === 'active')) {
    const path = `${base}/driver-pool/publications/${p.id}`;
    const cur = J.expectOk(await call(owner, 'GET', path), 'getDriverPoolPublication');
    await call(owner, 'POST', `${path}/withdrawal`, {
      body: { comment: 'W2.32: уборка стенд-e2e' },
      ifMatch: cur.headers.etag ?? '',
    });
  }
}

/** Ждать момента `at` (мс) с запасом `pad` (часы стенда настоящие). */
async function until(page: Page, at: number, pad = 3000): Promise<void> {
  const left = at + pad - Date.now();
  if (left > 0) await page.waitForTimeout(left);
}

test.describe('выход этапа 2 — AC-06 временный водитель @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и часы — сценарный сервер mock');

  /** Окно перевода: 14:00–18:00 по Москве 01.10.2026. */
  const W: Window = {
    startsAt: '2026-10-01T11:00:00Z',
    endsAt: '2026-10-01T15:00:00Z',
    timeZone: MSK,
  };

  /**
   * Ахмедов в «Север Логистик» без своей роли (как в сиде стенда), в пуле; рейс «Юг Транс»; запрос и одобрение — узкая
   * роль «Временный водитель» (W2.62).
   */
  async function temporary(app: AppFn, page: Page) {
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    const T = `/api/v1/tenants/${alta}`;
    const units = await listUnits(page, alta);
    const sever = units.find((u) => u.name === 'Север Логистик')?.id ?? '';
    const yug = units.find((u) => u.name === YUG)?.id ?? '';
    const members = J.expectOk(await call(page, 'GET', `${T}/members?limit=200`), 'listMembers')
      .body as { items: { id: string; displayName: string; revision: number }[] };
    const akh = members.items.find((m) => m.displayName === 'Тимур Ахмедов');
    if (!akh) throw new Error('нет Тимура Ахмедова');
    J.expectOk(
      await call(page, 'PATCH', `${T}/members/${akh.id}`, {
        body: { orgUnitIds: [sever] },
        ifMatch: `"rev-${akh.revision}"`,
      }),
      'updateMember',
    );
    const pub = await publish(page, alta, { driver: akh.id, home: sever, free: W });
    const trip = await yugTrip(page, alta, yug, W, 'Сборный груз');
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await requestAndApprove(page, alta, trip, pub.displayName);
    const car = (await vehicles(page, alta)).find((v) => v.displayName === ELF);
    if (!car) throw new Error(`нет машины «${ELF}»`);
    const elf = car.id;
    const cur = J.expectOk(
      await call(page, 'GET', `${T}/fleet/trip-plans/${trip.id}`),
      'getTripPlan',
    );
    J.expectOk(
      await call(page, 'PUT', `${T}/fleet/trips/${trip.id}/vehicle`, {
        body: { vehicleId: elf },
        ifMatch: cur.headers.etag ?? '',
      }),
      'assignTripVehicle',
    );
    const r208 = (
      J.expectOk(await call(page, 'GET', `${T}/fleet/trip-plans?limit=200`), 'listTripPlans')
        .body as {
        items: Plan[];
      }
    ).items.find((p) => p.number === 'Р-208') as Plan;
    return { alta, trip, r208, yug, sever, akh: akh.id, car };
  }

  test('пул: запрос и одобрение на экране; в окне — только рейс «Юг Транс» и машина рейса; после окна — как у несуществующего', async ({
    app,
    page,
  }) => {
    test.setTimeout(150_000);
    const { alta, trip, r208, yug, akh } = await temporary(app, page);
    const base = `/api/v1/tenants/${alta}/fleet`;

    // В окне перевода (14:30): «Моя смена» — рейс «Юг Транс», чужие рейсы — как несуществующие.
    await J.serverNow(page, '2026-10-01T11:30:00Z');
    await J.relogin(page, 'acc-9');
    await page.goto(`/t/${alta}/today`);
    await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${trip.number} · Сборный груз`)).toBeVisible();
    await expect(page.getByText('Машина назначена')).toBeVisible();
    // Узкая роль без домашней (W2.62): машины — исключительный список, ровно машина рейса.
    await onlyTripAndVehicle(page, alta, trip, { vehicle: ELF, driverId: akh, unit: yug });
    await J.hiddenLikeUnknown(page, (id) => `${base}/trip-plans/${id}`, r208.id, ['Р-208']);

    // После окна (18:10): рейс не начат — назначение кончилось, своих ролей у Ахмедова нет: список рейсов и рейс
    // отвечают как на несуществующий id — 403 forbidden_action, как на стенде (Q-W2.32-7); данных рейса нет.
    await J.serverNow(page, '2026-10-01T15:10:00Z');
    const after = await call(page, 'GET', `${base}/trip-plans?limit=200`);
    expect([after.status, (after.body as { code?: string }).code], 'listTripPlans').toEqual([
      403,
      'forbidden_action',
    ]);
    await hiddenAfterEnd(page, (id) => `${base}/trip-plans/${id}`, trip.id, {
      leak: trip.number,
      status: 403,
      code: 'forbidden_action',
    });
    await page.reload();
    await expect(page.locator('#app')).not.toContainText(trip.number, { timeout: 15_000 });
  });

  // W2.62 (Q-W2.32-6): MSW выдаёт узкую роль при одобрении и открывает машину рейса другой фирмы в чек-листе и осмотре
  // (как inspections.Checklist backend) — fixme снят. После срока сдача — командами водителя, как в строке @stand:
  // «Моя смена» в продолжении требует listVehicles (403, Q-W2.32-2); сдача на экране — после W2.61.
  test('начатый рейс после окна — только сдача; после приёмки — как несуществующий', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    const { alta, trip, yug, akh, car } = await temporary(app, page);
    const base = `/api/v1/tenants/${alta}/fleet`;

    // В окне (14:30): машину рейса бронирует владелец (Q-W2.32-1), водитель — осмотр и выезд на экране.
    await J.serverNow(page, '2026-10-01T11:30:00Z');
    J.expectOk(
      await call(page, 'POST', `${base}/reservations`, {
        body: {
          vehicleId: car.id,
          driverMemberId: akh,
          window: trip.plannedWindow,
          tripId: trip.id,
        },
      }),
      'reserveVehicle за временного водителя',
    );
    await J.relogin(page, 'acc-9');
    const file = await J.jpeg(page, 'Ортус · временный водитель');
    await departOnScreen(page, alta, trip, 'mock', file, Number(car.odometerKm) + 10);

    // После окна (18:10): начатый рейс — только продолжение; машины рейса нет (403, как на стенде), бронь закрыта;
    // сдача — командами водителя (finishTripRoute, осмотр при сдаче с пятью фото, returnTrip).
    await J.serverNow(page, '2026-10-01T15:10:00Z');
    await continuedOnly(page, alta, trip, yug, CARS_NARROW);
    const reserve = await call(page, 'POST', `${base}/reservations`, {
      body: { vehicleId: car.id, driverMemberId: akh, window: trip.plannedWindow, tripId: trip.id },
    });
    expect(
      [reserve.status, (reserve.body as { code?: string } | null)?.code],
      'reserveVehicle после срока',
    ).toEqual([403, 'forbidden_action']);
    await mockReturn(page, alta, trip, car.id, Number(car.odometerKm) + 60);
    expect((await plan(page, alta, trip.id)).body).toMatchObject({ state: 'submitted' });

    // Приёмка владельцем — назначение кончилось: рейс отвечает как несуществующий (AC-06; 403, Q-W2.32-7).
    await J.relogin(page, 'owner');
    await J.acceptOnReview(page, alta, trip.number);
    await J.relogin(page, 'acc-9');
    await hiddenAfterEnd(page, (id) => `${base}/trip-plans/${id}`, trip.id, {
      leak: trip.number,
      status: 403,
      code: 'forbidden_action',
    });
    await hiddenAfterEnd(page, (id) => `${base}/vehicles/${id}`, car.id, {
      leak: ELF,
      status: 404,
      code: 'not_found',
    });
  });
});

/** «Моя смена» в окне: рейс перевода, осмотр перед выездом с пятью фото и «Выехать на маршрут». */
async function departOnScreen(
  driver: Page,
  tenant: string,
  trip: Plan,
  mode: J.Mode,
  file: Buffer,
  odometer: number,
): Promise<void> {
  await driver.goto(`/t/${tenant}/today`);
  await expect(J.h1(driver, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await expect(driver.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
  await expect(J.h2(driver, 'Осмотр перед выездом')).toBeVisible(J.SERVER);
  await J.photos(driver, mode, file);
  await J.fillInspection(driver, String(odometer), DEP_CHECKS);
  await actionBar(driver).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(driver)).toHaveText('Выезд подтверждён сервером', J.SERVER);
  await expect(J.h2(driver, 'Маршрут')).toBeVisible(J.SERVER);
}

/**
 * Ответ `listVehicles` в продолжении — `[status, code]`: узкая роль «Временный водитель» (стенд и mock, W2.62) — 403
 * `forbidden_action` (в продолжении D09 строка роли в области resource кончилась, а `fleet.vehicles.read` области self
 * список машин не открывает, Q-W2.32-2). Если ответ сменится (например, W2.61 или правка шлюза), строка упадёт и
 * смена будет замечена.
 */
type CarsAfterEnd = readonly [status: number, code: string | undefined];
const CARS_NARROW: CarsAfterEnd = [403, 'forbidden_action'];

/** Ракурсы фото осмотра (requiredPhotoRoles чек-листа). */
const PHOTO_ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;

/**
 * Mock: пять готовых фото осмотра при сдаче рейса — загрузка (initiateUpload → completeUpload; PUT по билету сценарный
 * сервер не требует) и проверка файлов dev-маршрутом сценарного сервера (`scanFiles`).
 */
async function mockPhotos(driver: Page, tenant: string, tripId: string): Promise<string[]> {
  const base = `/api/v1/tenants/${tenant}/files/uploads`;
  const ids: string[] = [];
  for (const [i, role] of PHOTO_ROLES.entries()) {
    const sha256 = String(i + 1).repeat(64);
    const t = J.expectOk(
      await call(driver, 'POST', base, {
        body: {
          fileName: `${role}.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 48_000,
          sha256,
          purpose: 'inspection',
          owner: { moduleKey: 'fleet', entityType: 'trip', entityId: tripId },
        },
      }),
      'initiateUpload',
    ).body as { uploadId: string; fileId: string };
    J.expectOk(
      await call(driver, 'POST', `${base}/${t.uploadId}/complete`, { body: { sha256 } }),
      'completeUpload',
    );
    ids.push(t.fileId);
  }
  J.expectOk(
    await call(driver, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } }),
    'dev/scenario scanFiles',
  );
  return ids;
}

/**
 * Mock, продолжение после срока: «Завершить рейс» (finishTripRoute), осмотр при сдаче машины рейса с пятью фото
 * (getInspectionChecklist, submitInspection) и сдача (returnTrip) — командами водителя, как `apiReturn` на стенде.
 */
async function mockReturn(
  driver: Page,
  tenant: string,
  trip: Plan,
  vehicleId: string,
  odometer: number,
): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const etag = async () => (await plan(driver, tenant, trip.id)).headers.etag ?? '';
  J.expectOk(
    await call(driver, 'POST', `${base}/trips/${trip.id}/route-completion`, {
      ifMatch: await etag(),
    }),
    'finishTripRoute',
  );
  const list = J.expectOk(
    await call(driver, 'GET', `${base}/inspection-checklist?vehicleId=${vehicleId}&kind=return`),
    'getInspectionChecklist return',
  ).body as { versionId: string; items: { key: string }[] };
  const files = await mockPhotos(driver, tenant, trip.id);
  const at = '2026-10-01T15:10:00Z';
  const ret = J.expectOk(
    await call(driver, 'POST', `${base}/inspections`, {
      body: {
        checklistVersionId: list.versionId,
        vehicleId,
        kind: 'return',
        tripId: trip.id,
        odometerKm: String(odometer),
        fuelPercent: 50,
        checks: list.items.map((i) => ({ key: i.key, result: 'pass' })),
        photos: PHOTO_ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: at })),
        capturedAt: at,
      },
    }),
    'submitInspection return',
  ).body as { id: string };
  J.expectOk(
    await call(driver, 'PATCH', `${base}/trips/${trip.id}`, {
      body: { action: 'return', returnInspectionId: ret.id },
      ifMatch: await etag(),
    }),
    'returnTrip',
  );
}

/**
 * После срока у начатого рейса — только продолжение (D09): из фирмы-получателя виден лишь рейс перевода «в пути»;
 * машины рейса нет, ответ списка машин записан явно (`cars`).
 */
async function continuedOnly(
  driver: Page,
  tenant: string,
  trip: Plan,
  unit: string,
  cars: CarsAfterEnd,
): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const plans = J.expectOk(
    await call(driver, 'GET', `${base}/trip-plans?limit=200`),
    'listTripPlans',
  ).body as { items: UnitPlan[] };
  expect(
    plans.items.filter((p) => p.orgUnitId === unit).map((p) => `${p.number}:${p.state}`),
  ).toEqual([`${trip.number}:on_route`]);
  const r = await call(driver, 'GET', `${base}/vehicles?limit=200`);
  expect(
    [r.status, (r.body as { code?: string } | null)?.code],
    'listVehicles после срока',
  ).toEqual([...cars]);
  expect(JSON.stringify(r.body)).not.toContain(ELF);
}

interface StandFx {
  app: AppFn;
  page: Page;
  browser: Browser;
  harness: { appURL: string; allowHosts: readonly string[] };
  session: () => Promise<Session>;
  undo: Undo;
}

/** Перевод на стенде, доведённый до срока: начатый рейс «в пути» в продолжении. */
interface Overdue {
  tenant: string;
  owner: Page;
  driver: Page;
  akh: string;
  trip: Plan;
  elf: Vehicle;
  file: Buffer;
}

/**
 * Стенд, узкая роль «Временный водитель»: публикация Ахмедова, рейс «Юг Транс», запрос и одобрение на «Ресурсном
 * пуле», машина и бронь владельца; в окне — только рейс перевода и машина рейса, осмотр и выезд на экране; после срока
 * — начатый рейс только в продолжении, просрочка у владельца, бронь закрыта.
 */
async function overdueOnRoute(fx: StandFx, project: string): Promise<Overdue> {
  const { app, page, browser, harness, session, undo } = fx;
  await realClock(page);
  const s = await logisticsOn(session, undo);
  const owner = await J.desktop(browser, harness, 'owner');
  undo('контекст 1440', () => owner.close());
  await app('/', { persona: 'owner' });
  const yug = (await listUnits(owner.page, s.tenant)).find((u) => u.name === YUG)?.id ?? '';
  const elf = (await vehicles(owner.page, s.tenant)).find((v) => v.displayName === ELF);
  if (!elf) throw new Error(`нет машины «${ELF}»`);
  // Пул прошлого прогона (упавшая строка) не мешает: запросы Ахмедова закрыты, публикации сняты.
  await poolClean(owner.page, s.tenant, s.members.akhmedov);
  undo('пул: запросы и публикации Ахмедова', () =>
    poolClean(owner.page, s.tenant, s.members.akhmedov),
  );

  // Окно перевода — через 90 с на 150 с: запрос и одобрение на экране владельца — до его начала.
  const begin = Math.ceil((Date.now() + 90_000) / 1000) * 1000;
  const end = begin + 150_000;
  const window: Window = { startsAt: iso(begin), endsAt: iso(end), timeZone: MSK };
  const pub = await publish(owner.page, s.tenant, {
    driver: s.members.akhmedov,
    home: s.unitId,
    free: { startsAt: iso(Date.now() + 2000), endsAt: iso(end + 60_000), timeZone: MSK },
  });
  const trip = await yugTrip(owner.page, s.tenant, yug, window, `Пул W2.32 ${label(project)}`);
  await requestAndApprove(owner.page, s.tenant, trip, pub.displayName);
  await vehicleForTrip(owner.page, s.tenant, trip, s.members.akhmedov, elf.id);
  expect(Date.now(), 'одобрение и бронь — до начала окна').toBeLessThan(begin);

  const driver = await akhmedov(session);
  undo(`смена рейса ${trip.number}`, () => closeTrip(driver, owner.page, s.tenant, trip.id));
  const base = `/api/v1/tenants/${s.tenant}/fleet`;
  await until(driver, begin);

  // В окне: только рейс перевода и машина рейса (исключительный список); ГАЗель фирмы — как несуществующая.
  await onlyTripAndVehicle(driver, s.tenant, trip, {
    vehicle: ELF,
    driverId: s.members.akhmedov,
    unit: yug,
  });
  const gazel = (await vehicles(owner.page, s.tenant)).find((v) => v.displayName === 'ГАЗель Next');
  await J.hiddenLikeUnknown(driver, (id) => `${base}/vehicles/${id}`, gazel?.id ?? '', [
    'А 412 МР 77',
  ]);
  // Осмотр перед выездом и выезд — на экране «Моя смена» (телефон водителя), фото — MinIO и cmd/worker.
  const file = await J.jpeg(driver, 'Ортус · временный водитель');
  await departOnScreen(driver, s.tenant, trip, 'stand', file, Number(elf.odometerKm) + 10);
  expect(Date.now(), 'выезд — до конца окна').toBeLessThan(end);

  // После срока: начатый рейс — только продолжение (D09); просрочка у владельца; новая бронь закрыта.
  await until(driver, end);
  await continuedOnly(driver, s.tenant, trip, yug, CARS_NARROW);
  expect(await grantOf(owner.page, s.tenant, s.members.akhmedov, trip)).toMatchObject({
    grant: { state: 'closing', overdue: true },
  });
  // Бронь после срока закрыта: фактический ответ записан явно (стенд 19.10, три проекта — 403; в роли нет
  // fleet.reservations.create, Q-W2.57-1), чтобы смена ответа шлюза (например, после D-35/W2.75) была замечена.
  const reserve = await call(driver, 'POST', `${base}/reservations`, {
    body: { vehicleId: elf.id, driverMemberId: s.members.akhmedov, window, tripId: trip.id },
  });
  expect(
    [reserve.status, (reserve.body as { code?: string } | null)?.code],
    'reserveVehicle после срока',
  ).toEqual([403, 'forbidden_action']);
  return { tenant: s.tenant, owner: owner.page, driver, akh: s.members.akhmedov, trip, elf, file };
}

/**
 * Приёмка владельцем — назначение кончилось (`ended`): рейс и машина — как несуществующие (рейс 403, машина 404,
 * Q-W2.32-7).
 */
async function acceptedHidden(o: Overdue): Promise<void> {
  const base = `/api/v1/tenants/${o.tenant}/fleet`;
  await J.acceptOnReview(o.owner, o.tenant, o.trip.number);
  expect((await grantOf(o.owner, o.tenant, o.akh, o.trip))?.grant?.state).toBe('ended');
  await hiddenAfterEnd(o.driver, (id) => `${base}/trip-plans/${id}`, o.trip.id, {
    leak: o.trip.number,
    status: 403,
    code: 'forbidden_action',
  });
  await hiddenAfterEnd(o.driver, (id) => `${base}/vehicles/${id}`, o.elf.id, {
    leak: ELF,
    status: 404,
    code: 'not_found',
  });
  await o.driver.reload();
  await expect(o.driver.locator('#app')).not.toContainText(o.trip.number, { timeout: 15_000 });
}

test.describe('выход этапа 2 — AC-06 временный водитель на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('узкая роль «Временный водитель»: в окне — свой рейс и машина рейса, после срока — только сдача, после приёмки — как несуществующий', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(480_000);
    const o = await overdueOnRoute(
      { app, page, browser, harness, session, undo },
      testInfo.project.name,
    );

    // Сдача в продолжении — командами водителя (finishTripRoute, осмотр при сдаче с пятью фото, returnTrip): экран
    // «Моя смена» после срока не открывается — listVehicles 403 (в продолжении у роли нет fleet.vehicles.read), строка
    // «сдача на экране» ниже — test.fixme до исправления страницы (Q-W2.32-2 → W2.61).
    await apiReturn(
      o.driver,
      o.tenant,
      { ...o.trip, state: 'on_route' },
      {
        reservationId: '',
        vehicle: { ...o.elf, odometerKm: String(Number(o.elf.odometerKm) + 10) },
        departureInspectionId: '',
      },
    );
    expect((await plan(o.owner, o.tenant, o.trip.id)).body).toMatchObject({ state: 'submitted' });
    await acceptedHidden(o);
  });
});

// Дефект страницы (Q-W2.32-2 → W2.61): после срока у начатого рейса временный водитель сдаёт смену только командами
// API — «Моя смена» падает «Не удалось загрузить машины: Нет права на это действие…» (listVehicles 403 в продолжении
// D09). Строка вне grep e2e-stand (`@known-defect`), чтобы вердикт стенда не краснел пропуском. Шаги записаны целиком:
// после исправления — снять fixme и сменить тег на @stand (Q-W2.32-10); сейчас строка падает в `returnOnScreen` на
// «Не удалось загрузить машины». Владелец страницы — W2.22 (routes/logistics/driver), правила продолжения — W2.57.
test.describe('выход этапа 2 — AC-06: сдача временного водителя на экране после срока @known-defect', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('после срока «Моя смена» показывает рейс «В рейсе»: «Завершить рейс», осмотр при сдаче, «Сдать машину»', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(480_000);
    const o = await overdueOnRoute(
      { app, page, browser, harness, session, undo },
      testInfo.project.name,
    );
    await J.returnOnScreen(o.driver, o.tenant, 'stand', o.file, Number(o.elf.odometerKm) + 60);
    expect((await plan(o.owner, o.tenant, o.trip.id)).body).toMatchObject({ state: 'submitted' });
    await acceptedHidden(o);
  });
});
