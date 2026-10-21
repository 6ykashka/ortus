// W2.74 · Помощники e2e «Моей смены» с машинами на выбор (S2-20, D-35; макеты «Временный водитель - варианты.dc.html»
// 1c–1e, тег design-2026-10-19b). Сюжет — как conformance W2.71 `cases/vehicle-offer.ts`, но водитель — Тимур Ахмедов
// («Север Логистик», роль «Водитель» в своей фирме — с fleet.reservations.choose, Q-W2.70-7; своих рейсов нет): владелец
// публикует его в пул с обычной машиной Mercedes Sprinter, создаёт рейс «Юг Транс» 14:00–18:00 и запрашивает его с
// машиной; одобрение создаёт брони предложения (две — до 13:30, одна — сразу confirmed). Часы сценарного сервера —
// 10:30 по Москве (сид). Узкая роль «Временный водитель» без домашней до начала окна в MSW не действует (Q-W2.71-3).
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import type { Session, Undo } from './_stand/fixtures.ts';
import { assign, expectStatus, listUnits, roleId } from './_stand/stand.ts';
import { akhmedov, closeTrip, label, logisticsOn, vehicles } from './logistics.stand.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

const MSK = 'Europe/Moscow';
/** Окно рейса «Юг Транс» — 14:00–18:00 по Москве; срок выбора — 13:30 (TD-02). */
export const W = {
  startsAt: '2026-10-01T11:00:00Z',
  endsAt: '2026-10-01T15:00:00Z',
  timeZone: MSK,
};
/** Срок выбора прошёл (13:31 по Москве). */
export const AFTER_DEADLINE = '2026-10-01T10:31:00Z';
/** В окне рейса (14:05 по Москве). */
export const IN_WINDOW = '2026-10-01T11:05:00Z';

export const SPRINTER = { model: 'Mercedes Sprinter', plate: 'Т 771 ЕХ 77' } as const;
export const ELF = { model: 'Isuzu Elf', plate: 'К 120 РУ 77' } as const;

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

export type OfferMode = 'two' | 'one' | 'none';

export interface Offered {
  tenant: string;
  trip: { id: string; number: string; title: string };
}

const ok = (r: Awaited<ReturnType<typeof call>>, what: string) => {
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

/**
 * Владелец готовит рейс «Юг Транс» с машинами для Ахмедова и входит Ахмедовым на `segment` (по умолчанию «Сегодня»):
 * `two` — «Ставим нашу машину» Isuzu Elf + «Можно взять свою обычную» (две брони до 13:30); `one` — только Isuzu Elf
 * (одна бронь, confirmed); `none` — «Едет на своей обычной», фирма одобрила «Только водителя» (броней нет).
 */
export async function openOffer(
  app: AppFn,
  page: Page,
  mode: OfferMode,
  o: { segment?: 'today' | 'cars'; now?: string; scenario?: string } = {},
): Promise<Offered> {
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  await app('/', { persona: 'owner' });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  const T = `/api/v1/tenants/${tenant}`;
  const units = await listUnits(page, tenant);
  const sever = units.find((u) => u.name === 'Север Логистик')?.id ?? '';
  const yug = units.find((u) => u.name === 'Юг Транс')?.id ?? '';
  const members = ok(await call(page, 'GET', `${T}/members?limit=200`), 'listMembers').body as {
    items: { id: string; displayName: string; revision: number }[];
  };
  const akh = members.items.find((m) => m.displayName === 'Тимур Ахмедов');
  if (!akh) throw new Error('нет Тимура Ахмедова');
  ok(
    await call(page, 'PATCH', `${T}/members/${akh.id}`, {
      body: { orgUnitIds: [sever] },
      ifMatch: `"rev-${akh.revision}"`,
    }),
    'updateMember',
  );
  await assign(page, tenant, {
    memberId: akh.id,
    roleId: await roleId(page, tenant, 'Водитель'),
    unitId: sever,
  });
  const cars = ok(await call(page, 'GET', `${T}/fleet/vehicles?limit=200`), 'listVehicles')
    .body as { items: { id: string; displayName: string }[] };
  const idOf = (name: string) => cars.items.find((v) => v.displayName === name)?.id ?? '';
  const pub = ok(
    await call(page, 'POST', `${T}/fleet/driver-pool/publications`, {
      body: {
        driverMemberId: akh.id,
        homeOrgUnitId: sever,
        freeWindow: W,
        qualifications: ['Кат. B'],
        terms: 'По соглашению фирм группы',
        usualVehicleId: idOf(SPRINTER.model),
      },
    }),
    'publishDriverToPool',
  ).body as { id: string };
  const trip = ok(
    await call(page, 'POST', `${T}/fleet/trip-plans`, {
      body: {
        orgUnitId: yug,
        title: 'Сборный груз',
        plannedWindow: W,
        distanceKm: '35',
        cargo: {
          description: 'Сухой груз · 6 паллет-мест',
          weightKg: '500',
          volumeM3: '6',
          lengthM: '2',
        },
        stops: [
          {
            sequence: 1,
            op: 'load',
            address: 'Склад № 1, Лобня',
            plannedAt: W.startsAt,
            weightKg: '500',
            volumeM3: '6',
          },
          {
            sequence: 2,
            op: 'unload',
            address: 'Химки, ул. Заводская, 8',
            plannedAt: '2026-10-01T12:30:00Z',
            weightKg: '500',
            volumeM3: '6',
          },
        ],
      },
    }),
    'createTripPlan',
  ).body as Offered['trip'];
  const vehicle =
    mode === 'two'
      ? { mode: 'host_or_home', hostVehicleId: idOf(ELF.model) }
      : mode === 'one'
        ? { mode: 'host', hostVehicleId: idOf(ELF.model) }
        : { mode: 'home' };
  const req = ok(
    await call(page, 'POST', `${T}/fleet/driver-transfer-requests`, {
      body: {
        driverMemberId: akh.id,
        sourceOrgUnitId: sever,
        targetOrgUnitId: yug,
        window: W,
        reason: `Запрос на рейс ${trip.number}`,
        tripId: trip.id,
        publicationId: pub.id,
        vehicle,
      },
    }),
    'requestDriverTransfer',
  ).body as { id: string };
  const path = `${T}/fleet/driver-transfer-requests/${req.id}`;
  const cur = ok(await call(page, 'GET', path), 'getDriverTransfer');
  ok(
    await call(page, 'POST', `${path}/decision`, {
      body: { decision: mode === 'none' ? 'approve_driver_only' : 'approve' },
      ifMatch: cur.headers.etag ?? '',
    }),
    'decideDriverTransfer',
  );
  if (o.now) await serverNow(page, o.now);
  expectStatus(
    await call(page, 'POST', '/api/v1/dev/login', { body: { persona: 'acc-9' } }),
    200,
    'dev-вход Ахмедова',
  );
  // Сбой операций экрана (`listReservations=rate_limited` …) — после подготовки сюжета, до открытия страницы.
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await page.goto(`/t/${tenant}/${o.segment ?? 'today'}`);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: o.segment === 'cars' ? 'Автомобили' : 'Моя смена',
    }),
  ).toBeVisible({ timeout: 15_000 });
  return { tenant, trip };
}

/** Часы сценарного сервера (только mock). */
export async function serverNow(page: Page, now: string): Promise<void> {
  ok(
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { now } }),
    `dev/scenario now ${now}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Стенд (backend S2-20, W2.72): часы настоящие, узкая роль «Временный водитель» (у Ахмедова в сиде своей роли нет).

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const MIN = 60_000;

export interface StandOffer {
  tenant: string;
  owner: Page;
  driver: Page;
  trip: Offered['trip'] & { plannedWindow: typeof W };
  /** Начало окна, мс: осмотр, выезд и файлы рейса — с него (Q-W2.71-3, Q-W2.72-3). */
  begin: number;
  /** Пробег Isuzu Elf до рейса (осмотр выезда — не меньше, уборка сдаёт на +10 км, closeTrip). */
  elfOdometer: number;
}

/** Запросы и публикации Ахмедова в пуле закрыты (отзыв снимает брони предложения — `transfer_ended`, W2.72). */
async function poolClean(owner: Page, tenant: string, driver: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const list = ok(
    await call(
      owner,
      'GET',
      `${base}/driver-transfer-requests?status=requested&status=approved&limit=200`,
    ),
    'listDriverTransfers',
  ).body as { items: { id: string; status: string; driverMemberId: string }[] };
  for (const x of list.items.filter((t) => t.driverMemberId === driver)) {
    const path = `${base}/driver-transfer-requests/${x.id}`;
    const cur = ok(await call(owner, 'GET', path), 'getDriverTransfer');
    await call(owner, 'POST', `${path}/decision`, {
      body: {
        decision: x.status === 'approved' ? 'revoke' : 'reject',
        comment: 'W2.74: уборка стенд-e2e',
      },
      ifMatch: cur.headers.etag ?? '',
    });
  }
  const pubs = ok(
    await call(owner, 'GET', `${base}/driver-pool/publications?limit=200`),
    'listDriverPoolPublications',
  ).body as { items: { id: string; state: string; driverMemberId: string }[] };
  for (const p of pubs.items.filter((x) => x.driverMemberId === driver && x.state === 'active')) {
    const path = `${base}/driver-pool/publications/${p.id}`;
    const cur = ok(await call(owner, 'GET', path), 'getDriverPoolPublication');
    await call(owner, 'POST', `${path}/withdrawal`, {
      body: { comment: 'W2.74: уборка стенд-e2e' },
      ifMatch: cur.headers.etag ?? '',
    });
  }
}

/**
 * Стенд: владелец публикует Ахмедова с обычной Mercedes Sprinter, создаёт рейс «Юг Транс» и запрашивает его с машиной
 * (`two` — «Ставим нашу машину» Isuzu Elf + «Можно взять свою обычную», `one` — только Isuzu Elf) и одобряет; затем вход
 * Ахмедовым. `two`: окно через двое суток — срок выбора (начало − 30 мин) впереди, а рейс, оставшийся после отзыва без водителя, не попадает в «Рейсы сегодня» и «Требует решения» других строк; `one`: окно через `startIn` — после
 * срока выбора, бронь одна и сразу confirmed. Уборка: отзыв перевода (брони предложения сняты), смена закрыта.
 */
export async function standOffer(
  fx: { session: () => Promise<Session>; undo: Undo },
  mode: 'two' | 'one',
  project: string,
  o: { startIn?: number; length?: number } = {},
): Promise<StandOffer> {
  const s = await logisticsOn(fx.session, fx.undo);
  const owner = s.owner;
  const T = `/api/v1/tenants/${s.tenant}`;
  const yug = (await listUnits(owner, s.tenant)).find((u) => u.name === 'Юг Транс')?.id ?? '';
  const cars = await vehicles(owner, s.tenant);
  const idOf = (name: string) => {
    const v = cars.find((x) => x.displayName === name);
    if (!v) throw new Error(`нет машины «${name}»`);
    return v.id;
  };
  await poolClean(owner, s.tenant, s.members.akhmedov);
  fx.undo('пул: запросы и публикации Ахмедова (W2.74)', () =>
    poolClean(owner, s.tenant, s.members.akhmedov),
  );
  const begin =
    Math.ceil((Date.now() + (o.startIn ?? (mode === 'two' ? 50 * 60 * MIN : 90_000))) / 1000) *
    1000;
  const end = begin + (o.length ?? (mode === 'two' ? 30 * MIN : 150_000));
  const window = { startsAt: iso(begin), endsAt: iso(end), timeZone: MSK };
  const pub = ok(
    await call(owner, 'POST', `${T}/fleet/driver-pool/publications`, {
      body: {
        driverMemberId: s.members.akhmedov,
        homeOrgUnitId: s.unitId,
        freeWindow: { startsAt: iso(Date.now() + 2000), endsAt: iso(end + MIN), timeZone: MSK },
        qualifications: ['Кат. B'],
        terms: 'По соглашению фирм группы',
        usualVehicleId: idOf(SPRINTER.model),
      },
    }),
    'publishDriverToPool',
  ).body as { id: string };
  const trip = ok(
    await call(owner, 'POST', `${T}/fleet/trip-plans`, {
      body: {
        orgUnitId: yug,
        title: `S2-20 W2.74 ${label(project)}`,
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
    }),
    'createTripPlan «Юг Транс»',
  ).body as StandOffer['trip'];
  const vehicle =
    mode === 'two'
      ? { mode: 'host_or_home', hostVehicleId: idOf(ELF.model) }
      : { mode: 'host', hostVehicleId: idOf(ELF.model) };
  const req = ok(
    await call(owner, 'POST', `${T}/fleet/driver-transfer-requests`, {
      body: {
        driverMemberId: s.members.akhmedov,
        sourceOrgUnitId: s.unitId,
        targetOrgUnitId: yug,
        window,
        reason: `Запрос на рейс ${trip.number}`,
        tripId: trip.id,
        publicationId: pub.id,
        vehicle,
      },
    }),
    'requestDriverTransfer',
  ).body as { id: string };
  const path = `${T}/fleet/driver-transfer-requests/${req.id}`;
  const cur = ok(await call(owner, 'GET', path), 'getDriverTransfer');
  ok(
    await call(owner, 'POST', `${path}/decision`, {
      body: { decision: 'approve' },
      ifMatch: cur.headers.etag ?? '',
    }),
    'decideDriverTransfer approve',
  );
  const driver = await akhmedov(fx.session);
  // Уборки идут в обратном порядке: смена закрывается раньше отзыва перевода (он зарегистрирован выше).
  fx.undo(`смена рейса ${trip.number} (W2.74)`, () => closeTrip(driver, owner, s.tenant, trip.id));
  const elfOdometer = Number(cars.find((x) => x.displayName === ELF.model)?.odometerKm ?? 0);
  return { tenant: s.tenant, owner, driver, trip, begin, elfOdometer };
}

/** Ждать момента `at` (мс) с запасом `pad` (часы стенда настоящие). */
export async function until(page: Page, at: number, pad = 3000): Promise<void> {
  const left = at + pad - Date.now();
  if (left > 0) await page.waitForTimeout(left);
}

/** Карточка предложенной машины по модели. */
export const offerCard = (page: Page, model: string): Locator =>
  page
    .locator('article.ox-dr-offer')
    .filter({ has: page.locator('.ox-dr-car-model').getByText(model, { exact: true }) });

/** Лист «Берёте …?». */
export const offerSheet = (page: Page): Locator => page.getByRole('dialog', { name: /^Берёте / });
