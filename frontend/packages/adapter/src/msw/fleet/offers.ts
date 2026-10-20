// Тег Fleet, контракт 0.6.3-stage2 (W2.71, S2-20 «Машина для временного водителя», решение владельца 19.10 по
// Q-W2.32-1; design/docs/29-temporary-driver-vehicle.md, макеты 1a–1g): брони предложения при одобрении запроса пула,
// выбор водителем из предложенных (chooseReservation), «Оставить …» логиста, срок выбора — за 30 минут до начала окна
// рейса (TD-02), вторая бронь снимается сразу (TD-04). Сервер сценариев досчитывает срок лениво — при обращении к пулу,
// броням, машинам, рейсам и «Главной» (фоновых задач нет; на стенде — воркер W2.72).
import type { components } from '@ortus/api-client';

import { actionsFor } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { addMs, MINUTE } from '../core/time.ts';
import type { Org } from '../core/state.ts';
import { temporaryAccessOpen } from './pool-rules.ts';
import {
  accountOf,
  accountsWith,
  compatOf,
  covers,
  type FleetData,
  fleetOf,
  freeVehicle,
  notify,
  type TripRow,
  unitsFor,
  type VehicleRow,
} from './state.ts';

type S = components['schemas'];
type Reservation = S['Reservation'];

/** Срок выбора — за 30 минут до начала окна рейса (правило 4, TD-02). */
export const CHOOSE_BEFORE_MINUTES = 30;
/** «Водитель ещё не выбрал машину» — за 15 минут до срока выбора (docs/29 «Требует решения»). */
export const CHOICE_PENDING_MINUTES = 15;

/**
 * Тексты S2-20 без эталона (no-reference, Q-W2.70-13) — те же строки в @ortus/texts: errors.mock.logistics.vehicleOffer
 * (ошибки) и logisticsManager.vehicleOfferNotify (уведомления); тест texts/test/fleet-w271.test.mjs.
 */
export const OFFER_TEXT = {
  closed: 'Выбор машины уже закрыт.',
  notFound: 'Бронь не найдена.',
  chooseFirst: 'Сначала выберите машину.',
  noUsualVehicle: 'У водителя нет обычной машины',
  hostRequired: 'Выберите машину фирмы рейса',
  hostNotWithHome: 'Машину фирмы рейса не указывают для своей обычной',
  tripRequired: 'Машину запрашивают на рейс',
  usualVehicle: 'Нужна машина фирмы водителя',
  driverOnly: 'Обычную машину не запрашивали',
  rejectReason: 'Укажите причину отказа',
  notFit: 'Машина не подходит рейсу:',
  busy: 'Машина занята на время рейса. Обновите список.',
} as const;

const label = (v: VehicleRow): string => `${v.displayName} ${v.registrationNumber}`;

/** Уведомления S2-20 (вид — тип события без версии; заголовок — текст @ortus/texts). */
export const OFFER_NOTIFY = {
  chosen: (v: VehicleRow, trip: TripRow) => `Машина ${label(v)} выбрана на рейс ${trip.number}`,
  released: (v: VehicleRow, trip: TripRow) => `Машина ${label(v)} освобождена: рейс ${trip.number}`,
  driverChose: (v: VehicleRow, trip: TripRow) =>
    `Водитель выбрал машину на рейс ${trip.number}: ${label(v)}`,
  assigned: (v: VehicleRow, trip: TripRow) =>
    `Машину поставили на рейс ${trip.number}: ${label(v)}`,
  choose: (trip: TripRow) => `Выберите машину на рейс ${trip.number}`,
};

/** Срок выбора рейса: начало окна минус 30 минут. */
export const chooseUntilOf = (trip: TripRow): string =>
  addMs(trip.plannedWindow.startsAt, -CHOOSE_BEFORE_MINUTES * MINUTE);

/** Машина запроса (TransferVehicle) без судьбы брони — поля в порядке схемы. */
export function vehicleRef(org: Org, v: VehicleRow): S['TransferVehicle'] {
  const name = org.units.find((u) => u.id === v.orgUnitId)?.name;
  return {
    vehicleId: v.id,
    displayName: v.displayName,
    registrationNumber: v.registrationNumber,
    orgUnitId: v.orgUnitId,
    ...(name ? { orgUnitName: name } : {}),
  };
}

/** Совместимость и занятость машины для рейса: 409 vehicle_incompatible с причинами, 409 reservation_overlap. */
export function checkFit(v: VehicleRow, trip: TripRow, field: string): void {
  const c = compatOf(v, trip);
  if (!c.fit) {
    const bad = c.checks.slice(1).filter((x) => !x.ok);
    fail('vehicle_incompatible', `${OFFER_TEXT.notFit} ${c.reasons.join('; ')}`, {
      violations: bad.map((x) => ({
        field,
        code: x.key,
        message: `${x.label}: ${x.value}${x.need ? ', нужно ' + x.need : ''}`,
      })),
    });
  }
  if (!c.ok) fail('reservation_overlap', OFFER_TEXT.busy);
}

/** Бронь предложения — поля в порядке схемы Reservation (так же — tools/gen/examples-w271.mjs). */
function reservationOf(
  ctx: HandlerContext,
  v: VehicleRow,
  trip: TripRow,
  driver: string,
  group: string,
  kind: 'host' | 'usual',
  chooseUntil: string | undefined,
): Reservation {
  return {
    id: ctx.newId(),
    vehicleId: v.id,
    driverMemberId: driver,
    window: { ...trip.plannedWindow },
    state: chooseUntil ? 'held' : 'confirmed',
    holdExpiresAt: chooseUntil ?? trip.plannedWindow.endsAt,
    revision: 1,
    tripId: trip.id,
    offerGroupId: group,
    offeredToMemberId: driver,
    offerKind: kind,
    ...(chooseUntil ? { chooseUntil } : {}),
  };
}

/** Машина держится за рейсом. */
function hold(v: VehicleRow, trip: TripRow): void {
  v.vstate = 'reserved';
  v.heldBy = trip.id;
  delete v.note;
  v.revision++;
}

/** Рейс получает машину подтверждённой брони (назначение, assigned). */
function linkTrip(trip: TripRow, r: Reservation): void {
  trip.vehicleId = r.vehicleId;
  trip.reservationId = r.id;
  trip.holdExpiresAt = r.holdExpiresAt;
  if (trip.state === 'planned') trip.state = 'assigned';
  trip.revision++;
}

/**
 * Брони предложения на рейс водителю `driver`: две машины до `chooseUntil` (held, одна группа) или одна — сразу
 * confirmed (Q-W2.70-1, -2). Срок уже прошёл — машина фирмы рейса подтверждается, обычная не держится. Возвращает
 * брони и id группы; уведомляет водителя («машину поставили» или «выберите машину»).
 */
export function offerVehicles(
  ctx: HandlerContext,
  f: FleetData,
  trip: TripRow,
  driver: string,
  host: VehicleRow | undefined,
  usual: VehicleRow | undefined,
): { group: string; host?: Reservation; usual?: Reservation; chooseUntil?: string } {
  const group = ctx.newId();
  const deadline = chooseUntilOf(trip);
  const open = !!host && !!usual && ctx.now() < deadline;
  const until = open ? deadline : undefined;
  const out: { group: string; host?: Reservation; usual?: Reservation; chooseUntil?: string } = {
    group,
  };
  if (host) out.host = reservationOf(ctx, host, trip, driver, group, 'host', until);
  if (usual && (open || !host))
    out.usual = reservationOf(ctx, usual, trip, driver, group, 'usual', until);
  for (const r of [out.host, out.usual]) {
    if (!r) continue;
    f.reservations.push(r);
    const v = f.vehicles.find((x) => x.id === r.vehicleId);
    if (v) hold(v, trip);
    if (r.state === 'confirmed') linkTrip(trip, r);
  }
  if (until) out.chooseUntil = until;
  const one = out.host ?? out.usual;
  const v = one ? f.vehicles.find((x) => x.id === one.vehicleId) : undefined;
  if (v) {
    notify(ctx, accountOf(ctx.org().org, driver), {
      kind: open ? 'fleet.reservation.held' : 'fleet.reservation.confirmed',
      severity: 'info',
      title: open ? OFFER_NOTIFY.choose(trip) : OFFER_NOTIFY.assigned(v, trip),
      tripId: trip.id,
    });
  }
  return out;
}

/** Снять бронь предложения с причиной; машина освобождается от рейса. */
export function releaseOffered(
  f: FleetData,
  r: Reservation,
  reason: NonNullable<Reservation['releaseReason']>,
  at: string,
): void {
  r.state = 'released';
  r.releasedAt = at;
  r.releaseReason = reason;
  r.revision++;
  if (r.tripId) freeVehicle(f, r.vehicleId, r.tripId);
}

/** Подтвердить бронь группы: остальные снимаются с причиной `reason`; рейс получает машину. */
function confirm(
  f: FleetData,
  r: Reservation,
  at: string,
  reason: NonNullable<Reservation['releaseReason']>,
): Reservation[] {
  const trip = f.trips.find((x) => x.id === r.tripId);
  r.state = 'confirmed';
  r.chosenAt = at;
  r.holdExpiresAt = r.window.endsAt;
  r.revision++;
  const released = f.reservations.filter(
    (x) => x.offerGroupId === r.offerGroupId && x.id !== r.id && x.state === 'held',
  );
  for (const x of released) releaseOffered(f, x, reason, at);
  if (trip) {
    const v = f.vehicles.find((x) => x.id === r.vehicleId);
    if (v) hold(v, trip);
    linkTrip(trip, r);
  }
  return released;
}

/** Группа предложения ещё открыта: все её брони held, срок не прошёл. */
const openGroup = (f: FleetData, group: string, now: string): boolean => {
  const all = f.reservations.filter((x) => x.offerGroupId === group);
  return (
    all.length > 1 &&
    all.every((x) => x.state === 'held') &&
    all.some((x) => !!x.chooseUntil && now < x.chooseUntil)
  );
};

/** Бронь — из открытого предложения (выбора ещё не было). */
export const undecided = (f: FleetData, r: Reservation, now: string): boolean =>
  !!r.offerGroupId && r.state === 'held' && openGroup(f, r.offerGroupId, now);

/**
 * Срок выбора прошёл без выбора (правило 4): машина фирмы рейса подтверждается, обычная снимается (deadline) и
 * возвращается в свою фирму — уведомление её фирме.
 */
export function settleOffers(ctx: HandlerContext): void {
  const f = fleetOf(ctx.org().org);
  const now = ctx.now();
  const due = new Set(
    f.reservations
      .filter((r) => r.offerGroupId && r.state === 'held' && r.chooseUntil && r.chooseUntil <= now)
      .map((r) => r.offerGroupId as string),
  );
  for (const group of due) {
    const all = f.reservations.filter((x) => x.offerGroupId === group);
    const host = all.find((x) => x.offerKind === 'host' && x.state === 'held');
    if (!host || all.some((x) => x.state === 'confirmed' || x.state === 'consumed')) continue;
    const at = host.chooseUntil ?? now;
    const released = confirm(f, host, at, 'deadline');
    const trip = f.trips.find((x) => x.id === host.tripId);
    for (const r of released) {
      const v = f.vehicles.find((x) => x.id === r.vehicleId);
      if (!v || !trip) continue;
      notify(ctx, accountsWith(ctx, 'fleet.reservations.manage', v.orgUnitId), {
        kind: 'fleet.reservation.released',
        severity: 'info',
        title: OFFER_NOTIFY.released(v, trip),
        tripId: trip.id,
      });
    }
  }
}

/** Судьба брони в машине запроса (TransferVehicle) — поля в порядке схемы. */
function fate(ref: S['TransferVehicle'], r: Reservation | undefined): S['TransferVehicle'] {
  const base: S['TransferVehicle'] = {
    vehicleId: ref.vehicleId,
    displayName: ref.displayName,
    registrationNumber: ref.registrationNumber,
    orgUnitId: ref.orgUnitId,
    ...(ref.orgUnitName ? { orgUnitName: ref.orgUnitName } : {}),
  };
  if (!r) return base;
  return {
    ...base,
    reservationId: r.id,
    reservationState: r.state,
    ...(r.chosenAt ? { chosenAt: r.chosenAt } : {}),
    ...(r.releasedAt ? { releasedAt: r.releasedAt } : {}),
    ...(r.releaseReason ? { releaseReason: r.releaseReason } : {}),
  };
}

/** Обновить в запросе судьбу машин по броням группы (1f «Машины рейса»). */
export function syncTransferVehicle(f: FleetData, x: S['DriverTransfer']): void {
  const v = x.vehicle;
  if (!v?.offerGroupId) return;
  const group = f.reservations.filter((r) => r.offerGroupId === v.offerGroupId);
  const byVehicle = (id: string) => group.find((r) => r.vehicleId === id);
  if (v.hostVehicle) v.hostVehicle = fate(v.hostVehicle, byVehicle(v.hostVehicle.vehicleId));
  if (v.homeVehicle) v.homeVehicle = fate(v.homeVehicle, byVehicle(v.homeVehicle.vehicleId));
}

export const offerHandlers: Registry = {
  chooseReservation: (ctx) => {
    settleOffers(ctx);
    const t = ctx.org();
    const f = fleetOf(t.org);
    const now = ctx.now();
    const choose =
      !t.owner && actionsFor(t, 'tenant-org-unit-self', now).has('fleet.reservations.choose');
    const manage = unitsFor(t, 'fleet.reservations.manage', now);
    if (!choose && manage !== 'all' && manage.size === 0) fail('forbidden_action');
    const r = f.reservations.find((x) => x.id === ctx.params.reservationId?.toLowerCase());
    const trip = r?.tripId ? f.trips.find((x) => x.id === r.tripId) : undefined;
    const me = t.member?.id;
    const asDriver =
      choose &&
      !!r &&
      !!trip &&
      !!me &&
      r.offeredToMemberId === me &&
      trip.driverMemberId === me &&
      temporaryAccessOpen(f, trip, me, now, 'fleet.reservations.choose');
    const asLogist = !!trip && covers(manage, trip.orgUnitId);
    if (!r || !trip || !r.offerGroupId || (!asDriver && !asLogist)) {
      fail('not_found', OFFER_TEXT.notFound);
    }
    if (!undecided(f, r, now)) fail('offer_closed', OFFER_TEXT.closed);
    const released = confirm(f, r, now, asDriver ? 'chosen' : 'manager');
    const chosen = f.vehicles.find((x) => x.id === r.vehicleId);
    if (chosen && chosen.orgUnitId !== trip.orgUnitId) {
      notify(ctx, accountsWith(ctx, 'fleet.reservations.manage', chosen.orgUnitId), {
        kind: 'fleet.reservation.confirmed',
        severity: 'info',
        title: OFFER_NOTIFY.chosen(chosen, trip),
        tripId: trip.id,
      });
    }
    for (const x of released) {
      const v = f.vehicles.find((y) => y.id === x.vehicleId);
      if (v && v.orgUnitId !== trip.orgUnitId) {
        notify(ctx, accountsWith(ctx, 'fleet.reservations.manage', v.orgUnitId), {
          kind: 'fleet.reservation.released',
          severity: 'info',
          title: OFFER_NOTIFY.released(v, trip),
          tripId: trip.id,
        });
      }
    }
    if (asDriver && chosen) {
      notify(ctx, accountsWith(ctx, 'fleet.routes.manage', trip.orgUnitId), {
        kind: 'fleet.reservation.confirmed',
        severity: 'info',
        title: OFFER_NOTIFY.driverChose(chosen, trip),
        tripId: trip.id,
      });
    }
    return { body: { chosen: structuredClone(r), released: structuredClone(released) } };
  },
};
