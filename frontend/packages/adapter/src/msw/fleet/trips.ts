// Тег Fleet, контракт 0.5.0-stage2 (W2.00): рейс от плана до приёмки — список и карточка TripPlan, планирование,
// назначение машины логистом (assignVehicle эталона), старт, «Завершить рейс», сдача, приёмка с доработкой
// по разделам (api.js reviewTrip). Переходы — docs/10-data-model: planned → assigned → inspection →
// (defect_review →) on_route → returning → submitted → accepted | rework → submitted.
import type { components } from '@ortus/api-client';
import { isDriver } from '../core/access.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { addMs, MINUTE } from '../core/time.ts';
import {
  accountOf,
  accountsWith,
  compatOf,
  covers,
  fleetOf,
  freeVehicle,
  HOLD_MINUTES,
  notify,
  planDto,
  releaseHold,
  tripDto,
  tripForCommand,
  tripOr404,
  tripVisible,
  type TripRow,
  unitsFor,
  vehicleOr404,
} from './state.ts';

type S = components['schemas'];

const STATES: readonly S['TripState'][] = [
  'planned',
  'assigned',
  'inspection',
  'defect_review',
  'on_route',
  'returning',
  'submitted',
  'rework',
  'accepted',
  'cancelled',
];

const bump = (t: TripRow): void => {
  t.revision++;
};

/** Ответ Trip 0.1 начатого рейса. */
function started(t: TripRow): { body: S['Trip'] } {
  const body = tripDto(t);
  if (!body) throw new Error(`рейс ${t.number} не начат`);
  return { body };
}

const stopsViolation = (i: number, field: string, message: string): never =>
  fail('validation_failed', 'Проверьте точки рейса.', {
    violations: [{ field: `stops[${i}].${field}`, code: 'load', message }],
  });

/** Загрузка по участкам: выгрузка не больше, чем в кузове после предыдущей точки (масса и объём раздельно). */
function checkStops(stops: readonly S['TripStop'][]): void {
  let w = 0;
  let v = 0;
  stops.forEach((s, i) => {
    if (s.sequence !== i + 1) {
      fail('validation_failed', 'Проверьте точки рейса.', {
        violations: [
          { field: `stops[${i}].sequence`, code: 'order', message: 'Точки нумеруются подряд с 1' },
        ],
      });
    }
    const sign = s.op === 'load' ? 1 : -1;
    w += sign * Number(s.weightKg);
    v += sign * Number(s.volumeM3);
    if (w < 0)
      stopsViolation(i, 'weightKg', 'Выгрузка больше, чем в кузове после предыдущей точки');
    if (v < 0)
      stopsViolation(i, 'volumeM3', 'Выгрузка больше, чем в кузове после предыдущей точки');
  });
}

const validWindow = (w: S['TimeWindow'], field: string): void => {
  if (w.startsAt >= w.endsAt) {
    fail('validation_failed', 'Проверьте время рейса.', {
      violations: [{ field, code: 'range', message: 'Окончание должно быть позже начала' }],
    });
  }
};

const byWindow = (a: TripRow, b: TripRow): number =>
  a.plannedWindow.startsAt.localeCompare(b.plannedWindow.startsAt) ||
  a.number.localeCompare(b.number);

export const tripHandlers: Registry = {
  listTripPlans: (ctx) => {
    const states = ctx.query.getAll('state');
    if (states.some((s) => !STATES.includes(s as S['TripState']))) fail('malformed_request');
    const unit = uuidParam(ctx.query, 'orgUnitId', false);
    const driver = uuidParam(ctx.query, 'driverMemberId', false);
    const items = fleetOf(ctx.org().org)
      .trips.filter(
        (t) =>
          tripVisible(ctx, t) &&
          (!states.length || states.includes(t.state)) &&
          (!unit || t.orgUnitId === unit) &&
          (!driver || t.driverMemberId === driver),
      )
      .sort(byWindow)
      .map(planDto);
    return { body: page(items, ctx.query) };
  },

  getTripPlan: (ctx) => ({ body: planDto(tripOr404(ctx)) }),

  createTripPlan: (ctx) => {
    const t = ctx.org();
    const b = ctx.body as S['TripPlanCreate'];
    const unitId = b.orgUnitId.toLowerCase();
    if (!t.org.units.some((u) => u.id === unitId)) {
      fail('validation_failed', 'Подразделение не найдено.', {
        violations: [{ field: 'orgUnitId', code: 'unknown', message: 'Нет такого подразделения' }],
      });
    }
    if (!covers(unitsFor(t, 'fleet.routes.manage', ctx.now()), unitId)) fail('forbidden_action');
    validWindow(b.plannedWindow, 'plannedWindow');
    checkStops(b.stops);
    const f = fleetOf(t.org);
    let driverName: string | undefined;
    if (b.driverMemberId) {
      const m = t.org.members.find((x) => x.id === b.driverMemberId?.toLowerCase());
      if (!m || m.status !== 'active' || !isDriver(t.org, m, ctx.now())) {
        fail('validation_failed', 'Проверьте водителя.', {
          violations: [
            {
              field: 'driverMemberId',
              code: 'driver',
              message: 'Нужен действующий сотрудник с функцией «Водитель»',
            },
          ],
        });
      }
      driverName = m.displayName;
    }
    const next = Math.max(0, ...f.trips.map((x) => Number(/\d+$/.exec(x.number)?.[0] ?? 0))) + 1;
    const row: TripRow = {
      id: ctx.newId(),
      proto: `trip-${next}`,
      number: `Р-${next}`,
      title: b.title.trim(),
      orgUnitId: unitId,
      state: 'planned',
      plannedWindow: { ...b.plannedWindow },
      cargo: { ...b.cargo },
      stops: b.stops.map((s) => ({ ...s })),
      reviews: [],
      revision: 1,
    };
    if (b.distanceKm !== undefined) row.distanceKm = b.distanceKm;
    if (b.driverMemberId && driverName) {
      row.driverMemberId = b.driverMemberId.toLowerCase();
      row.driverDisplayName = driverName;
    }
    // Ключи — в порядке TripPlan: distanceKm после окна.
    f.trips.push(row);
    return { status: 201, body: planDto(row) };
  },

  assignTripVehicle: (ctx) => {
    const trip = tripForCommand(ctx, 'fleet.routes.manage');
    ctx.revision(trip.revision);
    if (trip.state !== 'planned' && trip.state !== 'assigned') {
      fail('invalid_transition', 'Машину можно назначить только запланированному рейсу.');
    }
    const f = fleetOf(ctx.org().org);
    const v = vehicleOr404(ctx, (ctx.body as S['TripVehicleAssignment']).vehicleId);
    const c = compatOf(v, trip);
    if (!c.fit) {
      const bad = c.checks.slice(1).filter((x) => !x.ok);
      fail('vehicle_incompatible', 'Нельзя назначить: ' + c.reasons.join('; '), {
        violations: bad.map((x) => ({
          field: 'vehicleId',
          code: x.key,
          message: `${x.label}: ${x.value}${x.need ? ', нужно ' + x.need : ''}`,
        })),
      });
    }
    if (!c.ok) fail('reservation_overlap', 'Машину только что забронировали. Обновите список.');
    if (trip.vehicleId && trip.vehicleId !== v.id) {
      freeVehicle(f, trip.vehicleId, trip.id);
      releaseHold(f, trip);
    }
    const hold = addMs(ctx.now(), HOLD_MINUTES * MINUTE);
    if (trip.driverMemberId && !trip.reservationId) {
      const r: S['Reservation'] = {
        id: ctx.newId(),
        vehicleId: v.id,
        driverMemberId: trip.driverMemberId,
        window: { ...trip.plannedWindow },
        state: 'held',
        holdExpiresAt: hold,
        revision: 1,
        tripId: trip.id,
      };
      f.reservations.push(r);
      trip.reservationId = r.id;
    }
    v.vstate = 'reserved';
    v.heldBy = trip.id;
    delete v.note;
    v.revision++;
    trip.vehicleId = v.id;
    trip.holdExpiresAt = hold;
    trip.state = 'assigned';
    bump(trip);
    return { body: planDto(trip) };
  },

  startTrip: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['TripStart'];
    const r = f.reservations.find((x) => x.id === b.reservationId.toLowerCase());
    const trip = r?.tripId ? f.trips.find((x) => x.id === r.tripId) : undefined;
    if (!r || !trip || !tripVisible(ctx, trip, 'fleet.trips.start'))
      fail('not_found', 'Бронь не найдена.');
    const insp = f.inspections.find((x) => x.id === b.departureInspectionId.toLowerCase());
    if (!insp || insp.kind !== 'departure' || insp.tripId !== trip.id) {
      fail('validation_failed', 'Нужен осмотр перед выездом этого рейса.', {
        violations: [
          { field: 'departureInspectionId', code: 'unknown', message: 'Осмотр не найден' },
        ],
      });
    }
    if (
      f.defects.some(
        (d) => d.tripId === trip.id && d.severity === 'blocking' && d.state === 'in_review',
      )
    ) {
      fail('blocking_defect_open', 'Выезд заблокирован: дефект на проверке менеджера.');
    }
    if (r.state !== 'held' || trip.state !== 'inspection') {
      fail('invalid_transition', 'Бронь уже использована или снята.');
    }
    r.state = 'consumed';
    r.revision++;
    const v = f.vehicles.find((x) => x.id === r.vehicleId);
    if (v) {
      v.vstate = 'on_route';
      v.revision++;
    }
    trip.state = 'on_route';
    trip.departureInspectionId = insp.id;
    trip.startedAt = ctx.now();
    bump(trip);
    notify(ctx, accountsWith(ctx, 'fleet.trips.review', trip.orgUnitId), {
      kind: 'fleet.trip.started',
      severity: 'info',
      title: `Рейс ${trip.number} начат · ${v?.displayName ?? ''}`.trim(),
      tripId: trip.id,
    });
    return { status: 201, ...started(trip) };
  },

  listTrips: (ctx) => {
    const items = fleetOf(ctx.org().org)
      .trips.filter((t) => tripVisible(ctx, t))
      .sort(byWindow)
      .flatMap((t) => tripDto(t) ?? []);
    return { body: page(items, ctx.query) };
  },

  getTrip: (ctx) => {
    const trip = tripOr404(ctx);
    const body = tripDto(trip);
    if (!body) fail('not_found', 'Рейс ещё не начат.');
    return { body };
  },

  finishTripRoute: (ctx) => {
    const trip = tripForCommand(ctx, 'fleet.trips.return');
    ctx.revision(trip.revision);
    if (trip.state !== 'on_route') fail('invalid_transition', 'Рейс ещё не в пути.');
    trip.state = 'returning';
    trip.routeCompletedAt = ctx.now();
    bump(trip);
    return { body: planDto(trip) };
  },

  returnTrip: (ctx) => {
    const trip = tripForCommand(ctx, 'fleet.trips.return');
    ctx.revision(trip.revision);
    if (trip.state !== 'returning' && trip.state !== 'rework') {
      fail('invalid_transition', 'Сдать машину можно после «Завершить рейс».');
    }
    const f = fleetOf(ctx.org().org);
    const id = (ctx.body as S['TripReturn']).returnInspectionId.toLowerCase();
    const latest = f.inspections
      .filter((x) => x.tripId === trip.id && x.kind === 'return')
      .sort((a, b) => (b.attempt ?? 1) - (a.attempt ?? 1))[0];
    if (!latest || latest.id !== id) {
      fail('validation_failed', 'Сдача не завершена: нужен последний осмотр при сдаче.', {
        violations: [
          { field: 'returnInspectionId', code: 'unknown', message: 'Осмотр при сдаче не найден' },
        ],
      });
    }
    const v = f.vehicles.find((x) => x.id === trip.vehicleId);
    if (v) {
      v.vstate = 'review';
      v.revision++;
    }
    trip.state = 'submitted';
    trip.returnInspectionId = id;
    trip.returnedAt = ctx.now();
    bump(trip);
    notify(ctx, accountsWith(ctx, 'fleet.trips.review', trip.orgUnitId), {
      kind: 'fleet.trip.submitted',
      severity: 'info',
      title:
        `Смена ${trip.number} сдана на приёмку · ${v ? `${v.displayName} ${v.registrationNumber}` : ''}`.trim(),
      tripId: trip.id,
    });
    return started(trip);
  },

  reviewTrip: {
    run: (ctx) => {
      const trip = tripForCommand(ctx, 'fleet.trips.review');
      ctx.revision(trip.revision);
      const b = ctx.body as S['TripReview'];
      const t = ctx.org();
      if (trip.state !== 'submitted') fail('invalid_transition', 'Смена уже обработана');
      const steps = b.steps ?? [];
      if (b.decision === 'rework') {
        const violations: S['ProblemViolation'][] = [];
        if (!b.comment?.trim()) {
          violations.push({
            field: 'comment',
            code: 'required',
            message: 'Опишите, что нужно исправить',
          });
        }
        if (!steps.length) {
          violations.push({
            field: 'steps',
            code: 'required',
            message: 'Отметьте хотя бы один раздел для доработки',
          });
        }
        if (violations.length) {
          fail('validation_failed', violations[0]?.message, { violations });
        }
      } else if (steps.length) {
        fail('validation_failed', 'Разделы доработки — только при возврате на доработку.', {
          violations: [{ field: 'steps', code: 'forbidden', message: 'Только для доработки' }],
        });
      }
      if (b.decision === 'reject') {
        fail('validation_failed', 'В пилоте смену принимают или возвращают на доработку.', {
          violations: [
            { field: 'decision', code: 'enum', message: 'Примите смену или верните на доработку' },
          ],
        });
      }
      const f = fleetOf(t.org);
      const reviewer = t.member?.id ?? '';
      const summary: S['TripReviewSummary'] = {
        decision: b.decision,
        ...(b.comment ? { comment: b.comment } : {}),
        ...(steps.length ? { steps: [...steps] } : {}),
        attempt: trip.reviews.length + 1,
        reviewerMemberId: reviewer,
        reviewedAt: ctx.now(),
      };
      trip.reviews.push(summary);
      const v = f.vehicles.find((x) => x.id === trip.vehicleId);
      if (b.decision === 'rework') {
        trip.state = 'rework';
        bump(trip);
        notify(ctx, accountOf(t.org, trip.driverMemberId), {
          kind: 'fleet.trip.rework_requested',
          severity: 'warning',
          title: `Смена ${trip.number} возвращена на доработку: ${b.comment ?? ''}`,
          tripId: trip.id,
        });
        return started(trip);
      }
      // approve и maintenance_required: смена принята, расходы подтверждены, начисление — в той же команде (Q-55).
      const ret = f.inspections.find((x) => x.id === trip.returnInspectionId);
      if (v) {
        v.vstate = b.decision === 'maintenance_required' ? 'unavailable' : 'free';
        if (b.decision === 'maintenance_required') v.note = 'нужен ремонт';
        delete v.heldBy;
        if (ret) v.odometerKm = ret.odometerKm;
        v.revision++;
      }
      for (const x of f.expenses) {
        if (x.tripId === trip.id && x.reviewState === 'pending') {
          x.reviewState = 'approved';
          x.revision++;
        }
      }
      trip.state = 'accepted';
      trip.acceptedAt = ctx.now();
      bump(trip);
      if (trip.earningsMinor !== undefined && trip.driverMemberId) {
        if (!f.earnings.some((e) => e.tripId === trip.id)) {
          f.earnings.push({
            tripId: trip.id,
            driverMemberId: trip.driverMemberId,
            amount: { amountMinor: trip.earningsMinor, currency: 'RUB' },
            updatedByMemberId: reviewer,
            updatedAt: ctx.now(),
            revision: 1,
          });
        }
      }
      notify(ctx, accountOf(t.org, trip.driverMemberId), {
        kind: 'fleet.trip.accepted',
        severity: 'info',
        title: `Смена ${trip.number} принята. Машина свободна.`,
        tripId: trip.id,
      });
      return started(trip);
    },
  },
};
