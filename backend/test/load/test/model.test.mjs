// Модель нагрузочного профиля (W0.16): profile.json, операции OpenAPI 0.1, тела, опции k6.
// Источники: design/docs/v0.1/ortus-openapi-v0.1.yaml, 01-technical-spec.md (NFR-03, PLAT-09),
// design/docs/15-quality-security.md (Load), docs/plan/v2/ws/W0.16.md §4, §6.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as model from '../lib/model.js';
import {
  OPS,
  STAGE_NAMES,
  buildOptions,
  buildThresholds,
  datasetQuery,
  deriveRates,
  expenseReview,
  idempotencyKey,
  inspectionCreate,
  isoInstant,
  paramValues,
  pathFor,
  requestsPerManagerIteration,
  requestsPerShift,
  reservationCreate,
  tripExpenseCreate,
  tripReturn,
  tripReview,
  tripStart,
  uploadCreate,
} from '../lib/model.js';

const profile = JSON.parse(readFileSync(new URL('../profile.json', import.meta.url), 'utf8'));
const OPENAPI_URL = new URL(
  '../../../../design/docs/v0.1/ortus-openapi-v0.1.yaml',
  import.meta.url,
);

/**
 * Операции из текста OpenAPI без YAML-парсера: путь «  /api/…:», метод «    get:»,
 * «      operationId: …» и ссылки на параметры IdempotencyKey / IfMatch внутри операции.
 */
function openApiOperations(yaml) {
  const ops = new Map();
  let path = null;
  let current = null;
  for (const line of yaml.split(/\r?\n/)) {
    const p = line.match(/^ {2}(\/\S+):\s*$/);
    if (p) {
      path = p[1];
      current = null;
      continue;
    }
    const m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (m && path) {
      current = { method: m[1].toUpperCase(), path, idempotent: false, ifMatch: false };
      continue;
    }
    if (/^ {0,4}\S/.test(line)) {
      current = null; // параметры пути, следующий раздел
      if (/^\S/.test(line)) path = null;
      continue;
    }
    if (!current) continue;
    const id = line.match(/^ {6}operationId:\s*(\w+)\s*$/);
    if (id) ops.set(id[1], current);
    if (/#\/components\/parameters\/IdempotencyKey'/.test(line)) current.idempotent = true;
    if (/#\/components\/parameters\/IfMatch'/.test(line)) current.ifMatch = true;
  }
  return ops;
}
const UUID = '10000000-0000-4000-8000-000000000001';
const UUID2 = '40000000-0000-4000-8000-000000000004';
const SHA = 'a'.repeat(64);

const PARAM_KEYS = [
  'vehicles',
  'drivers',
  'managers',
  'owners',
  'shiftsPerVehiclePerMonth',
  'peakDayUtilization',
  'departureWindowMinutes',
  'departureWindowShare',
  'driverSessionMinutes',
  'departurePhotos',
  'returnPhotos',
  'expensesPerShift',
  'receiptsPerExpense',
  'photoSizeBytes',
  'tripPollsPerShift',
  'driverThinkSeconds',
  'managerThinkSeconds',
  'listLimit',
  'historyMonths',
  'tenantsOnStand',
  'noisyExportsPerMinute',
  'noisyExportPages',
  'noisyExportPageSize',
  'noisyUploadsPerMinute',
];

describe('profile.json — параметры D-08 (заглушки с допущениями)', () => {
  it('ссылается на решение D-08 и помечен черновиком, пока владелец продукта не ответил', () => {
    assert.equal(profile.decision, 'D-08');
    assert.match(profile.status, /draft/);
  });

  it('содержит все параметры профиля пилота: машины, смены, фото, одновременные пользователи', () => {
    assert.deepEqual(Object.keys(profile.params).sort(), [...PARAM_KEYS].sort());
  });

  for (const key of PARAM_KEYS) {
    it(`параметр ${key}: положительное число, единица, источник, статус`, () => {
      const p = profile.params[key];
      assert.equal(typeof p.value, 'number');
      assert.ok(p.value > 0, `${key} > 0`);
      assert.ok(p.unit && typeof p.unit === 'string');
      assert.ok(p.source && typeof p.source === 'string');
      assert.ok(['assumption', 'source'].includes(p.status), `${key}.status`);
      if (p.status === 'assumption') assert.match(p.assumption, /^A-\d{2}$/);
    });
  }

  it('номера допущений A-NN уникальны', () => {
    const ids = Object.values(profile.params)
      .filter((p) => p.status === 'assumption')
      .map((p) => p.assumption);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('PLAT-09: 100 машин × 20 смен × 12 фото × 1,2 МБ взяты из источника', () => {
    assert.equal(profile.params.vehicles.value, 100);
    assert.equal(profile.params.shiftsPerVehiclePerMonth.value, 20);
    assert.equal(profile.params.photoSizeBytes.value, 1_200_000);
    for (const k of ['vehicles', 'shiftsPerVehiclePerMonth', 'photoSizeBytes']) {
      assert.equal(profile.params[k].status, 'source');
      assert.match(profile.params[k].source, /PLAT-09/);
    }
  });

  it('цели NFR-03 / план 27 шаг 3.1: p95 чтения ≤ 500 мс, записи ≤ 800 мс', () => {
    assert.equal(profile.targets.readP95Ms, 500);
    assert.equal(profile.targets.writeP95Ms, 800);
    assert.ok(profile.targets.errorRate > 0 && profile.targets.errorRate < 0.05);
    assert.ok(profile.targets.checksRate > 0.95 && profile.targets.checksRate <= 1);
  });

  it('стадии smoke, pilot, stress', () => {
    assert.deepEqual(STAGE_NAMES, ['smoke', 'pilot', 'stress']);
    assert.deepEqual(Object.keys(profile.stages).sort(), [...STAGE_NAMES].sort());
    assert.equal(profile.stages.pilot.scale, 1);
    assert.ok(profile.stages.stress.scale > 1);
  });

  it('paramValues: значения параметров с переопределениями стадии', () => {
    const base = paramValues(profile, 'pilot');
    assert.equal(base.vehicles, 100);
    const smoke = paramValues(profile, 'smoke');
    assert.ok(smoke.photoSizeBytes < base.photoSizeBytes, 'smoke шлёт маленькие фото');
    assert.equal(smoke.driverThinkSeconds, 0);
    assert.throws(() => paramValues(profile, 'nope'), /стади/);
  });
});

// Метод, путь и заголовки — дословно из ortus-openapi-v0.1.yaml.
const EXPECTED_OPS = {
  getMyContext: ['GET', '/api/v1/me/context', 'read', false, false],
  listVehicles: ['GET', '/api/v1/tenants/{tenantId}/fleet/vehicles', 'read', false, false],
  listReservations: ['GET', '/api/v1/tenants/{tenantId}/fleet/reservations', 'read', false, false],
  reserveVehicle: ['POST', '/api/v1/tenants/{tenantId}/fleet/reservations', 'write', true, false],
  getInspectionChecklist: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/inspection-checklist',
    'read',
    false,
    false,
  ],
  initiateUpload: ['POST', '/api/v1/tenants/{tenantId}/files/uploads', 'write', true, false],
  completeUpload: [
    'POST',
    '/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete',
    'write',
    true,
    false,
  ],
  submitInspection: ['POST', '/api/v1/tenants/{tenantId}/fleet/inspections', 'write', true, false],
  listInspections: ['GET', '/api/v1/tenants/{tenantId}/fleet/inspections', 'read', false, false],
  startTrip: ['POST', '/api/v1/tenants/{tenantId}/fleet/trips', 'write', true, false],
  listTrips: ['GET', '/api/v1/tenants/{tenantId}/fleet/trips', 'read', false, false],
  getTrip: ['GET', '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}', 'read', false, false],
  returnTrip: ['PATCH', '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}', 'write', true, true],
  reviewTrip: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/review',
    'write',
    true,
    true,
  ],
  listTripExpenses: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses',
    'read',
    false,
    false,
  ],
  createTripExpense: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses',
    'write',
    true,
    false,
  ],
  getTripExpense: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses/{expenseId}',
    'read',
    false,
    false,
  ],
  reviewTripExpense: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses/{expenseId}/review',
    'write',
    true,
    true,
  ],
  listDatasets: ['GET', '/api/v1/tenants/{tenantId}/datasets', 'read', false, false],
  queryDataset: [
    'POST',
    '/api/v1/tenants/{tenantId}/datasets/{datasetId}/query',
    'read',
    false,
    false,
  ],
};

describe('OPS — операции OpenAPI 0.1, которые трогает нагрузка', () => {
  it('ровно 20 операций', () => {
    assert.deepEqual(Object.keys(OPS).sort(), Object.keys(EXPECTED_OPS).sort());
  });

  for (const [op, [method, path, kind, idempotent, ifMatch]] of Object.entries(EXPECTED_OPS)) {
    it(`${op}: ${method} ${path}, ${kind}${idempotent ? ', Idempotency-Key' : ''}${ifMatch ? ', If-Match' : ''}`, () => {
      assert.deepEqual(OPS[op], { method, path, kind, idempotent, ifMatch });
    });
  }

  it('queryDataset — POST только для чтения, попадает в порог чтения', () => {
    assert.equal(OPS.queryDataset.method, 'POST');
    assert.equal(OPS.queryDataset.kind, 'read');
  });

  // Сверка с самим контрактом, а не с копией: правка ortus-openapi-v0.1.yaml роняет тест.
  describe('совпадает с ortus-openapi-v0.1.yaml', () => {
    const contract = openApiOperations(readFileSync(OPENAPI_URL, 'utf8'));

    it('контракт разобран: операций больше, чем трогает нагрузка', () => {
      assert.ok(contract.size > Object.keys(OPS).length, `${contract.size} операций`);
    });

    for (const [opId, spec] of Object.entries(OPS)) {
      it(`${opId}: метод, путь, Idempotency-Key и If-Match как в контракте`, () => {
        const c = contract.get(opId);
        assert.ok(c, `${opId} нет в контракте`);
        assert.deepEqual(
          {
            method: spec.method,
            path: spec.path,
            idempotent: spec.idempotent,
            ifMatch: spec.ifMatch,
          },
          c,
        );
      });
    }
  });
});

describe('devLoginAllowed — dev-вход только local и compose (PD-18, Q-102, ADR-0004)', () => {
  for (const url of [
    'http://127.0.0.1:8108',
    'http://localhost:5201',
    'http://[::1]:8108',
    'http://host.docker.internal:8108',
    'http://api:8080',
    'http://bff/',
  ]) {
    it(`разрешён: ${url}`, () => {
      assert.equal(model.devLoginAllowed(url), true);
    });
  }

  for (const url of [
    'https://stage.example',
    'https://crm.ortus.example/api',
    'http://10.0.0.5:8080',
    'http://192.168.1.20',
    'not a url',
  ]) {
    it(`запрещён: ${url} — вход на stage решает интегратор / техлид`, () => {
      assert.equal(model.devLoginAllowed(url), false);
    });
  }
});

describe('pathFor', () => {
  it('подставляет параметры пути', () => {
    assert.equal(
      pathFor('getTrip', { tenantId: UUID, tripId: UUID2 }),
      `/api/v1/tenants/${UUID}/fleet/trips/${UUID2}`,
    );
  });

  it('кодирует значения и добавляет query-строку', () => {
    assert.equal(
      pathFor(
        'getInspectionChecklist',
        { tenantId: 't 1' },
        { vehicleId: UUID, kind: 'departure' },
      ),
      `/api/v1/tenants/t%201/fleet/inspection-checklist?vehicleId=${UUID}&kind=departure`,
    );
    assert.equal(
      pathFor('listTrips', { tenantId: UUID }, { limit: 50, cursor: undefined }),
      `/api/v1/tenants/${UUID}/fleet/trips?limit=50`,
    );
  });

  it('бросает ошибку при пропущенном параметре и неизвестной операции', () => {
    assert.throws(() => pathFor('getTrip', { tenantId: UUID }), /tripId/);
    assert.throws(() => pathFor('nope', {}), /nope/);
  });
});

describe('idempotencyKey — Idempotency-Key по OpenAPI (16–128, [A-Za-z0-9._:-])', () => {
  const parts = { run: 'r1', scenario: 'driverShift', vu: 3, iter: 7, step: 'startTrip' };

  it('проходит схему заголовка', () => {
    const key = idempotencyKey(parts);
    assert.match(key, /^[A-Za-z0-9._:-]{16,128}$/);
  });

  it('детерминирован и уникален по (прогон, сценарий, VU, итерация, шаг)', () => {
    assert.equal(idempotencyKey(parts), idempotencyKey({ ...parts }));
    const keys = new Set([
      idempotencyKey(parts),
      idempotencyKey({ ...parts, run: 'r2' }),
      idempotencyKey({ ...parts, scenario: 'managerShift' }),
      idempotencyKey({ ...parts, vu: 4 }),
      idempotencyKey({ ...parts, iter: 8 }),
      idempotencyKey({ ...parts, step: 'returnTrip' }),
    ]);
    assert.equal(keys.size, 6);
  });

  it('недопустимые символы заменяются, длина ≤ 128', () => {
    const key = idempotencyKey({ ...parts, step: 'фото #1/' + 'x'.repeat(200) });
    assert.match(key, /^[A-Za-z0-9._:-]{16,128}$/);
  });
});

describe('тела запросов — обязательные поля схем OpenAPI 0.1', () => {
  const at = new Date(Date.UTC(2026, 9, 5, 6, 0, 0));

  it('isoInstant — UTC с суффиксом Z', () => {
    assert.equal(isoInstant(at), '2026-10-05T06:00:00Z');
  });

  it('ReservationCreate: vehicleId, driverMemberId, window{startsAt, endsAt, timeZone}', () => {
    const body = reservationCreate({
      vehicleId: UUID,
      driverMemberId: UUID2,
      startsAt: at,
      hours: 9,
    });
    assert.deepEqual(body, {
      vehicleId: UUID,
      driverMemberId: UUID2,
      window: {
        startsAt: '2026-10-05T06:00:00Z',
        endsAt: '2026-10-05T15:00:00Z',
        timeZone: 'Europe/Moscow',
      },
    });
  });

  it('UploadCreate: fileName, contentType, sizeBytes, sha256, purpose, owner', () => {
    const body = uploadCreate({
      fileName: 'front.jpg',
      sizeBytes: 1024,
      sha256: SHA,
      purpose: 'inspection',
      owner: { entityType: 'reservation', entityId: UUID },
    });
    assert.deepEqual(body, {
      fileName: 'front.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: SHA,
      purpose: 'inspection',
      owner: { moduleKey: 'fleet', entityType: 'reservation', entityId: UUID },
    });
    assert.throws(
      () =>
        uploadCreate({
          fileName: 'x',
          sizeBytes: 1,
          sha256: 'bad',
          purpose: 'inspection',
          owner: { entityType: 'trip', entityId: UUID },
        }),
      /sha256/,
    );
    assert.throws(
      () =>
        uploadCreate({
          fileName: 'x',
          sizeBytes: 1,
          sha256: SHA,
          purpose: 'selfie',
          owner: { entityType: 'trip', entityId: UUID },
        }),
      /purpose/,
    );
  });

  it('InspectionCreate (выезд): чек-лист целиком pass, фото по ролям, reservationId', () => {
    const checklist = {
      versionId: UUID,
      kind: 'departure',
      items: [{ key: 'tires' }, { key: 'lights' }],
      requiredPhotoRoles: ['front', 'rear'],
    };
    const body = inspectionCreate({
      checklist,
      vehicleId: UUID2,
      reservationId: UUID,
      odometerKm: 120345,
      fuelPercent: 80,
      photos: [
        { role: 'front', fileId: UUID },
        { role: 'rear', fileId: UUID2 },
      ],
      capturedAt: at,
    });
    assert.deepEqual(body, {
      checklistVersionId: UUID,
      vehicleId: UUID2,
      kind: 'departure',
      reservationId: UUID,
      odometerKm: '120345',
      fuelPercent: 80,
      checks: [
        { key: 'tires', result: 'pass' },
        { key: 'lights', result: 'pass' },
      ],
      photos: [
        { role: 'front', fileId: UUID, capturedAt: '2026-10-05T06:00:00Z' },
        { role: 'rear', fileId: UUID2, capturedAt: '2026-10-05T06:00:00Z' },
      ],
      capturedAt: '2026-10-05T06:00:00Z',
    });
  });

  it('InspectionCreate (возврат) требует tripId, выезд — reservationId', () => {
    const checklist = {
      versionId: UUID,
      kind: 'return',
      items: [{ key: 'k' }],
      requiredPhotoRoles: ['front'],
    };
    const common = {
      checklist,
      vehicleId: UUID,
      odometerKm: 1,
      fuelPercent: 50,
      photos: [{ role: 'front', fileId: UUID }],
      capturedAt: at,
    };
    assert.equal(inspectionCreate({ ...common, tripId: UUID2 }).tripId, UUID2);
    assert.equal(inspectionCreate({ ...common, tripId: UUID2 }).kind, 'return');
    assert.throws(() => inspectionCreate(common), /tripId/);
    assert.throws(
      () => inspectionCreate({ ...common, checklist: { ...checklist, kind: 'departure' } }),
      /reservationId/,
    );
  });

  it('TripStart, TripReturn, TripReview, ExpenseReview', () => {
    assert.deepEqual(tripStart({ reservationId: UUID, departureInspectionId: UUID2 }), {
      reservationId: UUID,
      departureInspectionId: UUID2,
    });
    assert.deepEqual(tripReturn({ returnInspectionId: UUID2 }), {
      action: 'return',
      returnInspectionId: UUID2,
    });
    assert.deepEqual(tripReview(), { decision: 'approve' });
    assert.deepEqual(expenseReview(), { decision: 'approve' });
  });

  it('TripExpenseCreate: kind из D-12, Money в копейках целым, Quantity строкой', () => {
    const body = tripExpenseCreate({
      kind: 'fuel',
      occurredAt: at,
      amountMinor: 350000,
      receiptFileIds: [UUID],
      quantityLitres: 40,
    });
    assert.deepEqual(body, {
      kind: 'fuel',
      occurredAt: '2026-10-05T06:00:00Z',
      amount: { amountMinor: 350000, currency: 'RUB' },
      quantity: '40',
      receiptFileIds: [UUID],
    });
    assert.throws(
      () => tripExpenseCreate({ kind: 'food', occurredAt: at, amountMinor: 1, receiptFileIds: [] }),
      /kind/,
    );
    assert.throws(
      () =>
        tripExpenseCreate({ kind: 'wash', occurredAt: at, amountMinor: 1.5, receiptFileIds: [] }),
      /amountMinor/,
    );
  });

  it('DatasetQuery: select (≤ 100), filters, sort, limit (≤ 200), cursor по желанию', () => {
    assert.deepEqual(datasetQuery({ select: ['a', 'b'], limit: 200 }), {
      select: ['a', 'b'],
      filters: [],
      sort: [],
      limit: 200,
    });
    assert.equal(datasetQuery({ select: ['a'], limit: 10, cursor: 'c2' }).cursor, 'c2');
    const many = Array.from({ length: 150 }, (_, i) => `f${i}`);
    assert.equal(datasetQuery({ select: many, limit: 500 }).select.length, 100);
    assert.equal(datasetQuery({ select: many, limit: 500 }).limit, 200);
  });
});

describe('deriveRates — производные величины профиля', () => {
  const r = deriveRates(profile, 'pilot');
  const v = paramValues(profile, 'pilot');

  it('смены в минуту пика = машины × загрузка дня × доля окна / минуты окна × масштаб', () => {
    const expected =
      (v.vehicles * v.peakDayUtilization * v.departureWindowShare) / v.departureWindowMinutes;
    assert.equal(r.shiftsPeakDay, v.vehicles * v.peakDayUtilization);
    assert.ok(Math.abs(r.shiftsPerMinutePeak - expected) < 1e-9);
    const stress = deriveRates(profile, 'stress');
    assert.ok(Math.abs(stress.shiftsPerMinutePeak - expected * profile.stages.stress.scale) < 1e-9);
  });

  it('PLAT-09: 12 фото на смену и ≈ 28,8 ГБ новых фото в месяц', () => {
    assert.equal(r.photosPerShift, 12);
    assert.equal(r.photoGBPerMonth, 28.8);
  });

  it('одновременные пользователи пика = водители в приложении + менеджеры и владельцы × масштаб', () => {
    assert.equal(
      r.concurrentUsersPeak,
      Math.ceil(r.shiftsPerMinutePeak * v.driverSessionMinutes) + v.managers + v.owners,
    );
    // stress: менеджеров тоже ×5 (managerVus = 40), как их подаёт сценарий managerShift.
    const stress = deriveRates(profile, 'stress');
    assert.equal(
      stress.concurrentUsersPeak,
      Math.ceil(stress.shiftsPerMinutePeak * v.driverSessionMinutes) + stress.managerVus,
    );
    assert.equal(stress.concurrentUsersPeak, 80);
  });

  it('объём истории: рейсы, осмотры, расходы, файлы', () => {
    const trips = v.vehicles * v.shiftsPerVehiclePerMonth * v.historyMonths;
    assert.equal(r.historyTrips, trips);
    assert.equal(r.historyInspections, trips * 2);
    assert.equal(r.historyExpenses, trips * v.expensesPerShift);
    assert.equal(r.historyFiles, trips * r.photosPerShift);
  });

  it('запросы в секунду пилота: водители и менеджеры (без передачи файлов)', () => {
    const shift = requestsPerShift(profile, 'pilot');
    const mgr = requestsPerManagerIteration(profile, 'pilot', { review: false });
    assert.ok(
      Math.abs(r.driverApiRps - (r.shiftsPerMinutePeak * (shift.read + shift.write)) / 60) < 1e-9,
    );
    assert.ok(
      Math.abs(
        r.managerApiRps -
          ((v.managers + v.owners) * (mgr.read + mgr.write)) / v.managerThinkSeconds,
      ) < 1e-9,
    );
  });

  it('шумный тенант: строк выгрузки в минуту и байт фото в минуту', () => {
    assert.equal(
      r.noisyExportRowsPerMinute,
      v.noisyExportsPerMinute * v.noisyExportPages * v.noisyExportPageSize,
    );
    assert.equal(r.noisyUploadMBPerMinute, (v.noisyUploadsPerMinute * v.photoSizeBytes) / 1e6);
  });
});

describe('requestsPerShift / requestsPerManagerIteration — состав сценариев', () => {
  it('смена водителя: 1 вход, чтения, записи, передачи файлов', () => {
    const s = requestsPerShift(profile, 'pilot');
    const v = paramValues(profile, 'pilot');
    const photos = v.departurePhotos + v.returnPhotos + v.expensesPerShift * v.receiptsPerExpense;
    assert.equal(s.auth, 1);
    assert.equal(s.transfer, photos);
    assert.deepEqual(s.byOp, {
      getMyContext: 1,
      listReservations: 1,
      listVehicles: 1,
      reserveVehicle: 1,
      getInspectionChecklist: 2,
      initiateUpload: photos,
      completeUpload: photos,
      submitInspection: 2,
      startTrip: 1,
      getTrip: v.tripPollsPerShift + 1,
      createTripExpense: v.expensesPerShift,
      returnTrip: 1,
    });
    const reads = 1 + 1 + 1 + 2 + v.tripPollsPerShift + 1;
    assert.equal(s.read, reads);
    assert.equal(s.write, 1 + 2 * photos + 2 + 1 + v.expensesPerShift + 1);
  });

  it('итерация менеджера: 4 списка; при приёмке — рейс, расходы, решения', () => {
    const v = paramValues(profile, 'pilot');
    const plain = requestsPerManagerIteration(profile, 'pilot', { review: false });
    assert.deepEqual(plain.byOp, {
      listTrips: 1,
      listVehicles: 1,
      listReservations: 1,
      listInspections: 1,
    });
    const review = requestsPerManagerIteration(profile, 'pilot', { review: true });
    assert.deepEqual(review.byOp, {
      listTrips: 1,
      listVehicles: 1,
      listReservations: 1,
      listInspections: 1,
      getTrip: 2,
      listTripExpenses: 1,
      getTripExpense: v.expensesPerShift,
      reviewTripExpense: v.expensesPerShift,
      reviewTrip: 1,
    });
    assert.equal(review.write, v.expensesPerShift + 1);
  });
});

describe('buildThresholds — пороги только для пилотного тенанта', () => {
  const t = buildThresholds(profile);

  it('p95 чтения < 500, записи < 800; ошибки и проверки', () => {
    assert.deepEqual(t, {
      'http_req_duration{tenant:pilot,kind:read}': ['p(95)<500'],
      'http_req_duration{tenant:pilot,kind:write}': ['p(95)<800'],
      'http_req_failed{tenant:pilot}': [`rate<${profile.targets.errorRate}`],
      'checks{tenant:pilot}': [`rate>${profile.targets.checksRate}`],
    });
  });

  it('передача файлов, вход и шумный тенант в пороги не входят', () => {
    for (const key of Object.keys(t)) {
      assert.doesNotMatch(key, /transfer|auth|noisy/);
    }
  });
});

describe('buildVolumeThresholds — минимальный объём поданной нагрузки (допущение A-24)', () => {
  const FLOWS = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];

  it('метрики flow_completed / flow_aborted с тегом flow; доля минимального объёма в targets', () => {
    assert.equal(model.FLOW_COMPLETED, 'flow_completed');
    assert.equal(model.FLOW_ABORTED, 'flow_aborted');
    assert.equal(profile.targets.minVolumeShare, 0.9);
  });

  it('smoke: каждая итерация каждого сценария обязана завершиться', () => {
    const n = profile.stages.smoke.iterations;
    assert.deepEqual(
      model.buildVolumeThresholds(profile, 'smoke'),
      Object.fromEntries(FLOWS.map((f) => [`flow_completed{flow:${f}}`, [`count>=${n}`]])),
    );
  });

  // Плановый объём × 0,9 (вниз): смены = rate driverShift (31 и 157 в час) × 0,5 ч; менеджеры = VU × 1800 с /
  // (20 с паузы + 4 списка × 0,2 с); выгрузки 6 × 30; фото 120 × 30.
  const EXPECTED_MIN = {
    pilot: { driverShift: 13, managerShift: 622, noisyExport: 162, noisyUploads: 3240 },
    stress: { driverShift: 70, managerShift: 3114, noisyExport: 162, noisyUploads: 3240 },
  };
  for (const [stage, mins] of Object.entries(EXPECTED_MIN)) {
    it(`${stage}: ${Object.entries(mins)
      .map(([f, n]) => `${f} ≥ ${n}`)
      .join(', ')}`, () => {
      assert.deepEqual(
        model.buildVolumeThresholds(profile, stage),
        Object.fromEntries(FLOWS.map((f) => [`flow_completed{flow:${f}}`, [`count>=${mins[f]}`]])),
      );
    });
  }

  for (const stage of STAGE_NAMES) {
    it(`${stage}: options содержит пороги целей и пороги объёма`, () => {
      assert.deepEqual(buildOptions(profile, stage).thresholds, {
        ...buildThresholds(profile),
        ...model.buildVolumeThresholds(profile, stage),
      });
    });
  }

  for (const stage of ['pilot', 'stress']) {
    it(`${stage}: gracefulStop смены водителя длиннее самой смены — начатые смены доигрываются`, () => {
      const v = paramValues(profile, stage);
      const s = requestsPerShift(profile, stage);
      const minSeconds = (s.read + s.write + s.transfer) * v.driverThinkSeconds;
      const graceful = buildOptions(profile, stage).scenarios.driverShift.gracefulStop;
      assert.match(graceful, /^\d+s$/);
      assert.ok(parseInt(graceful, 10) > minSeconds, `${graceful} > ${minSeconds}s`);
    });
  }
});

describe('buildOptions — сценарии k6 по стадиям', () => {
  const NAMES = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];

  it('неизвестная стадия → ошибка', () => {
    assert.throws(() => buildOptions(profile, 'huge'), /стади/);
  });

  it('smoke: несколько итераций каждого сценария на 1 VU (ловит потерю сессии между итерациями)', () => {
    const iterations = profile.stages.smoke.iterations;
    assert.ok(Number.isInteger(iterations) && iterations >= 2, 'smoke.iterations ≥ 2');
    const o = buildOptions(profile, 'smoke');
    assert.deepEqual(Object.keys(o.scenarios).sort(), [...NAMES].sort());
    for (const name of NAMES) {
      const s = o.scenarios[name];
      assert.equal(s.executor, 'per-vu-iterations');
      assert.equal(s.vus, 1);
      assert.equal(s.iterations, iterations);
      assert.equal(s.exec, name);
    }
    for (const [key, value] of Object.entries(buildThresholds(profile))) {
      assert.deepEqual(o.thresholds[key], value);
    }
  });

  for (const stage of STAGE_NAMES) {
    it(`${stage}: cookie jar VU не сбрасывается между итерациями (вход один раз на VU)`, () => {
      // k6 по умолчанию чистит jar перед каждой итерацией: managerShift и шумный тенант
      // со второй итерации получали бы 401.
      assert.equal(buildOptions(profile, stage).noCookiesReset, true);
    });
  }

  for (const stage of ['pilot', 'stress']) {
    it(`${stage}: открытая модель для смен и шума, закрытая для менеджеров`, () => {
      const o = buildOptions(profile, stage);
      const v = paramValues(profile, stage);
      const r = deriveRates(profile, stage);
      const scale = profile.stages[stage].scale;
      const duration = `${profile.stages[stage].durationMinutes}m`;

      const d = o.scenarios.driverShift;
      assert.equal(d.executor, 'constant-arrival-rate');
      assert.equal(d.timeUnit, '1h');
      assert.equal(d.rate, Math.max(1, Math.round(r.shiftsPerMinutePeak * 60)));
      assert.equal(d.duration, duration);
      assert.ok(d.preAllocatedVUs >= 1 && d.maxVUs >= d.preAllocatedVUs);

      const m = o.scenarios.managerShift;
      assert.equal(m.executor, 'constant-vus');
      assert.equal(m.vus, (v.managers + v.owners) * scale);
      assert.equal(m.duration, duration);

      const e = o.scenarios.noisyExport;
      assert.equal(e.executor, 'constant-arrival-rate');
      assert.equal(e.rate, v.noisyExportsPerMinute);
      assert.equal(e.timeUnit, '1m');

      const u = o.scenarios.noisyUploads;
      assert.equal(u.rate, v.noisyUploadsPerMinute);
      assert.equal(u.timeUnit, '1m');
    });
  }

  it('теги тенанта ставятся на уровне сценария', () => {
    const o = buildOptions(profile, 'pilot');
    assert.deepEqual(o.scenarios.driverShift.tags, { tenant: 'pilot' });
    assert.deepEqual(o.scenarios.managerShift.tags, { tenant: 'pilot' });
    assert.deepEqual(o.scenarios.noisyExport.tags, { tenant: 'noisy' });
    assert.deepEqual(o.scenarios.noisyUploads.tags, { tenant: 'noisy' });
  });

  it('p95 и p99 в сводке', () => {
    const o = buildOptions(profile, 'pilot');
    assert.ok(o.summaryTrendStats.includes('p(95)'));
    assert.ok(o.summaryTrendStats.includes('p(99)'));
  });
});
