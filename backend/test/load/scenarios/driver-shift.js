// Смена водителя (W0.16): бронь → осмотр выезда с фото → старт → рейс → расходы с чеками →
// осмотр сдачи с фото → сдача с If-Match. Состав запросов = requestsPerShift() модели.
// Итог итерации — flow_completed или flow_aborted{reason} (lib/flow.js).
import { sleep } from 'k6';
import exec from 'k6/execution';

import { Session, makeFiller, pad, tenantOf } from '../lib/client.js';
import { track } from '../lib/flow.js';
import {
  inspectionCreate,
  isoInstant,
  paramValues,
  reservationCreate,
  tripExpenseCreate,
  tripReturn,
  tripStart,
} from '../lib/model.js';

const EXPENSES = [
  { kind: 'fuel', amountMinor: 350000, quantityLitres: 40 },
  { kind: 'parking', amountMinor: 20000 },
  { kind: 'wash', amountMinor: 50000 },
  { kind: 'toll', amountMinor: 45000 },
  { kind: 'other', amountMinor: 10000 },
];
const SHIFT_HOURS = 9;

export function makeDriverShift(profile, stage) {
  const v = paramValues(profile, stage);
  const filler = makeFiller(v.photoSizeBytes);
  const think = () => {
    if (v.driverThinkSeconds > 0) sleep(v.driverThinkSeconds);
  };

  function inspect(s, { tenantId, vehicleId, kind, owner, count, odometerKm, ...link }) {
    const list = s.call('getInspectionChecklist', {
      params: { tenantId },
      query: { vehicleId, kind },
    });
    if (!list.ok || !list.json) return null;
    const roles = list.json.requiredPhotoRoles.length ? list.json.requiredPhotoRoles : ['front'];
    const photos = [];
    for (let i = 0; i < count; i++) {
      const role = roles[i % roles.length];
      const fileId = s.upload({
        tenantId,
        purpose: 'inspection',
        owner,
        fileName: `${kind}-${role}-${i + 1}.jpg`,
        filler,
      });
      if (!fileId) return null;
      photos.push({ role, fileId });
    }
    think();
    const res = s.call('submitInspection', {
      params: { tenantId },
      body: inspectionCreate({
        checklist: list.json,
        vehicleId,
        odometerKm,
        fuelPercent: kind === 'departure' ? 80 : 45,
        photos,
        capturedAt: new Date(),
        ...link,
      }),
    });
    return res.ok ? res.json : null;
  }

  /** Своя бронь в статусе held или новая бронь случайной свободной машины (допущение A-22). */
  function reservationFor(s, { tenantId, memberId }) {
    const now = new Date();
    const until = new Date(now.getTime() + SHIFT_HOURS * 3600 * 1000);
    const reservations = s.call('listReservations', {
      params: { tenantId },
      query: { limit: v.listLimit },
    });
    // Фильтр доступности OpenAPI 0.1: в списке только машины, свободные на смену.
    const vehicles = s.call('listVehicles', {
      params: { tenantId },
      query: {
        limit: v.listLimit,
        availableFrom: isoInstant(now),
        availableUntil: isoInstant(until),
      },
    });
    const items = (r) => (r.json && r.json.items) || [];
    const own = items(reservations).find(
      (r) => r.driverMemberId === memberId && r.state === 'held',
    );
    if (own) return { reservation: own, vehicles: items(vehicles) };
    // Случайная машина, а не первая: иначе одновременные водители бьются за одну (409).
    const free = items(vehicles).filter((x) => x.status === 'available');
    if (!free.length) return { reason: 'no_vehicle' };
    const pick = free[Math.floor(Math.random() * free.length)];
    // 409 при гонке за машину — ожидаемый ответ, но смена прерывается (reason vehicle_conflict).
    const held = s.call('reserveVehicle', {
      params: { tenantId },
      body: reservationCreate({
        vehicleId: pick.id,
        driverMemberId: memberId,
        startsAt: now,
        hours: SHIFT_HOURS,
      }),
      expected: [201, 409],
    });
    if (held.status === 409) return { reason: 'vehicle_conflict' };
    if (held.status !== 201 || !held.json) return { reason: 'reserve' };
    return { reservation: held.json, vehicles: free };
  }

  function shift(s) {
    if (!s.login()) return 'login';
    const me = tenantOf(s);
    if (!me) return 'context';
    const { tenantId } = me;
    think();

    const { reservation, vehicles, reason } = reservationFor(s, me);
    if (!reservation) return reason;
    const vehicle = vehicles.find((x) => x.id === reservation.vehicleId);
    const odometer = Number((vehicle && vehicle.odometerKm) || 100000);
    think();

    const departure = inspect(s, {
      tenantId,
      vehicleId: reservation.vehicleId,
      kind: 'departure',
      owner: { entityType: 'reservation', entityId: reservation.id },
      count: v.departurePhotos,
      odometerKm: odometer,
      reservationId: reservation.id,
    });
    if (!departure) return 'departure_inspection';
    const started = s.call('startTrip', {
      params: { tenantId },
      body: tripStart({ reservationId: reservation.id, departureInspectionId: departure.id }),
    });
    if (!started.ok || !started.json) return 'start_trip';
    const tripId = started.json.id;
    const tripOwner = { entityType: 'trip', entityId: tripId };

    for (let i = 0; i < v.tripPollsPerShift; i++) {
      think();
      s.call('getTrip', { params: { tenantId, tripId } });
    }

    for (let e = 0; e < v.expensesPerShift; e++) {
      const receiptFileIds = [];
      for (let k = 0; k < v.receiptsPerExpense; k++) {
        const fileId = s.upload({
          tenantId,
          purpose: 'expense_receipt',
          owner: tripOwner,
          fileName: `receipt-${e + 1}-${k + 1}.jpg`,
          filler,
        });
        if (!fileId) return 'receipt';
        receiptFileIds.push(fileId);
      }
      think();
      const x = EXPENSES[e % EXPENSES.length];
      const expense = s.call('createTripExpense', {
        params: { tenantId, tripId },
        body: tripExpenseCreate({ ...x, occurredAt: new Date(), receiptFileIds }),
      });
      if (!expense.ok) return 'expense';
    }

    const back = inspect(s, {
      tenantId,
      vehicleId: reservation.vehicleId,
      kind: 'return',
      owner: tripOwner,
      count: v.returnPhotos,
      odometerKm: odometer + 150,
      tripId,
    });
    if (!back) return 'return_inspection';
    const current = s.call('getTrip', { params: { tenantId, tripId } });
    if (!current.etag) return 'no_etag';
    const returned = s.call('returnTrip', {
      params: { tenantId, tripId },
      ifMatch: current.etag,
      body: tripReturn({ returnInspectionId: back.id }),
    });
    return returned.ok ? null : 'return_trip';
  }

  return function driverShift() {
    const persona = `load-pilot-driver-${pad((exec.scenario.iterationInTest % v.drivers) + 1, 3)}`;
    const outcome = track('driverShift');
    const reason = shift(new Session(persona, 'driverShift'));
    if (reason) outcome.abort(reason);
    else outcome.done();
  };
}
