// W2.71 · Стюард контрактной дельты 0.6.3-stage2: S2-20 «Машина для временного водителя» — решение владельца
// продукта D-35 комплекта от 19.10 (ответ на Q-W2.32-1; design/docs/29-temporary-driver-vehicle.md, макеты 1a–1g «Временный
// водитель - варианты.dc.html»; DoR docs/plan/v2/analysis/dor/s2-20-temporary-driver-vehicle.md §3–§4). Бронь при
// одобрении запроса, режим машины в запросе, решение фирмы водителя по обычной машине, выбор водителя из предложенных
// (fleet.reservations.choose), срок выбора, «Требует решения» логиста. Бриф docs/plan/v2/ws/W2.71.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';
import { W5_ADDED_KEYS, W5_CODES } from './lib/stage5.mjs';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const name = (ref) => ref?.split('/').pop();
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const was = (id) => {
  const o = ops.get(id);
  return source.paths[o.path][o.method].description;
};
const w271 = loadDeltas().filter((d) => /W2\.71/.test(d.source));

/** Шаблон «Водитель» 19.10b (design/docs/11-permissions.yaml :199–205): + fleet.reservations.choose после create. */
const DRIVER = [
  'files.read',
  'files.upload',
  'tasks.read',
  'knowledge.read',
  'calendar.availability.read',
  'fleet.vehicles.read',
  'fleet.reservations.read',
  'fleet.reservations.create',
  'fleet.reservations.choose',
  'fleet.inspections.read',
  'fleet.inspections.submit',
  'fleet.trips.read',
  'fleet.trips.start',
  'fleet.trips.return',
  'fleet.routes.read',
  'fleet.expenses.read',
  'fleet.expenses.create',
];

/** Роль «Временный водитель» W2.57 + выбор из предложенных (docs/29 «Права»). */
const TEMPORARY = [
  'files.read',
  'files.upload',
  'fleet.vehicles.read',
  'fleet.reservations.read',
  'fleet.reservations.choose',
  'fleet.inspections.read',
  'fleet.inspections.submit',
  'fleet.trips.read',
  'fleet.trips.start',
  'fleet.trips.return',
  'fleet.routes.read',
  'fleet.expenses.read',
  'fleet.expenses.create',
];

describe('контракт 0.6.3-stage2 (W2.71): права и коды', () => {
  const catalog = loadCatalog();
  const actions = flattenActions(catalog);

  it('fleet.reservations.choose: create, self, «Выбирать машину из предложенных», только предложенные брони', () => {
    const a = actions.get('fleet.reservations.choose');
    assert.ok(a, 'fleet.reservations.choose');
    assert.equal(a.module, 'logistics');
    assert.equal(a.level, 'create');
    assert.equal(a.label, 'Выбирать машину из предложенных');
    assert.deepEqual(a.scopes, ['self']);
    assert.equal(a.note, 'только брони, предложенные мне на мой рейс; новых броней не создаёт');
    assert.equal(a.sensitivity, undefined);
    const keys = Object.keys(catalog.modules.logistics.actions);
    assert.equal(
      keys.indexOf('fleet.reservations.choose'),
      keys.indexOf('fleet.reservations.manage') + 1,
      'после fleet.reservations.manage, как в 11 (19.10b)',
    );
    // W4.07 (0.8.0-stage4) и W4.04 (0.9.0-stage4) влиты позже: branding.manage и ключи «Базы знаний»
    // (core.knowledge) не считаются — остальных 120, как в 0.7.1.
    const own = [...actions].filter(
      ([k, x]) =>
        k !== 'branding.manage' && !W5_ADDED_KEYS.includes(k) && x.module !== 'core.knowledge',
    );
    // W5.00 (0.12.0-stage5): ключи и коды этапа 5 не считаются; cash.manage → cash.accounts.manage — на один ключ меньше.
    assert.equal(own.length, 119);
  });

  it('подпись fleet.reservations.manage — «Ставить и снимать брони» (19.10b), остальное как в 11', () => {
    const m = actions.get('fleet.reservations.manage');
    assert.equal(m.label, 'Ставить и снимать брони');
    assert.equal(m.level, 'edit');
    assert.deepEqual(m.scopes, ['tenant', 'unit', 'self']);
  });

  it('шаблон «Водитель» и системная роль «Временный водитель» — с выбором, без создания и снятия броней', () => {
    assert.deepEqual(catalog.role_templates.driver.actions, DRIVER);
    const t = catalog.role_templates.temporary_driver;
    assert.deepEqual([...t.actions].sort(), [...TEMPORARY].sort());
    assert.ok(
      !t.actions.includes('fleet.reservations.create'),
      'вариант (a) D-35 комплекта отклонён',
    );
    assert.ok(!t.actions.includes('fleet.reservations.manage'));
    assert.deepEqual(t.resource_actions, ['fleet.vehicles.read']);
    assert.match(t.note, /fleet\.reservations\.choose/);
    assert.match(t.note, /предложенн/);
  });

  it('offer_closed — 409, не повторять; vehicle_incompatible и reservation_overlap — прежние', () => {
    const codes = readYaml(ERRORS_PATH).codes;
    const c = codes.offer_closed;
    assert.ok(c, 'offer_closed');
    assert.equal(c.status, 409);
    assert.equal(c.retryable, false);
    assert.match(c.source, /D-35 комплекта/);
    assert.match(c.title, /срок выбора/);
    assert.equal(
      Object.keys(codes).at(-1 - W5_CODES.length),
      'offer_closed',
      'только добавление — в конец реестра (после него — коды W5.00)',
    );
    assert.equal(Object.keys(codes).length - W5_CODES.length, 53);
    assert.equal(codes.vehicle_incompatible.status, 409);
    assert.equal(codes.reservation_overlap.status, 409);
    assert.ok(schemas.ProblemCode.enum.includes('offer_closed'));
  });
});

describe('контракт 0.6.3-stage2 (W2.71): обычная машина, режим машины, решение по ней', () => {
  it('публикация: usualVehicleId — машина домашней фирмы (правило 1, TD-01), одинаковый 422 чужой и неизвестной', () => {
    const c = schemas.DriverPoolPublicationCreate.properties.usualVehicleId;
    assert.equal(name(c?.$ref), 'Id');
    for (const w of ['homeOrgUnitId', 'TD-01', '422 validation_failed', 'usualVehicleId']) {
      assert.ok(c.description.includes(w), `usualVehicleId: ${w}`);
    }
    assert.equal(name(schemas.DriverPoolPublication.properties.usualVehicleId?.$ref), 'Id');
    assert.ok(!schemas.DriverPoolPublicationCreate.required.includes('usualVehicleId'));
    assert.match(op('publishDriverToPool').description, /usualVehicleId/);
  });

  it('каталог: DriverAvailability.usualVehicle — машина, габариты, совместимость с рейсом tripId (правило 2)', () => {
    const u = schemas.DriverAvailability.properties.usualVehicle;
    assert.equal(name(u?.$ref), 'PoolUsualVehicle');
    const p = schemas.PoolUsualVehicle;
    assert.deepEqual(p.required, [
      'vehicleId',
      'displayName',
      'registrationNumber',
      'bodyType',
      'capacity',
    ]);
    for (const k of ['temperatureMinC', 'temperatureMaxC', 'fit', 'freeForWindow']) {
      assert.ok(p.properties[k], `PoolUsualVehicle.${k}`);
    }
    assert.equal(name(p.properties.capacity.$ref), 'VehicleCapacity');
    assert.equal(name(p.properties.fit.$ref), 'VehicleFit');
    assert.deepEqual(schemas.VehicleFit.required, ['ok', 'reasons']);
    const trip = op('listAvailableDrivers').parameters.find((x) => x.name === 'tripId');
    assert.ok(trip, 'listAvailableDrivers?tripId');
    assert.equal(trip.required, false);
    assert.match(trip.description, /fit/);
    // Параметры 0.1 — те же и в том же порядке.
    const before = source.paths['/api/v1/tenants/{tenantId}/fleet/driver-pool'].get.parameters;
    assert.deepEqual(op('listAvailableDrivers').parameters.slice(0, before.length), before);
  });

  it('запрос: vehicle { mode: home | host | host_or_home, hostVehicleId } — без брони до одобрения', () => {
    const v = schemas.DriverTransferCreate.properties.vehicle;
    assert.equal(name(v?.$ref), 'DriverTransferVehicleCreate');
    const c = schemas.DriverTransferVehicleCreate;
    assert.deepEqual(c.properties.mode.enum, ['home', 'host', 'host_or_home']);
    assert.deepEqual(c.required, ['mode']);
    assert.equal(name(c.properties.hostVehicleId.$ref), 'Id');
    assert.deepEqual(schemas.DriverTransferCreate.required, src.DriverTransferCreate.required);
    const d = op('requestDriverTransfer').description;
    assert.ok(d.startsWith(was('requestDriverTransfer')), 'текст 0.1');
    for (const w of [
      'W2.71',
      'vehicle_incompatible',
      'reservation_overlap',
      'vehicle.hostVehicleId',
      'vehicle.mode',
      'usual_vehicle',
      'No reservation is created before the approval',
      // Правила W2.51 и W2.57 на месте.
      'outside_free_window',
      'except the continuation of a started trip (D09)',
    ]) {
      assert.ok(d.includes(w), `requestDriverTransfer: ${w}`);
    }
  });

  it('DriverTransfer.vehicle: режим, машины, решение фирмы водителя, группа и срок выбора (1b, 1f)', () => {
    assert.equal(name(schemas.DriverTransfer.properties.vehicle?.$ref), 'DriverTransferVehicle');
    const v = schemas.DriverTransferVehicle;
    assert.deepEqual(v.required, ['mode']);
    assert.deepEqual(v.properties.homeDecision.enum, ['approved', 'declined']);
    for (const k of ['hostVehicle', 'homeVehicle']) {
      assert.equal(name(v.properties[k].$ref), 'TransferVehicle', k);
    }
    assert.equal(name(v.properties.offerGroupId.$ref), 'Id');
    assert.equal(name(v.properties.chooseUntil.$ref), 'Instant');
    const t = schemas.TransferVehicle;
    assert.deepEqual(t.required, ['vehicleId', 'displayName', 'registrationNumber', 'orgUnitId']);
    for (const k of [
      'reservationId',
      'reservationState',
      'chosenAt',
      'releasedAt',
      'releaseReason',
    ]) {
      assert.ok(t.properties[k], `TransferVehicle.${k}`);
    }
    assert.deepEqual(t.properties.reservationState.enum, schemas.Reservation.properties.state.enum);
  });

  it('решение: approve | approve_driver_only | reject (причина обязательна) | revoke | extend; одобрение — брони', () => {
    const d = schemas.DriverTransferDecision;
    assert.deepEqual(d.properties.decision.enum, [
      ...src.DriverTransferDecision.properties.decision.enum,
      'extend',
      'approve_driver_only',
    ]);
    assert.match(d.properties.comment.description, /reject/);
    assert.match(d.properties.comment.description, /422 validation_failed/);
    assert.deepEqual(d.required, src.DriverTransferDecision.required);
    const text = op('decideDriverTransfer').description;
    assert.ok(text.startsWith(was('decideDriverTransfer')), 'текст 0.1');
    for (const w of [
      'W2.71',
      'approve_driver_only',
      'homeDecision',
      'offerGroupId',
      'chooseUntil',
      'window.startsAt − 30 min',
      'confirmed',
      'Укажите причину отказа',
      'vehicle_incompatible',
      'reservation_overlap',
      'fleet.trip_without_vehicle',
      'fleet.reservation.held.v1',
      // W2.57 на месте.
      'extend',
      'temporary_driver',
    ]) {
      assert.ok(text.includes(w), `decideDriverTransfer: ${w}`);
    }
  });
});

describe('контракт 0.6.3-stage2 (W2.71): брони предложения и выбор', () => {
  it('Reservation: confirmed, группа предложения, кому, вид машины, срок, выбор и снятие', () => {
    const r = schemas.Reservation;
    assert.deepEqual(r.properties.state.enum, [
      ...src.Reservation.properties.state.enum,
      'confirmed',
    ]);
    for (const [k, t] of [
      ['offerGroupId', 'Id'],
      ['offeredToMemberId', 'Id'],
      ['chooseUntil', 'Instant'],
      ['chosenAt', 'Instant'],
      ['releasedAt', 'Instant'],
    ]) {
      assert.equal(name(r.properties[k]?.$ref), t, `Reservation.${k}`);
    }
    assert.deepEqual(r.properties.offerKind.enum, ['host', 'usual']);
    assert.deepEqual(r.properties.releaseReason.enum, [
      'chosen',
      'deadline',
      'manager',
      'transfer_ended',
    ]);
    assert.deepEqual(r.required, src.Reservation.required);
    assert.ok(r.description.startsWith(src.Reservation.description), 'текст 0.1');
    assert.match(r.description, /confirmed/);
    assert.match(r.description, /holdExpiresAt = chooseUntil/);
  });

  it('chooseReservation: POST …/reservations/{reservationId}/choose → { chosen, released[] }', () => {
    const o = ops.get('chooseReservation');
    assert.ok(o, 'chooseReservation');
    assert.equal(o.method, 'post');
    assert.equal(o.path, '/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}/choose');
    assert.equal(o.tag, 'Fleet');
    assert.deepEqual(o.op['x-permissions'], [
      'fleet.reservations.choose',
      'fleet.reservations.manage',
    ]);
    assert.equal(o.op['x-permissions-mode'], 'any');
    const ok = o.op.responses['200'].content['application/json'].schema;
    assert.equal(name(ok.$ref), 'ReservationChoice');
    const c = schemas.ReservationChoice;
    assert.deepEqual(c.required, ['chosen', 'released']);
    assert.equal(name(c.properties.chosen.$ref), 'Reservation');
    assert.equal(name(c.properties.released.items.$ref), 'Reservation');
    for (const s of ['403', '404', '409']) assert.ok(o.op.responses[s], `ответ ${s}`);
    const params = (o.op.parameters ?? []).map((p) => name(p.$ref) ?? p.name);
    assert.ok(params.includes('IdempotencyKey'), 'идемпотентна');
    assert.equal(o.op.requestBody, undefined);
    const d = o.op.description;
    for (const w of [
      'offer_closed',
      '404',
      'Idempotency-Key',
      'released',
      'chosen',
      'manager',
      'deadline',
      'fleet.reservation.confirmed.v1',
      'fleet.reservation.released.v1',
      'offerGroupId',
      'D-09 комплекта',
      'Сначала выберите машину.',
      'before window.startsAt',
    ]) {
      assert.ok(d.includes(w), `chooseReservation: ${w}`);
    }
  });

  it('прочие операции брони: временный водитель не бронирует (403), видит только предложенные машины', () => {
    const reserve = op('reserveVehicle').description;
    assert.ok(reserve.startsWith(was('reserveVehicle')), 'текст 0.1');
    assert.match(reserve, /403 forbidden_action/);
    const list = op('listVehicles').description;
    assert.ok(list.startsWith(was('listVehicles')), 'текст 0.1');
    assert.match(list, /offered/);
    const release = op('releaseReservation').description;
    assert.ok(release.startsWith(was('releaseReservation')), 'текст 0.1');
    assert.match(release, /confirmed/);
    assert.match(release, /manager/);
    const start = op('startTrip').description;
    assert.ok(start.startsWith(was('startTrip')), 'текст 0.1');
    assert.match(start, /held or confirmed/);
  });

  it('assignTripVehicle: alternativeVehicleId — свой водитель выбирает из двух (Q-W2.70-6), временному — confirmed', () => {
    const a = schemas.TripVehicleAssignment.properties.alternativeVehicleId;
    assert.equal(name(a?.$ref), 'Id');
    assert.match(a.description, /Q-W2\.70-6/);
    assert.deepEqual(schemas.TripVehicleAssignment.required, ['vehicleId']);
    assert.match(op('assignTripVehicle').description, /W2\.71/);
    assert.match(op('assignTripVehicle').description, /confirmed/);
  });

  it('«Требует решения»: fleet.vehicle_choice_pending и fleet.trip_without_vehicle', () => {
    const k = schemas.DecisionItem.properties.kind.description;
    assert.match(k, /fleet\.vehicle_choice_pending/);
    assert.match(k, /fleet\.trip_without_vehicle/);
    assert.match(k, /15 minutes before chooseUntil/);
  });
});

describe('контракт 0.6.3-stage2 (W2.71): экраны, аддитивность, примеры, журнал, миграция, версия', () => {
  const screens = readYaml(abs('api/openapi/screens.yaml')).screens;

  it('screens.yaml: S2-20 на пуле, запросе, «Сегодня», «Главной»; выбор — у водителя и логиста', () => {
    for (const k of ['logistics-pool', 'modal-driver-request', 'driver-today', 'home']) {
      assert.ok(screens[k].stories.includes('S2-20'), `${k}: S2-20`);
    }
    assert.ok(screens['driver-today'].operations.includes('chooseReservation'));
    assert.ok(screens['driver-today'].operations.includes('listReservations'));
    assert.ok(screens.home.operations.includes('chooseReservation'));
    assert.ok(screens.home.operations.includes('assignTripVehicle'));
    assert.ok(screens['modal-driver-request'].operations.includes('listVehicles'));
  });

  it('дельты W2.71: новое — add; перечисления — надмножество; описания — с текстом 0.1 в начале', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w271.map((d) => d.pointer));
    for (const p of [
      '/paths/~1api~1v1~1tenants~1{tenantId}~1fleet~1reservations~1{reservationId}~1choose',
      '/components/schemas/Reservation/properties/state/enum',
      '/components/schemas/Reservation/properties/offerGroupId',
      '/components/schemas/DriverTransferCreate/properties/vehicle',
      '/components/schemas/DriverTransfer/properties/vehicle',
      '/components/schemas/DriverAvailability/properties/usualVehicle',
      '/components/schemas/ReservationChoice',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    for (const d of w271.filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/enum') || d.pointer.endsWith('/parameters')) {
        assert.ok(
          before.every((v) => now.some((n) => JSON.stringify(n) === JSON.stringify(v))) &&
            now.length > before.length,
          `${d.pointer}: не надмножество`,
        );
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(
          typeof before === 'string' && now.startsWith(before) && now.length > before.length,
          `${d.pointer}: описание 0.1 не сохранено в начале`,
        );
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W2\.71/);
  });

  it('примеры валидны; сюжет S2-20: запрос с машиной, одобрение с бронями, выбор, повтор — 409', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    const get = (o, n) => {
      const e = examples.get(o)?.get(n);
      assert.ok(e, `${o}/${n}`);
      return e;
    };
    assert.ok(get('publishDriverToPool', 'usual_vehicle').usualVehicleId);
    const requested = get('requestDriverTransfer', 'vehicle');
    assert.equal(requested.vehicle.mode, 'host_or_home');
    assert.equal(requested.vehicle.offerGroupId, undefined, 'до одобрения броней нет');
    get('requestDriverTransfer', 'vehicle_incompatible');
    const approved = get('decideDriverTransfer', 'approved_with_vehicle');
    assert.equal(approved.vehicle.homeDecision, 'approved');
    assert.ok(approved.vehicle.offerGroupId);
    assert.equal(approved.vehicle.hostVehicle.reservationState, 'held');
    assert.equal(approved.vehicle.homeVehicle.reservationState, 'held');
    assert.equal(get('decideDriverTransfer', 'validation_failed').violations[0].field, 'comment');
    const chosen = get('chooseReservation', 'ok');
    assert.equal(chosen.chosen.state, 'confirmed');
    assert.equal(chosen.released.length, 1);
    assert.equal(chosen.released[0].releaseReason, 'chosen');
    assert.equal(chosen.chosen.offerGroupId, chosen.released[0].offerGroupId);
    assert.equal(get('chooseReservation', 'offer_closed').code, 'offer_closed');
    assert.equal(get('chooseReservation', 'not_found').code, 'not_found');
  });

  // В ветке — 0.6.3-stage2 и tenant 0019; влит после W4.02 и W4.06 (0.7.0-stage4, tenant 0020–0022): интегратор выдал
  // 0.7.1-stage4 и tenant 0023 (goose без WithAllowOutofOrder, api/README.md «Порядок вливания номеров ниже применённого»).
  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.7.1-stage4, миграция tenant 0023 выдана W2.71', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.7\.1-stage4 — W2\.71/m);
    assert.ok(
      log.indexOf('## 0.7.1-stage4') < log.indexOf('## 0.7.0-stage4'),
      'новый раздел — сверху',
    );
    assert.match(log, /D-35 комплекта/);
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 2, W2\.71 \(`0\.7\.1-stage4`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0023\s*\|\s*`0023_fleet_temporary_driver_vehicle_offer\.sql`[^|]*\|\s*W2\.71/,
    );
  });

  it('версия контракта — не ниже 0.7.1-stage4', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    const [minor, patch] = [Number(m[1]), Number(m[2])];
    assert.ok(Number(m[3]) >= 4 && (minor > 7 || (minor === 7 && patch >= 1)), doc.info.version);
  });
});
