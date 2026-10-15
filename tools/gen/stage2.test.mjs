// W2.00 · Контракт этапа 2 (0.5.0-stage2): очередь и решение по блокирующему дефекту (S2-17, D-29 комплекта), рейс от
// плана до приёмки (TripPlan, Q-45), назначение машины логистом, «Завершить рейс», доработка по разделам
// (rework + steps[], S2-10), «Требует решения» (S2-18, тег Home), список начислений (S2-12). Бриф
// docs/plan/v2/ws/W2.00.md §4. Контракт только аддитивный: kind change — только расширение перечисления.
// DoR: screens.yaml покрывает истории S2-01…S2-19 экранами этапа 2 или причиной «без экрана».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkCoverage, checkExamples, loadExamples } from './lib/examples.mjs';
import { listOperations, operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { escapeToken, parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W2.00 §4. */
const OPS = [
  [
    'listTripPlans',
    'get',
    `${T}/fleet/trip-plans`,
    'Fleet',
    ['fleet.trips.read'],
    'tenant-org-unit-self',
  ],
  [
    'createTripPlan',
    'post',
    `${T}/fleet/trip-plans`,
    'Fleet',
    ['fleet.routes.manage'],
    'tenant-or-org-unit',
  ],
  [
    'getTripPlan',
    'get',
    `${T}/fleet/trip-plans/{tripId}`,
    'Fleet',
    ['fleet.trips.read'],
    'tenant-org-unit-self',
  ],
  [
    'assignTripVehicle',
    'put',
    `${T}/fleet/trips/{tripId}/vehicle`,
    'Fleet',
    ['fleet.routes.manage'],
    'tenant-or-org-unit',
  ],
  [
    'finishTripRoute',
    'post',
    `${T}/fleet/trips/{tripId}/route-completion`,
    'Fleet',
    ['fleet.trips.return'],
    'tenant-org-unit-self',
  ],
  [
    'listInspectionDefects',
    'get',
    `${T}/fleet/defects`,
    'Fleet',
    ['fleet.inspections.review'],
    'responsible-manager-or-owner',
  ],
  [
    'getInspectionDefect',
    'get',
    `${T}/fleet/defects/{defectId}`,
    'Fleet',
    ['fleet.inspections.read'],
    'tenant-org-unit-self',
  ],
  [
    'decideInspectionDefect',
    'post',
    `${T}/fleet/defects/{defectId}/decision`,
    'Fleet',
    ['fleet.inspections.review'],
    'responsible-manager-or-owner',
  ],
  [
    'listTripEarnings',
    'get',
    `${T}/fleet/earnings`,
    'Earnings',
    ['fleet.earnings.read'],
    'responsible-manager-or-owner-only',
  ],
  ['getMyDecisionQueue', 'get', '/api/v1/me/decisions', 'Home', [], 'identity'],
];
const NEW = OPS.map((o) => o[0]);
const COMMANDS = [
  'createTripPlan',
  'assignTripVehicle',
  'finishTripRoute',
  'decideInspectionDefect',
];
const REVISIONED = ['assignTripVehicle', 'finishTripRoute', 'decideInspectionDefect'];
/** Операции W0.08 и W1.00 — не должны пропасть. */
const EARLIER = [
  'startLogin',
  'selectTenant',
  'listMyNotifications',
  'explainAccess',
  'createPeopleImport',
  'suspendPlatformTenant',
  'listPlatformAuditEvents',
  'listFiles',
  'getStorageBreakdown',
  'previewModuleDeactivation',
  'createRealtimeTicket',
  'createMember',
  'updateWorkProfile',
  'previewOrgUnitMove',
];
const TRIP_STATE = [
  'planned',
  'assigned',
  'inspection',
  'defect_review',
  'on_route',
  'returning',
  'submitted',
  'rework',
  'accepted',
];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const codes = readYaml(ERRORS_PATH).codes;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, name) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === name.toLowerCase());
const successOf = (o) => Object.keys(o.responses).find((s) => /^[23]/.test(s));
const name = (ref) => ref?.split('/').pop();
const bodySchema = (id) =>
  schemas[name(op(id).requestBody?.content?.['application/json']?.schema?.$ref)];
const okSchema = (id) =>
  name(op(id).responses[successOf(op(id))]?.content?.['application/json']?.schema?.$ref);
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w200 = loadDeltas().filter((d) => /W2\.00/.test(d.source));
const screensDoc = readYaml(SCREENS_PATH);
const screens = screensDoc.screens;

describe('контракт этапа 2 (W2.00, 0.5.0-stage2)', () => {
  it('10 новых операций: метод, путь, тег, x-permissions, x-scope', () => {
    const wrong = [];
    for (const [id, method, path, tag, perms, scope] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, tag, perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('аддитивность: операции 0.1, W0.08 и W1.00 на месте, новые пути — дельты W2.00, новый тег Home', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    const ids = new Set(listOperations(doc).map((o) => o.operationId));
    assert.deepEqual(
      [...listOperations(source).map((o) => o.operationId), ...EARLIER].filter(
        (id) => !ids.has(id),
      ),
      [],
    );
    const pointers = new Set(loadDeltas().map((d) => d.pointer));
    const newPaths = [...new Set(OPS.map((o) => o[2]))].filter((p) => !(p in source.paths));
    assert.deepEqual(
      newPaths.filter((p) => !pointers.has(`/paths/${escapeToken(p)}`)),
      [],
    );
    for (const p of newPaths) {
      const d = loadDeltas().find((x) => x.pointer === `/paths/${escapeToken(p)}`);
      assert.match(d.source, /W2\.00/, p);
    }
    const tags = doc.tags.map((t) => t.name);
    assert.equal(tags.length, 20);
    // Как Auth у W0.08: новый тег — после Auth, Repairs остаётся последним (тест кодогенерации W0.09).
    assert.deepEqual(tags.slice(0, 3), ['Context', 'Auth', 'Home']);
    assert.equal(tags.at(-1), 'Repairs');
    assert.match(loadDeltas().find((d) => d.pointer === '/tags').source, /W2\.00/);
  });

  it('kind change у дельт W2.00 — только расширение перечисления: значения 0.1 сохранены', () => {
    const changes = w200.filter(
      (d) => d.kind === 'change' && d.pointer !== '/info/version' && d.pointer !== '/tags',
    );
    assert.ok(changes.length >= 4, 'TripReview.decision и три bodyType');
    // Массивы бандл сравнивает целиком, поэтому расширение enum параметра запроса объявляется дельтой
    // на массив parameters: внутри него допустимо только расширение enum, остальное — как в 0.1.
    const widenOnly = (was, now, ptr, out) => {
      if (JSON.stringify(was) === JSON.stringify(now)) return;
      if (ptr.endsWith('/enum') && Array.isArray(was) && Array.isArray(now)) {
        if (was.some((v) => !now.includes(v)) || now.length <= was.length) {
          out.push(`${ptr}: не надмножество ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
        }
        return;
      }
      const both = (p) =>
        was !== null && now !== null && typeof was === 'object' && p(was) && p(now);
      if (both(Array.isArray) && was.length === now.length) {
        was.forEach((x, i) => widenOnly(x, now[i], `${ptr}/${i}`, out));
        return;
      }
      if (both((x) => !Array.isArray(x))) {
        const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
        for (const k of keys) widenOnly(was[k], now[k], `${ptr}/${escapeToken(k)}`, out);
        return;
      }
      out.push(`${ptr}: изменение не по перечислению`);
    };
    const bad = [];
    for (const d of changes) widenOnly(at(source, d.pointer), at(doc, d.pointer), d.pointer, bad);
    assert.deepEqual(bad, []);
  });

  it('команды W2.00: Idempotency-Key, X-CSRF-Token, Origin, x-csrf; If-Match у изменяющих рейс и дефект', () => {
    const gaps = [];
    for (const id of COMMANDS) {
      if (param(id, 'header', 'Idempotency-Key')?.required !== true)
        gaps.push(`${id}: Idempotency-Key`);
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['403', '404', '409', '422']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    for (const id of REVISIONED) {
      if (param(id, 'header', 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
    }
    assert.deepEqual(gaps, []);
    assert.ok(op('createTripPlan').responses['201']);
  });

  it('TripPlan: рейс от плана до приёмки, 9 состояний TRIP_STATE + cancelled, без начислений (AC-05)', () => {
    assert.deepEqual(schemas.TripState.enum, [...TRIP_STATE, 'cancelled']);
    const p = schemas.TripPlan;
    assert.equal(name(p.properties.state.$ref), 'TripState');
    for (const f of [
      'id',
      'number',
      'title',
      'orgUnitId',
      'state',
      'plannedWindow',
      'cargo',
      'stops',
      'revision',
    ]) {
      assert.ok(p.required.includes(f), f);
    }
    for (const f of [
      'driverMemberId',
      'vehicleId',
      'reservationId',
      'holdExpiresAt',
      'departureInspectionId',
      'returnInspectionId',
      'blockingDefectId',
      'lastReview',
    ]) {
      assert.ok(f in p.properties, f);
      assert.ok(!p.required.includes(f), `${f} необязательно`);
    }
    const leaks = Object.keys(p.properties).filter((k) => /earn|salary|payroll|wage/i.test(k));
    assert.deepEqual(leaks, []);
    assert.equal(p.additionalProperties, false);
    assert.match(p.description, /same id/);
    assert.match(p.description, /No earnings/);
    assert.deepEqual(schemas.TripStop.properties.op.enum, ['load', 'unload']);
    for (const id of ['listTripPlans', 'getTripPlan', 'assignTripVehicle', 'finishTripRoute']) {
      assert.equal(okSchema(id), id === 'listTripPlans' ? 'TripPlanPage' : 'TripPlan', id);
    }
    assert.equal(
      param('listTripPlans', 'query', 'state').schema.items.$ref.split('/').pop(),
      'TripState',
    );
    assert.match(op('listTripPlans').description, /driver work profile sees only trips/);
    // Trip 0.1 не меняется: ни одной дельты внутри схемы Trip.
    assert.deepEqual(
      loadDeltas().filter((d) => d.pointer.startsWith('/components/schemas/Trip/')),
      [],
    );
  });

  it('assignTripVehicle и finishTripRoute: машина логиста с проверкой совместимости, «Завершить рейс»', () => {
    assert.deepEqual(Object.keys(bodySchema('assignTripVehicle').properties), ['vehicleId']);
    const d = op('assignTripVehicle').description;
    for (const re of [
      /vehicle_incompatible/,
      /reservation_overlap/,
      /invalid_transition/,
      /planned or assigned/,
    ]) {
      assert.match(d, re);
    }
    assert.equal(op('finishTripRoute').requestBody, undefined);
    assert.match(op('finishTripRoute').description, /on_route/);
    assert.match(op('finishTripRoute').description, /returning/);
  });

  it('дефекты S2-17: очередь fleet.defects, решение «разрешить выезд» или «подтвердить неисправность», повтор — 409', () => {
    const d = schemas.InspectionDefect;
    assert.deepEqual(d.properties.state.enum, [
      'open',
      'in_review',
      'resolved',
      'confirmed_out_of_service',
    ]);
    assert.deepEqual(d.properties.severity.enum, ['minor', 'major', 'blocking']);
    assert.deepEqual(d.properties.decision.enum, ['allow_departure', 'confirm_out_of_service']);
    for (const f of [
      'id',
      'vehicleId',
      'inspectionId',
      'zone',
      'description',
      'severity',
      'state',
      'reportedAt',
      'revision',
    ]) {
      assert.ok(d.required.includes(f), f);
    }
    const dec = bodySchema('decideInspectionDefect');
    assert.deepEqual(dec.properties.decision.enum, ['allow_departure', 'confirm_out_of_service']);
    assert.deepEqual(dec.required, ['decision']);
    assert.equal(okSchema('decideInspectionDefect'), 'InspectionDefect');
    assert.match(op('decideInspectionDefect').description, /invalid_transition/);
    assert.match(op('decideInspectionDefect').description, /D-29 комплекта/);
    assert.equal(okSchema('listInspectionDefects'), 'InspectionDefectPage');
    assert.ok(param('listInspectionDefects', 'query', 'state'));
    assert.ok(param('decideInspectionDefect', 'path', 'defectId'));
    // Осмотр несёт структурные дефекты, комментарий и попытку (повторная сдача после доработки).
    const create = schemas.InspectionCreate.properties;
    assert.equal(name(create.defects.items.$ref), 'InspectionDefectReport');
    assert.deepEqual(schemas.InspectionDefectReport.properties.severity.enum, [
      'minor',
      'major',
      'blocking',
    ]);
    assert.ok('comment' in create);
    const insp = schemas.Inspection.properties;
    assert.equal(name(insp.defects.items.$ref), 'InspectionDefect');
    for (const f of ['tripId', 'attempt', 'comment']) assert.ok(f in insp, f);
    assert.ok(!schemas.Inspection.required.includes('defects'));
  });

  it('приёмка S2-10: rework с разделами steps[] и текстами прототипа', () => {
    const r = schemas.TripReview;
    for (const v of ['approve', 'reject', 'maintenance_required', 'rework']) {
      assert.ok(r.properties.decision.enum.includes(v), v);
    }
    assert.equal(name(r.properties.steps.items.$ref), 'ReworkStep');
    assert.deepEqual(schemas.ReworkStep.enum, ['photos', 'odometer', 'expenses', 'checklist']);
    assert.ok(!r.required.includes('steps'));
    assert.match(r.properties.steps.description, /Опишите, что нужно исправить/);
    assert.match(r.properties.steps.description, /Отметьте хотя бы один раздел для доработки/);
    assert.deepEqual(
      schemas.TripReviewSummary.properties.steps.items.$ref.split('/').pop(),
      'ReworkStep',
    );
  });

  it('бронь и запрос водителя связаны с рейсом; отметки машины для карточек; кузов «Тент»', () => {
    for (const s of [
      'ReservationCreate',
      'Reservation',
      'DriverTransferCreate',
      'DriverTransfer',
    ]) {
      assert.ok('tripId' in schemas[s].properties, s);
      assert.ok(!schemas[s].required.includes('tripId'), `${s}.tripId необязателен`);
    }
    const v = schemas.Vehicle;
    for (const f of ['heldByTripId', 'statusNote', 'depot']) {
      assert.ok(f in v.properties, f);
      assert.ok(!v.required.includes(f), f);
    }
    assert.ok('depot' in schemas.VehicleCreate.properties);
    assert.ok(v.properties.bodyType.enum.includes('tent'));
    assert.ok(schemas.VehicleCreate.properties.bodyType.enum.includes('tent'));
    assert.ok(param('listVehicles', 'query', 'bodyType').schema.enum.includes('tent'));
  });

  it('«Требует решения» S2-18: персональная лента по одной организации, структурные элементы без текста', () => {
    const o = op('getMyDecisionQueue');
    assert.equal(param('getMyDecisionQueue', 'query', 'tenantId')?.required, true);
    assert.ok(param('getMyDecisionQueue', 'query', 'limit'));
    assert.equal(okSchema('getMyDecisionQueue'), 'DecisionQueue');
    assert.match(o.description, /404/);
    const q = schemas.DecisionQueue;
    for (const f of ['tenantId', 'items', 'total', 'generatedAt'])
      assert.ok(q.required.includes(f), f);
    const item = schemas.DecisionItem;
    assert.deepEqual(item.properties.tone.enum, ['danger', 'warn', 'info', 'neutral']);
    for (const f of ['key', 'kind', 'moduleKey', 'tone', 'params'])
      assert.ok(item.required.includes(f), f);
    for (const f of ['title', 'text', 'label'])
      assert.ok(!(f in item.properties), `${f}: текст собирает клиент`);
    assert.equal(item.properties.params.additionalProperties.type, 'string');
    assert.ok(new RegExp(item.properties.kind.pattern).test('fleet.blocking_defect'));
    assert.ok(!new RegExp(item.properties.kind.pattern).test('Fleet'));
    assert.equal(doc.tags.find((t) => t.name === 'Home')?.description.length > 10, true);
  });

  it('listTripEarnings S2-12: отдельный маршрут, только с правом начислений, водителю — никогда', () => {
    assert.equal(okSchema('listTripEarnings'), 'TripEarningsPage');
    assert.equal(name(schemas.TripEarningsPage.properties.items.items.$ref), 'TripEarnings');
    assert.match(op('listTripEarnings').description, /driver/i);
    assert.ok(param('listTripEarnings', 'query', 'cursor'));
  });

  it('у каждой новой операции есть пример ошибки и пример успеха; примеры валидны', () => {
    const examples = loadExamples();
    const gaps = [];
    for (const id of NEW) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      const problems = names.filter((n) => n in codes);
      if (!problems.length) gaps.push(`${id}: нет примера ошибки`);
      if (problems.length === names.length) gaps.push(`${id}: нет примера успеха`);
    }
    assert.deepEqual(gaps, []);
    assert.deepEqual(checkExamples(doc, examples), []);
    assert.deepEqual(checkCoverage(doc, examples), []);
    // Рейс в примере — Р-208 сида 14.10, без начислений.
    const plan = examples.get('getTripPlan').get('ok');
    assert.equal(plan.number, 'Р-208');
    assert.ok(!JSON.stringify(plan).includes('4500'));
  });

  it('screens.yaml этапа 2: истории и эталон; S2-01…S2-19 покрыты экраном или причиной «без экрана»', () => {
    const want = {
      home: ['getMyDecisionQueue'],
      'logistics-fleet': ['listTripPlans', 'listVehicles', 'assignTripVehicle'],
      'logistics-review': [
        'listTripPlans',
        'reviewTrip',
        'decideInspectionDefect',
        'getTripEarnings',
      ],
      'logistics-defects': [
        'listInspectionDefects',
        'getInspectionDefect',
        'decideInspectionDefect',
      ],
      'logistics-earnings': ['listTripEarnings'],
      'logistics-pool': ['listAvailableDrivers', 'requestDriverTransfer', 'decideDriverTransfer'],
      'driver-today': [
        'getTripPlan',
        'reserveVehicle',
        'submitInspection',
        'startTrip',
        'finishTripRoute',
        'returnTrip',
      ],
      'driver-cars': ['listVehicles', 'reserveVehicle'],
    };
    const gaps = [];
    for (const [key, list] of Object.entries(want)) {
      for (const id of list)
        if (!screens[key]?.operations?.includes(id)) gaps.push(`${key}: ${id}`);
    }
    const covered = new Set();
    for (const [key, s] of Object.entries(screens)) {
      if (s.stage !== 2) continue;
      if (!Array.isArray(s.stories) || !s.stories.length) gaps.push(`${key}: нет stories`);
      for (const st of s.stories ?? []) covered.add(st);
      if (!/^(design-stage-2 · |no-reference)/.test(s.reference ?? ''))
        gaps.push(`${key}: reference`);
    }
    const without = screensDoc.storiesWithoutScreen ?? {};
    const all = Array.from({ length: 19 }, (_, i) => `S2-${String(i + 1).padStart(2, '0')}`);
    gaps.push(
      ...all.filter((st) => !covered.has(st) && !(st in without)).map((st) => `${st}: не покрыта`),
    );
    assert.deepEqual(gaps, []);
    assert.match(screens['logistics-defects'].reference, /^no-reference/);
  });

  it('реестр миграций api/README.md: tenant 0010–0012 выданы W2.00', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /\|\s*tenant\s*\|\s*0010\s*\|\s*`0010_fleet_defect_queue\.sql`/);
    assert.match(readme, /\|\s*tenant\s*\|\s*0011\s*\|\s*`0011_fleet_trip_rework\.sql`/);
    assert.match(readme, /\|\s*tenant\s*\|\s*0012\s*\|\s*`0012_fleet_trip_plan\.sql`/);
  });

  it('кодогенерация: тег Home в router.go (Servers.Home, nil → 501)', () => {
    const router = readFileSync(abs('backend/cmd/api/router.go'), 'utf8');
    assert.match(router, /homeapi "github\.com\/ortus\/ortus-crm\/backend\/internal\/api\/home"/);
    assert.match(router, /\bHome\s+homeapi\.StrictServerInterface/);
  });

  it('версия контракта — 0.5.0-stage2', () => {
    assert.equal(doc.info.version, '0.5.0-stage2');
  });
});
