// Модель нагрузочного профиля (W0.16 → W2.47): profile.json по ответу D-08, операции контракта 0.5.1-stage2,
// тела запросов, закрытая модель водителей с темпом, опции k6.
// Источники: docs/plan/v2/po-answers-2026-10-17.md (D-08), docs/adr/0009-pilot-load-profile.md,
// api/dist/ortus.bundle.yaml, backend/internal/modules/fleet/expenses/rules.go (шесть категорий, один чек),
// docs/plan/v2/ws/W2.47.md §10.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as model from '../lib/model.js';
import {
  EXPENSE_KINDS,
  OPS,
  STAGE_NAMES,
  buildOptions,
  buildThresholds,
  buildVolumeThresholds,
  deriveRates,
  driverPacing,
  expenseFor,
  fitsCargo,
  idempotencyKey,
  inspectionCreate,
  isoInstant,
  paramValues,
  pathFor,
  personaIndex,
  personasFor,
  pickTrip,
  plannedIterations,
  planningFor,
  requestsForPlanning,
  requestsPerManagerIteration,
  requestsPerShift,
  reservationCreate,
  tripExpenseCreate,
  tripPlanCreate,
  tripReturn,
  tripWindows,
  tripReview,
  tripStart,
  tripsPerDriver,
  uploadCreate,
} from '../lib/model.js';

const profile = JSON.parse(readFileSync(new URL('../profile.json', import.meta.url), 'utf8'));
const BUNDLE_URL = new URL('../../../../api/dist/ortus.bundle.yaml', import.meta.url);

/**
 * Операции из текста бандла без YAML-парсера: путь «  /api/…:», метод «    get:»,
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
    if (/#\/components\/parameters\/IdempotencyKey["']/.test(line)) current.idempotent = true;
    if (/#\/components\/parameters\/IfMatch["']/.test(line)) current.ifMatch = true;
  }
  return ops;
}

const UUID = '10000000-0000-4000-8000-000000000001';
const UUID2 = '40000000-0000-4000-8000-000000000004';
const SHA = 'a'.repeat(64);

// Ответ D-08 (17.10.2026) и правила сервера этапа 2 — источники; остальное — допущения A-NN.
const SOURCES = {
  vehicles: 60,
  employees: 80,
  drivers: 60,
  officeUsers: 15,
  peakConcurrentUsers: 60,
  peakUploadsPerHour: 600,
  shiftsPerDay: 60,
  departurePhotos: 5,
  returnPhotos: 5,
  receiptsPerExpense: 1,
  photoSizeBytes: 420_000,
  listLimit: 50,
  noisyExportPageSize: 200,
};
const ASSUMPTIONS = {
  daysPerMonth: [30, 'A-04'],
  expensesPerShift: [1, 'A-09'],
  tripPollsPerShift: [6, 'A-11'],
  driverThinkSeconds: [20, 'A-12'],
  managerThinkSeconds: [20, 'A-13'],
  historyMonths: [12, 'A-14'],
  tenantsOnStand: [10, 'A-15'],
  noisyExportsPerMinute: [6, 'A-16'],
  noisyExportPages: [20, 'A-17'],
  noisyUploadsPerMinute: [100, 'A-18'],
};
const PARAM_KEYS = [...Object.keys(SOURCES), ...Object.keys(ASSUMPTIONS)];

describe('profile.json — параметры D-08 (ответ владельца 17.10)', () => {
  it('версия 0.2.0, решение D-08 принято — профиль больше не черновик', () => {
    assert.equal(profile.version, '0.2.0');
    assert.equal(profile.decision, 'D-08');
    assert.match(profile.status, /^accepted/);
    assert.doesNotMatch(profile.status, /draft|pending/);
  });

  it('содержит ровно параметры профиля: машины, люди, пик, фото, история, шумный сосед', () => {
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

  for (const [key, value] of Object.entries(SOURCES)) {
    it(`${key} = ${value} — из источника`, () => {
      assert.equal(profile.params[key].value, value);
      assert.equal(profile.params[key].status, 'source');
    });
  }

  for (const [key, [value, id]] of Object.entries(ASSUMPTIONS)) {
    it(`${key} = ${value} — допущение ${id}`, () => {
      assert.equal(profile.params[key].value, value);
      assert.equal(profile.params[key].status, 'assumption');
      assert.equal(profile.params[key].assumption, id);
    });
  }

  it('числа ответа D-08 ссылаются на D-08', () => {
    for (const k of [
      'vehicles',
      'employees',
      'drivers',
      'officeUsers',
      'peakConcurrentUsers',
      'peakUploadsPerHour',
      'shiftsPerDay',
      'photoSizeBytes',
    ]) {
      assert.match(profile.params[k].source, /D-08/, k);
    }
  });

  it('номера допущений A-NN уникальны', () => {
    const ids = Object.values(profile.params)
      .filter((p) => p.status === 'assumption')
      .map((p) => p.assumption);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('цели NFR-03 / план 27 шаг 3.1: p95 чтения ≤ 500 мс, записи ≤ 800 мс', () => {
    assert.equal(profile.targets.readP95Ms, 500);
    assert.equal(profile.targets.writeP95Ms, 800);
    assert.ok(profile.targets.errorRate > 0 && profile.targets.errorRate < 0.05);
    assert.ok(profile.targets.checksRate > 0.95 && profile.targets.checksRate <= 1);
  });

  it('стадии smoke, stand, pilot (час пика), stress — профиль ×2 (ADR-0009)', () => {
    assert.deepEqual(STAGE_NAMES, ['smoke', 'stand', 'pilot', 'stress']);
    assert.deepEqual(Object.keys(profile.stages).sort(), [...STAGE_NAMES].sort());
    assert.equal(profile.stages.pilot.scale, 1);
    assert.equal(profile.stages.pilot.durationMinutes, 60);
    assert.equal(profile.stages.stress.scale, 2);
    assert.equal(profile.stages.stress.durationMinutes, 60);
  });

  it('stand: персонажи сида demo, без шумного тенанта, 2 минуты, две смены водителя', () => {
    const s = profile.stages.stand;
    assert.equal(s.durationMinutes, 2);
    assert.equal(s.iterations, 2);
    assert.deepEqual(s.flows, ['driverShift', 'managerShift']);
    // Роль «Водитель» в сиде — только у группы «Водители Север» (Илья Васильев, Кирилл Громов — отстранён);
    // у Тимура Ахмедова (acc-9) роли нет: listTripPlans → 403 (прогон-дым на слоте 7, второй запуск).
    assert.deepEqual(s.personas, { drivers: ['driver'], managers: ['owner'], planner: 'owner' });
  });

  it('paramValues: значения параметров с переопределениями стадии', () => {
    const base = paramValues(profile, 'pilot');
    assert.equal(base.vehicles, 60);
    const smoke = paramValues(profile, 'smoke');
    assert.ok(smoke.photoSizeBytes < base.photoSizeBytes, 'smoke шлёт маленькие фото');
    assert.equal(smoke.driverThinkSeconds, 0);
    assert.throws(() => paramValues(profile, 'nope'), /стади/);
  });
});

// Метод, путь и заголовки — дословно из api/dist/ortus.bundle.yaml (0.5.1-stage2).
const EXPECTED_OPS = {
  getMyContext: ['GET', '/api/v1/me/context', 'read', false, false],
  listMembers: ['GET', '/api/v1/tenants/{tenantId}/members', 'read', false, false],
  createTripPlan: ['POST', '/api/v1/tenants/{tenantId}/fleet/trip-plans', 'write', true, false],
  listTripPlans: ['GET', '/api/v1/tenants/{tenantId}/fleet/trip-plans', 'read', false, false],
  getTripPlan: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/trip-plans/{tripId}',
    'read',
    false,
    false,
  ],
  listVehicles: ['GET', '/api/v1/tenants/{tenantId}/fleet/vehicles', 'read', false, false],
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
  getFile: ['GET', '/api/v1/tenants/{tenantId}/files/{fileId}', 'read', false, false],
  getFileDownload: [
    'GET',
    '/api/v1/tenants/{tenantId}/files/{fileId}/download',
    'read',
    false,
    false,
  ],
  submitInspection: ['POST', '/api/v1/tenants/{tenantId}/fleet/inspections', 'write', true, false],
  getInspection: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/inspections/{inspectionId}',
    'read',
    false,
    false,
  ],
  listInspectionDefects: ['GET', '/api/v1/tenants/{tenantId}/fleet/defects', 'read', false, false],
  startTrip: ['POST', '/api/v1/tenants/{tenantId}/fleet/trips', 'write', true, false],
  createTripExpense: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses',
    'write',
    true,
    false,
  ],
  listTripExpenses: [
    'GET',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses',
    'read',
    false,
    false,
  ],
  finishTripRoute: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/route-completion',
    'write',
    true,
    true,
  ],
  returnTrip: ['PATCH', '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}', 'write', true, true],
  reviewTrip: [
    'POST',
    '/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/review',
    'write',
    true,
    true,
  ],
};

describe('OPS — операции контракта 0.5.1-stage2, которые трогает нагрузка', () => {
  it('ровно 21 операция; наборов данных (501 на этапе 2) среди них нет', () => {
    assert.deepEqual(Object.keys(OPS).sort(), Object.keys(EXPECTED_OPS).sort());
    for (const gone of [
      'listDatasets',
      'queryDataset',
      'listTrips',
      'getTrip',
      'reviewTripExpense',
    ]) {
      assert.equal(OPS[gone], undefined, gone);
    }
  });

  for (const [op, [method, path, kind, idempotent, ifMatch]] of Object.entries(EXPECTED_OPS)) {
    it(`${op}: ${method} ${path}, ${kind}${idempotent ? ', Idempotency-Key' : ''}${ifMatch ? ', If-Match' : ''}`, () => {
      assert.deepEqual(OPS[op], { method, path, kind, idempotent, ifMatch });
    });
  }

  // Сверка с самим контрактом, а не с копией: правка бандла роняет тест.
  describe('совпадает с api/dist/ortus.bundle.yaml', () => {
    const yaml = readFileSync(BUNDLE_URL, 'utf8');
    const contract = openApiOperations(yaml);

    // W2.51 поднимает минор (0.6.0-stage2) только добавлениями, W4.02 — этап (0.7.0-stage4): проверяется «не ниже
    // 0.5.1-stage2», как в tools/gen/stage2-w240.test.mjs; операции нагрузки сверяет с бандлом каждая проверка ниже.
    it('бандл — версии не ниже 0.5.1-stage2, операций больше, чем трогает нагрузка', () => {
      const m = /^ {2}version: 0\.(\d+)\.(\d+)-stage[2-9]$/m.exec(yaml);
      assert.ok(m, 'версия бандла — 0.N.x-stageM, M ≥ 2');
      const [minor, patch] = [Number(m[1]), Number(m[2])];
      assert.ok(minor > 5 || (minor === 5 && patch >= 1), `версия бандла ${m[0].trim()}`);
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
    'http://127.0.0.1:8107',
    'http://localhost:5207',
    'http://[::1]:8108',
    'http://host.docker.internal:8107',
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
      pathFor('getTripPlan', { tenantId: UUID, tripId: UUID2 }),
      `/api/v1/tenants/${UUID}/fleet/trip-plans/${UUID2}`,
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
      pathFor(
        'listTripPlans',
        { tenantId: UUID },
        { limit: 50, cursor: undefined, state: 'submitted' },
      ),
      `/api/v1/tenants/${UUID}/fleet/trip-plans?limit=50&state=submitted`,
    );
  });

  it('бросает ошибку при пропущенном параметре и неизвестной операции', () => {
    assert.throws(() => pathFor('getTripPlan', { tenantId: UUID }), /tripId/);
    assert.throws(() => pathFor('nope', {}), /nope/);
  });
});

describe('idempotencyKey — Idempotency-Key по OpenAPI (16–128, [A-Za-z0-9._:-])', () => {
  const parts = { run: 'r1', scenario: 'driverShift', vu: 3, iter: 7, step: 'startTrip' };

  it('проходит схему заголовка', () => {
    assert.match(idempotencyKey(parts), /^[A-Za-z0-9._:-]{16,128}$/);
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

describe('тела запросов — схемы 0.5.1-stage2 и правила сервера этапа 2', () => {
  const at = new Date(Date.UTC(2026, 9, 5, 6, 0, 0));
  const window = {
    startsAt: '2026-10-05T06:00:00Z',
    endsAt: '2026-10-05T15:00:00Z',
    timeZone: 'Europe/Moscow',
  };

  it('isoInstant — UTC с суффиксом Z', () => {
    assert.equal(isoInstant(at), '2026-10-05T06:00:00Z');
  });

  it('TripPlanCreate: подразделение водителя, окно, груз и две остановки, водитель', () => {
    const body = tripPlanCreate({
      orgUnitId: UUID,
      driverMemberId: UUID2,
      window,
      title: 'Нагрузка 1',
    });
    assert.deepEqual(body, {
      orgUnitId: UUID,
      title: 'Нагрузка 1',
      plannedWindow: window,
      distanceKm: '60',
      cargo: {
        description: 'Нагрузка · 4 паллеты',
        weightKg: '300',
        volumeM3: '2',
        lengthM: '1.2',
      },
      stops: [
        {
          sequence: 1,
          op: 'load',
          address: 'Склад № 1, Лобня',
          plannedAt: window.startsAt,
          weightKg: '300',
          volumeM3: '2',
        },
        {
          sequence: 2,
          op: 'unload',
          address: 'Химки, ул. Заводская, 8',
          weightKg: '300',
          volumeM3: '2',
        },
      ],
      driverMemberId: UUID2,
    });
  });

  it('tripWindows: окна рейсов водителя не пересекаются (сервер: «Водитель уже занят в это время»)', () => {
    const w = tripWindows({ at, cycleSeconds: 2970, count: 2 });
    assert.deepEqual(w, [
      {
        startsAt: '2026-10-05T05:50:00Z',
        endsAt: '2026-10-05T06:38:30Z',
        timeZone: 'Europe/Moscow',
      },
      {
        startsAt: '2026-10-05T06:39:30Z',
        endsAt: '2026-10-05T07:28:00Z',
        timeZone: 'Europe/Moscow',
      },
    ]);
    // Без темпа (smoke, stand) — 9 часов; после уже запланированного рейса — с минутой зазора.
    assert.deepEqual(tripWindows({ at, cycleSeconds: 0, count: 1 }), [
      {
        startsAt: '2026-10-05T05:50:00Z',
        endsAt: '2026-10-05T14:50:00Z',
        timeZone: 'Europe/Moscow',
      },
    ]);
    assert.equal(
      tripWindows({ at, cycleSeconds: 0, count: 1, after: '2026-10-05T09:00:00Z' })[0].startsAt,
      '2026-10-05T09:01:00Z',
    );
  });

  it('planningFor: рейсы на каждого активного водителя; уже запланированные засчитываются, окна — после них', () => {
    const members = [
      { id: 'd1', status: 'active', workProfiles: ['driver'], orgUnitIds: ['u1'] },
      { id: 'd2', status: 'active', workProfiles: ['driver'], orgUnitIds: ['u2'] },
      { id: 'd3', status: 'suspended', workProfiles: ['driver'], orgUnitIds: ['u1'] },
      { id: 'm1', status: 'active', workProfiles: ['manager'], orgUnitIds: ['u1'] },
    ];
    const planned = [
      {
        driverMemberId: 'd1',
        state: 'planned',
        plannedWindow: { startsAt: '2026-10-05T05:00:00Z', endsAt: '2026-10-05T09:00:00Z' },
      },
      {
        driverMemberId: 'd2',
        state: 'planned',
        plannedWindow: { startsAt: '2026-10-04T05:00:00Z', endsAt: '2026-10-04T09:00:00Z' },
      },
    ];
    const out = planningFor({ members, planned, perDriver: 1, at, cycleSeconds: 0 });
    assert.deepEqual(
      out.map((p) => [p.driverMemberId, p.orgUnitId, p.window.startsAt]),
      [['d2', 'u2', '2026-10-05T05:50:00Z']],
    );
    const two = planningFor({ members, planned, perDriver: 2, at, cycleSeconds: 0 });
    assert.deepEqual(
      two.map((p) => [p.driverMemberId, p.window.startsAt]),
      [
        ['d1', '2026-10-05T09:01:00Z'],
        ['d2', '2026-10-05T05:50:00Z'],
        ['d2', '2026-10-05T14:51:00Z'],
      ],
    );
  });

  it('pickTrip: самый ранний рейс в планировании, окно которого не кончится до конца смены', () => {
    const plan = (id, startsAt, endsAt, state = 'planned') => ({
      id,
      state,
      plannedWindow: { startsAt, endsAt },
    });
    const plans = [
      plan('late', '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z'),
      plan('ending', '2026-10-05T05:00:00Z', '2026-10-05T06:05:00Z'),
      plan('done', '2026-10-05T04:00:00Z', '2026-10-05T10:00:00Z', 'submitted'),
      plan('now', '2026-10-05T05:30:00Z', '2026-10-05T07:00:00Z'),
    ];
    assert.equal(pickTrip(plans, at, 600).id, 'now');
    assert.equal(pickTrip(plans, at, 60).id, 'ending');
    assert.equal(pickTrip([], at, 60), undefined);
  });

  it('fitsCargo: масса, объём и длина груза помещаются в машину; без сведений о вместимости — подходит', () => {
    const cargo = { weightKg: '1100', volumeM3: '12', lengthM: '3' };
    const v = (payloadKg, volumeM3, cargoLengthM) => ({
      capacity: { payloadKg, volumeM3, cargoLengthM },
    });
    assert.equal(fitsCargo(v('1500', '12', '3.2'), cargo), true);
    assert.equal(fitsCargo(v('1000', '12', '3.2'), cargo), false);
    assert.equal(fitsCargo(v('1500', '9', '3.2'), cargo), false);
    assert.equal(fitsCargo(v('1500', '12', '2.4'), cargo), false);
    assert.equal(fitsCargo({}, cargo), true);
  });

  it('ReservationCreate: машина, водитель рейса, окно рейса, tripId', () => {
    assert.deepEqual(
      reservationCreate({ vehicleId: UUID, driverMemberId: UUID2, window, tripId: UUID2 }),
      { vehicleId: UUID, driverMemberId: UUID2, window, tripId: UUID2 },
    );
  });

  it('UploadCreate: фото рейса (fleet / trip), JPEG, sha256, назначение', () => {
    const body = uploadCreate({
      fileName: 'front.jpg',
      sizeBytes: 1024,
      sha256: SHA,
      purpose: 'inspection',
      tripId: UUID,
    });
    assert.deepEqual(body, {
      fileName: 'front.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: SHA,
      purpose: 'inspection',
      owner: { moduleKey: 'fleet', entityType: 'trip', entityId: UUID },
    });
    assert.throws(
      () =>
        uploadCreate({
          fileName: 'x',
          sizeBytes: 1,
          sha256: 'bad',
          purpose: 'inspection',
          tripId: UUID,
        }),
      /sha256/,
    );
    assert.throws(
      () =>
        uploadCreate({ fileName: 'x', sizeBytes: 1, sha256: SHA, purpose: 'selfie', tripId: UUID }),
      /purpose/,
    );
  });

  it('InspectionCreate (выезд): чек-лист целиком pass, фото по ролям, reservationId', () => {
    const checklist = {
      versionId: UUID,
      kind: 'departure',
      items: [{ key: 'body' }, { key: 'tires' }],
      requiredPhotoRoles: ['front', 'rear'],
    };
    const body = inspectionCreate({
      checklist,
      vehicleId: UUID2,
      reservationId: UUID,
      odometerKm: '120345',
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
        { key: 'body', result: 'pass' },
        { key: 'tires', result: 'pass' },
      ],
      photos: [
        { role: 'front', fileId: UUID, capturedAt: '2026-10-05T06:00:00Z' },
        { role: 'rear', fileId: UUID2, capturedAt: '2026-10-05T06:00:00Z' },
      ],
      capturedAt: '2026-10-05T06:00:00Z',
    });
  });

  it('InspectionCreate (сдача) требует tripId, выезд — reservationId', () => {
    const checklist = {
      versionId: UUID,
      kind: 'return',
      items: [{ key: 'k' }],
      requiredPhotoRoles: ['front'],
    };
    const common = {
      checklist,
      vehicleId: UUID,
      odometerKm: '1',
      fuelPercent: 50,
      photos: [{ role: 'front', fileId: UUID }],
      capturedAt: at,
    };
    assert.equal(inspectionCreate({ ...common, tripId: UUID2 }).tripId, UUID2);
    assert.throws(() => inspectionCreate(common), /tripId/);
    assert.throws(
      () => inspectionCreate({ ...common, checklist: { ...checklist, kind: 'departure' } }),
      /reservationId/,
    );
  });

  it('TripStart, TripReturn, TripReview', () => {
    assert.deepEqual(tripStart({ reservationId: UUID, departureInspectionId: UUID2 }), {
      reservationId: UUID,
      departureInspectionId: UUID2,
    });
    assert.deepEqual(tripReturn({ returnInspectionId: UUID2 }), {
      action: 'return',
      returnInspectionId: UUID2,
    });
    assert.deepEqual(tripReview(), { decision: 'approve' });
  });

  it('шесть категорий ответа D-12 (W2.40): «прочее» и «шиномонтаж» — первыми, штрафов нет', () => {
    assert.deepEqual(EXPENSE_KINDS, ['other', 'tire_service', 'fuel', 'wash', 'parking', 'toll']);
  });

  it('expenseFor: по кругу шести категорий; топливо — с литрами, «прочее» — с комментарием (Q-W2.40-6)', () => {
    const kinds = Array.from({ length: 7 }, (_, i) => expenseFor(i).kind);
    assert.deepEqual(kinds, [...EXPENSE_KINDS, 'other']);
    assert.ok(expenseFor(0).comment && expenseFor(0).comment.trim().length > 0);
    assert.equal(expenseFor(2).quantityLitres, 40);
    for (let i = 0; i < 6; i++) {
      const e = expenseFor(i);
      assert.ok(
        Number.isInteger(e.amountMinor) && e.amountMinor > 0 && e.amountMinor <= 20_000_000,
      );
    }
  });

  it('TripExpenseCreate: категория, рубли в копейках, ровно один чек, литры строкой, комментарий', () => {
    assert.deepEqual(
      tripExpenseCreate({ ...expenseFor(2), occurredAt: at, receiptFileIds: [UUID] }),
      {
        kind: 'fuel',
        occurredAt: '2026-10-05T06:00:00Z',
        amount: { amountMinor: 350000, currency: 'RUB' },
        quantity: '40',
        receiptFileIds: [UUID],
      },
    );
    const other = tripExpenseCreate({ ...expenseFor(0), occurredAt: at, receiptFileIds: [UUID] });
    assert.equal(other.kind, 'other');
    assert.equal(typeof other.comment, 'string');
    assert.throws(
      () =>
        tripExpenseCreate({ kind: 'fine', occurredAt: at, amountMinor: 1, receiptFileIds: [UUID] }),
      /kind/,
    );
    assert.throws(
      () =>
        tripExpenseCreate({
          kind: 'other',
          occurredAt: at,
          amountMinor: 1,
          receiptFileIds: [UUID],
        }),
      /комментар/,
    );
    assert.throws(
      () =>
        tripExpenseCreate({ kind: 'fuel', occurredAt: at, amountMinor: 1, receiptFileIds: [UUID] }),
      /литр/,
    );
    assert.throws(
      () =>
        tripExpenseCreate({
          kind: 'wash',
          occurredAt: at,
          amountMinor: 1,
          receiptFileIds: [UUID, UUID2],
        }),
      /чек/,
    );
    assert.throws(
      () =>
        tripExpenseCreate({
          kind: 'wash',
          occurredAt: at,
          amountMinor: 1.5,
          receiptFileIds: [UUID],
        }),
      /amountMinor/,
    );
  });
});

describe('deriveRates — производные величины профиля D-08', () => {
  const r = deriveRates(profile, 'pilot');
  const s = deriveRates(profile, 'stress');

  it('60 пользователей пика: 45 водителей и 15 офисных VU; stress — 120', () => {
    assert.equal(r.driverVus, 45);
    assert.equal(r.managerVus, 15);
    assert.equal(r.concurrentUsersPeak, 60);
    assert.equal(s.driverVus, 90);
    assert.equal(s.managerVus, 30);
    assert.equal(s.concurrentUsersPeak, 120);
  });

  it('600 загрузок фото в час пика (stress 1 200), 11 фото на смену', () => {
    assert.equal(r.photosPerShift, 11);
    assert.equal(r.uploadsPerHourPeak, 600);
    assert.equal(s.uploadsPerHourPeak, 1200);
    assert.equal(r.shiftsPerHourPeak, 54.545);
  });

  it('темп водителя: цикл = VU × фото × 3600 / загрузок в час; активная часть короче цикла', () => {
    assert.equal(r.driverCycleSeconds, 2970);
    assert.equal(s.driverCycleSeconds, 2970);
    assert.equal(r.driverActiveSeconds, 492.8);
    assert.ok(r.driverActiveSeconds < r.driverCycleSeconds);
  });

  it('объём фото: 252 МБ в час пика, ≈ 277 МБ в день и ≈ 8,3 ГБ в месяц (D-08: 250 МБ, 8 ГБ)', () => {
    assert.equal(r.photoMBPerPeakHour, 252);
    assert.equal(r.photoMBPerDay, 277.2);
    assert.equal(r.photoGBPerMonth, 8.316);
  });

  it('история 12 месяцев: рейсы, осмотры, расходы, файлы ≈ 100 ГБ (квота пилота W2.48)', () => {
    assert.equal(r.historyTrips, 21600);
    assert.equal(r.historyInspections, 43200);
    assert.equal(r.historyExpenses, 21600);
    assert.equal(r.historyFiles, 237600);
    assert.equal(r.historyFileGB, 99.792);
  });

  it('запросы в секунду пилота: водители и менеджеры (без передачи файлов)', () => {
    assert.equal(r.driverApiRps, 0.803);
    assert.equal(r.managerApiRps, 3);
  });

  it('шумный тенант: строк выгрузки в минуту и МБ фото в минуту', () => {
    assert.equal(r.noisyExportRowsPerMinute, 24000);
    assert.equal(r.noisyUploadMBPerMinute, 42);
  });
});

describe('requestsPerShift / requestsPerManagerIteration / requestsForPlanning', () => {
  it('смена водителя: рейс-план, бронь, 11 фото до ready, осмотры, старт, расход, завершение, сдача', () => {
    const sh = requestsPerShift(profile, 'pilot');
    assert.equal(sh.auth, 1);
    assert.equal(sh.transfer, 11);
    assert.deepEqual(sh.byOp, {
      getMyContext: 1,
      listTripPlans: 7,
      listVehicles: 1,
      reserveVehicle: 1,
      getInspectionChecklist: 2,
      initiateUpload: 11,
      completeUpload: 11,
      getFile: 11,
      submitInspection: 2,
      startTrip: 1,
      createTripExpense: 1,
      getTripPlan: 2,
      finishTripRoute: 1,
      returnTrip: 1,
    });
    assert.equal(sh.read, 24);
    assert.equal(sh.write, 29);
    assert.equal(sh.thinkPoints, 24);
  });

  it('итерация менеджера: рабочее место, очередь приёмки, дефекты; приёмка — карточка, осмотры, расходы, фото', () => {
    const plain = requestsPerManagerIteration(profile, 'pilot', { review: false });
    assert.deepEqual(plain.byOp, { listTripPlans: 2, listVehicles: 1, listInspectionDefects: 1 });
    assert.equal(plain.transfer, 0);
    const review = requestsPerManagerIteration(profile, 'pilot', { review: true });
    assert.deepEqual(review.byOp, {
      listTripPlans: 2,
      listVehicles: 1,
      listInspectionDefects: 1,
      getTripPlan: 2,
      getInspection: 2,
      listTripExpenses: 1,
      getFileDownload: 11,
      reviewTrip: 1,
    });
    assert.equal(review.transfer, 11);
    assert.equal(review.write, 1);
  });

  it('планирование в setup: вход логиста, контекст, участники, рейсы по водителям', () => {
    assert.deepEqual(requestsForPlanning({ drivers: 3, tripsPerDriver: 2 }), {
      auth: 1,
      byOp: { getMyContext: 1, listMembers: 1, listTripPlans: 1, createTripPlan: 6 },
    });
  });
});

describe('персонажи и темп', () => {
  it('pilot: 45 водителей, 15 офисных, логист-планировщик, шумный владелец', () => {
    const p = personasFor(profile, 'pilot');
    assert.equal(p.drivers.length, 45);
    assert.equal(p.drivers[0], 'load-pilot-driver-001');
    assert.equal(p.drivers[44], 'load-pilot-driver-045');
    assert.equal(p.managers.length, 15);
    assert.equal(p.managers[14], 'load-pilot-manager-15');
    assert.equal(p.planner, 'load-pilot-planner-01');
    assert.equal(p.noisy, 'load-noisy-owner-01');
    assert.equal(personasFor(profile, 'stress').drivers.length, 90);
  });

  it('smoke: по водителю на итерацию; stand — персонажи сида demo', () => {
    assert.deepEqual(personasFor(profile, 'smoke').drivers, [
      'load-pilot-driver-001',
      'load-pilot-driver-002',
    ]);
    assert.deepEqual(personasFor(profile, 'smoke').managers, ['load-pilot-manager-01']);
    assert.deepEqual(personasFor(profile, 'stand').drivers, ['driver']);
    assert.equal(personasFor(profile, 'stand').planner, 'owner');
  });

  it('personaIndex: слот VU + итерация × число VU по кругу персонажей', () => {
    assert.equal(personaIndex({ slot: 0, iteration: 1, vus: 1, count: 2 }), 1);
    assert.equal(personaIndex({ slot: 7, iteration: 1, vus: 45, count: 45 }), 7);
    assert.equal(personaIndex({ slot: 1, iteration: 0, vus: 2, count: 2 }), 1);
  });

  it('driverPacing: стартовый сдвиг слота и цикл; smoke и stand — без пауз', () => {
    assert.deepEqual(driverPacing(profile, 'pilot', 10), {
      offsetSeconds: 660,
      cycleSeconds: 2970,
    });
    assert.deepEqual(driverPacing(profile, 'smoke', 1), { offsetSeconds: 0, cycleSeconds: 0 });
    assert.deepEqual(driverPacing(profile, 'stand', 1), { offsetSeconds: 0, cycleSeconds: 0 });
  });

  it('tripsPerDriver: сколько рейсов планирует setup на водителя (с темпом — на один больше смен)', () => {
    // Окно рейса — один цикл; смена слота со сдвигом может прийтись на следующее окно.
    assert.equal(tripsPerDriver(profile, 'pilot'), 3);
    assert.equal(tripsPerDriver(profile, 'stress'), 3);
    assert.equal(tripsPerDriver(profile, 'smoke'), 1);
    // stand: две смены Ильи Васильева — Р-208 сида засчитывается, setup() планирует ещё один рейс.
    assert.equal(tripsPerDriver(profile, 'stand'), 2);
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

  it('передача файлов, вход, планирование и шумный тенант в пороги не входят', () => {
    for (const key of Object.keys(t)) assert.doesNotMatch(key, /transfer|auth|setup|noisy/);
  });

  it('pilot, stress, smoke — с целями p95; stand — p95 только наблюдается (стенд разработчика — не stage)', () => {
    for (const stage of ['smoke', 'pilot', 'stress'])
      assert.deepEqual(buildThresholds(profile, stage), t);
    assert.equal(profile.stages.stand.latencyGate, false);
    assert.deepEqual(buildThresholds(profile, 'stand'), {
      ...t,
      'http_req_duration{tenant:pilot,kind:read}': ['p(95)>=0'],
      'http_req_duration{tenant:pilot,kind:write}': ['p(95)>=0'],
    });
  });
});

describe('buildVolumeThresholds — минимальный объём (A-24) и приёмка смен', () => {
  const FLOWS = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];

  it('метрики flow_completed / flow_aborted / trips_reviewed; доля минимального объёма в targets', () => {
    assert.equal(model.FLOW_COMPLETED, 'flow_completed');
    assert.equal(model.FLOW_ABORTED, 'flow_aborted');
    assert.equal(model.TRIPS_REVIEWED, 'trips_reviewed');
    assert.equal(profile.targets.minVolumeShare, 0.9);
  });

  it('plannedIterations pilot: 55 смен за час (≈ 605 фото), менеджеры до конца доигрыша смен', () => {
    const p = plannedIterations(profile, 'pilot');
    assert.equal(p.driverShift, 55);
    assert.equal(p.noisyExport, 360);
    assert.equal(p.noisyUploads, 6000);
    assert.equal(plannedIterations(profile, 'stress').driverShift, 110);
  });

  it('smoke: каждая итерация каждого сценария; приёмка на каждой итерации менеджера', () => {
    const n = profile.stages.smoke.iterations;
    assert.deepEqual(buildVolumeThresholds(profile, 'smoke'), {
      ...Object.fromEntries(FLOWS.map((f) => [`flow_completed{flow:${f}}`, [`count>=${n}`]])),
      trips_reviewed: [`count>=${n}`],
    });
  });

  it('stand: обе смены сида и их приёмка; менеджер — половина плана', () => {
    assert.deepEqual(buildVolumeThresholds(profile, 'stand'), {
      'flow_completed{flow:driverShift}': ['count>=2'],
      'flow_completed{flow:managerShift}': ['count>=5'],
      trips_reviewed: ['count>=2'],
    });
  });

  const EXPECTED_MIN = {
    pilot: {
      driverShift: 49,
      managerShift: 2976,
      noisyExport: 324,
      noisyUploads: 5400,
      reviewed: 49,
    },
    stress: {
      driverShift: 99,
      managerShift: 5952,
      noisyExport: 324,
      noisyUploads: 5400,
      reviewed: 99,
    },
  };
  for (const [stage, mins] of Object.entries(EXPECTED_MIN)) {
    it(`${stage}: ${Object.entries(mins)
      .map(([f, n]) => `${f} ≥ ${n}`)
      .join(', ')}`, () => {
      assert.deepEqual(buildVolumeThresholds(profile, stage), {
        ...Object.fromEntries(
          FLOWS.map((f) => [`flow_completed{flow:${f}}`, [`count>=${mins[f]}`]]),
        ),
        trips_reviewed: [`count>=${mins.reviewed}`],
      });
    });
  }

  for (const stage of STAGE_NAMES) {
    it(`${stage}: options содержит пороги целей и пороги объёма`, () => {
      assert.deepEqual(buildOptions(profile, stage).thresholds, {
        ...buildThresholds(profile, stage),
        ...buildVolumeThresholds(profile, stage),
      });
    });
  }
});

describe('buildOptions — сценарии k6 по стадиям', () => {
  const NAMES = ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads'];

  it('неизвестная стадия → ошибка', () => {
    assert.throws(() => buildOptions(profile, 'huge'), /стади/);
  });

  it('smoke: несколько итераций каждого сценария на 1 VU', () => {
    const iterations = profile.stages.smoke.iterations;
    assert.ok(Number.isInteger(iterations) && iterations >= 2);
    const o = buildOptions(profile, 'smoke');
    assert.deepEqual(Object.keys(o.scenarios).sort(), [...NAMES].sort());
    for (const name of NAMES) {
      const s = o.scenarios[name];
      assert.equal(s.executor, 'per-vu-iterations');
      assert.equal(s.vus, 1);
      assert.equal(s.iterations, iterations);
      assert.equal(s.exec, name);
    }
  });

  it('stand: водитель сида — две смены подряд (Р-208 и рейс setup), логист 2 минуты, шумного тенанта нет', () => {
    const o = buildOptions(profile, 'stand');
    assert.deepEqual(Object.keys(o.scenarios).sort(), ['driverShift', 'managerShift']);
    assert.deepEqual(
      { ...o.scenarios.driverShift, maxDuration: undefined },
      {
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 2,
        maxDuration: undefined,
        exec: 'driverShift',
        tags: { tenant: 'pilot' },
      },
    );
    assert.equal(o.scenarios.managerShift.executor, 'constant-vus');
    assert.equal(o.scenarios.managerShift.vus, 1);
    assert.equal(o.scenarios.managerShift.duration, '120s');
  });

  for (const stage of STAGE_NAMES) {
    it(`${stage}: cookie jar VU не сбрасывается; setup успевает спланировать рейсы`, () => {
      const o = buildOptions(profile, stage);
      assert.equal(o.noCookiesReset, true);
      assert.equal(o.setupTimeout, '10m');
    });
  }

  for (const stage of ['pilot', 'stress']) {
    it(`${stage}: закрытая модель водителей и офиса (60 пользователей × масштаб), открытая — шум`, () => {
      const o = buildOptions(profile, stage);
      const r = deriveRates(profile, stage);
      const d = o.scenarios.driverShift;
      assert.equal(d.executor, 'constant-vus');
      assert.equal(d.vus, r.driverVus);
      assert.equal(d.duration, '3600s');
      assert.equal(d.gracefulStop, `${Math.ceil(r.driverActiveSeconds * 2)}s`);
      const m = o.scenarios.managerShift;
      assert.equal(m.executor, 'constant-vus');
      assert.equal(m.vus, r.managerVus);
      assert.equal(m.duration, `${3600 + Math.ceil(r.driverActiveSeconds * 2)}s`);
      assert.equal(d.vus + m.vus, r.concurrentUsersPeak);
      const v = paramValues(profile, stage);
      assert.equal(o.scenarios.noisyExport.executor, 'constant-arrival-rate');
      assert.equal(o.scenarios.noisyExport.rate, v.noisyExportsPerMinute);
      assert.equal(o.scenarios.noisyUploads.rate, v.noisyUploadsPerMinute);
      assert.equal(o.scenarios.noisyUploads.timeUnit, '1m');
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
