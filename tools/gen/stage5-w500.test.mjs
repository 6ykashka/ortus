// W5.00 · Контрактный PR этапа 5 (0.12.0-stage5, номер версии согласует интегратор): касса (cash.md §2.2: 22 новые
// операции, схемы v2, 17 ключей с limit, 5 кодов, события), склад (склады, остатки по партиям FEFO, резервы, правка
// номенклатуры) и SPA (карточка и правка услуги с техкартой, отмена и перенос визита, фильтры незавершённого учёта).
// Эталон — «Касса.dc.html», «Касса - варианты.dc.html», ortus/cash.js (design-2026-10-19); склад и SPA — без макета
// (B-6), по документам комплекта. Разбор docs/plan/v2/analysis/dor/cash.md §2–§7. Бриф docs/plan/v2/ws/W5.00.md.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { STAGE7_CODES } from './lib/stage7.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const T = '/api/v1/tenants/{tenantId}';
const C = `${T}/cash`;
const I = `${T}/inventory`;
const S = `${T}/spa`;
const ACC = 'tenant-org-unit-account';
const ACC_SELF = 'tenant-org-unit-account-self';

/**
 * [operationId, тег, метод, путь, x-permissions, x-scope, x-permissions-mode, статус успеха, схема ответа | null,
 * схема тела | null, If-Match]. Бриф W5.00 §1.
 */
const NEW = [
  [
    'previewCashAccountAccess',
    'Cash',
    'get',
    `${C}/accounts/access-preview`,
    ['cash.accounts.manage'],
    'tenant-org-unit',
    'all',
    '200',
    'CashAccessPreview',
    null,
    false,
  ],
  [
    'reverseCashOperation',
    'Cash',
    'post',
    `${C}/operations/{operationId}/reverse`,
    ['cash.reverse'],
    ACC,
    'all',
    '201',
    'CashOperation',
    'CashReverseRequest',
    false,
  ],
  [
    'linkCashOperationSource',
    'Cash',
    'post',
    `${C}/operations/{operationId}/source-link`,
    ['cash.post'],
    ACC,
    'all',
    '201',
    'CashOperationSourceLink',
    'CashSourceLinkRequest',
    false,
  ],
  [
    'findCashDuplicates',
    'Cash',
    'get',
    `${C}/duplicates`,
    ['cash.post'],
    ACC,
    'all',
    '200',
    'CashDuplicateList',
    null,
    false,
  ],
  [
    'listCashProposals',
    'Cash',
    'get',
    `${C}/proposals`,
    ['cash.read'],
    ACC,
    'all',
    '200',
    'CashProposalPage',
    null,
    false,
  ],
  [
    'postCashProposal',
    'Cash',
    'post',
    `${C}/proposals/{proposalKey}/post`,
    ['cash.proposals.post'],
    ACC,
    'all',
    '201',
    'CashProposalPostResult',
    'CashProposalPost',
    false,
  ],
  [
    'dismissCashProposal',
    'Cash',
    'post',
    `${C}/proposals/{proposalKey}/dismiss`,
    ['cash.proposals.post'],
    ACC,
    'all',
    '200',
    'CashProposal',
    'CashProposalDismiss',
    false,
  ],
  [
    'listCashShifts',
    'Cash',
    'get',
    `${C}/shifts`,
    ['cash.read'],
    ACC,
    'all',
    '200',
    'CashShiftPage',
    null,
    false,
  ],
  [
    'openCashShift',
    'Cash',
    'post',
    `${C}/accounts/{accountId}/shifts`,
    ['cash.shift.operate'],
    ACC,
    'all',
    '201',
    'CashShift',
    'CashShiftOpen',
    false,
  ],
  [
    'closeCashShift',
    'Cash',
    'post',
    `${C}/shifts/{shiftId}/close`,
    ['cash.shift.operate'],
    ACC,
    'all',
    '200',
    'CashShift',
    'CashShiftClose',
    true,
  ],
  [
    'reviewCashShift',
    'Cash',
    'post',
    `${C}/shifts/{shiftId}/review`,
    ['cash.reconcile'],
    ACC,
    'all',
    '200',
    'CashShift',
    'CashShiftReview',
    true,
  ],
  [
    'listCashTransfers',
    'Cash',
    'get',
    `${C}/transfers`,
    ['cash.read'],
    ACC,
    'all',
    '200',
    'CashTransferPage',
    null,
    false,
  ],
  [
    'createCashTransfer',
    'Cash',
    'post',
    `${C}/transfers`,
    ['cash.transfer'],
    ACC,
    'all',
    '201',
    'CashTransfer',
    'CashTransferCreate',
    false,
  ],
  [
    'decideCashTransfer',
    'Cash',
    'post',
    `${C}/transfers/{transferId}/decision`,
    ['cash.transfer'],
    ACC,
    'all',
    '200',
    'CashTransfer',
    'CashTransferDecision',
    true,
  ],
  [
    'issueCashAdvance',
    'Cash',
    'post',
    `${C}/accounts/{accountId}/advance-issues`,
    ['cash.advance.issue'],
    ACC,
    'all',
    '201',
    'CashTransfer',
    'CashAdvanceIssue',
    false,
  ],
  [
    'submitAdvanceReceipt',
    'Cash',
    'post',
    `${C}/accounts/{accountId}/receipts`,
    ['cash.advance.self'],
    ACC_SELF,
    'all',
    '201',
    'AdvanceReceipt',
    'AdvanceReceiptCreate',
    false,
  ],
  [
    'listAdvanceReceipts',
    'Cash',
    'get',
    `${C}/receipts`,
    ['cash.read', 'cash.advance.self'],
    ACC_SELF,
    'any',
    '200',
    'AdvanceReceiptPage',
    null,
    false,
  ],
  [
    'decideAdvanceReceipt',
    'Cash',
    'post',
    `${C}/receipts/{receiptId}/decision`,
    ['cash.advance.issue'],
    ACC,
    'all',
    '200',
    'AdvanceReceipt',
    'AdvanceReceiptDecision',
    true,
  ],
  [
    'returnCashAdvance',
    'Cash',
    'post',
    `${C}/accounts/{accountId}/advance-returns`,
    ['cash.advance.self'],
    ACC_SELF,
    'all',
    '201',
    'CashTransfer',
    'CashAdvanceReturn',
    false,
  ],
  [
    'listCashApprovalRequests',
    'Cash',
    'get',
    `${C}/approval-requests`,
    ['cash.read'],
    ACC,
    'all',
    '200',
    'CashApprovalRequestPage',
    null,
    false,
  ],
  [
    'decideCashApprovalRequest',
    'Cash',
    'post',
    `${C}/approval-requests/{approvalRequestId}/decision`,
    ['cash.approve'],
    ACC,
    'all',
    '200',
    'CashApprovalRequest',
    'CashApprovalDecision',
    true,
  ],
  [
    'listCashCategories',
    'Cash',
    'get',
    `${C}/categories`,
    ['cash.read'],
    ACC,
    'all',
    '200',
    'CashCategoryList',
    null,
    false,
  ],
  [
    'listWarehouses',
    'Inventory',
    'get',
    `${I}/warehouses`,
    ['inventory.items.read'],
    'tenant-org-unit-warehouse',
    'all',
    '200',
    'WarehousePage',
    null,
    false,
  ],
  [
    'createWarehouse',
    'Inventory',
    'post',
    `${I}/warehouses`,
    ['inventory.warehouses.manage'],
    'tenant-org-unit',
    'all',
    '201',
    'Warehouse',
    'WarehouseCreate',
    false,
  ],
  [
    'updateInventoryItem',
    'Inventory',
    'patch',
    `${I}/items/{itemId}`,
    ['inventory.items.manage'],
    'tenant-org-unit',
    'all',
    '200',
    'InventoryItem',
    'InventoryItemPatch',
    true,
  ],
  [
    'listInventoryBalances',
    'Inventory',
    'get',
    `${I}/balances`,
    ['inventory.items.read'],
    'tenant-org-unit-warehouse',
    'all',
    '200',
    'InventoryBalancePage',
    null,
    false,
  ],
  [
    'listInventoryReservations',
    'Inventory',
    'get',
    `${I}/reservations`,
    ['inventory.movements.read'],
    'tenant-org-unit-warehouse',
    'all',
    '200',
    'InventoryReservationPage',
    null,
    false,
  ],
  [
    'createInventoryReservation',
    'Inventory',
    'post',
    `${I}/reservations`,
    ['inventory.movements.post'],
    'tenant-org-unit-warehouse',
    'all',
    '201',
    'InventoryReservation',
    'InventoryReservationCreate',
    false,
  ],
  [
    'releaseInventoryReservation',
    'Inventory',
    'post',
    `${I}/reservations/{reservationId}/release`,
    ['inventory.movements.post'],
    'tenant-org-unit-warehouse',
    'all',
    '200',
    'InventoryReservation',
    null,
    false,
  ],
  [
    'getSpaService',
    'Spa',
    'get',
    `${S}/services/{serviceId}`,
    ['spa.services.read'],
    'tenant-org-unit',
    'all',
    '200',
    'SpaService',
    null,
    false,
  ],
  [
    'updateSpaService',
    'Spa',
    'patch',
    `${S}/services/{serviceId}`,
    ['spa.services.manage'],
    'tenant-org-unit',
    'all',
    '200',
    'SpaService',
    'SpaServicePatch',
    true,
  ],
  [
    'cancelAppointment',
    'Spa',
    'post',
    `${S}/appointments/{appointmentId}/cancel`,
    ['spa.appointments.create'],
    'tenant-org-unit-self',
    'all',
    '200',
    'Appointment',
    'AppointmentCancel',
    true,
  ],
  [
    'rescheduleAppointment',
    'Spa',
    'post',
    `${S}/appointments/{appointmentId}/reschedule`,
    ['spa.appointments.create'],
    'tenant-org-unit-self',
    'all',
    '200',
    'Appointment',
    'AppointmentReschedule',
    true,
  ],
];
const ids = NEW.map((o) => o[0]);
const READS = NEW.filter((o) => o[2] === 'get').map((o) => o[0]);
/** Операции 0.1 тегов этапа 5: переделаны (схемы, права, параметры, описания). */
const CHANGED = [
  'listCashAccounts',
  'createCashAccount',
  'listCashOperations',
  'postCashOperation',
];
const KEPT = [
  'listInventoryItems',
  'createInventoryItem',
  'listInventoryMovements',
  'postInventoryMovement',
  'listSpaServices',
  'createSpaService',
  'listAppointments',
  'createAppointment',
  'completeAppointment',
  'getAppointment',
  'recordAppointmentPerformance',
];
const CASH_KEYS = [
  'cash.read',
  'cash.balance.read',
  'cash.post',
  'cash.proposals.post',
  'cash.shift.operate',
  'cash.refund',
  'cash.transfer',
  'cash.advance.issue',
  'cash.approve',
  'cash.reconcile',
  'cash.reverse',
  'cash.payroll.post',
  'cash.reports.finance',
  'cash.accounts.manage',
  'cash.period.close',
  'cash.advance.self',
  'cash.export',
];
const NEW_CODES = [
  ['shift_closed', 409],
  ['duplicate_source', 409],
  ['duplicate_receipt', 409],
  ['self_approval', 403],
  ['insufficient_funds', 409],
];
const EVENTS = {
  postCashOperation: ['cash.operation.posted.v1', 'cash.approval.requested.v1'],
  reverseCashOperation: ['cash.operation.posted.v1'],
  postCashProposal: ['cash.operation.posted.v1', 'cash.approval.requested.v1'],
  openCashShift: ['cash.shift.opened_with_diff.v1'],
  closeCashShift: ['cash.shift.closed.v1'],
  reviewCashShift: ['cash.shift.recount_requested.v1', 'cash.shift.diff_accepted.v1'],
  createCashTransfer: ['cash.transfer.sent.v1'],
  decideCashTransfer: ['cash.transfer.decided.v1'],
  issueCashAdvance: ['cash.transfer.sent.v1', 'cash.approval.requested.v1'],
  submitAdvanceReceipt: ['cash.advance_receipt.submitted.v1'],
  decideAdvanceReceipt: ['cash.advance_receipt.decided.v1'],
  decideCashApprovalRequest: ['cash.approval.decided.v1', 'cash.operation.posted.v1'],
};

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, n) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === n.toLowerCase());
const name = (ref) => ref?.split('/').pop();
const bodyOf = (id) => name(op(id).requestBody?.content?.['application/json']?.schema?.$ref);
const okOf = (id, status) =>
  name(op(id).responses[status]?.content?.['application/json']?.schema?.$ref);
const w500 = () => loadDeltas().filter((d) => /W5\.00/.test(d.source));
const props = (s) => Object.keys(schemas[s]?.properties ?? {});

describe('контракт 0.12.0-stage5 (W5.00): операции, права, области', () => {
  it('33 новые операции тегов Cash, Inventory, Spa: метод, путь, x-permissions, x-scope, режим', () => {
    assert.equal(NEW.length, 33);
    assert.equal(NEW.filter((o) => o[1] === 'Cash').length, 22);
    const wrong = [];
    for (const [id, tag, method, path, perms, scope, mode] of NEW) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [
        o.method,
        o.path,
        o.tag,
        o.op['x-permissions'],
        o.op['x-scope'],
        o.op['x-permissions-mode'],
      ];
      const want = [method, path, tag, perms, scope, mode];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('операции 0.1 тегов на месте; createCashAccount требует cash.accounts.manage (cash.manage → переименован)', () => {
    for (const id of [...CHANGED, ...KEPT]) assert.ok(ops.get(id), id);
    assert.deepEqual(op('createCashAccount')['x-permissions'], ['cash.accounts.manage']);
    for (const id of ['listCashAccounts', 'listCashOperations']) {
      assert.deepEqual(op(id)['x-permissions'], ['cash.read', 'cash.advance.self'], id);
      assert.equal(op(id)['x-permissions-mode'], 'any', id);
      assert.equal(op(id)['x-scope'], ACC_SELF, id);
    }
    assert.deepEqual(op('postCashOperation')['x-permissions'], ['cash.post']);
    for (const id of [...NEW.map((o) => o[0]), ...CHANGED])
      assert.notEqual(op(id).deprecated, true, id);
  });

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, ответы; If-Match — у решений и закрытия смены', () => {
    const gaps = [];
    for (const [id, , method, , , , , , , , ifMatch] of NEW) {
      if (method === 'get') continue;
      if (param(id, 'header', 'Idempotency-Key')?.required !== true)
        gaps.push(`${id}: Idempotency-Key`);
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['401', '403', '404', '422'])
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      const im = param(id, 'header', 'If-Match');
      if (ifMatch !== Boolean(im)) gaps.push(`${id}: If-Match ${Boolean(im)}`);
      if (ifMatch)
        for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
    }
    for (const id of READS)
      if (param(id, 'header', 'Idempotency-Key')) gaps.push(`${id}: чтение с Idempotency-Key`);
    assert.deepEqual(gaps, []);
  });

  it('тела запросов и ответов', () => {
    const wrong = [];
    for (const [id, , , , , , , status, ok, body] of NEW) {
      if (!op(id).responses[status]) wrong.push(`${id}: нет ответа ${status}`);
      if ((okOf(id, status) ?? null) !== ok) wrong.push(`${id}: ответ ${okOf(id, status)} ≠ ${ok}`);
      if ((bodyOf(id) ?? null) !== body) wrong.push(`${id}: тело ${bodyOf(id)} ≠ ${body}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('ответ 202 «заявка на согласование» у проводки сверх лимита (Q-W4.00-cash-2)', () => {
    for (const id of ['postCashOperation', 'postCashProposal', 'issueCashAdvance']) {
      assert.equal(okOf(id, '202'), 'CashApprovalRequest', id);
    }
    assert.equal(okOf('postCashOperation', '201'), 'CashOperation');
    assert.ok(op('postCashOperation').responses['409']);
  });

  it('параметры пути и фильтры', () => {
    for (const [id, p] of [
      ['reverseCashOperation', 'operationId'],
      ['linkCashOperationSource', 'operationId'],
      ['openCashShift', 'accountId'],
      ['closeCashShift', 'shiftId'],
      ['reviewCashShift', 'shiftId'],
      ['decideCashTransfer', 'transferId'],
      ['decideAdvanceReceipt', 'receiptId'],
      ['decideCashApprovalRequest', 'approvalRequestId'],
      ['updateInventoryItem', 'itemId'],
      ['updateSpaService', 'serviceId'],
    ]) {
      assert.equal(param(id, 'path', p)?.required, true, `${id}: ${p}`);
    }
    assert.match(param('postCashProposal', 'path', 'proposalKey')?.schema?.pattern, /\^/);
    const names = (id) => (op(id).parameters ?? []).map((p) => deref(p).name);
    assert.deepEqual(names('listCashAccounts'), ['cursor', 'limit', 'kind', 'orgUnitId']);
    assert.deepEqual(names('listCashOperations'), [
      'cursor',
      'limit',
      'accountId',
      'type',
      'shiftId',
    ]);
    assert.deepEqual(names('listAppointments'), [
      'cursor',
      'limit',
      'status',
      'from',
      'to',
      'practitionerMemberId',
    ]);
    assert.deepEqual(names('listCashShifts'), ['cursor', 'limit', 'accountId', 'status']);
    assert.deepEqual(names('listCashProposals'), ['cursor', 'limit', 'status']);
    assert.deepEqual(names('listInventoryBalances'), [
      'cursor',
      'limit',
      'warehouseId',
      'itemId',
      'belowMinimum',
    ]);
  });

  it('права: 17 ключей кассы с атрибутами limit и blocked_by_function; cash.manage — в prototype_renames', () => {
    const catalog = loadCatalog();
    const cash = catalog.modules.cash;
    assert.deepEqual(Object.keys(cash.actions), CASH_KEYS);
    for (const k of ['cash.post', 'cash.refund', 'cash.advance.issue'])
      assert.equal(cash.actions[k].limit, 'amount', k);
    for (const k of ['cash.payroll.post', 'cash.reports.finance']) {
      assert.deepEqual(cash.actions[k].blocked_by_function, ['driver', 'foreman'], k);
      assert.equal(cash.actions[k].sensitivity, 'restricted', k);
    }
    assert.deepEqual(cash.actions['cash.advance.self'].scopes, ['self']);
    assert.deepEqual(cash.actions['cash.shift.operate'].scopes, ['unit', 'account']);
    assert.ok(cash.actions['cash.read'].scopes.includes('account'));
    assert.notEqual(cash.actions['cash.read'].sensitivity, 'sensitive');
    assert.equal(cash.actions['cash.balance.read'].sensitivity, 'sensitive');
    assert.equal(catalog.prototype_renames['cash.manage'], 'cash.accounts.manage');
    for (const k of CASH_KEYS) assert.ok(!(k in (catalog.prototype_pending ?? {})), `pending ${k}`);
    const inv = Object.keys(catalog.modules.inventory.actions);
    for (const k of ['inventory.warehouses.manage', 'inventory.consumption.override'])
      assert.ok(inv.includes(k), k);
    const actions = flattenActions(catalog);
    for (const [id] of NEW)
      for (const k of op(id)['x-permissions']) assert.ok(actions.has(k), `${id}: ${k}`);
  });

  it('ошибки: 5 новых кодов кассы; over_limit и period_locked не вводятся; причины склада — у invalid_transition', () => {
    const reg = readYaml(ERRORS_PATH).codes;
    for (const [code, status] of NEW_CODES) {
      assert.equal(reg[code]?.status, status, code);
      assert.match(reg[code].source, /W5\.00/, code);
      assert.ok(reg[code].ui, code);
    }
    assert.equal(Object.keys(reg).length, 58 + STAGE7_CODES.length); // + 8 кодов W7.00
    for (const code of ['over_limit', 'period_locked']) assert.ok(!(code in reg), code);
    for (const r of [
      'insufficient_stock',
      'lot_expired',
      'reservation_not_active',
      'shift_not_open',
      'transfer_decided',
    ]) {
      assert.match(reg.invalid_transition.reasons[r]?.source ?? '', /W5\.00/, r);
    }
  });

  it('события: x-events у операций кассы (cash.md §2.3)', () => {
    for (const [id, events] of Object.entries(EVENTS))
      assert.deepEqual(op(id)['x-events'], events, id);
  });
});

describe('контракт 0.12.0-stage5 (W5.00): схемы', () => {
  it('CashAccount v2: шесть видов, остаток может быть скрыт, режим смен, ККТ, лимиты, мои права', () => {
    const a = schemas.CashAccount;
    assert.deepEqual(a.properties.kind.enum, [
      'cash_drawer',
      'safe',
      'advance',
      'acquiring',
      'bank',
      'virtual',
    ]);
    assert.deepEqual(a.properties.orgUnitId.type, ['string', 'null']);
    assert.ok(
      JSON.stringify(a.properties.balance).includes('null'),
      'balance nullable (cash.balance.read)',
    );
    assert.deepEqual(a.properties.shiftMode.enum, ['none', 'open', 'blind']);
    assert.deepEqual(a.properties.kktMode.enum, ['none', 'manual']);
    for (const p of [
      'id',
      'orgUnitId',
      'name',
      'currency',
      'kind',
      'balance',
      'revision',
      'shiftMode',
      'kktMode',
      'my',
    ]) {
      assert.ok(a.required.includes(p), p);
    }
    for (const p of [
      'balanceLimit',
      'floatAmount',
      'tolerance',
      'responsibleMemberId',
      'holderMemberId',
      'advanceLimit',
      'drawerAccountId',
      'openShiftId',
    ]) {
      assert.ok(a.properties[p], p);
    }
    assert.deepEqual(schemas.CashAccountMy.required, ['via', 'rights', 'limits']);
    assert.deepEqual(schemas.CashAccountMy.properties.via.enum, ['role', 'self', 'owner']);
    assert.deepEqual(props('CashLimits'), ['outMinor', 'refundMinor', 'advanceMinor']);
    assert.deepEqual(schemas.CashAccountCreate.properties.kind.enum, a.properties.kind.enum);
    assert.deepEqual(schemas.CashAccountCreate.required, ['orgUnitId', 'name', 'currency', 'kind']);
    assert.match(a.description ?? '', /cash → cash_drawer/);
  });

  it('CashOperation v2: тип, способ оплаты, статья, основание, чек, источник, смена, группа, согласование', () => {
    const o = schemas.CashOperation;
    for (const p of Object.keys(source.components.schemas.CashOperation.properties))
      assert.ok(o.properties[p], `0.1 ${p}`);
    assert.deepEqual(o.properties.type.enum, [
      'in',
      'out',
      'refund',
      'move_in',
      'move_out',
      'opening',
      'adjust',
      'storno',
    ]);
    assert.deepEqual(o.properties.method.enum, ['cash', 'card', 'sbp', 'transfer']);
    assert.deepEqual(o.properties.origin.enum, ['manual', 'proposal', 'import', 'integration']);
    for (const p of [
      'categoryId',
      'basis',
      'receipt',
      'source',
      'shiftId',
      'groupId',
      'transferId',
      'approvedByMemberId',
      'reversedByOperationId',
      'own',
    ]) {
      assert.ok(o.properties[p], p);
    }
    for (const p of ['type', 'method', 'origin']) assert.ok(o.required.includes(p), p);
    const c = schemas.CashOperationCreate;
    assert.deepEqual(c.properties.type.enum, ['in', 'out', 'refund', 'opening']);
    for (const p of ['method', 'categoryId', 'basis', 'receipt', 'source', 'refundsOperationId'])
      assert.ok(c.properties[p], p);
    assert.ok(
      ['accountId', 'direction', 'amount', 'category', 'occurredAt'].every((p) =>
        c.required.includes(p),
      ),
    );
    assert.deepEqual(props('CashReceipt'), [
      'fdNumber',
      'kktShift',
      'receiptAt',
      'none',
      'reason',
      'sellerMemberId',
      'fileId',
    ]);
    assert.deepEqual(props('CashSourceRef'), ['key', 'kind', 'id', 'label']);
  });

  it('CashShift: попытки закрытия сохраняются (Q-W4.00-cash-4), расхождение и решение', () => {
    const s = schemas.CashShift;
    assert.deepEqual(s.properties.status.enum, ['open', 'review', 'closed']);
    for (const p of [
      'number',
      'openedAt',
      'openedByMemberId',
      'openingFloat',
      'openingDiff',
      'closedAt',
      'closedByMemberId',
      'counted',
      'counts',
      'z',
      'terminal',
      'expected',
      'diff',
      'decision',
      'attempts',
      'toSafeTransferId',
      'revision',
    ]) {
      assert.ok(s.properties[p], p);
    }
    assert.deepEqual(schemas.CashShiftDecision.properties.kind.enum, ['auto', 'accepted']);
    assert.ok(schemas.CashShiftCloseAttempt.required.includes('closedAt'));
    assert.deepEqual(schemas.CashShiftReview.properties.decision.enum, ['accept', 'recount']);
    assert.deepEqual(schemas.CashShiftClose.required.includes('counted'), true);
  });

  it('перемещения, предложения, чеки подотчёта, заявки, статьи', () => {
    assert.deepEqual(schemas.CashTransfer.properties.status.enum, ['transit', 'done', 'rejected']);
    assert.deepEqual(schemas.CashTransferDecision.properties.decision.enum, ['accept', 'reject']);
    assert.deepEqual(schemas.CashProposal.properties.status.enum, ['open', 'posted', 'dismissed']);
    assert.deepEqual(schemas.CashProposal.properties.kind.enum, [
      'visit',
      'expense',
      'payroll',
      'refund',
      'purchase',
      'invoice',
    ]);
    assert.deepEqual(schemas.AdvanceReceipt.properties.status.enum, [
      'review',
      'accepted',
      'rejected',
    ]);
    assert.ok(
      schemas.AdvanceReceiptCreate.required.includes('fileId'),
      'фото чека — файл Files (Q-W4.00-cash-12)',
    );
    assert.deepEqual(schemas.CashApprovalRequest.properties.type.enum, ['out', 'refund', 'issue']);
    assert.deepEqual(schemas.CashApprovalRequest.properties.status.enum, [
      'pending',
      'approved',
      'rejected',
    ]);
    assert.deepEqual(schemas.CashApprovalDecision.properties.decision.enum, ['approve', 'reject']);
    assert.deepEqual(schemas.CashCategory.properties.group.enum, [
      'income',
      'expense',
      'transfer',
      'adjustment',
    ]);
  });

  it('склад: остатки по партиям в порядке FEFO, резервы, склад; SPA: правка услуги, перенос, отмена, фактическая цена', () => {
    assert.ok(schemas.InventoryBalance.properties.lots);
    assert.match(schemas.InventoryBalance.description, /FEFO/);
    assert.deepEqual(props('InventoryLotBalance'), ['lotId', 'expiresOn', 'onHand']);
    assert.deepEqual(schemas.InventoryReservation.properties.status.enum, [
      'active',
      'consumed',
      'released',
    ]);
    assert.ok(schemas.InventoryItem.properties.minLevel);
    assert.ok(!schemas.InventoryItem.required.includes('minLevel'));
    assert.deepEqual(schemas.InventoryItemPatch.minProperties, 1);
    assert.ok(schemas.Warehouse.properties.orgUnitId);
    assert.deepEqual(schemas.SpaServicePatch.minProperties, 1);
    assert.ok(schemas.AppointmentReschedule.required.includes('startsAt'));
    assert.ok(schemas.AppointmentCancel.required.includes('reason'));
    assert.ok(
      schemas.AppointmentComplete.properties.finalPrice,
      'CASH-03: цена визита по факту после скидки',
    );
    assert.ok(schemas.Appointment.properties.finalPrice);
    assert.ok(!schemas.AppointmentComplete.required.includes('finalPrice'));
  });
});

describe('контракт 0.12.0-stage5 (W5.00): дельты, экраны, примеры, миграции, журнал', () => {
  it('каждое отличие от 0.1 объявлено дельтой W5.00, дельты используются', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    const mine = w500();
    assert.ok(mine.length >= 40, `${mine.length} дельт W5.00`);
    const pointers = new Set(mine.map((d) => d.pointer));
    assert.ok(
      [...pointers].some((p) => p.startsWith('/components/schemas/CashAccount/properties/kind')),
    );
    assert.ok(pointers.has('/components/schemas/CashShift'));
  });

  it('версия контракта — этап 5, не ниже 0.12.0-stage5; экраны кассы в screens.yaml', () => {
    assert.match(doc.info.version, /^0\.(1[2-9]|[2-9]\d)\.\d+-stage[5-9]$/);
    const screens = readYaml(SCREENS_PATH).screens;
    for (const k of [
      'cash-desk',
      'cash-inbox',
      'cash-shifts',
      'cash-advances',
      'cash-self',
      'cash-settings',
    ]) {
      assert.equal(screens[k]?.stage, 5, k);
      assert.ok(screens[k].operations.length > 0, k);
    }
    for (const k of [
      'modal-cash-post',
      'modal-cash-shift-open',
      'modal-cash-shift-close',
      'modal-cash-transfer',
      'modal-cash-account',
    ]) {
      assert.ok(screens[k], k);
    }
    const used = new Set(Object.values(screens).flatMap((s) => s.operations ?? []));
    for (const id of ids.filter((i) => ops.get(i).tag === 'Cash'))
      assert.ok(used.has(id), `${id}: нет на экране`);
    assert.ok(screens['inventory-stock']?.reference.startsWith('no-reference'));
    assert.ok(screens['spa-services']?.reference.startsWith('no-reference'));
  });

  it('примеры операций кассы: успех и ошибка каждой, ajv-проверка', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    const gaps = [];
    for (const id of ids.filter((i) => ops.get(i).tag === 'Cash')) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      if (!names.length) gaps.push(`${id}: нет примеров`);
      else if (!names.some((n) => n === 'ok' || n === 'created')) gaps.push(`${id}: нет успеха`);
    }
    assert.deepEqual(gaps, []);
  });

  it('реестр миграций tenant: 0040–0044 выданы W5.00, резерв 0045–0049', () => {
    const want = [
      '0040_cash_ledger',
      '0041_cash_shifts_transfers',
      '0042_cash_proposals_advances',
      '0043_inventory',
      '0044_spa',
    ];
    for (const f of want) {
      const p = abs(`backend/migrations/tenant/${f}.sql`);
      assert.ok(existsSync(p), f);
      assert.match(readFileSync(p, 'utf8'), /^-- W5\.00 · tenant 00\d\d · /, f);
    }
    assert.ok(!existsSync(abs('backend/migrations/tenant/0045_.sql')));
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /0040–0044/);
    assert.match(readme, /резерв 0045–0049/);
  });

  it('строки изоляции: касса и склад — без pending (хендлеры W5.31, W5.10), pending до хендлера (SPA — W5.20)', () => {
    // W5.10 (хендлеры склада) снял pending со строк inventory_w500.yaml, W5.31 — со строк cash_w500.yaml.
    for (const f of ['inventory_w500.yaml', 'cash_w500.yaml']) {
      const p = abs('backend/test/isolation/' + f);
      assert.ok(existsSync(p), f);
      assert.doesNotMatch(readFileSync(p, 'utf8'), /^\s*pending:/m, f);
    }
    for (const [f, pending] of [['spa_w500.yaml', 'W5.20']]) {
      const p = abs(`backend/test/isolation/${f}`);
      assert.ok(existsSync(p), f);
      assert.match(
        readFileSync(p, 'utf8'),
        new RegExp(`pending: ${pending.replace('.', '\\.')}`),
        f,
      );
    }
  });

  it('журнал api/CHANGELOG.md: раздел 0.12.0-stage5 выше 0.11.0-stage4', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.ok(log.indexOf('## 0.12.0-stage5') !== -1);
    assert.ok(log.indexOf('## 0.12.0-stage5') < log.indexOf('## 0.11.0-stage4'));
    assert.match(
      log.slice(log.indexOf('## 0.12.0-stage5'), log.indexOf('## 0.11.0-stage4')),
      /W5\.00/,
    );
  });
});
