// W2.51 · Стюард контракта этапа 2, часть 1 (0.6.0-stage2), только добавления: пул водителей (S2-14, AUTH-06/07,
// AC-06) — публикация водителя фирмой-источником, временное назначение со сроком и автозавершение; наборы «Данных»
// этапа 2 (S2-16, AC-14) — право набора, варианты выбора, поиск по видимым полям, число видимых строк; tenant 0014
// (Q-W2.02-14: индекс sched.reservations (bundle_id)). Бриф docs/plan/v2/ws/W2.51.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, PERMISSIONS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { escapeToken, parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';
const PUBS = `${T}/fleet/driver-pool/publications`;

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W2.51 §4. */
const OPS = [
  [
    'listDriverPoolPublications',
    'get',
    PUBS,
    'Fleet',
    ['fleet.driver_transfers.read'],
    'source-manager-or-owner',
  ],
  [
    'publishDriverToPool',
    'post',
    PUBS,
    'Fleet',
    ['fleet.driver_transfers.approve'],
    'source-manager-or-owner',
  ],
  [
    'getDriverPoolPublication',
    'get',
    `${PUBS}/{publicationId}`,
    'Fleet',
    ['fleet.driver_transfers.read'],
    'source-manager-or-owner',
  ],
  [
    'withdrawDriverPoolPublication',
    'post',
    `${PUBS}/{publicationId}/withdrawal`,
    'Fleet',
    ['fleet.driver_transfers.approve'],
    'source-manager-or-owner',
  ],
];
const NEW = OPS.map((o) => o[0]);
const COMMANDS = ['publishDriverToPool', 'withdrawDriverPoolPublication'];
/** Операции экранов пула и «Данных», которым нужны примеры успеха и ошибки (W2.23, W2.26). */
const WITH_EXAMPLES = [
  ...NEW,
  'listAvailableDrivers',
  'requestDriverTransfer',
  'listDriverTransfers',
  'decideDriverTransfer',
  'listDatasets',
  'queryDataset',
];
const TRANSFER_STATUS_0_1 = ['requested', 'approved', 'rejected', 'expired', 'revoked'];

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
const w251 = loadDeltas().filter((d) => /W2\.51/.test(d.source));

describe('контракт 0.6.0-stage2 (W2.51): пул водителей', () => {
  it('4 новые операции публикации: метод, путь, тег, x-permissions, x-scope', () => {
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

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf; снятие — с If-Match; ответы', () => {
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
    if (param('withdrawDriverPoolPublication', 'header', 'If-Match')?.required !== true) {
      gaps.push('withdrawDriverPoolPublication: If-Match');
    }
    for (const s of ['412', '428']) {
      if (!op('withdrawDriverPoolPublication').responses[s]) gaps.push(`withdraw: ответ ${s}`);
    }
    assert.deepEqual(gaps, []);
    assert.equal(okOf('publishDriverToPool', '201'), 'DriverPoolPublication');
    assert.equal(okOf('withdrawDriverPoolPublication', '200'), 'DriverPoolPublication');
    assert.equal(okOf('getDriverPoolPublication', '200'), 'DriverPoolPublication');
    assert.equal(okOf('listDriverPoolPublications', '200'), 'DriverPoolPublicationPage');
    assert.equal(bodyOf('publishDriverToPool'), 'DriverPoolPublicationCreate');
    assert.equal(bodyOf('withdrawDriverPoolPublication'), 'DriverPoolWithdrawal');
    assert.ok(op('getDriverPoolPublication').responses['200'].headers?.ETag, 'ETag публикации');
    assert.ok(param('getDriverPoolPublication', 'path', 'publicationId')?.required);
  });

  it('публикация: псевдоним пула, домашняя фирма, окно, квалификации, условия, состояние', () => {
    const p = schemas.DriverPoolPublication;
    for (const f of [
      'id',
      'driverMemberId',
      'driverDisplayName',
      'displayName',
      'homeOrgUnitId',
      'homeOrgUnitName',
      'qualifications',
      'freeWindow',
      'terms',
      'state',
      'publishedByMemberId',
      'publishedAt',
      'withdrawnAt',
      'revision',
    ]) {
      assert.ok(f in p.properties, `DriverPoolPublication.${f}`);
    }
    assert.deepEqual(p.properties.state.enum, ['active', 'withdrawn', 'expired']);
    assert.deepEqual(p.required, [
      'id',
      'driverMemberId',
      'displayName',
      'homeOrgUnitId',
      'qualifications',
      'freeWindow',
      'state',
      'publishedAt',
      'revision',
    ]);
    assert.match(p.properties.displayName.description, /Водитель #/);
    const c = schemas.DriverPoolPublicationCreate;
    assert.equal(c.additionalProperties, false);
    assert.deepEqual(c.required, [
      'driverMemberId',
      'homeOrgUnitId',
      'freeWindow',
      'qualifications',
    ]);
    assert.equal(c.properties.terms.maxLength, 500);
    assert.equal(
      schemas.DriverPoolWithdrawal.required,
      undefined,
      'комментарий снятия необязателен',
    );
    assert.deepEqual(schemas.DriverPoolPublicationPage.required, ['items', 'nextCursor']);
    const state = param('listDriverPoolPublications', 'query', 'state');
    assert.deepEqual(state?.schema?.enum, ['active', 'withdrawn', 'expired']);
    assert.equal(param('listDriverPoolPublications', 'query', 'homeOrgUnitId')?.required, false);
  });

  it('каталог пула: ссылка на публикацию и название домашней фирмы — необязательные поля', () => {
    const a = schemas.DriverAvailability;
    assert.equal(a.properties.publicationId.$ref?.split('/').pop(), 'Id');
    assert.equal(a.properties.homeOrgUnitName.type, 'string');
    assert.deepEqual(a.required, src.DriverAvailability.required, 'required 0.1');
  });

  it('запрос: статус completed (надмножество 0.1), временное назначение, кто и когда решил', () => {
    const t = schemas.DriverTransfer;
    const status = t.properties.status;
    assert.deepEqual(status.enum, [...TRANSFER_STATUS_0_1, 'completed']);
    for (const w of ['completed', 'expired', 'closing', 'AC-06', 'D09', 'AUTH-07']) {
      assert.ok(status.description.includes(w), `описание статуса: ${w}`);
    }
    for (const f of [
      'publicationId',
      'driverDisplayName',
      'sourceOrgUnitName',
      'targetOrgUnitName',
      'tripNumber',
      'reason',
      'requestedByMemberId',
      'requestedAt',
      'decidedByMemberId',
      'decidedAt',
      'decisionComment',
      'grant',
      'completedAt',
    ]) {
      assert.ok(f in t.properties, `DriverTransfer.${f}`);
    }
    assert.deepEqual(t.required, src.DriverTransfer.required, 'required 0.1 не меняется');
    assert.equal(name(t.properties.grant.$ref), 'TemporaryDriverGrant');
    const g = schemas.TemporaryDriverGrant;
    assert.deepEqual(g.properties.state.enum, ['scheduled', 'active', 'closing', 'ended']);
    assert.deepEqual(g.required, ['assignmentId', 'orgUnitId', 'validFrom', 'validUntil', 'state']);
    for (const f of ['tripId', 'endedAt', 'endReason']) assert.ok(f in g.properties, `grant.${f}`);
    assert.deepEqual(g.properties.endReason.enum, ['completed', 'revoked']);
  });

  it('listDriverTransfers: фильтры direction и status; параметры 0.1 на месте', () => {
    const was = source.paths[`${T}/fleet/driver-transfer-requests`].get.parameters;
    const now = op('listDriverTransfers').parameters;
    assert.deepEqual(now.slice(0, was.length), was, 'параметры 0.1 в том же порядке');
    const direction = param('listDriverTransfers', 'query', 'direction');
    assert.equal(direction?.required, false);
    assert.deepEqual(direction?.schema?.enum, ['incoming', 'outgoing']);
    const status = param('listDriverTransfers', 'query', 'status');
    assert.equal(status?.schema?.type, 'array');
    assert.deepEqual(status?.schema?.items?.enum, [...TRANSFER_STATUS_0_1, 'completed']);
  });

  it('права и коды — существующие: новых ключей и кодов ошибок нет; источник отпускает водителя', () => {
    const actions = flattenActions(loadCatalog());
    assert.equal(actions.size, 123);
    assert.equal(Object.keys(readYaml(ERRORS_PATH).codes).length, 52);
    // Ключи 11 сохраняются дословно (permissions.test.mjs W0.07) — пояснение W2.51 только комментарием каталога.
    const approve =
      readYaml(PERMISSIONS_PATH).modules.logistics.actions['fleet.driver_transfers.approve'];
    assert.equal(approve.note, undefined);
    const raw = readFileSync(PERMISSIONS_PATH, 'utf8');
    assert.match(raw, /#[^\n]*fleet\.driver_transfers\.approve[^\n]*publishDriverToPool/);
    assert.match(op('publishDriverToPool').description, /resources_unavailable/);
  });
});

describe('контракт 0.6.0-stage2 (W2.51): наборы «Данных» этапа 2', () => {
  it('Dataset: право набора, тип объекта строки, выгрузка, скрытые поля, сортировка по умолчанию', () => {
    const d = schemas.Dataset;
    for (const f of [
      'permissionKey',
      'entityType',
      'exportAllowed',
      'hiddenFieldLabels',
      'defaultSort',
    ]) {
      assert.ok(f in d.properties, `Dataset.${f}`);
    }
    assert.deepEqual(d.required, src.Dataset.required);
    const id = d.properties.id.description;
    for (const w of ['fleet.vehicles', 'fleet.trips', 'fleet.expenses', 'Автомобили', 'Поездки']) {
      assert.ok(id.includes(w), `Dataset.id: ${w}`);
    }
    assert.ok(id.includes('fleet.earnings.read'), 'поле «Начисление» — с правом начислений');
  });

  it('FieldDescriptor.options — варианты выбора (код и подпись)', () => {
    const o = schemas.FieldDescriptor.properties.options;
    assert.equal(o.type, 'array');
    assert.equal(name(o.items.$ref), 'ChoiceOption');
    assert.deepEqual(schemas.FieldDescriptor.required, src.FieldDescriptor.required);
  });

  it('DatasetQuery: поиск по видимым полям и число строк — необязательны; результат с visibleCount', () => {
    const q = schemas.DatasetQuery;
    assert.equal(q.properties.search.maxLength, 200);
    assert.equal(q.properties.includeCount.type, 'boolean');
    assert.deepEqual(q.required, src.DatasetQuery.required);
    const r = schemas.DatasetQueryResult;
    assert.equal(r.properties.visibleCount.type, 'integer');
    assert.equal(r.properties.visibleCountCapped.type, 'boolean');
    assert.deepEqual(r.required, src.DatasetQueryResult.required);
  });
});

// Возврат 1 (ревью W2.51): правила, которые MSW уже держал или должен держать, — в тексте контракта, чтобы W2.07 и
// W2.08 не выбрали иначе; хранимые поля снятия и отзыва; одна публичная ссылка на публикацию.
describe('контракт 0.6.0-stage2 (W2.51), возврат 1: правила пула и «Данных» в контракте', () => {
  const desc = (id) => op(id).description;
  const was = (id) => {
    const o = ops.get(id);
    return source.paths[o.path][o.method].description;
  };

  it('requestDriverTransfer: рейс — фирмы targetOrgUnitId, окно — внутри freeWindow, publicationId', () => {
    const c = schemas.DriverTransferCreate;
    assert.equal(
      name(c.properties.publicationId?.$ref),
      'Id',
      'DriverTransferCreate.publicationId',
    );
    assert.deepEqual(c.required, src.DriverTransferCreate.required, 'required 0.1');
    assert.ok(desc('requestDriverTransfer').startsWith(was('requestDriverTransfer')), 'текст 0.1');
    for (const w of [
      'targetOrgUnitId',
      'freeWindow',
      'publicationId',
      '422 validation_failed',
      'field tripId',
      'field window',
      '404',
    ]) {
      assert.ok(desc('requestDriverTransfer').includes(w), `requestDriverTransfer: ${w}`);
    }
    assert.match(c.properties.tripId.description, /targetOrgUnitId/);
    assert.match(c.properties.window.description ?? '', /freeWindow/);
    assert.match(c.properties.publicationId.description, /DriverAvailability\.publicationId/);
  });

  it('decideDriverTransfer: одобрение перепроверяет рейс (409) и сериализуется по водителю', () => {
    const d = desc('decideDriverTransfer');
    assert.ok(d.startsWith(was('decideDriverTransfer')), 'текст 0.1');
    for (const w of ['409 invalid_transition', 'already has a driver', 'resources_unavailable']) {
      assert.ok(d.includes(w), `decideDriverTransfer: ${w}`);
    }
    assert.match(d, /serializ/i, 'одобрения одного водителя сериализуются');
  });

  it('queryDataset: 403 известному набору без права, 404 неизвестному, одинаковый 422 полю; курсор', () => {
    const d = desc('queryDataset');
    assert.ok(d.startsWith(was('queryDataset')), 'текст 0.1');
    for (const w of ['403 forbidden_action', '404 not_found', '422 validation_failed', 'hidden']) {
      assert.ok(d.includes(w), `queryDataset: ${w}`);
    }
    const cursor = schemas.DatasetQuery.properties.cursor.description ?? '';
    for (const w of ['filters', 'search', 'sort', '400 malformed_request']) {
      assert.ok(cursor.includes(w), `DatasetQuery.cursor: ${w}`);
    }
  });

  it('публичная ссылка на публикацию одна — DriverPoolPublication.id; catalog_ref наружу не выходит', () => {
    const a = schemas.DriverAvailability.properties;
    assert.match(a.publicationId.description, /DriverPoolPublication\.id/);
    assert.match(a.publicationId.description, /catalog_ref/);
    assert.doesNotMatch(a.publicationId.description, /Random catalog reference/);
    const p = doc.components.parameters.publicationId.description;
    assert.match(p, /DriverPoolPublication\.id/);
    assert.doesNotMatch(p, /the catalog reference of AUTH-06/);
    assert.match(
      schemas.DriverTransfer.properties.publicationId.description,
      /DriverPoolPublication\.id/,
    );
  });

  it('driverMemberId каталога и запроса — только ссылка для запроса, не разрешается чужой фирмой', () => {
    for (const s of ['DriverAvailability', 'DriverTransfer']) {
      const d = schemas[s].properties.driverMemberId.description ?? '';
      assert.match(d, /members/, `${s}.driverMemberId`);
      assert.match(d, /404/, `${s}.driverMemberId`);
    }
  });

  it('publishDriverToPool: неизвестный и чужой сотрудник — одинаковый 422; пересечение с неснятыми', () => {
    const d = desc('publishDriverToPool');
    assert.doesNotMatch(d, /Unknown or invisible driver — 404/);
    assert.match(d, /same 422 validation_failed/);
    assert.match(schemas.DriverPoolPublicationCreate.description, /not withdrawn/);
    assert.match(schemas.DriverPoolPublication.properties.displayName.description, /retr/);
  });

  it('снятие хранит комментарий, отзыв — автора; закрытие рейса после окна — до приёмки', () => {
    const p = schemas.DriverPoolPublication.properties;
    assert.equal(p.withdrawalComment?.maxLength, 2000, 'DriverPoolPublication.withdrawalComment');
    assert.match(
      p.withdrawnByMemberId?.$ref ?? '',
      /Id$/,
      'DriverPoolPublication.withdrawnByMemberId',
    );
    assert.equal(p.withdrawnByMemberId.readOnly, true);
    const t = schemas.DriverTransfer.properties;
    assert.equal(t.revokedByMemberId?.readOnly, true, 'DriverTransfer.revokedByMemberId');
    for (const w of ['accepted or cancelled', 'rework']) {
      assert.ok(t.status.description.includes(w), `DriverTransfer.status: ${w}`);
      assert.ok(
        schemas.TemporaryDriverGrant.properties.state.description.includes(w),
        `TemporaryDriverGrant.state: ${w}`,
      );
    }
  });
});

// Возврат 2 (ревью W2.51): одно правило выбора публикации без publicationId — в описании операции, в описании поля и
// в MSW (вариант А ревью): 404 — только водителю без активной публикации; окно вне freeWindow выбранной публикации —
// 422 window. publishDriverToPool: невидимая фирма отвечает как несуществующая (AC-01, как createTripPlan), ответ не
// выдаёт, какие фирмы есть.
describe('контракт 0.6.0-stage2 (W2.51), возврат 2: выбор публикации и порядок проверок', () => {
  const desc = (id) => op(id).description;

  it('requestDriverTransfer без publicationId: пересекающаяся публикация, 404 — нет активной, иначе 422 window', () => {
    const d = desc('requestDriverTransfer');
    const field = schemas.DriverTransferCreate.properties.publicationId.description;
    for (const [where, text] of [
      ['requestDriverTransfer', d],
      ['DriverTransferCreate.publicationId', field],
    ]) {
      assert.match(
        text,
        /contains window, otherwise .*overlaps window/,
        `${where}: запасной выбор`,
      );
      assert.match(text, /earliest freeWindow\.startsAt/, `${where}: детерминированный выбор`);
      assert.match(text, /no active publication[^.]*404/, `${where}: 404 — только без публикации`);
      assert.match(text, /outside_free_window/, `${where}: окно вне — 422 window`);
    }
    assert.doesNotMatch(field, /whose freeWindow contains window\.$/, 'старое правило поля');
  });

  it('publishDriverToPool: невидимая фирма — как несуществующая (одинаковый 422), 403 — видимой без права', () => {
    const d = desc('publishDriverToPool');
    assert.match(d, /no fleet\.driver_transfers\.approve in any company[^.]*403 forbidden_action/);
    assert.match(
      d,
      /unknown homeOrgUnitId and a company the actor cannot see \(org_units\.read\)[^.]*same 422 validation_failed[^.]*field homeOrgUnitId/,
    );
    assert.match(d, /visible company without the right[^.]*403 forbidden_action/);
  });
});

describe('контракт 0.6.0-stage2 (W2.51): аддитивность, примеры, экраны, миграции, версия', () => {
  it('дельты W2.51: новые пути и схемы — add; change — только надмножество перечисления', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w251.map((d) => d.pointer));
    for (const p of [PUBS, `${PUBS}/{publicationId}`, `${PUBS}/{publicationId}/withdrawal`]) {
      assert.ok(pointers.has(`/paths/${escapeToken(p)}`), `дельта пути ${p}`);
    }
    for (const s of [
      'DriverPoolPublication',
      'DriverPoolPublicationCreate',
      'DriverPoolPublicationPage',
      'DriverPoolWithdrawal',
      'TemporaryDriverGrant',
    ]) {
      assert.ok(pointers.has(`/components/schemas/${s}`), `дельта схемы ${s}`);
    }
    // /info/version — общая дельта версии (источник перечисляет все PR), не перечисление.
    for (const d of w251.filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      if (d.pointer.endsWith('/enum')) {
        const was = at(source, d.pointer);
        const now = at(doc, d.pointer);
        assert.ok(
          was.every((v) => now.includes(v)) && now.length > was.length,
          `${d.pointer}: не надмножество`,
        );
      } else if (d.pointer.endsWith('/description')) {
        // Возврат 1: правила операции 0.1 дописываются после её текста — описание 0.1 сохраняется дословно.
        const was = at(source, d.pointer);
        const now = at(doc, d.pointer);
        assert.ok(
          typeof was === 'string' && now.startsWith(was) && now.length > was.length,
          `${d.pointer}: описание 0.1 не сохранено в начале`,
        );
      } else {
        assert.match(d.pointer, /\/parameters$/, `${d.pointer}: change не по перечислению`);
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W2\.51/);
  });

  it('примеры: у операций пула и «Данных» есть успех и ошибка; все примеры валидны', () => {
    const examples = loadExamples();
    const codes = readYaml(ERRORS_PATH).codes;
    const gaps = [];
    for (const id of WITH_EXAMPLES) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      if (!names.some((n) => !(n in codes))) gaps.push(`${id}: нет примера успеха`);
      if (!names.some((n) => n in codes)) gaps.push(`${id}: нет примера ошибки`);
    }
    assert.deepEqual(gaps, []);
    assert.deepEqual(checkExamples(doc, examples), []);
  });

  it('screens.yaml: операции публикации — у экрана logistics-pool', () => {
    const pool = readYaml(SCREENS_PATH).screens['logistics-pool'];
    for (const id of NEW) assert.ok(pool.operations.includes(id), id);
    assert.match(pool.note, /W2\.51/);
  });

  // W2.52 выдал 0015–0017: резерв этапа 2 — очередь, его начало сдвигается.
  it('реестр миграций api/README.md: tenant 0014 выдан W2.51, резерв этапа 2 до 0019', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0014\s*\|\s*`0014_fleet_driver_pool_reservation_bundle\.sql`[^|]*\|\s*W2\.51/,
    );
    assert.match(readme, /\|\s*tenant\s*\|\s*001[5-9]–0019\s*\|/);
  });

  // W2.52 поднимает patch (0.6.1-stage2): проверяется «не ниже 0.6.0-stage2».
  it('версия контракта — не ниже 0.6.0-stage2', () => {
    const m = /^0\.(\d+)\.(\d+)-stage2$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[1]) >= 6, doc.info.version);
  });
});
