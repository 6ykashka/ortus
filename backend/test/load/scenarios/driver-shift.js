// Смена водителя (W0.16 → W2.47), путь клиента W2.22 на контракте 0.5.1-stage2: свой рейс в планировании →
// бронь машины на рейс → осмотр выезда с пятью фото → старт → опросы «Сегодня» → чек и расход → завершение
// маршрута → осмотр сдачи с пятью фото → сдача машины. Состав запросов = requestsPerShift() модели.
// Темп (pilot, stress; A-26): стартовый сдвиг слота, затем смена раз в цикл. Итог — lib/flow.js.
import { sleep } from 'k6';
import exec from 'k6/execution';

import { Session, makeFiller, tenantOf } from '../lib/client.js';
import { track } from '../lib/flow.js';
import {
  buildOptions,
  deriveRates,
  driverPacing,
  expenseFor,
  fitsCargo,
  inspectionCreate,
  paramValues,
  personaIndex,
  personasFor,
  pickTrip,
  reservationCreate,
  tripExpenseCreate,
  tripReturn,
  tripStart,
} from '../lib/model.js';

const RESERVE_ATTEMPTS = 3;
// 409 — машина занята (гонка), 422 — машина не подходит рейсу: берётся другая.
const RESERVE_EXPECTED = [201, 409, 422];

export function makeDriverShift(profile, stage) {
  const v = paramValues(profile, stage);
  const personas = personasFor(profile, stage).drivers;
  const vus = buildOptions(profile, stage).scenarios.driverShift.vus;
  const filler = makeFiller(v.photoSizeBytes);
  // Запас окна рейса: полторы активной части смены и минута.
  const needSeconds = Math.ceil(deriveRates(profile, stage).driverActiveSeconds * 1.5) + 60;
  let slot = null; // порядок первой итерации VU: персонаж и темп
  const think = () => {
    if (v.driverThinkSeconds > 0) sleep(v.driverThinkSeconds);
  };

  /** Фото рейса до `ready`; после каждого — пауза водителя. */
  function photo(s, tenantId, tripId, purpose, fileName) {
    const r = s.upload({ tenantId, purpose, tripId, fileName, filler });
    think();
    return r;
  }

  function inspect(s, { tenantId, plan, vehicleId, kind, count, odometerKm, ...link }) {
    const list = s.call('getInspectionChecklist', {
      params: { tenantId },
      query: { vehicleId, kind },
    });
    if (!list.ok || !list.json) return { reason: `${kind}_inspection` };
    const roles = list.json.requiredPhotoRoles.length ? list.json.requiredPhotoRoles : ['front'];
    const photos = [];
    for (let i = 0; i < count; i++) {
      const role = roles[i % roles.length];
      const r = photo(s, tenantId, plan.id, 'inspection', `${kind}-${role}.jpg`);
      if (!r.fileId) return r;
      photos.push({ role, fileId: r.fileId });
    }
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
    return res.ok && res.json ? { inspection: res.json } : { reason: `${kind}_inspection` };
  }

  /**
   * Свой рейс в планировании (водитель видит только свои рейсы, D22): самый ранний, окно которого не кончится до
   * конца смены — бронь должна лежать в окне рейса и кончаться позже «сейчас».
   */
  function myTrip(s, tenantId) {
    const res = s.call('listTripPlans', {
      params: { tenantId },
      query: { limit: v.listLimit, state: 'planned' },
    });
    return pickTrip((res.json && res.json.items) || [], new Date(), needSeconds);
  }

  /** Бронь машины на рейс: назначенная логистом или случайная свободная по грузу, до трёх попыток. */
  function reserve(s, tenantId, plan) {
    const list = s.call('listVehicles', { params: { tenantId }, query: { limit: v.listLimit } });
    const items = (list.json && list.json.items) || [];
    const free = plan.vehicleId
      ? items.filter((x) => x.id === plan.vehicleId)
      : items.filter((x) => x.status === 'available' && fitsCargo(x, plan.cargo));
    if (!free.length) return { reason: 'no_vehicle' };
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS && free.length; attempt++) {
      // Случайная машина, а не первая: иначе одновременные водители бьются за одну.
      const [vehicle] = free.splice(Math.floor(Math.random() * free.length), 1);
      const held = s.call('reserveVehicle', {
        params: { tenantId },
        body: reservationCreate({
          vehicleId: vehicle.id,
          driverMemberId: plan.driverMemberId,
          window: plan.plannedWindow,
          tripId: plan.id,
        }),
        expected: RESERVE_EXPECTED,
      });
      if (held.status === 201 && held.json) return { reservation: held.json, vehicle };
      if (held.status !== 409 && held.status !== 422) return { reason: 'reserve' };
    }
    return { reason: 'vehicle_conflict' };
  }

  /** ETag свежего getTripPlan для команд рейса. */
  function planTag(s, tenantId, tripId) {
    const res = s.call('getTripPlan', { params: { tenantId, tripId } });
    return res.ok ? res.etag : undefined;
  }

  function shift(s, index) {
    if (!s.login()) return 'login';
    const me = tenantOf(s);
    if (!me) return 'context';
    const { tenantId } = me;
    think();

    const plan = myTrip(s, tenantId);
    if (!plan) return 'no_trip';
    const { reservation, vehicle, reason } = reserve(s, tenantId, plan);
    if (!reservation) return reason;
    const odometer = Math.round(Number(vehicle.odometerKm || 100000));
    think();

    const out = inspect(s, {
      tenantId,
      plan,
      vehicleId: reservation.vehicleId,
      kind: 'departure',
      count: v.departurePhotos,
      odometerKm: odometer,
      reservationId: reservation.id,
    });
    if (!out.inspection) return out.reason;
    think();
    const started = s.call('startTrip', {
      params: { tenantId },
      body: tripStart({ reservationId: reservation.id, departureInspectionId: out.inspection.id }),
    });
    if (!started.ok || !started.json) return 'start_trip';
    const tripId = started.json.id;
    think();

    for (let i = 0; i < v.tripPollsPerShift; i++) {
      s.call('listTripPlans', { params: { tenantId }, query: { limit: v.listLimit } });
      think();
    }

    for (let e = 0; e < v.expensesPerShift; e++) {
      const receiptFileIds = [];
      for (let k = 0; k < v.receiptsPerExpense; k++) {
        const r = photo(s, tenantId, tripId, 'expense_receipt', `receipt-${e + 1}.jpg`);
        if (!r.fileId) return r.reason === 'upload' ? 'receipt' : r.reason;
        receiptFileIds.push(r.fileId);
      }
      const expense = s.call('createTripExpense', {
        params: { tenantId, tripId },
        body: tripExpenseCreate({
          ...expenseFor(index * v.expensesPerShift + e),
          occurredAt: new Date(),
          receiptFileIds,
        }),
      });
      if (!expense.ok) return 'expense';
      think();
    }

    const routeTag = planTag(s, tenantId, tripId);
    if (!routeTag) return 'no_etag';
    const finished = s.call('finishTripRoute', {
      params: { tenantId, tripId },
      ifMatch: routeTag,
    });
    if (!finished.ok) return 'finish_route';
    think();

    const back = inspect(s, {
      tenantId,
      plan,
      vehicleId: reservation.vehicleId,
      kind: 'return',
      count: v.returnPhotos,
      odometerKm: odometer + 60,
      tripId,
    });
    if (!back.inspection) return back.reason;
    think();
    const returnTag = planTag(s, tenantId, tripId);
    if (!returnTag) return 'no_etag';
    const returned = s.call('returnTrip', {
      params: { tenantId, tripId },
      ifMatch: returnTag,
      body: tripReturn({ returnInspectionId: back.inspection.id }),
    });
    return returned.ok ? null : 'return_trip';
  }

  return function driverShift() {
    const iteration = exec.vu.iterationInScenario;
    if (slot === null) slot = exec.scenario.iterationInTest;
    const { offsetSeconds, cycleSeconds } = driverPacing(profile, stage, slot);
    if (iteration === 0 && offsetSeconds > 0) sleep(offsetSeconds);
    const started = Date.now();
    const persona = personas[personaIndex({ slot, iteration, vus, count: personas.length })];
    const outcome = track('driverShift');
    const reason = shift(new Session(persona, 'driverShift'), exec.scenario.iterationInTest);
    if (reason) outcome.abort(reason);
    else outcome.done();
    const rest = cycleSeconds - (Date.now() - started) / 1000;
    if (cycleSeconds > 0 && rest > 0) sleep(rest);
  };
}
