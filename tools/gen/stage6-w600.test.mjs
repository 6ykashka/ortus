// W6.00 · Контрактный PR этапа 6 (0.12.0-stage6, номер версии согласует интегратор): «Ремонт и стройка» — объекты,
// отметки и приёмка, допработы, замер, сметы, справочник и шаблоны, график, документы и подпись по SMS, снабжение,
// финансы, начисления, подрядчики, ссылка и публичный кабинет заказчика. Разбор docs/plan/v2/analysis/dor/repair.md §2.2,
// решения Q-W4.00-repair-1…24; эталон design-2026-10-19. Бриф docs/plan/v2/ws/W6.00.md.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { W5_CODES } from './lib/stage5.mjs';
import { STAGE7_CODES } from './lib/stage7.mjs';
import { readYaml } from './lib/yaml-io.mjs';
import {
  CHANGED_SCHEMAS,
  DECISION_KINDS,
  LEGACY,
  NEW_PERMISSIONS,
  OPERATIONS,
  REASONS,
  REJECT_REASONS,
  SCHEDULE_REASONS,
  SCREENS,
  SUPPLY_STATES,
  UNITS,
  VERSION,
} from './stage6-w600-spec.mjs';

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
const props = (s) => Object.keys(schemas[s]?.properties ?? {});
const prop = (s, p) => schemas[s]?.properties?.[p];
const commands = OPERATIONS.filter((o) => o.method !== 'get' && !o.public);

describe('контракт 0.12.0-stage6 (W6.00): операции и права', () => {
  it('версия контракта — 0.12.0-stage6 (после W7.00 — 0.12.0-stage7)', () => {
    assert.equal(VERSION, '0.12.0-stage6');
    assert.match(doc.info.version, /^0\.12\.0-stage[67]$/);
  });

  it('тег Repairs: 66 операций (4 из 0.1 переделаны, остальные — добавления): метод, путь, x-permissions, x-scope', () => {
    assert.equal(OPERATIONS.length, 66);
    assert.equal(LEGACY.length, 4);
    const wrong = [];
    for (const o of OPERATIONS) {
      const got = ops.get(o.id);
      if (!got) {
        wrong.push(`${o.id}: нет в бандле`);
        continue;
      }
      const have = [got.method, got.path, got.tag, got.op['x-permissions'], got.op['x-scope']];
      const want = [o.method, o.path, 'Repairs', o.perms, o.scope];
      if (JSON.stringify(have) !== JSON.stringify(want)) {
        wrong.push(`${o.id}: ${JSON.stringify(have)} ≠ ${JSON.stringify(want)}`);
      }
      if (got.op['x-permissions-mode'] !== o.mode) wrong.push(`${o.id}: режим ${o.mode}`);
    }
    assert.deepEqual(wrong, []);
    const inBundle = [...ops.values()].filter((o) => o.tag === 'Repairs').length;
    assert.equal(inBundle, 66, 'в бандле нет лишних операций Repairs');
  });

  it('операции 0.1 Repairs на месте и не устарели; путь объекта — /repairs/projects/{projectId} (Q-W4.00-repair-1)', () => {
    for (const id of LEGACY) assert.ok(op(id), id);
    for (const o of OPERATIONS) assert.notEqual(op(o.id).deprecated, true, o.id);
    assert.ok(
      !Object.keys(doc.paths).some((p) => p.includes('/repairs/objects')),
      '/repairs/objects/* из docs/19 переименованы',
    );
  });

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf, ответы; If-Match — по таблице, 412 и 428', () => {
    const gaps = [];
    for (const o of commands) {
      const id = o.id;
      if (param(id, 'header', 'Idempotency-Key')?.required !== true)
        gaps.push(`${id}: Idempotency-Key`);
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['401', '403', '404', '422', '429']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
      const im = param(id, 'header', 'If-Match');
      if (o.ifMatch !== Boolean(im)) gaps.push(`${id}: If-Match ${Boolean(im)}`);
      if (o.ifMatch) {
        for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    for (const o of OPERATIONS.filter((x) => x.method === 'get')) {
      if (param(o.id, 'header', 'Idempotency-Key')) gaps.push(`${o.id}: чтение с Idempotency-Key`);
    }
    assert.deepEqual(gaps, []);
  });

  it('тела запросов и ответов: схемы и статусы успеха по таблице; ETag у ресурсов с ревизией', () => {
    const wrong = [];
    for (const o of OPERATIONS) {
      const status = o.status;
      if (!op(o.id).responses[status]) wrong.push(`${o.id}: нет ответа ${status}`);
      if ((okOf(o.id, status) ?? null) !== (o.res ?? null)) {
        wrong.push(`${o.id}: ответ ${okOf(o.id, status)} ≠ ${o.res}`);
      }
      if ((bodyOf(o.id) ?? null) !== (o.req ?? null))
        wrong.push(`${o.id}: тело ${bodyOf(o.id)} ≠ ${o.req}`);
      const revisioned = o.res && 'revision' in (schemas[o.res]?.properties ?? {});
      if (revisioned && !op(o.id).responses[status].headers?.ETag) wrong.push(`${o.id}: ETag`);
    }
    assert.deepEqual(wrong, []);
  });

  it('публичный контур заказчика: security [], x-public-capability, без прав, ссылка на токен, 410 по сроку', () => {
    for (const id of ['getClientCabinet', 'approveEstimateByClient', 'signDocumentByClient']) {
      assert.deepEqual(op(id).security, [], id);
      assert.deepEqual(op(id)['x-permissions'], [], id);
      assert.match(op(id)['x-public-capability'], /clientToken/, id);
      assert.ok(op(id).responses['410'], `${id}: 410 public_token_expired`);
      assert.ok(
        doc.paths[ops.get(id).path].parameters.some((p) => deref(p).name === 'clientToken'),
      );
    }
    assert.ok(op('signDocumentByClient').responses['409']);
    assert.equal(bodyOf('signDocumentByClient'), 'ClientSign');
  });

  it('параметры: фильтры списка объектов, отметок, закупок, сравнения версий; порядок — Cursor, Limit, затем фильтры', () => {
    const names = (id) => (op(id).parameters ?? []).map((p) => deref(p).name);
    assert.deepEqual(names('listRepairProjects').slice(0, 2), ['cursor', 'limit']);
    assert.deepEqual(param('listRepairProjects', 'query', 'filter').schema.enum, [
      'active',
      'todo',
      'draft',
      'done',
    ]);
    assert.ok(param('listRepairProjects', 'query', 'q'));
    assert.deepEqual(param('listWorkLogs', 'query', 'status').schema.enum, [
      'submitted',
      'accepted',
      'rejected',
    ]);
    assert.ok(param('listWorkLogs', 'query', 'projectId'));
    assert.deepEqual(param('listSupplyRequests', 'query', 'state').schema.enum, SUPPLY_STATES);
    assert.equal(param('diffEstimates', 'query', 'to').required, true);
    assert.equal(param('getEstimate', 'path', 'version').schema.type, 'integer');
    assert.match(
      param('getClientCabinet', 'path', 'clientToken').description,
      /only the hash is stored/,
    );
  });

  it('права: все ключи x-permissions в каталоге; семь новых ключей repairs.*, названные в разборе §3.2', () => {
    const catalog = loadCatalog();
    const actions = flattenActions(catalog);
    const wrong = [];
    for (const o of OPERATIONS)
      for (const k of o.perms) if (!actions.has(k)) wrong.push(`${o.id}: ${k}`);
    assert.deepEqual(wrong, []);
    const keys = Object.keys(catalog.modules.repairs.actions);
    for (const k of NEW_PERMISSIONS) assert.ok(keys.includes(k), k);
    assert.equal(keys.length, 14 + NEW_PERMISSIONS.length);
    const a = catalog.modules.repairs.actions;
    assert.equal(a['repairs.crew.accrue'].sensitivity, 'restricted');
    assert.deepEqual(a['repairs.crew.accrue'].blocked_by_function, ['driver']);
    assert.equal(a['repairs.crew.pay'].level, 'review');
    assert.equal(a['repairs.client_link.manage'].sensitivity, 'sensitive');
    assert.equal(a['repairs.subcontractors.manage'].sensitivity, 'sensitive');
    assert.deepEqual(a['repairs.measurements.edit'].scopes, ['tenant', 'unit', 'project']);
    assert.deepEqual(catalog.modules.repairs.nav.items, ['objects', 'supply', 'catalog']);
  });

  it('шаблоны ролей: прораб и замерщик правят замер (Q-W4.00-repair-17), подрядчик — узкая роль без цен', () => {
    const t = loadCatalog().role_templates;
    assert.ok(t.foreman.actions.includes('repairs.measurements.edit'));
    assert.ok(t.measurer.actions.includes('repairs.measurements.edit'));
    assert.ok(!t.foreman.actions.includes('repairs.finance.read'));
    const c = t.subcontractor;
    assert.ok(c, 'шаблон «Подрядчик» (Q-W4.00-repair-13)');
    assert.deepEqual(
      c.actions.filter((k) => k.startsWith('repairs.')),
      [
        'repairs.projects.read',
        'repairs.work_logs.read',
        'repairs.work_logs.submit',
        'repairs.schedule.read',
      ],
    );
    assert.ok(t.owner.kind === 'system');
    assert.ok(t.estimator.actions.includes('repairs.crew.accrue') === false);
  });

  it('ошибки: кодов не прибавилось; причины validation_failed и invalid_transition — добавлением', () => {
    const reg = readYaml(ERRORS_PATH).codes;
    for (const [code, list] of Object.entries(REASONS)) {
      for (const r of list) {
        assert.ok(reg[code].reasons?.[r], `${code}.${r}`);
        assert.match(reg[code].reasons[r].source, /W6\.00/, r);
      }
    }
    assert.equal(
      Object.keys(reg).length,
      53 + W5_CODES.length + STAGE7_CODES.length,
      'новых кодов нет (причины внутри существующих; коды этапа 5 — W5_CODES)',
    );
    assert.equal(reg.invalid_transition.status, 409);
    assert.equal(reg.validation_failed.status, 422);
    assert.ok(reg.public_token_expired && reg.estimate_version_locked && reg.change_order_closed);
  });
});

describe('контракт 0.12.0-stage6 (W6.00): схемы', () => {
  it('RepairProject: прораб и сумма не обязательны (объект без прораба, Q-W4.00-repair-1), черновик, сводка списка', () => {
    const p = schemas.RepairProject;
    assert.ok(
      p.properties.status.enum.includes('draft') &&
        p.properties.status.enum.includes('handed_over'),
    );
    for (const old of src.RepairProject.properties.status.enum)
      assert.ok(p.properties.status.enum.includes(old), old);
    assert.ok(p.required.includes('foremanMemberId'));
    assert.deepEqual(
      p.properties.foremanMemberId.oneOf.map((x) => x.type ?? 'ref'),
      ['ref', 'null'],
    );
    assert.ok(!p.required.includes('budget'), 'бюджет — только с repairs.finance.read');
    for (const f of ['readiness', 'todoCount', 'access', 'measured'])
      assert.ok(p.required.includes(f), f);
    for (const f of [
      'kind',
      'areaM2',
      'dueOn',
      'forecastDueOn',
      'clientName',
      'leadTaskId',
      'warrantyUntil',
      'handedOverOn',
      'stage',
    ]) {
      assert.ok(p.properties[f], f);
    }
    assert.match(p.description, /never returns them to the foreman/);
    assert.deepEqual(props('RepairReadiness'), ['acceptedPct', 'pendingPct', 'clientPct']);
    assert.ok(!schemas.RepairProjectCreate.required.includes('foremanMemberId'));
    assert.ok(!schemas.RepairProjectCreate.required.includes('budget'));
    assert.equal(schemas.RepairProjectPatch.minProperties, 1);
  });

  it('обзор: очередь решений 16 видов, «Деньги» только с правом финансов, лента', () => {
    assert.deepEqual(schemas.RepairDecision.properties.kind.enum, DECISION_KINDS);
    assert.equal(DECISION_KINDS.length, 16);
    assert.deepEqual(schemas.RepairDecision.properties.tab.enum.slice(0, 2), ['overview', 'works']);
    const o = schemas.RepairProjectOverview;
    assert.ok(!o.required.includes('money'));
    for (const f of ['project', 'decisions', 'works', 'photos', 'people', 'feed'])
      assert.ok(o.required.includes(f), f);
    assert.match(o.description, /money is present only with repairs\.finance\.read/);
  });

  it('отметка: одна работа и объём, ≥ 1 фото, материалы из справочника, причина возврата; единицы 0.1 + прототип', () => {
    assert.deepEqual(schemas.RepairUnit.enum, UNITS);
    for (const u of src.WorkLogLine.properties.unit.enum) assert.ok(UNITS.includes(u), u);
    assert.deepEqual(prop('WorkLogLine', 'unit').enum, UNITS);
    assert.ok(!schemas.WorkLogLine.required.includes('workerId'));
    assert.ok(schemas.WorkLogLine.properties.workId);
    assert.equal(schemas.WorkLogCreate.properties.evidenceFileIds.minItems, 1);
    assert.equal(name(schemas.WorkLogCreate.properties.materials.items.$ref), 'WorkLogMaterial');
    assert.deepEqual(props('WorkLogMaterial'), ['priceItemId', 'quantity']);
    assert.deepEqual(schemas.WorkLog.properties.status.enum, ['submitted', 'accepted', 'rejected']);
    for (const f of ['returnReason', 'acceptedAt', 'number'])
      assert.ok(schemas.WorkLog.properties[f], f);
    assert.equal(schemas.WorkLogReturn.properties.reason.minLength, 2);
    assert.deepEqual(schemas.WorkLogReturn.required, ['reason']);
  });

  it('прораб не получает цен: допработа, отметка, график, работы и заявка прораба без полей Money; цены — в сметах и снабжении', () => {
    const hasMoney = (s) => {
      const json = JSON.stringify(s);
      return json.includes('/Money"') || json.includes('RepairMoneyDelta');
    };
    for (const n of [
      'ChangeOrder',
      'ChangeOrderCreate',
      'WorkLog',
      'WorkLogCreate',
      'RepairWork',
      'Schedule',
      'ScheduleStage',
      'Measurement',
      'SupplyRequestCreate',
    ]) {
      assert.equal(hasMoney(schemas[n]), false, `${n}: цена в схеме для прораба`);
    }
    for (const n of ['Estimate', 'EstimateLine', 'ProjectFinance', 'CrewAccrual', 'PriceItem']) {
      assert.equal(hasMoney(schemas[n]), true, n);
    }
    assert.match(schemas.SupplyRequest.properties.cost.$ref ?? '', /Money/);
    assert.ok(!schemas.SupplyRequest.required.includes('cost'), 'сумма заявки — только снабжению');
  });

  it('допработа: пять статусов, четыре причины отказа (design/docs/19), без цен у прораба', () => {
    assert.deepEqual(schemas.ChangeOrder.properties.status.enum, [
      'proposed',
      'priced',
      'sent',
      'signed',
      'rejected',
    ]);
    assert.equal(name(schemas.ChangeOrderReject.properties.reason.$ref), 'RepairRejectReason');
    assert.equal(name(schemas.ChangeOrder.properties.rejectReason.$ref), 'RepairRejectReason');
    assert.deepEqual(schemas.RepairRejectReason.enum, REJECT_REASONS);
    assert.equal(REJECT_REASONS.length, 4);
    assert.equal(schemas.ChangeOrderCreate.properties.photoFileIds.minItems, 1);
  });

  it('замер и смета: версии, четыре состояния, правка черновика пакетом, сравнение по строкам (docs/19 «Версии»)', () => {
    assert.deepEqual(props('MeasurementTotals'), [
      'floorM2',
      'wallsM2',
      'perimeterM',
      'wetFloorM2',
      'wetWallsM2',
    ]);
    assert.deepEqual(schemas.Estimate.properties.state.enum, [
      'draft',
      'sent',
      'approved',
      'replaced',
    ]);
    assert.deepEqual(schemas.Estimate.properties.kind.enum, ['first', 'revision', 'change']);
    assert.ok(schemas.EstimateLine.properties.manual && schemas.EstimateLine.properties.formula);
    assert.deepEqual(props('EstimateDraftPatch'), [
      'addSections',
      'addLines',
      'lines',
      'removeLineIds',
      'resetLineIds',
      'discountPct',
    ]);
    assert.equal(schemas.EstimateDraftPatch.minProperties, 1);
    assert.deepEqual(schemas.EstimateDiffRow.properties.change.enum, [
      'added',
      'removed',
      'changed',
      'same',
    ]);
    assert.match(op('diffEstimates').description ?? op('diffEstimates').summary, /id|line/i);
    assert.match(op('updateEstimateDraft').description, /estimate_version_locked/);
    assert.match(op('createEstimateFromTemplate').description, /estimate_draft_exists/);
    assert.match(op('createEstimateRevision').description, /agreement_pending/);
    assert.match(op('rejectChangeOrder').description, /change_order_closed/);
  });

  it('справочник и шаблоны: шесть частей шаблона, формулы объёма, копия; повтор названия — price_item_duplicate', () => {
    assert.deepEqual(props('Template').slice(0, 5), [
      'id',
      'name',
      'kind',
      'source',
      'usedByObjects',
    ]);
    for (const f of ['lines', 'stages', 'documents', 'checklist', 'materials', 'warrantyMonths']) {
      assert.ok(schemas.Template.required.includes(f), f);
    }
    assert.deepEqual(schemas.TemplateLine.properties.formula.enum, [
      'floor',
      'floor_dry',
      'walls',
      'walls_dry',
      'wet',
      'perimeter',
      'perimeter_dry',
    ]); // 7 формул design/docs/19 («санузлы: пол и стены» — одна)
    assert.match(op('createPriceItem').description, /price_item_duplicate/);
    assert.match(op('updatePriceItem').description, /only new drafts|new drafts/);
  });

  it('график: без сумм, предпросмотр без записи, перенос — только с причиной из семи (docs/19 «Правила графика»)', () => {
    assert.equal(name(schemas.ScheduleChangeApply.properties.reason.$ref), 'RepairScheduleReason');
    assert.deepEqual(schemas.RepairScheduleReason.enum, SCHEDULE_REASONS);
    assert.equal(SCHEDULE_REASONS.length, 7);
    assert.deepEqual(schemas.ScheduleChangeApply.required, ['changes', 'reason']);
    assert.deepEqual(schemas.ScheduleLink.properties.lagDays.minimum, -60);
    assert.match(op('previewScheduleChange').description, /without saving|no record/i);
    assert.match(op('applyScheduleChange').description, /schedule_reason_required/);
    assert.match(op('applyScheduleChange').description, /schedule_stage_locked/);
    assert.match(op('setScheduleStageExecutor').description, /without a reason/);
    assert.deepEqual(op('createScheduleBaseline')['x-permissions'], ['repairs.schedule.baseline']);
  });

  it('документы и подпись: пять состояний, код SMS не возвращается (SMS-провайдер — кандидат 31 плана v2), ввод кода — публичная операция', () => {
    assert.deepEqual(schemas.RepairDocument.properties.state.enum, [
      'draft',
      'wait',
      'sms',
      'signed',
      'paid',
    ]);
    assert.ok(!('code' in schemas.RepairSignRequestResult.properties));
    assert.match(schemas.RepairSignRequestResult.description, /never returned/);
    assert.equal(schemas.ClientSign.properties.smsCode.pattern, '^[0-9]{4,8}$');
    assert.match(op('signDocumentByClient').description, /sms_code_invalid|sms_code_expired/);
  });

  it('снабжение: шесть состояний заявки, одна закупка на несколько объектов, QR чека, остатки на объектах', () => {
    assert.deepEqual(schemas.SupplyRequest.properties.state.enum, SUPPLY_STATES);
    assert.deepEqual(schemas.Purchase.properties.state.enum, ['ordered', 'received']);
    assert.equal(schemas.PurchaseCreate.properties.lines.minItems, 1);
    assert.deepEqual(schemas.PurchaseReceive.required, ['receiptQr']);
    assert.match(schemas.PurchaseCreate.description, /average price of the warehouse/);
    assert.deepEqual(op('issueSupplyRequest')['x-permissions'], ['inventory.movements.post']);
    assert.deepEqual(op('returnProjectStock')['x-permissions'], [
      'repairs.supply.manage',
      'inventory.movements.post',
    ]);
    assert.equal(op('returnProjectStock')['x-permissions-mode'], 'all');
  });

  it('финансы, бригада, подрядчики, ссылка: выплата — предложение в кассу, ссылка выдаётся один раз', () => {
    assert.match(schemas.PayoutResult.description, /proposal of a cash operation/);
    assert.deepEqual(schemas.CrewAccrual.properties.state.enum, [
      'pending_act',
      'accrued',
      'proposed',
      'paid',
    ]);
    assert.match(schemas.ClientLinkIssued.description, /only the token hash|database keeps only/);
    assert.deepEqual(op('issueClientLink')['x-permissions'], ['repairs.client_link.manage']);
    assert.ok(op('revokeClientLink').responses['204']);
    assert.deepEqual(op('accrueByAct')['x-permissions'], ['repairs.crew.accrue']);
    assert.deepEqual(op('payoutAccruals')['x-permissions'], ['repairs.crew.pay']);
  });
});

describe('контракт 0.12.0-stage6 (W6.00): дельты, экраны, миграции', () => {
  it('отличия от 0.1 объявлены в source-delta.yaml (источник W6.00), операции 0.1 не пропали', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    const w600 = loadDeltas().filter((d) => /W6\.00/.test(d.source));
    assert.ok(w600.length > 50, `дельт W6.00: ${w600.length}`);
    const pointers = new Set(w600.map((d) => d.pointer));
    for (const n of CHANGED_SCHEMAS) {
      assert.ok(pointers.has(`/components/schemas/${n}`), `change ${n}`);
      assert.equal(w600.find((d) => d.pointer === `/components/schemas/${n}`).kind, 'change');
    }
    const ids = new Set([...ops.keys()]);
    for (const id of operationsById(source).keys()) assert.ok(ids.has(id), `пропала ${id}`);
    assert.match(
      w600.find((d) => d.pointer === '/info/version')?.reason ?? doc.info.version,
      /0\.12\.0-stage6/,
    );
  });

  it('экраны этапа 6: 17 ключей, операции есть в бандле, эталон — снимок design-2026-10-19 или no-reference', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const keys = Object.keys(SCREENS);
    assert.equal(keys.length, 17);
    for (const key of keys) {
      const s = screens[key];
      assert.ok(s, key);
      assert.equal(s.stage, 6, key);
      assert.deepEqual(s.operations, SCREENS[key].operations, key);
      assert.match(s.reference, /^(design-2026-10-19 · |no-reference)/, key);
      assert.match(s.ws, /^W6\.\d\d$/, key);
      for (const id of s.operations) assert.ok(ops.get(id), `${key}: ${id}`);
    }
    const covered = new Set(keys.flatMap((k) => screens[k].operations));
    const outside = OPERATIONS.filter((o) => !covered.has(o.id)).map((o) => o.id);
    assert.deepEqual(outside, [], 'каждая операция тега Repairs стоит на экране этапа 6');
    assert.equal(screens['public-client-cabinet'].reference.startsWith('no-reference'), true);
    assert.equal(screens['repair-supply-request'].reference.startsWith('no-reference'), true);
  });

  it('реестр миграций: tenant 0050–0054 выданы W6.00 (блок этапа 6), резерв 0055–0059', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    for (const f of [
      '0050_repairs_core.sql',
      '0051_repairs_estimates.sql',
      '0052_repairs_schedule.sql',
      '0053_repairs_supply.sql',
      '0054_repairs_documents_cabinet.sql',
    ]) {
      assert.ok(readme.includes(f), `README: ${f}`);
      assert.ok(existsSync(abs(`backend/migrations/tenant/${f}`)), `файл ${f}`);
    }
    assert.match(readme, /0055–0059/);
  });

  it('CHANGELOG описывает 0.12.0-stage6', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /0\.12\.0-stage6/);
    assert.match(log, /W6\.00/);
  });

  it('isolation: строки операций тега Repairs записаны (pending у операций без хендлера) и отказы шлюза без pending', () => {
    for (const f of [
      'backend/test/isolation/repairs_w600.yaml',
      'backend/test/isolation/repairs_w600_gate.yaml',
    ]) {
      assert.ok(existsSync(abs(f)), f);
    }
    const rows = readYaml(abs('backend/test/isolation/repairs_w600.yaml'));
    const listed = new Set(rows.endpoints.map((e) => e.op));
    const protectedOps = OPERATIONS.filter((o) => !o.public).map((o) => o.id);
    const missing = protectedOps.filter((id) => !listed.has(id) && !LEGACY.includes(id));
    assert.ok(missing.length === 0, `нет строк изоляции: ${missing.join(', ')}`);
    // W6.11: у 13 операций шагов 6.1–6.2 хендлеры есть (pending снят); у остальных pending — WS-владелец (W6.12–W6.15).
    const served = new Set([
      'listRepairProjects',
      'createRepairProject',
      'getRepairProject',
      'updateRepairProject',
      'getRepairProjectOverview',
      'assignRepairForeman',
      'activateRepairProject',
      'handOverRepairProject',
      'listRepairWorks',
      'listWorkLogs',
      'submitWorkLog',
      'acceptWorkLog',
      'returnWorkLog',
    ]);
    for (const e of rows.endpoints) {
      if (served.has(e.op)) assert.equal(e.pending, undefined, e.op);
      else assert.match(e.pending, /^W6\.1[2-5]$/, e.op);
    }
  });
});
