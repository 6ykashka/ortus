// W2.75 · Общее журни S2-20 «Машина для временного водителя» (D-35; design/docs/29-temporary-driver-vehicle.md, макеты
// «Временный водитель - варианты.dc.html» 1a–1g, design-2026-10-19b): день рейса на стенде (`dayStand`), запрос и
// решение фирмы водителя, выбор и осмотры на телефоне, проверки фирмы машины, ожидание настоящих часов стенда с ходом
// в выводе (`waitUntil`). Строки — `temporary-driver-vehicle.spec.ts` и `temporary-driver-vehicle-shift.spec.ts`
// (полная смена ждёт начала окна рейса ≈ 30 минут на проект — отдельный файл, шард сторожа e2e-stand берёт его целиком).
import type { Locator, Page } from '@playwright/test';

import { expect, type Session, type Undo } from '../../_stand/fixtures.ts';
import { listUnits } from '../../_stand/stand.ts';
import { actionBar, DEP_CHECKS } from '../../driver.helpers.ts';
import { ELF, offerCard, offerSheet, SPRINTER } from '../../driver-offer.helpers.ts';
import { driverCard, incomingCard, POOL_H1 } from '../../logistics-pool.helpers.ts';
import {
  akhmedov,
  closeTrip,
  label,
  logisticsOn,
  plan,
  plans,
  vehicles,
} from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, type Reply } from '../../shell.helpers.ts';
import * as J from './journey.ts';

export const MSK = 'Europe/Moscow';
export const YUG = 'Юг Транс';
export const SEVER = 'Север Логистик';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const OFFER_CLOSED =
  'Выбор машины уже закрыт: срок прошёл или машина выбрана. Обновите смену.';

export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** «13:30» — время по Москве (часы и зона харнесса). */
export const hhmm = (at: string | number): string =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: MSK }).format(
    new Date(at),
  );
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `[status, code]` ответа Problem. */
export const statusCode = (r: Reply): [number, string | undefined] => [
  r.status,
  (r.body as { code?: string } | null)?.code,
];

/**
 * Сторож полного e2e-stand снимает прогон после 20 минут без строки вывода, а строки S2-20 ждут настоящих часов
 * стенда (окно доступа, срок выбора, начало окна рейса — до ≈ 30 минут). Ход ожидания — строкой не реже раза в 5 мин.
 */
export const PROGRESS_EVERY = 5 * MIN;

export interface Sleeper {
  waitForTimeout(ms: number): Promise<void>;
}

export interface WaitOpts {
  /** Запас после `at`, мс (как `until`, по умолчанию 3 с). */
  pad?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/** Порция сна — с запасом меньше PROGRESS_EVERY. */
export const WAIT_STEP = 4 * MIN;

/**
 * Ждать момента `at` (+ `pad`) настоящих часов стенда: сон порциями по WAIT_STEP, перед каждой — строка хода в вывод
 * теста (list-репортёр печатает её сразу, сторож видит вывод).
 */
export async function waitUntil(
  page: Sleeper,
  at: number,
  what: string,
  o: WaitOpts = {},
): Promise<void> {
  const now = o.now ?? Date.now;
  const log = o.log ?? ((line: string) => console.log(line));
  const end = at + (o.pad ?? 3000);
  for (let left = end - now(); left > 0; left = end - now()) {
    log(`W2.75 · ждём ${what} (${hhmm(at)} МСК): осталось ${Math.ceil(left / 1000)} с`);
    await page.waitForTimeout(Math.min(left, WAIT_STEP));
  }
}

export interface Window {
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

export interface Car {
  vehicleId: string;
  displayName: string;
  reservationId?: string;
  reservationState?: string;
  releaseReason?: string;
  chosenAt?: string;
}

export interface Transfer {
  id: string;
  status: string;
  tripId?: string;
  publicationId?: string;
  driverMemberId: string;
  vehicle?: {
    mode: string;
    homeDecision?: string;
    chooseUntil?: string;
    offerGroupId?: string;
    hostVehicle?: Car;
    homeVehicle?: Car;
  };
}

/** Перевод рейса `trip` (владелец, listDriverTransfers): статус и машины S2-20. */
export async function transferOf(
  owner: Page,
  tenant: string,
  trip: string,
): Promise<Transfer | undefined> {
  const r = J.expectOk(
    await call(
      owner,
      'GET',
      `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests?status=requested&status=approved&status=completed&limit=200`,
    ),
    'listDriverTransfers',
  ).body as { items: Transfer[] };
  return r.items.find((x) => x.tripId === trip);
}

/** Бронь по id (владелец, getReservation): группа предложения, кому предложена, состояние. */
export async function reservation(
  owner: Page,
  tenant: string,
  id: string,
): Promise<{ state: string; offerGroupId?: string; offeredToMemberId?: string; tripId?: string }> {
  return J.expectOk(
    await call(owner, 'GET', `/api/v1/tenants/${tenant}/fleet/reservations/${id}`),
    'getReservation',
  ).body as { state: string; offerGroupId?: string; offeredToMemberId?: string; tripId?: string };
}

/** Запросы и публикации Ахмедова в пуле закрыты: отзыв перевода снимает брони предложения (`transfer_ended`, W2.72). */
export async function poolClean(owner: Page, tenant: string, driver: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const list = J.expectOk(
    await call(
      owner,
      'GET',
      `${base}/driver-transfer-requests?status=requested&status=approved&limit=200`,
    ),
    'listDriverTransfers',
  ).body as { items: Transfer[] };
  for (const x of list.items.filter((t) => t.driverMemberId === driver)) {
    const path = `${base}/driver-transfer-requests/${x.id}`;
    const cur = J.expectOk(await call(owner, 'GET', path), 'getDriverTransfer');
    await call(owner, 'POST', `${path}/decision`, {
      body: {
        decision: x.status === 'approved' ? 'revoke' : 'reject',
        comment: 'W2.75: уборка стенд-e2e',
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
      body: { comment: 'W2.75: уборка стенд-e2e' },
      ifMatch: cur.headers.etag ?? '',
    });
  }
}

/** Машины «Север Логистик», на которые переносится чужое назначение Mercedes Sprinter (S2-20 их не берёт). */
export const SPARE = ['Hyundai Porter', 'Ford Transit'];

/**
 * Q-W2.75-4: строка `logistics-fleet` @stand (W2.53) назначает логистом Mercedes Sprinter на свой рейс без водителя
 * на ближайшие 2 часа, а снять назначение API не даёт (вопрос W2.53). Строки S2-20 следующего проекта с ближним окном
 * получают тогда 409 `reservation_overlap` на обычной машине Ахмедова. Такое назначение (рейс `assigned` без водителя,
 * окно ещё не кончилось) переносится на свободную машину из SPARE — сервер снимает бронь заменённой машины.
 */
export async function sprinterFree(owner: Page, tenant: string): Promise<void> {
  const cars = await vehicles(owner, tenant);
  const sprinter = cars.find((v) => v.displayName === SPRINTER.model);
  if (!sprinter) throw new Error(`нет «${SPRINTER.model}»`);
  const now = Date.now();
  const held = (await plans(owner, tenant)).filter(
    (p) =>
      p.vehicleId === sprinter.id &&
      p.state === 'assigned' &&
      !p.driverMemberId &&
      Date.parse(p.plannedWindow.endsAt) > now,
  );
  for (const p of held) {
    let moved = false;
    for (const name of SPARE) {
      const spare = cars.find((v) => v.displayName === name);
      if (!spare) continue;
      const cur = await plan(owner, tenant, p.id);
      const r = await call(owner, 'PUT', `/api/v1/tenants/${tenant}/fleet/trips/${p.id}/vehicle`, {
        body: { vehicleId: spare.id },
        ifMatch: cur.headers.etag ?? '',
      });
      if (r.status >= 200 && r.status < 300) {
        moved = true;
        break;
      }
    }
    if (!moved)
      throw new Error(
        `${SPRINTER.model} назначена на ${p.number} без водителя, перенести некуда (${SPARE.join(', ')} заняты)`,
      );
  }
}

export interface Day {
  tenant: string;
  /** Владелец в контексте 1440: логист «Юг Транс» и менеджер «Север Логистик». */
  owner: Page;
  driver: Page;
  akh: string;
  vasiliev: string;
  sever: string;
  yug: string;
  pub: string;
  code: string;
  cars: { elf: string; sprinter: string; sprinterKm: number };
  trip: { id: string; number: string; title: string; plannedWindow: Window };
}

export type Fx = {
  browser: Parameters<typeof J.desktop>[0];
  harness: Parameters<typeof J.desktop>[1];
};

/**
 * Пул журни: публикация Ахмедова с обычной Mercedes Sprinter и рейс «Юг Транс» (сухой груз 0,4 т — подходят обе
 * машины) на 30 минут. По умолчанию — через 8–11 суток (случайный час: окна проектов и повторов не пересекаются, бронь
 * назначения логиста API снять не даёт — вопрос W2.53); `begin` — своё начало окна рейса. Уборка: смена рейса, запросы
 * и публикации Ахмедова.
 */
export async function dayStand(
  fx: Fx,
  session: () => Promise<Session>,
  undo: Undo,
  project: string,
  o: { begin?: number } = {},
): Promise<Day> {
  const s = await logisticsOn(session, undo);
  const desk = await J.desktop(fx.browser, fx.harness, 'owner');
  undo('контекст 1440 владельца', () => desk.close());
  const owner = desk.page;
  const T = `/api/v1/tenants/${s.tenant}`;
  const yug = (await listUnits(owner, s.tenant)).find((u) => u.name === YUG)?.id ?? '';
  const cars = await vehicles(owner, s.tenant);
  const sprinter = cars.find((v) => v.displayName === SPRINTER.model);
  const elf = cars.find((v) => v.displayName === ELF.model);
  if (!yug || !sprinter || !elf)
    throw new Error(`нет «${YUG}», «${SPRINTER.model}» или «${ELF.model}»`);
  await poolClean(owner, s.tenant, s.members.akhmedov);
  undo('пул: запросы и публикации Ахмедова (W2.75)', () =>
    poolClean(owner, s.tenant, s.members.akhmedov),
  );
  await sprinterFree(owner, s.tenant);
  const begin =
    o.begin ??
    Math.ceil((Date.now() + 8 * 24 * HOUR + Math.random() * 72 * HOUR) / (5 * MIN)) * 5 * MIN;
  const window: Window = { startsAt: iso(begin), endsAt: iso(begin + 30 * MIN), timeZone: MSK };
  const free = Math.max(Date.now() + 2000, begin - HOUR);
  const pub = J.expectOk(
    await call(owner, 'POST', `${T}/fleet/driver-pool/publications`, {
      body: {
        driverMemberId: s.members.akhmedov,
        homeOrgUnitId: s.unitId,
        freeWindow: { startsAt: iso(free), endsAt: iso(begin + 2 * HOUR), timeZone: MSK },
        qualifications: ['Кат. B'],
        terms: 'По соглашению фирм группы',
        usualVehicleId: sprinter.id,
      },
    }),
    'publishDriverToPool',
  ).body as { id: string; displayName: string };
  const trip = J.expectOk(
    await call(owner, 'POST', `${T}/fleet/trip-plans`, {
      body: {
        orgUnitId: yug,
        title: `S2-20 W2.75 ${label(project)}`,
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
  ).body as Day['trip'];
  const driver = await akhmedov(session);
  // Уборки идут в обратном порядке: смена (и бронь рейса) — раньше отзыва перевода.
  undo(`смена рейса ${trip.number} (W2.75)`, () => closeTrip(driver, owner, s.tenant, trip.id));
  return {
    tenant: s.tenant,
    owner,
    driver,
    akh: s.members.akhmedov,
    vasiliev: s.members.vasiliev,
    sever: s.unitId,
    yug,
    pub: pub.id,
    code: pub.displayName,
    cars: { elf: elf.id, sprinter: sprinter.id, sprinterKm: Number(sprinter.odometerKm) },
    trip,
  };
}

/**
 * Запрос логиста командой (requestDriverTransfer) с машиной: `host_or_home` — «Ставим нашу машину» Isuzu Elf + «Можно
 * взять свою обычную»; `access` — окно доступа (по умолчанию — окно рейса, как шлёт диалог 1a).
 */
export async function requestApi(
  d: Day,
  access?: Window,
  mode: 'host_or_home' | 'home' = 'host_or_home',
): Promise<string> {
  return (
    J.expectOk(
      await call(d.owner, 'POST', `/api/v1/tenants/${d.tenant}/fleet/driver-transfer-requests`, {
        body: {
          driverMemberId: d.akh,
          sourceOrgUnitId: d.sever,
          targetOrgUnitId: d.yug,
          window: access ?? d.trip.plannedWindow,
          reason: `Запрос на рейс ${d.trip.number}`,
          tripId: d.trip.id,
          publicationId: d.pub,
          vehicle: mode === 'home' ? { mode } : { mode, hostVehicleId: d.cars.elf },
        },
      }),
      'requestDriverTransfer',
    ).body as { id: string }
  ).id;
}

/** Решение фирмы водителя командой (владелец; If-Match свежего GET). */
export async function approveApi(
  d: Day,
  id: string,
  decision: 'approve' | 'approve_driver_only' = 'approve',
): Promise<void> {
  const path = `/api/v1/tenants/${d.tenant}/fleet/driver-transfer-requests/${id}`;
  const cur = J.expectOk(await call(d.owner, 'GET', path), 'getDriverTransfer');
  J.expectOk(
    await call(d.owner, 'POST', `${path}/decision`, {
      body: { decision },
      ifMatch: cur.headers.etag ?? '',
    }),
    `decideDriverTransfer ${decision}`,
  );
}

/** «Ресурсный пул» рейса у владельца → «Запросить на рейс» → диалог «Запросить водителя» (1a). */
export async function requestDialog(owner: Page, tenant: string, trip: Day['trip'], code: string) {
  await owner.goto(`/t/${tenant}/pool?trip=${trip.id}`);
  await expect(J.h1(owner, POOL_H1)).toBeVisible(J.SERVER);
  const c = driverCard(owner, code);
  await expect(c).toContainText(`Кат. B · ${SEVER}`, J.SERVER);
  await c.getByRole('button', { name: `Запросить на рейс ${trip.number}` }).click();
  const dlg = owner.getByRole('dialog');
  await expect(dlg).toContainText(`${code} · ${SEVER}`);
  await expect(dlg.getByRole('radiogroup', { name: 'Машина' })).toBeVisible();
  await expect(dlg).toContainText(`${SPRINTER.model} · ${SPRINTER.plate} · ${SEVER}`);
  await expect(dlg).toContainText('Подходит рейсу · свободна ');
  await expect(dlg).toContainText(`Машину тоже согласует ${SEVER}.`);
  return dlg;
}

/** 1a · «Ставим нашу машину» Isuzu Elf, «Можно взять свою обычную» (по умолчанию) → «Отправить запрос». */
export async function requestTwo(owner: Page, tenant: string, trip: Day['trip'], code: string) {
  const dlg = await requestDialog(owner, tenant, trip, code);
  const host = dlg.getByRole('combobox', { name: 'Ставим нашу машину' });
  const elf = (await host.locator('option').allTextContents()).find((t) =>
    t.startsWith(`${ELF.model} · `),
  );
  expect(elf, `«${ELF.model}» в «Ставим нашу машину»`).toBeTruthy();
  await host.selectOption({ label: elf ?? '' });
  await expect(dlg.getByRole('radio', { name: 'Ставим нашу машину' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const choice = dlg.getByRole('checkbox', { name: /Можно взять свою обычную/ });
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await expect(choice).toContainText(`: ${ELF.model} или свою ${SPRINTER.model}.`);
  await expect(dlg.locator('.ox-pl-sum-line > span:last-child').first()).toHaveText(
    new RegExp(`^Две брони до выбора на .+: ${esc(ELF.model)} и ${esc(SPRINTER.model)}\\.`),
  );
  await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(toast(owner)).toHaveText(`Запрос отправлен фирме ${SEVER}`, J.SERVER);
}

/** 1b · фирма водителя: строка входящего «{фирма} просит на рейс …», «Машина» на выбор водителя → «Одобрить с машиной». */
export async function approveWithCar(owner: Page, code: string, trip: Day['trip']): Promise<void> {
  const row = incomingCard(owner, code);
  await expect(row).toContainText(`${YUG} просит на рейс ${trip.number}`, J.SERVER);
  await expect(row).toContainText('Ждёт решения');
  await expect(ddOf(row, 'Машина')).toHaveText(
    `Их ${ELF.model} или ваша ${SPRINTER.model} — на выбор водителя`,
  );
  await expect(row).toContainText(`${SPRINTER.model} · ${SPRINTER.plate}`);
  await expect(row.getByRole('button')).toHaveText([
    'Одобрить с машиной',
    'Только водителя',
    'Отклонить',
  ]);
  await row.getByRole('button', { name: 'Одобрить с машиной' }).click();
  await expect(toast(owner)).toHaveText(`Фирма ${SEVER} одобрила запрос`, J.SERVER);
}

/** Сервер одной транзакцией: две брони `held` с общим offerGroupId, предложены водителю, на рейс. */
export async function twoHeld(owner: Page, tenant: string, trip: string, driver: string) {
  const x = await transferOf(owner, tenant, trip);
  expect(x?.status).toBe('approved');
  const host = x?.vehicle?.hostVehicle;
  const home = x?.vehicle?.homeVehicle;
  expect([host?.displayName, home?.displayName]).toEqual([ELF.model, SPRINTER.model]);
  expect([host?.reservationState, home?.reservationState]).toEqual(['held', 'held']);
  const a = await reservation(owner, tenant, host?.reservationId ?? '');
  const b = await reservation(owner, tenant, home?.reservationId ?? '');
  expect(a.offerGroupId, 'общая группа предложения').toBeTruthy();
  expect([a.offerGroupId, a.offeredToMemberId, a.tripId], 'бронь Isuzu Elf').toEqual([
    x?.vehicle?.offerGroupId ?? a.offerGroupId,
    driver,
    trip,
  ]);
  expect([b.offerGroupId, b.offeredToMemberId, b.tripId], 'бронь Mercedes Sprinter').toEqual([
    a.offerGroupId,
    driver,
    trip,
  ]);
  return x as Transfer;
}

export const ddOf = (scope: Locator, term: string): Locator =>
  scope
    .locator('dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** У временного водителя нет «Подтвердить бронь» и «Забронировать» (вариант (a) D-35 отклонён). */
export async function noBooking(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Подтвердить бронь' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Забронировать' })).toHaveCount(0);
}

/** Список машин временного водителя (listVehicles): только предложенные ему, без других машин фирм. */
export async function onlyOffered(driver: Page, tenant: string, models: readonly string[]) {
  const r = J.expectOk(
    await call(driver, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`),
    'listVehicles временного водителя',
  ).body as { items: { displayName: string }[] };
  expect(r.items.map((v) => v.displayName).sort(), 'машины временного водителя').toEqual(
    [...models].sort(),
  );
}

/** AC-06 (DoR §6): бронь временного водителя — 403, данных о машине в ответе нет. */
export async function reserveForbidden(
  driver: Page,
  tenant: string,
  akh: string,
  vehicleId: string,
  w: Window,
) {
  const r = await call(driver, 'POST', `/api/v1/tenants/${tenant}/fleet/reservations`, {
    body: { vehicleId, driverMemberId: akh, window: w },
  });
  expect(statusCode(r), 'reserveVehicle временного водителя').toEqual([403, 'forbidden_action']);
}

export const choosePath = (tenant: string, id: string) =>
  `/api/v1/tenants/${tenant}/fleet/reservations/${id}/choose`;

/** AC-06 (DoR §6): `choose` закрытого предложения — 409 offer_closed. */
export async function chooseClosed(driver: Page, tenant: string, reservationId: string) {
  const r = await call(driver, 'POST', choosePath(tenant, reservationId));
  expect(statusCode(r), 'chooseReservation').toEqual([409, 'offer_closed']);
}

/** Параллельные `choose` из страницы водителя (каждый со своим Idempotency-Key): статусы и коды ответов. */
export async function chooseAtOnce(
  driver: Page,
  tenant: string,
  ids: readonly string[],
): Promise<{ status: number; code: string }[]> {
  return driver.evaluate(
    async (paths) => {
      const csrf = decodeURIComponent(
        /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '',
      );
      return Promise.all(
        paths.map(async (path) => {
          const r = await fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID() },
          });
          const j = (await r.json().catch(() => ({}))) as { code?: string };
          return { status: r.status, code: j.code ?? '' };
        }),
      );
    },
    ids.map((id) => choosePath(tenant, id)),
  );
}

export const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
export const take = (page: Page, model: string) =>
  offerCard(page, model).getByRole('button', { name: 'Взять эту машину' });

/** 1c → 1d → 1e · «Выберите машину» → «Взять эту машину» Mercedes Sprinter → «Взять и начать осмотр». */
export async function chooseSprinter(dr: Page): Promise<void> {
  await expect(dr.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([
    SPRINTER.model,
    ELF.model,
  ]);
  await expect(offerCard(dr, SPRINTER.model)).toContainText('Ваша обычная');
  await expect(offerCard(dr, ELF.model)).toContainText('Поставил логист');
  await noBooking(dr);
  await take(dr, SPRINTER.model).click();
  const sheet = offerSheet(dr);
  await expect(sheet.getByRole('heading', { name: `Берёте ${SPRINTER.model}?` })).toBeVisible();
  await expect(sheet).toContainText(
    `Бронь ${ELF.model} ${ELF.plate} снимется, машина вернётся в свою фирму.`,
  );
  await expect(sheet).toContainText('Осмотр и дефекты увидят фирма рейса и фирма машины.');
  await expect(sheet).toContainText('Поменять машину после выбора может только логист.');
  await sheet.getByRole('button', { name: 'Взять и начать осмотр' }).click();
  await expect(toast(dr)).toHaveText('Бронь подтверждена сервером. Начните осмотр', J.SERVER);
  const held = dr.locator('.ox-dr-offer-held');
  await expect(held).toContainText(`Бронь подтверждена сервером · ${SPRINTER.model} до`, J.SERVER);
  await expect(held).toContainText(`${ELF.model} ${ELF.plate} освобождена в`);
  await expect(dr.getByRole('button', { name: 'Взять эту машину' })).toHaveCount(0);
  await noBooking(dr);
}

/** 1e · осмотр перед выездом на обычной машине: пять фото, пробег, чек-лист → «Выехать на маршрут». */
export async function departOnSprinter(
  dr: Page,
  mode: J.Mode,
  file: Buffer,
  km: number,
): Promise<void> {
  await expect(h2(dr, 'Осмотр перед выездом')).toBeVisible(J.SERVER);
  await expect(dr.locator('.ox-dr-insp .ox-dr-sub').first()).toHaveText(
    `${SPRINTER.model} · ${SPRINTER.plate} · ваша обычная`,
  );
  await expect(dr.getByText('Осмотр увидят фирма рейса и фирма машины.')).toBeVisible();
  await J.photos(dr, mode, file);
  await J.fillInspection(dr, String(km), DEP_CHECKS);
  await actionBar(dr).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(dr)).toHaveText('Выезд подтверждён сервером', J.SERVER);
  await expect(h2(dr, 'Маршрут')).toBeVisible(J.SERVER);
}

export interface InspectionRow {
  id: string;
  kind: string;
  vehicleId: string;
  tripId?: string;
  odometerKm: string;
}

/**
 * Фирма машины (правило 6): видит осмотры выезда и сдачи своей обычной машины на чужом рейсе; машина свободна сразу
 * после осмотра сдачи, не дожидаясь приёмки смены фирмой рейса.
 */
export async function homeCompanyChecks(
  kotova: Page,
  tenant: string,
  trip: string,
  sprinter: string,
  km: number,
  o: { released?: boolean } = {},
) {
  const list = J.expectOk(
    await call(kotova, 'GET', `/api/v1/tenants/${tenant}/fleet/inspections?limit=200`),
    'listInspections фирмы машины',
  ).body as { items: InspectionRow[] };
  const mine = list.items.filter((i) => i.tripId === trip);
  expect(
    mine.map((i) => `${i.kind}:${i.vehicleId === sprinter ? 'sprinter' : i.vehicleId}`).sort(),
    'осмотры обычной машины на рейсе фирмы рейса',
  ).toEqual(['departure:sprinter', 'return:sprinter']);
  const ret = mine.find((i) => i.kind === 'return');
  expect(Number(ret?.odometerKm)).toBe(km);
  J.expectOk(
    await call(kotova, 'GET', `/api/v1/tenants/${tenant}/fleet/inspections/${ret?.id ?? ''}`),
    'getInspection сдачи фирмой машины',
  );
  if (o.released === false) return;
  const car = (await vehicles(kotova, tenant)).find((v) => v.id === sprinter) as
    { status: string; heldByTripId?: string } | undefined;
  expect([car?.status, car?.heldByTripId], 'обычная машина свободна после осмотра сдачи').toEqual([
    'available',
    undefined,
  ]);
}
