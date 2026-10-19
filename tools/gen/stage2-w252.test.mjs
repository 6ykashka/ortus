// W2.52 · Стюард контракта этапа 2, часть 2 (0.6.1-stage2), только добавления — ответы владельца продукта 17.10:
// справочник категорий расходов тенанта (D-12 комплекта, W2.41; коды посева остаются валидными), история принадлежности машины
// (модель данных 2, W2.42), антифрод фото (модель данных 4, W2.43), чек-лист в формате FormDefinition (D-30 комплекта, W2.45),
// поля задачи у дефекта в очереди (D-29 комплекта, W2.46), заменители интеграций D-11 (W2.50): импорт CSV машин, выгрузка CSV
// расходов и рейсов, адрес остановки для ссылки навигатора. Бриф docs/plan/v2/ws/W2.52.md §4.
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
const CATS = `${T}/fleet/expense-categories`;
const ASSIGN = `${T}/fleet/vehicles/{vehicleId}/assignments`;
const IMPORTS = `${T}/fleet/vehicle-imports`;
/** Шесть кодов посева справочника (ответ владельца 17.10 на D-12 комплекта; контракт 0.5.1-stage2, W2.40). */
const SEED_KINDS = ['fuel', 'wash', 'parking', 'toll', 'tire_service', 'other'];
const CODE = '^[a-z][a-z0-9_]{1,49}$';

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W2.52 §4. */
const OPS = [
  ['listExpenseCategories', 'get', CATS, 'Fleet', ['fleet.expenses.read'], 'tenant-org-unit-self'],
  ['createExpenseCategory', 'post', CATS, 'Fleet', ['modules.settings.manage'], 'tenant'],
  [
    'archiveExpenseCategory',
    'post',
    `${CATS}/{categoryCode}/archive`,
    'Fleet',
    ['modules.settings.manage'],
    'tenant',
  ],
  [
    'listVehicleAssignments',
    'get',
    ASSIGN,
    'Fleet',
    ['fleet.vehicles.read'],
    'tenant-org-unit-resource-pool',
  ],
  ['moveVehicle', 'post', ASSIGN, 'Fleet', ['fleet.vehicles.manage'], 'tenant-or-org-unit'],
  [
    'assignInspectionDefect',
    'post',
    `${T}/fleet/defects/{defectId}/assignment`,
    'Fleet',
    ['fleet.inspections.review'],
    'responsible-manager-or-owner',
  ],
  [
    'createVehicleImport',
    'post',
    IMPORTS,
    'Fleet',
    ['fleet.vehicles.manage'],
    'tenant-or-org-unit',
  ],
  [
    'getVehicleImport',
    'get',
    `${IMPORTS}/{importId}`,
    'Fleet',
    ['fleet.vehicles.manage'],
    'tenant-or-org-unit',
  ],
  [
    'commitVehicleImport',
    'post',
    `${IMPORTS}/{importId}/commit`,
    'Fleet',
    ['fleet.vehicles.manage'],
    'tenant-or-org-unit',
  ],
  [
    'exportDataset',
    'post',
    `${T}/datasets/{datasetId}/export`,
    'Data',
    ['data.export'],
    'effective-module-and-field-scopes',
  ],
];
const NEW = OPS.map((o) => o[0]);
const COMMANDS = [
  'createExpenseCategory',
  'archiveExpenseCategory',
  'moveVehicle',
  'assignInspectionDefect',
  'createVehicleImport',
  'commitVehicleImport',
];
const IF_MATCH = [
  'archiveExpenseCategory',
  'moveVehicle',
  'assignInspectionDefect',
  'commitVehicleImport',
];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, name) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === name.toLowerCase());
const name = (ref) => ref?.split('/').pop();
const bodyOf = (id) => name(op(id).requestBody?.content?.['application/json']?.schema?.$ref);
const okOf = (id, status) =>
  name(op(id).responses[status]?.content?.['application/json']?.schema?.$ref);
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w252 = loadDeltas().filter((d) => /W2\.52/.test(d.source));

describe('контракт 0.6.1-stage2 (W2.52): операции и права', () => {
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
      if (param(id, 'header', 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
    }
    if (!op('createVehicleImport').responses['413']) gaps.push('createVehicleImport: 413');
    // Выгрузка — читающий POST, как queryDataset: CSRF и Origin, без Idempotency-Key.
    if (!param('exportDataset', 'header', 'X-CSRF-Token')) gaps.push('exportDataset: CSRF');
    if (param('exportDataset', 'header', 'Idempotency-Key'))
      gaps.push('exportDataset: idempotency');
    assert.deepEqual(gaps, []);
    assert.equal(okOf('listExpenseCategories', '200'), 'ExpenseCategoryPage');
    assert.equal(okOf('createExpenseCategory', '201'), 'ExpenseCategory');
    assert.equal(okOf('archiveExpenseCategory', '200'), 'ExpenseCategory');
    assert.equal(bodyOf('createExpenseCategory'), 'ExpenseCategoryCreate');
    assert.equal(okOf('listVehicleAssignments', '200'), 'VehicleAssignmentPage');
    assert.equal(okOf('moveVehicle', '200'), 'Vehicle');
    assert.ok(op('moveVehicle').responses['200'].headers?.ETag, 'ETag машины после перемещения');
    assert.equal(bodyOf('moveVehicle'), 'VehicleMove');
    assert.equal(okOf('assignInspectionDefect', '200'), 'InspectionDefect');
    assert.equal(bodyOf('assignInspectionDefect'), 'DefectAssignment');
    assert.equal(okOf('createVehicleImport', '201'), 'VehicleImport');
    assert.equal(okOf('getVehicleImport', '200'), 'VehicleImport');
    assert.equal(okOf('commitVehicleImport', '200'), 'VehicleImport');
    assert.equal(bodyOf('createVehicleImport'), 'VehicleImportCreate');
    assert.equal(bodyOf('commitVehicleImport'), 'VehicleImportCommit');
    assert.equal(okOf('exportDataset', '200'), 'DatasetExport');
    assert.equal(bodyOf('exportDataset'), 'DatasetExportCreate');
    for (const [p, id] of [
      ['vehicleId', 'listVehicleAssignments'],
      ['categoryCode', 'archiveExpenseCategory'],
    ]) {
      assert.ok(param(id, 'path', p)?.required, `параметр пути ${p}`);
      assert.ok(doc.components.parameters[p], `components.parameters.${p}`);
    }
    assert.equal(doc.components.parameters.categoryCode.schema.pattern, CODE);
  });

  it('новых ключей прав и кодов ошибок нет: справочник — настройки модуля, выгрузка — data.export', () => {
    const actions = flattenActions(loadCatalog());
    assert.equal(actions.size, 123);
    assert.equal(Object.keys(readYaml(ERRORS_PATH).codes).length, 52);
    assert.match(op('exportDataset').description, /data\.export/);
    assert.match(op('exportDataset').description, /dataset (own )?permission/);
  });
});

describe('контракт 0.6.1-stage2 (W2.52): справочник категорий расходов (W2.41, D-12 комплекта)', () => {
  it('ExpenseCategory: код, подпись, «комментарий обязателен», посев, состояние, ревизия', () => {
    const c = schemas.ExpenseCategory;
    for (const f of [
      'code',
      'label',
      'commentRequired',
      'seeded',
      'state',
      'archivedAt',
      'archivedByMemberId',
      'createdAt',
      'revision',
    ]) {
      assert.ok(f in c.properties, `ExpenseCategory.${f}`);
    }
    assert.deepEqual(c.required, [
      'code',
      'label',
      'commentRequired',
      'seeded',
      'state',
      'createdAt',
      'revision',
    ]);
    assert.deepEqual(c.properties.state.enum, ['active', 'archived']);
    assert.equal(c.properties.code.pattern, CODE);
    for (const k of SEED_KINDS) assert.ok(c.properties.code.description.includes(k), k);
    const cr = schemas.ExpenseCategoryCreate;
    assert.equal(cr.additionalProperties, false);
    assert.deepEqual(cr.required, ['label', 'commentRequired']);
    assert.equal(cr.properties.label.maxLength, 100);
    assert.equal(cr.properties.code.pattern, CODE);
    assert.deepEqual(schemas.ExpenseCategoryPage.required, ['items', 'nextCursor']);
    assert.equal(
      param('listExpenseCategories', 'query', 'includeArchived')?.schema?.type,
      'boolean',
    );
    assert.match(op('archiveExpenseCategory').description, /other/);
    assert.match(op('archiveExpenseCategory').description, /409 invalid_transition/);
  });

  it('kind расхода — код справочника (без перечисления), шесть кодов посева валидны', () => {
    for (const s of ['TripExpenseCreate', 'TripExpense']) {
      const k = schemas[s].properties.kind;
      assert.equal(k.type, 'string', `${s}.kind`);
      assert.equal(k.enum, undefined, `${s}.kind: перечисление снято`);
      assert.equal(k.pattern, CODE, `${s}.kind.pattern`);
      assert.deepEqual(k.examples, SEED_KINDS, `${s}.kind.examples`);
      assert.deepEqual(schemas[s].required, src[s].required, `${s}: required 0.1`);
    }
    const d = schemas.TripExpenseCreate.properties.kind.description;
    for (const w of [
      'fleet.expense_categories',
      'unknown_category',
      'archived_category',
      'commentRequired',
    ]) {
      assert.ok(d.includes(w), `TripExpenseCreate.kind: ${w}`);
    }
    assert.match(
      schemas.TripExpenseCreate.properties.comment.description,
      /Для категории «\{label\}» добавьте комментарий/,
    );
  });
});

describe('контракт 0.6.1-stage2 (W2.52): машина, фото, чек-лист, дефект', () => {
  it('история машины: VehicleAssignment, VehicleMove, Vehicle.orgUnitSince (W2.42)', () => {
    const a = schemas.VehicleAssignment;
    for (const f of [
      'id',
      'vehicleId',
      'orgUnitId',
      'orgUnitName',
      'validFrom',
      'validTo',
      'reason',
      'assignedByMemberId',
    ]) {
      assert.ok(f in a.properties, `VehicleAssignment.${f}`);
    }
    assert.deepEqual(a.required, ['id', 'vehicleId', 'orgUnitId', 'validFrom', 'validTo']);
    assert.deepEqual(a.properties.validTo.type, ['string', 'null']);
    const m = schemas.VehicleMove;
    assert.equal(m.additionalProperties, false);
    assert.deepEqual(m.required, ['orgUnitId', 'reason']);
    assert.equal(m.properties.reason.maxLength, 500);
    const since = schemas.Vehicle.properties.orgUnitSince;
    assert.equal(since?.readOnly, true);
    assert.deepEqual(schemas.Vehicle.required, src.Vehicle.required);
    assert.match(
      op('moveVehicle').description,
      /fleet\.vehicles\.manage over the current and the target/,
    );
    assert.match(op('listVehicleAssignments').description, /outside the scope/);
  });

  it('антифрод фото: предупреждение о повторе sha256 и серверное время у файла и фото осмотра (W2.43)', () => {
    const w = schemas.FileDuplicateWarning;
    assert.deepEqual(w.required, ['code', 'firstSeenAt', 'previousCount', 'sameOwner']);
    assert.deepEqual(w.properties.code.enum, ['duplicate_sha256']);
    assert.equal(w.properties.previousCount.minimum, 1);
    assert.match(w.description, /never blocks/);
    assert.equal(name(schemas.File.properties.duplicateWarning?.$ref), 'FileDuplicateWarning');
    const p = schemas.InspectionPhoto.properties;
    assert.equal(p.serverCapturedAt?.readOnly, true, 'InspectionPhoto.serverCapturedAt');
    assert.equal(name(p.duplicateWarning?.$ref), 'FileDuplicateWarning');
    assert.deepEqual(schemas.InspectionPhoto.required, src.InspectionPhoto.required);
    assert.deepEqual(schemas.File.required, src.File.required);
    assert.match(p.serverCapturedAt.description, /completeUpload/);
    assert.match(p.capturedAt.description ?? '', /advisory/);
  });

  it('чек-лист — FormDefinition (W2.45, D-30 комплекта): definition, blockingValues у поля формы', () => {
    const c = schemas.InspectionChecklist;
    assert.equal(name(c.properties.definition?.$ref), 'FormDefinition');
    assert.deepEqual(c.required, src.InspectionChecklist.required);
    for (const w of [
      'photo_',
      'single_choice',
      'pass',
      'fail',
      'blockingValues',
      'Осмотр перед выездом',
    ]) {
      assert.ok(c.properties.definition.description.includes(w), `definition: ${w}`);
    }
    const f = schemas.FormField.properties.blockingValues;
    assert.equal(f?.type, 'array');
    assert.equal(f.maxItems, 20);
    assert.deepEqual(schemas.FormField.required, src.FormField.required);
  });

  it('поля задачи у дефекта (W2.46, D-29 комплекта): исполнитель, срок, кто и когда назначил; команда назначения', () => {
    const d = schemas.InspectionDefect.properties;
    for (const f of [
      'assigneeMemberId',
      'assigneeDisplayName',
      'dueAt',
      'assignedByMemberId',
      'assignedAt',
    ]) {
      assert.ok(f in d, `InspectionDefect.${f}`);
    }
    assert.deepEqual(schemas.InspectionDefect.required, [
      'id',
      'vehicleId',
      'inspectionId',
      'zone',
      'description',
      'severity',
      'state',
      'reportedAt',
      'reportedByMemberId',
      'revision',
    ]);
    const a = schemas.DefectAssignment;
    assert.equal(a.additionalProperties, false);
    assert.deepEqual(a.required, ['assigneeMemberId', 'dueAt']);
    assert.match(op('assignInspectionDefect').description, /in_review/);
    assert.match(op('assignInspectionDefect').description, /4\.1/);
  });
});

describe('контракт 0.6.1-stage2 (W2.52): заменители интеграций D-11 комплекта (W2.50)', () => {
  it('импорт CSV машин: предпросмотр, строки, итоги, применение', () => {
    const c = schemas.VehicleImportCreate;
    assert.deepEqual(c.required, ['fileName', 'csv', 'defaultOrgUnitId']);
    assert.equal(c.properties.csv.maxLength, 1048576);
    const r = schemas.VehicleImportRow;
    assert.deepEqual(r.properties.action.enum, ['create', 'update', 'skip', 'error']);
    assert.deepEqual(r.required, ['line', 'action', 'errors']);
    assert.deepEqual(schemas.VehicleImportTotals.required, [
      'rows',
      'create',
      'update',
      'skip',
      'error',
    ]);
    assert.deepEqual(schemas.VehicleImport.required, [
      'id',
      'state',
      'fileName',
      'defaultOrgUnitId',
      'totals',
      'rows',
      'createdAt',
      'expiresAt',
      'revision',
    ]);
    assert.deepEqual(schemas.VehicleImportCommit.required, ['skipInvalidRows']);
    const d = op('createVehicleImport').description;
    for (const w of [
      'registration_number',
      'display_name',
      'body_type',
      'payload_kg',
      'org_unit',
      '2000',
    ]) {
      assert.ok(d.includes(w), `createVehicleImport: ${w}`);
    }
  });

  it('выгрузка CSV: тело запроса как выборка без пагинации, CSV в ответе, лимит строк', () => {
    const c = schemas.DatasetExportCreate;
    assert.equal(c.additionalProperties, false);
    assert.deepEqual(c.required, ['select', 'filters', 'sort']);
    const e = schemas.DatasetExport;
    assert.deepEqual(e.required, [
      'datasetId',
      'fileName',
      'contentType',
      'content',
      'rowCount',
      'rowLimit',
      'truncated',
      'generatedAt',
    ]);
    assert.equal(e.properties.contentType.const, 'text/csv; charset=utf-8');
    assert.equal(e.properties.rowLimit.maximum, 10000);
    const d = op('exportDataset').description;
    for (const w of [
      'fleet.expenses',
      'fleet.trips',
      ';',
      'formula',
      '403 forbidden_action',
      '422 validation_failed',
    ]) {
      assert.ok(d.includes(w), `exportDataset: ${w}`);
    }
    assert.match(schemas.Dataset.properties.exportAllowed.description, /exportDataset/);
  });

  it('адрес остановки для ссылки навигатора: TripStop.navigationAddress, шаблон ссылки', () => {
    const s = schemas.TripStop;
    assert.equal(s.properties.navigationAddress?.maxLength, 500);
    assert.match(s.properties.navigationAddress.description, /yandex\.ru\/maps/);
    assert.deepEqual(s.required, ['sequence', 'op', 'address', 'weightKg', 'volumeM3']);
  });
});

describe('контракт 0.6.1-stage2 (W2.52): аддитивность, примеры, экраны, миграции, версия', () => {
  it('дельты W2.52: новые пути и схемы — add; change — kind расхода и описания с текстом 0.1 в начале', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w252.map((d) => d.pointer));
    for (const p of [
      CATS,
      `${CATS}/{categoryCode}/archive`,
      ASSIGN,
      `${T}/fleet/defects/{defectId}/assignment`,
      IMPORTS,
      `${IMPORTS}/{importId}`,
      `${IMPORTS}/{importId}/commit`,
      `${T}/datasets/{datasetId}/export`,
    ]) {
      assert.ok(pointers.has(`/paths/${escapeToken(p)}`), `дельта пути ${p}`);
    }
    for (const s of [
      'ExpenseCategory',
      'ExpenseCategoryCreate',
      'ExpenseCategoryPage',
      'VehicleAssignment',
      'VehicleAssignmentPage',
      'VehicleMove',
      'DefectAssignment',
      'VehicleImport',
      'VehicleImportCreate',
      'VehicleImportCommit',
      'VehicleImportRow',
      'VehicleImportTotals',
      'DatasetExportCreate',
      'DatasetExport',
      'FileDuplicateWarning',
    ]) {
      assert.ok(pointers.has(`/components/schemas/${s}`), `дельта схемы ${s}`);
    }
    for (const d of w252.filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      if (d.pointer.endsWith('/description')) {
        const was = at(source, d.pointer);
        const now = at(doc, d.pointer);
        assert.ok(
          typeof was === 'string' && now.startsWith(was) && now.length > was.length,
          `${d.pointer}: описание 0.1 не сохранено в начале`,
        );
      } else {
        assert.match(d.pointer, /\/properties\/kind$/, `${d.pointer}: change не по kind расхода`);
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W2\.52/);
  });

  it('примеры: у новых операций есть успех и ошибка; все примеры валидны', () => {
    const examples = loadExamples();
    const codes = readYaml(ERRORS_PATH).codes;
    const gaps = [];
    for (const id of NEW) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      if (!names.some((n) => !(n in codes))) gaps.push(`${id}: нет примера успеха`);
      if (!names.some((n) => n in codes)) gaps.push(`${id}: нет примера ошибки`);
    }
    assert.deepEqual(gaps, []);
    assert.deepEqual(checkExamples(doc, examples), []);
    // Пример чек-листа несёт определение формы; пример осмотра — серверное время фото.
    assert.ok(examples.get('getInspectionChecklist').get('ok').definition?.fields?.length);
    assert.ok(
      examples
        .get('submitInspection')
        .get('ok')
        .photos.every((p) => p.serverCapturedAt),
    );
  });

  it('screens.yaml: экраны справочника и импорта, операции — у экранов водителя, логиста, дефектов, «Данных»', () => {
    const s = readYaml(SCREENS_PATH).screens;
    const want = {
      'company-expense-categories': [
        'listExpenseCategories',
        'createExpenseCategory',
        'archiveExpenseCategory',
      ],
      'logistics-vehicle-import': [
        'createVehicleImport',
        'getVehicleImport',
        'commitVehicleImport',
      ],
      'logistics-fleet': ['listVehicleAssignments', 'moveVehicle'],
      'logistics-defects': ['assignInspectionDefect'],
      'driver-today': ['listExpenseCategories'],
      'core-data': ['exportDataset'],
    };
    const gaps = [];
    for (const [key, list] of Object.entries(want)) {
      for (const id of list) if (!s[key]?.operations?.includes(id)) gaps.push(`${key}: ${id}`);
    }
    assert.deepEqual(gaps, []);
    for (const key of ['company-expense-categories', 'logistics-vehicle-import']) {
      assert.equal(s[key].stage, 2);
      assert.match(s[key].reference, /^no-reference/);
      assert.match(s[key].note ?? '', /W2\.52/);
    }
  });

  // W2.57 выдал 0018: резерв этапа 2 — очередь, его начало сдвигается.
  it('реестр миграций api/README.md: tenant 0015–0017 выданы W2.52, резерв этапа 2 до 0019', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    for (const [n, file] of [
      ['0015', '0015_fleet_expense_categories.sql'],
      ['0016', '0016_fleet_vehicle_assignments_imports.sql'],
      ['0017', '0017_fleet_inspection_evidence_tasks.sql'],
    ]) {
      const re = new RegExp(
        `\\|\\s*tenant\\s*\\|\\s*${n}\\s*\\|\\s*\`${file.replace('.', '\\.')}\`[^|]*\\|\\s*W2\\.52`,
      );
      assert.match(readme, re, n);
    }
    assert.match(readme, /\|\s*tenant\s*\|\s*(0018–)?0019\s*\|/);
  });

  // W2.57 поднимает patch (0.6.2-stage2), W4.02 — этап (0.7.0-stage4): проверяется «не ниже 0.6.1-stage2».
  it('версия контракта — не ниже 0.6.1-stage2', () => {
    const m = /^0\.(\d+)\.(\d+)-stage[2-9]$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    const [minor, patch] = [Number(m[1]), Number(m[2])];
    assert.ok(minor > 6 || (minor === 6 && patch >= 1), doc.info.version);
  });
});

describe('контракт 0.6.1-stage2 (W2.52): уточнения ревью (возврат 1)', () => {
  it('выгрузка: апостроф — только у текстовых ячеек (и после ведущих пробелов), числа и деньги — без него', () => {
    const d = op('exportDataset').description;
    assert.match(d, /text, choices, reference and files cells/);
    assert.match(d, /after leading whitespace/);
    assert.match(d, /money, decimal, date, instant and boolean cells are never prefixed/);
    assert.match(d, /-1234,50/);
  });

  it('импорт машин: неизвестная и невидимая фирма — одинаковый ответ (по названиям фирмы вне области не перебрать)', () => {
    const d = op('createVehicleImport').description;
    assert.match(
      d,
      /An unknown defaultOrgUnitId and one the actor cannot see — the same 422 validation_failed \(field defaultOrgUnitId, code unknown, «Подразделение не найдено\.»\)/,
    );
    assert.match(d, /a visible company without fleet\.vehicles\.manage — 403 forbidden_action/);
    assert.match(
      d,
      /an org_unit that is unknown and one outside the scope of the actor — the same row error text «Подразделение не найдено\.»/,
    );
  });

  it('справочник: одновременные создания без code не сталкиваются — сервер берёт следующий свободный custom_<N>', () => {
    const d = op('createExpenseCategory').description;
    assert.match(d, /Concurrent creations without code/);
    assert.match(d, /next free custom_<N>/);
    assert.match(d, /never answer 409/);
  });

  it('страница истории машины ограничена, как остальные страницы: maxItems = максимум Limit', () => {
    const max = doc.components.parameters.Limit.schema.maximum;
    assert.equal(schemas.VehicleAssignmentPage.properties.items.maxItems, max);
    assert.equal(max, 200);
  });
});
