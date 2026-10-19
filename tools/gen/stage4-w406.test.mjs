// W4.06 · Контрактный PR 5 этапа 4 (0.7.0-stage4, номер версии согласует интегратор), только добавления: календарь
// ресурсов (W4.40, W4.41 — день и неделя, перенос с проверкой всех ресурсов брони, свободные слоты), сохранённые виды
// «Данных» и выгрузка заданием с журналом (W4.50). Эталон — «Ортус CRM.dc.html» pg.calendar, pg.data (design-2026-10-19);
// CAL-01…05, DATA-03, 07-ux-and-data §3, 03-api-guide «Что требуется допроектировать» — Данные. Бриф docs/plan/v2/ws/W4.06.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { escapeToken, parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';
const DATA = 'effective-module-and-field-scopes';
const VIEWS = `${T}/datasets/{datasetId}/views`;
const JOBS = `${T}/data/export-jobs`;

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W4.06 §4. */
const OPS = [
  [
    'listCalendarResources',
    'get',
    `${T}/calendar/resources`,
    'Calendar',
    ['calendar.bookings.read'],
    'tenant-org-unit-self',
  ],
  ['listDatasetViews', 'get', VIEWS, 'Data', ['data.query'], DATA],
  ['createDatasetView', 'post', VIEWS, 'Data', ['data.query'], DATA],
  ['updateDatasetView', 'patch', `${VIEWS}/{viewId}`, 'Data', ['data.query'], DATA],
  ['deleteDatasetView', 'delete', `${VIEWS}/{viewId}`, 'Data', ['data.query'], DATA],
  [
    'createDatasetExportJob',
    'post',
    `${T}/datasets/{datasetId}/export-jobs`,
    'Data',
    ['data.export'],
    DATA,
  ],
  ['listDatasetExportJobs', 'get', JOBS, 'Data', ['data.export'], DATA],
  ['getDatasetExportJob', 'get', `${JOBS}/{exportJobId}`, 'Data', ['data.export'], DATA],
  [
    'getDatasetExportDownload',
    'get',
    `${JOBS}/{exportJobId}/download`,
    'Data',
    ['data.export'],
    DATA,
  ],
  ['revokeDatasetExportJob', 'post', `${JOBS}/{exportJobId}/revoke`, 'Data', ['data.export'], DATA],
];
const NEW = OPS.map((o) => o[0]);
const COMMANDS = [
  'createDatasetView',
  'updateDatasetView',
  'deleteDatasetView',
  'createDatasetExportJob',
  'revokeDatasetExportJob',
];
const IF_MATCH = ['updateDatasetView', 'deleteDatasetView', 'revokeDatasetExportJob'];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, n) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === n.toLowerCase());
const name = (ref) => ref?.split('/').pop();
const bodyOf = (id) => name(op(id).requestBody?.content?.['application/json']?.schema?.$ref);
const okOf = (id, status) =>
  name(op(id).responses[status]?.content?.['application/json']?.schema?.$ref);
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w406 = () => loadDeltas().filter((d) => /W4\.06/.test(d.source));
const was = (id) => {
  const o = ops.get(id);
  return source.paths[o.path][o.method].description;
};

describe('контракт 0.7.0-stage4 (W4.06): операции и права', () => {
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

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf; If-Match — у правок с ревизией; ответы', () => {
    const gaps = [];
    for (const id of COMMANDS) {
      if (!op(id)) {
        gaps.push(`${id}: нет`);
        continue;
      }
      if (param(id, 'header', 'Idempotency-Key')?.required !== true) {
        gaps.push(`${id}: Idempotency-Key`);
      }
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['400', '401', '403', '404', '409', '422', '429']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    for (const id of IF_MATCH) {
      if (!op(id)) continue;
      if (param(id, 'header', 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
    }
    assert.deepEqual(gaps, []);
    assert.equal(okOf('listCalendarResources', '200'), 'CalendarResourcePage');
    assert.equal(okOf('listDatasetViews', '200'), 'DatasetViewList');
    assert.equal(okOf('createDatasetView', '201'), 'DatasetView');
    assert.equal(bodyOf('createDatasetView'), 'DatasetViewCreate');
    assert.equal(okOf('updateDatasetView', '200'), 'DatasetView');
    assert.equal(bodyOf('updateDatasetView'), 'DatasetViewPatch');
    assert.ok(op('deleteDatasetView').responses['204'], 'deleteDatasetView: 204');
    assert.equal(okOf('createDatasetExportJob', '202'), 'DatasetExportJob');
    assert.equal(bodyOf('createDatasetExportJob'), 'DatasetExportJobCreate');
    assert.equal(okOf('listDatasetExportJobs', '200'), 'DatasetExportJobPage');
    assert.equal(okOf('getDatasetExportJob', '200'), 'DatasetExportJob');
    assert.equal(okOf('getDatasetExportDownload', '200'), 'DatasetExportDownload');
    assert.equal(okOf('revokeDatasetExportJob', '200'), 'DatasetExportJob');
    for (const id of ['createDatasetView', 'updateDatasetView', 'getDatasetExportJob']) {
      const ok = op(id).responses[id === 'createDatasetView' ? '201' : '200'];
      assert.ok(ok.headers?.ETag, `${id}: ETag`);
    }
    for (const [p, id] of [
      ['viewId', 'updateDatasetView'],
      ['exportJobId', 'getDatasetExportJob'],
    ]) {
      assert.ok(param(id, 'path', p)?.required, `параметр пути ${p}`);
      assert.equal(name(doc.components.parameters[p]?.schema?.$ref), 'Id', `${p}: Id`);
    }
  });

  it('новых ключей прав, кодов ошибок, тегов и x-scope нет; права набора — как у queryDataset', () => {
    assert.equal(flattenActions(loadCatalog()).size, 123);
    assert.equal(Object.keys(readYaml(ERRORS_PATH).codes).length, 52);
    assert.equal(doc.tags.length, 20);
    for (const id of ['createDatasetExportJob', 'getDatasetExportDownload', 'listDatasetViews']) {
      assert.match(op(id).description, /dataset (own )?permission/, id);
    }
  });
});

describe('контракт 0.7.0-stage4 (W4.06): календарь ресурсов (W4.40, W4.41)', () => {
  it('CalendarResource: вид, имя, подразделение, объект, пояс, рабочий день', () => {
    const r = schemas.CalendarResource;
    assert.ok(r, 'CalendarResource');
    assert.equal(r.additionalProperties, false);
    assert.deepEqual(r.required, [
      'id',
      'kind',
      'name',
      'orgUnitId',
      'timeZone',
      'workday',
      'active',
    ]);
    assert.deepEqual(r.properties.kind.enum, src.ResourceSelection.properties.kind.enum);
    assert.equal(name(r.properties.object.$ref), 'ObjectRef');
    assert.equal(name(r.properties.timeZone.$ref), 'TimeZone');
    assert.equal(name(r.properties.workday.$ref), 'CalendarWorkday');
    const w = schemas.CalendarWorkday;
    assert.deepEqual(w.required, ['start', 'end']);
    assert.match('08:00', new RegExp(w.properties.start.pattern));
    assert.match('20:00', new RegExp(w.properties.end.pattern));
    assert.doesNotMatch('8:00', new RegExp(w.properties.start.pattern));
    assert.deepEqual(schemas.CalendarResourcePage.required, ['items', 'nextCursor']);
    const d = op('listCalendarResources').description;
    for (const w2 of ['fleet.vehicles.read', 'self', 'kind', 'orgUnitId']) {
      assert.ok(d.includes(w2), `listCalendarResources: ${w2}`);
    }
    assert.deepEqual(param('listCalendarResources', 'query', 'kind')?.schema?.enum, [
      'member',
      'room',
      'vehicle',
      'equipment',
    ]);
    assert.ok(param('listCalendarResources', 'query', 'orgUnitId'));
  });

  it('listCalendarBookings: окно дня или недели, вид, подразделение, ресурс; параметры 0.1 на месте', () => {
    const names = params('listCalendarBookings').map((p) => p.name);
    assert.deepEqual(names.slice(0, 3), ['tenantId', 'cursor', 'limit']);
    for (const n of ['from', 'to', 'kind', 'orgUnitId', 'resourceId']) {
      const p = param('listCalendarBookings', 'query', n);
      assert.ok(p, n);
      assert.notEqual(p.required, true, `${n}: необязательный`);
    }
    assert.equal(name(param('listCalendarBookings', 'query', 'from').schema.$ref), 'Instant');
    const d = op('listCalendarBookings').description;
    assert.ok(d.startsWith(was('listCalendarBookings')), 'текст 0.1');
    for (const w of ['7 days', 'occupied', 'fleet.vehicles.read', '422 validation_failed']) {
      assert.ok(d.includes(w), `listCalendarBookings: ${w}`);
    }
  });

  it('Booking: подготовка и уборка, занятость с буферами, вид источника, запрет переноса', () => {
    const b = schemas.Booking.properties;
    for (const f of ['prepMinutes', 'cleanupMinutes']) {
      assert.equal(b[f]?.type, 'integer', f);
      assert.equal(b[f].minimum, 0);
      assert.equal(b[f].maximum, 240);
      assert.equal(schemas.BookingCreate.properties[f]?.maximum, 240, `BookingCreate.${f}`);
      assert.equal(schemas.AvailabilityQuery.properties[f]?.maximum, 240, `AvailabilityQuery.${f}`);
    }
    assert.equal(name(b.occupied?.$ref), 'TimeWindow');
    assert.deepEqual(b.sourceKind?.enum, ['appointment', 'trip', 'maintenance', 'break', 'manual']);
    assert.deepEqual(b.rescheduleLock?.enum, [
      'permission',
      'source_module',
      'specialist_schedule',
      'vehicle_card',
    ]);
    assert.deepEqual(schemas.Booking.required, src.Booking.required, 'required 0.1');
    assert.deepEqual(schemas.BookingCreate.required, src.BookingCreate.required);
    for (const t of [
      'Нет права «Изменять» в календаре.',
      'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
      'Перерыв меняется в графике специалиста.',
      'Недоступность машины задаётся в карточке машины.',
    ]) {
      assert.ok(b.rescheduleLock.description.includes(t), t);
    }
  });

  it('перенос: все ресурсы брони атомарно с буферами, текст конфликта эталона, слоты — findCalendarAvailability', () => {
    const d = op('updateCalendarBooking').description;
    assert.ok(d.startsWith(was('updateCalendarBooking')), 'текст 0.1');
    for (const w of [
      '409 resources_unavailable',
      'Конфликт ресурсов: ',
      'занят («',
      'busy',
      '409 invalid_transition',
      'rescheduleLock',
      'findCalendarAvailability',
      'excludeBookingId',
      'Время вне рабочего дня ресурса.',
    ]) {
      assert.ok(d.includes(w), `updateCalendarBooking: ${w}`);
    }
    const q = schemas.AvailabilityQuery;
    assert.equal(name(q.properties.excludeBookingId?.$ref), 'Id');
    assert.equal(q.properties.maxSlots?.maximum, 20);
    assert.deepEqual(q.required, src.AvailabilityQuery.required);
    const a = op('findCalendarAvailability').description;
    assert.ok(a.startsWith(was('findCalendarAvailability')), 'текст 0.1');
    assert.match(a, /excludeBookingId/);
    assert.match(a, /15/);
  });
});

describe('контракт 0.7.0-stage4 (W4.06): сохранённые виды «Данных» (W4.50)', () => {
  it('DatasetView: личный или общий, автор, запрос, скрытые поля, ревизия', () => {
    const v = schemas.DatasetView;
    assert.ok(v, 'DatasetView');
    assert.deepEqual(v.required, [
      'id',
      'datasetId',
      'name',
      'visibility',
      'ownerMemberId',
      'ownerDisplayName',
      'query',
      'revision',
      'createdAt',
      'updatedAt',
    ]);
    assert.deepEqual(v.properties.visibility.enum, ['personal', 'shared']);
    assert.equal(name(v.properties.query.$ref), 'DatasetViewQuery');
    assert.equal(v.properties.hiddenFieldLabels?.type, 'array');
    const q = schemas.DatasetViewQuery;
    assert.deepEqual(q.required, ['filters', 'sort']);
    for (const f of ['select', 'filters', 'search', 'sort']) assert.ok(q.properties[f], f);
    const c = schemas.DatasetViewCreate;
    assert.deepEqual(c.required, ['name', 'query']);
    assert.equal(c.properties.name.maxLength, 120);
    assert.equal(c.properties.visibility.default, 'personal');
    assert.equal(schemas.DatasetViewPatch.minProperties, 1);
    assert.equal(schemas.DatasetViewList.properties.items.maxItems, 200);
    const d = op('createDatasetView').description;
    for (const w of [
      'data.export',
      'shared',
      'Вид с таким именем уже есть.',
      'hiddenFieldLabels',
    ]) {
      assert.ok(d.includes(w), `createDatasetView: ${w}`);
    }
  });
});

describe('контракт 0.7.0-stage4 (W4.06): выгрузка заданием с журналом (W4.50)', () => {
  it('DatasetExportJob: состояния, снимок, пределы, автор, срок, отзыв', () => {
    const j = schemas.DatasetExportJob;
    assert.ok(j, 'DatasetExportJob');
    assert.deepEqual(j.properties.state.enum, [
      'queued',
      'running',
      'ready',
      'failed',
      'expired',
      'revoked',
    ]);
    assert.equal(name(j.properties.spec.$ref), 'DatasetExportCreate');
    for (const f of [
      'id',
      'datasetId',
      'datasetName',
      'state',
      'spec',
      'columnLabels',
      'timeZone',
      'rowLimit',
      'requestedByMemberId',
      'requestedByDisplayName',
      'createdAt',
      'revision',
    ]) {
      assert.ok(j.required.includes(f), `required ${f}`);
    }
    for (const f of [
      'snapshotAt',
      'rowCount',
      'truncated',
      'fileName',
      'sizeBytes',
      'failureCode',
      'revokeReason',
      'expiresAt',
      'viewId',
    ]) {
      assert.ok(j.properties[f], f);
    }
    assert.equal(j.properties.rowLimit.maximum, 100000);
    assert.deepEqual(j.properties.revokeReason.enum, [
      'author',
      'owner',
      'permissions_changed',
      'module_disabled',
    ]);
    const c = schemas.DatasetExportJobCreate;
    assert.deepEqual(c.required, ['select', 'filters', 'sort']);
    assert.equal(name(c.properties.viewId.$ref), 'Id');
    const dl = schemas.DatasetExportDownload;
    assert.deepEqual(dl.required, [
      'exportJobId',
      'downloadUrl',
      'expiresAt',
      'fileName',
      'contentType',
      'sizeBytes',
    ]);
    assert.equal(dl.properties.contentType.const, 'text/csv; charset=utf-8');
  });

  it('описания: снимок и повторная проверка прав, журнал, срок 24 ч, предел заданий, отзыв', () => {
    const create = op('createDatasetExportJob').description;
    for (const w of [
      'exportDataset',
      '100 000',
      '429 rate_limited',
      'Дождитесь завершения начатых выгрузок.',
      'audit',
    ]) {
      assert.ok(create.includes(w), `createDatasetExportJob: ${w}`);
    }
    assert.match(op('listDatasetExportJobs').description, /owner/);
    const dl = op('getDatasetExportDownload').description;
    for (const w of [
      'permissions_changed',
      '409 invalid_transition',
      'Права изменились — выгрузка отозвана. Запустите её снова.',
      '5 minutes',
    ]) {
      assert.ok(dl.includes(w), `getDatasetExportDownload: ${w}`);
    }
    assert.match(op('revokeDatasetExportJob').description, /409 invalid_transition/);
    assert.match(schemas.DatasetExportJob.properties.expiresAt.description, /24 h/);
    for (const n of ['datasetId', 'state']) {
      assert.ok(param('listDatasetExportJobs', 'query', n), `listDatasetExportJobs ?${n}`);
    }
  });
});

describe('контракт 0.7.0-stage4 (W4.06): аддитивность, экраны, примеры, журнал, миграции, версия', () => {
  it('дельты W4.06: пути и схемы — add, описания 0.1 — с текстом 0.1 в начале, параметры 0.1 на месте', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w406().map((d) => d.pointer));
    for (const p of [
      `/paths/${escapeToken(`${T}/calendar/resources`)}`,
      `/paths/${escapeToken(VIEWS)}`,
      `/paths/${escapeToken(`${JOBS}/{exportJobId}/revoke`)}`,
      '/components/schemas/CalendarResource',
      '/components/schemas/DatasetExportJob',
      '/components/schemas/Booking/properties/rescheduleLock',
      '/components/parameters/viewId',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    for (const d of w406().filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/parameters')) {
        assert.deepEqual(now.slice(0, before.length), before, `${d.pointer}: параметры 0.1`);
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(now.startsWith(before) && now.length > before.length, d.pointer);
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W4\.06/);
  });

  it('screens.yaml: экран «Календарь» этапа 4, виды и задания — у «Данных»', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const cal = screens['core-calendar'];
    assert.ok(cal, 'core-calendar');
    assert.equal(cal.stage, 4);
    assert.equal(cal.ws, 'W4.41');
    assert.match(cal.reference, /design-2026-10-19/);
    for (const o of [
      'listCalendarResources',
      'listCalendarBookings',
      'getCalendarBooking',
      'updateCalendarBooking',
      'findCalendarAvailability',
    ]) {
      assert.ok(cal.operations.includes(o), `core-calendar: ${o}`);
    }
    for (const o of NEW.filter((x) => x !== 'listCalendarResources')) {
      assert.ok(screens['core-data'].operations.includes(o), `core-data: ${o}`);
    }
  });

  it('примеры валидны; успех и ошибка у каждой новой операции, перенос — конфликт эталона', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    for (const id of [
      ...NEW,
      'listCalendarBookings',
      'updateCalendarBooking',
      'findCalendarAvailability',
    ]) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      // Удаление вида — 204 без тела: у него только примеры ошибок.
      if (id === 'deleteDatasetView') {
        assert.ok(names.includes('not_found'), `${id}: ${names}`);
        continue;
      }
      assert.ok(names.length >= 2, `${id}: ${names}`);
      assert.ok(
        names.some((n) => /^(ok|week|day|created|ready|queued|reschedule)/.test(n)),
        `${id}: успех`,
      );
    }
    const conflict = examples.get('updateCalendarBooking')?.get('resources_unavailable');
    assert.equal(
      conflict?.detail,
      'Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)',
    );
    const slots = examples.get('findCalendarAvailability')?.get('reschedule');
    assert.deepEqual(
      slots?.slots.map((s) => s.window.startsAt),
      ['2026-10-01T05:00:00Z', '2026-10-01T05:15:00Z', '2026-10-01T05:30:00Z'],
    );
  });

  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.7.0-stage4, tenant 0021–0022 выданы W4.06 (перенумерованы при вливании после W4.02)', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.7\.0-stage4 — W4\.06/m);
    assert.ok(
      log.indexOf('## 0.7.0-stage4') < log.indexOf('## 0.6.2-stage2'),
      'новый раздел — сверху',
    );
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.06 \(`0\.7\.0-stage4`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0021\s*\|\s*`0021_sched_calendar_bookings\.sql`[^|]*\|\s*W4\.06/,
    );
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0022\s*\|\s*`0022_data_views_export_jobs\.sql`[^|]*\|\s*W4\.06/,
    );
  });

  it('версия контракта — этап 4, не ниже 0.7.0-stage4 (номер при вливании — интегратор)', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[3]) >= 4, doc.info.version);
    assert.ok(Number(m[1]) >= 7, doc.info.version);
  });
});

// Возврат 1 (ревью W4.06): правила, которые контракт должен назвать явно для W4.40, W4.41 и W4.50.
describe('контракт 0.7.0-stage4 (W4.06), возврат 1: явные правила для хендлеров', () => {
  it('createDatasetView: занятое имя — 422, «Сохранить вид» эталона заменяет вид — клиент правит его updateDatasetView', () => {
    const d = op('createDatasetView').description;
    for (const w of [
      'onSaveView',
      'replaces',
      'listDatasetViews',
      'updateDatasetView',
      'If-Match',
    ]) {
      assert.ok(d.includes(w), `createDatasetView: ${w}`);
    }
  });

  it('getDatasetExportDownload: GET с последствиями назван явно — no-store, без предвыборки и автоповтора', () => {
    const d = op('getDatasetExportDownload').description;
    for (const w of ['not a safe GET', 'Cache-Control: no-store', 'prefetch', 'only the author']) {
      assert.ok(d.includes(w), `getDatasetExportDownload: ${w}`);
    }
    const dl = schemas.DatasetExportDownload.properties.downloadUrl.description ?? '';
    assert.match(dl, /signed/, 'downloadUrl: подписанная ссылка');
    assert.match(dl, /5 minutes/, 'downloadUrl: срок ссылки');
  });

  it('updateCalendarBooking: конфликт — пункт на пару (другая бронь × ресурс), порядок bookingConflicts эталона', () => {
    const d = op('updateCalendarBooking').description;
    for (const w of ['one item per pair', 'bookingConflicts', 'order of creation']) {
      assert.ok(d.includes(w), `updateCalendarBooking: ${w}`);
    }
  });

  it('Booking.resources — только видимые ресурсы; бронь со скрытым ресурсом — rescheduleLock permission', () => {
    const d = op('listCalendarBookings').description;
    assert.ok(d.includes('Booking.resources lists only the resources the member may see'), d);
    const lock = schemas.Booking.properties.rescheduleLock.description;
    assert.ok(lock.includes('a resource of the booking hidden from the member'), lock);
    const res = op('listCalendarResources').description;
    assert.ok(res.includes('confirmed bookings not finished before the current day'), res);
  });
});

// Возврат 1 (ревью W4.06): строки изоляции у каждой новой и изменённой операции — бриф §6.4 и README матрицы
// («у операций с If-Match — отказы до хендлера»). Отказы до хендлера, которые формат строк выражает: без сессии — 401,
// владелец чужой организации — 404 (AC-02), шлюз без права x-permissions — 403 forbidden_action.
describe('строки изоляции W4.06 (backend/test/isolation/*_w406*.yaml)', () => {
  const FILES = ['calendar_w406', 'calendar_w406_gate', 'data_w406', 'data_w406_gate'];
  const CHANGED = [
    'listCalendarBookings',
    'getCalendarBooking',
    'updateCalendarBooking',
    'findCalendarAvailability',
  ];
  const endpoints = FILES.flatMap((f) =>
    readYaml(abs(`backend/test/isolation/${f}.yaml`)).endpoints.map((e) => ({ ...e, file: f })),
  );

  it('у каждой из 10 новых и 4 изменённых операций: 401 без сессии, 404 чужой организации, 403 шлюза', () => {
    const missing = [];
    for (const id of [...NEW, ...CHANGED]) {
      const rows = endpoints.filter((e) => e.op === id).flatMap((e) => e.rows);
      if (!rows.some((r) => r.actor === 'anonymous' && r.status === 401)) {
        missing.push(`${id}: 401 anonymous`);
      }
      if (
        !rows.some(
          (r) => r.actor === 'b.owner' && r.status === 404 && r.params?.tenantId === 'tenant:a',
        )
      ) {
        missing.push(`${id}: 404 b.owner → tenant:a`);
      }
      if (!rows.some((r) => r.status === 403 && r.code === 'forbidden_action')) {
        missing.push(`${id}: 403 forbidden_action`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('метод и путь строк — как в контракте; отказ шлюза — без pending, остальное — pending W4.40 или W4.50', () => {
    const wrong = [];
    for (const e of endpoints) {
      const o = ops.get(e.op);
      if (!o) {
        wrong.push(`${e.file}/${e.op}: нет в контракте`);
        continue;
      }
      const re = new RegExp(
        `^${o.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('{datasetId}', '[a-z][a-z0-9_.-]+')}$`,
      );
      if (e.method.toLowerCase() !== o.method || !re.test(e.path)) {
        wrong.push(`${e.file}/${e.op}: ${e.method} ${e.path} ≠ ${o.method} ${o.path}`);
      }
      const want = e.file.endsWith('_gate')
        ? undefined
        : e.file.startsWith('calendar')
          ? 'W4.40'
          : 'W4.50';
      if (e.pending !== want) wrong.push(`${e.file}/${e.op}: pending ${e.pending} ≠ ${want}`);
    }
    assert.deepEqual(wrong, []);
  });
});
