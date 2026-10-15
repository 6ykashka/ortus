// Тег Fleet, контракт 0.5.0-stage2 (W2.00): машины области (подбор S2-02) и бронь водителя на рейс с hold и
// сроком (api.js reserve, cancelReservation). Бронь подтверждает только сервер: совместимость (compat) и
// доступность проверяются здесь же — 409 vehicle_incompatible с причинами, 409 reservation_overlap.
import type { components } from '@ortus/api-client';

import { limitOf, page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { addMs, MINUTE } from '../core/time.ts';
import {
  asDriver,
  compatOf,
  covers,
  fleetOf,
  freeVehicle,
  HOLD_MINUTES,
  tripVisible,
  unitsFor,
  vehicleDto,
  vehicleOr404,
} from './state.ts';

type S = components['schemas'];

const BODIES = ['van', 'box', 'flatbed', 'refrigerated', 'tent'];
const QUANTITY = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

export const vehicleHandlers: Registry = {
  listVehicles: (ctx) => {
    const t = ctx.org();
    const q = ctx.query;
    const from = q.get('availableFrom');
    const until = q.get('availableUntil');
    if ((from === null) !== (until === null)) {
      fail('validation_failed', 'Укажите обе границы интервала доступности или ни одной.', {
        violations: [
          {
            field: from === null ? 'availableFrom' : 'availableUntil',
            code: 'required',
            message: 'Нужны обе границы интервала',
          },
        ],
      });
    }
    const body = q.get('bodyType');
    if (body !== null && !BODIES.includes(body)) fail('malformed_request');
    const minPayload = q.get('minPayloadKg');
    if (minPayload !== null && !QUANTITY.test(minPayload)) fail('malformed_request');
    const unit = uuidParam(q, 'orgUnitId', false);
    limitOf(q);
    const units = unitsFor(t, 'fleet.vehicles.read', ctx.now());
    const items = fleetOf(t.org)
      .vehicles.filter(
        (v) =>
          covers(units, v.orgUnitId) &&
          (!unit || v.orgUnitId === unit) &&
          (body === null || v.bodyType === body) &&
          (minPayload === null || Number(v.capacity.payloadKg) >= Number(minPayload)) &&
          (from === null || v.vstate === 'free'),
      )
      .map(vehicleDto);
    return { body: page(items, q) };
  },

  reserveVehicle: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['ReservationCreate'];
    const driverId = b.driverMemberId.toLowerCase();
    const me = asDriver(t, ctx.now());
    // Водитель бронирует только для себя (ReservationCreate 0.1).
    if (me && me.id !== driverId) fail('forbidden_action');
    if (b.window.startsAt >= b.window.endsAt) {
      fail('validation_failed', 'Проверьте интервал брони.', {
        violations: [
          { field: 'window', code: 'range', message: 'Окончание должно быть позже начала' },
        ],
      });
    }
    const v = vehicleOr404(ctx, b.vehicleId);
    const trip = b.tripId ? f.trips.find((x) => x.id === b.tripId?.toLowerCase()) : undefined;
    if (b.tripId && (!trip || !tripVisible(ctx, trip))) fail('not_found', 'Рейс не найден.');
    if (trip && trip.driverMemberId !== driverId) {
      fail('validation_failed', 'Бронь оформляется на водителя рейса.', {
        violations: [{ field: 'driverMemberId', code: 'trip', message: 'Водитель рейса другой' }],
      });
    }
    if (trip && trip.state !== 'planned' && trip.state !== 'assigned') {
      fail('invalid_transition', 'Рейс уже в работе: бронь не нужна.');
    }
    if (trip) {
      const c = compatOf(v, trip);
      if (!c.fit) fail('vehicle_incompatible', 'Машина не подходит рейсу: ' + c.reasons.join('; '));
      if (!c.ok) fail('reservation_overlap', 'Машина уже недоступна. Обновите список.');
    } else if (v.vstate !== 'free') {
      fail('reservation_overlap', 'Машина уже недоступна. Обновите список.');
    }
    const hold = addMs(ctx.now(), HOLD_MINUTES * MINUTE);
    // Логист уже назначил эту машину и держит её за рейсом — водитель подтверждает ту же бронь.
    const prior = trip?.reservationId
      ? f.reservations.find((x) => x.id === trip.reservationId && x.state === 'held')
      : undefined;
    let r: S['Reservation'];
    if (prior && prior.vehicleId === v.id) {
      prior.holdExpiresAt = hold;
      prior.revision++;
      r = prior;
    } else {
      if (trip?.vehicleId && trip.vehicleId !== v.id) freeVehicle(f, trip.vehicleId, trip.id);
      if (prior) {
        prior.state = 'released';
        prior.revision++;
      }
      r = {
        id: ctx.newId(),
        vehicleId: v.id,
        driverMemberId: driverId,
        window: { ...b.window },
        state: 'held',
        holdExpiresAt: hold,
        ...(b.routeId ? { routeId: b.routeId.toLowerCase() } : {}),
        revision: 1,
        ...(trip ? { tripId: trip.id } : {}),
      };
      f.reservations.push(r);
    }
    v.vstate = 'reserved';
    if (trip) v.heldBy = trip.id;
    delete v.note;
    v.revision++;
    if (trip) {
      trip.vehicleId = v.id;
      trip.reservationId = r.id;
      trip.holdExpiresAt = hold;
      trip.state = 'inspection';
      trip.revision++;
    }
    return { status: 201, body: structuredClone(r) };
  },

  listReservations: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const me = asDriver(t, ctx.now());
    const units = unitsFor(t, 'fleet.reservations.read', ctx.now());
    const items = f.reservations.filter((r) => {
      if (me) return r.driverMemberId === me.id;
      const v = f.vehicles.find((x) => x.id === r.vehicleId);
      return !!v && covers(units, v.orgUnitId);
    });
    return { body: page(structuredClone(items), ctx.query) };
  },

  getReservation: (ctx) => ({ body: structuredClone(reservationOr404(ctx)) }),

  releaseReservation: (ctx) => {
    const r = reservationOr404(ctx);
    ctx.revision(r.revision);
    if (r.state !== 'held') fail('invalid_transition', 'Бронь уже снята или использована.');
    const f = fleetOf(ctx.org().org);
    r.state = 'released';
    r.revision++;
    const trip = r.tripId ? f.trips.find((x) => x.id === r.tripId) : undefined;
    if (trip) {
      freeVehicle(f, r.vehicleId, trip.id);
      const v = f.vehicles.find((x) => x.id === r.vehicleId);
      if (v?.heldBy === trip.id) delete v.heldBy;
      if (trip.reservationId === r.id) {
        delete trip.reservationId;
        delete trip.holdExpiresAt;
        delete trip.vehicleId;
        delete trip.departureInspectionId;
        delete trip.blockingDefectId;
        trip.state = 'planned';
        trip.revision++;
      }
    } else {
      const v = f.vehicles.find((x) => x.id === r.vehicleId);
      if (v?.vstate === 'reserved' && !v.heldBy) {
        v.vstate = 'free';
        v.revision++;
      }
    }
    return { body: structuredClone(r) };
  },
};

/** Бронь запроса: водитель — своя, менеджер — машины своей области; иначе 404. */
function reservationOr404(ctx: HandlerContext): S['Reservation'] {
  const t = ctx.org();
  const f = fleetOf(t.org);
  const r = f.reservations.find((x) => x.id === ctx.params.reservationId?.toLowerCase());
  const me = asDriver(t, ctx.now());
  const v = r ? f.vehicles.find((x) => x.id === r.vehicleId) : undefined;
  const visible =
    !!r &&
    (me
      ? r.driverMemberId === me.id
      : !!v && covers(unitsFor(t, 'fleet.reservations.read', ctx.now()), v.orgUnitId));
  if (!r || !visible) fail('not_found', 'Бронь не найдена.');
  return r;
}
