// W6.00 · Контрактный PR этапа 6 (0.12.0-stage6): «Ремонт и стройка» — спецификация тега Repairs.
// Единственный источник форм операций и схем: из него строятся paths/repairs.yaml, components/repairs/schemas.yaml,
// параметры, дельты 0.1 и проверки tools/gen/stage6-w600.test.mjs. Разбор — docs/plan/v2/analysis/dor/repair.md §2.2,
// решения по умолчанию — Q-W4.00-repair-1…24; эталон design-2026-10-19. Бриф — docs/plan/v2/ws/W6.00.md.

export const VERSION = '0.12.0-stage6';
export const T = '/api/v1/tenants/{tenantId}';
export const R = `${T}/repairs`;
export const P = `${R}/projects/{projectId}`;
export const PUB = '/api/v1/public/client/{clientToken}';

// ---------------------------------------------------------------------------------------------
// Мини-язык схем (ключ с «?» на конце — необязательное поле).
const ref = (n) => ({ $ref: `./schemas.yaml#/${n}` });
const cref = (n) => ({ $ref: `../common/schemas.yaml#/${n}` });
const ID = cref('Id');
const INSTANT = cref('Instant');
const MONEY = cref('Money');
const QTY = cref('Quantity');
const s = (o = {}) => ({ type: 'string', ...o });
const i = (o = {}) => ({ type: 'integer', ...o });
const b = () => ({ type: 'boolean' });
const date = () => ({ type: 'string', format: 'date' });
const arr = (items, o = {}) => ({ type: 'array', items, ...o });
const en = (values, o = {}) => ({ type: 'string', enum: values, ...o });
const nul = (x) => (x.$ref ? { oneOf: [x, { type: 'null' }] } : { ...x, type: [x.type, 'null'] });
const pct = () => i({ minimum: 0, maximum: 100 });
const rev = () => i({ minimum: 1, format: 'int64' });
const ob = (props, description) => {
  const out = { type: 'object', additionalProperties: false, properties: {}, required: [] };
  for (const [k, v] of Object.entries(props)) {
    const optional = k.endsWith('?');
    const name = optional ? k.slice(0, -1) : k;
    out.properties[name] = v;
    if (!optional) out.required.push(name);
  }
  if (!out.required.length) delete out.required;
  if (description) out.description = description;
  return out;
};
const page = (item, description) =>
  ob(
    { items: arr(ref(item)), nextCursor: { type: ['string', 'null'], maxLength: 2048 } },
    description ??
      'Opaque cursor is bound to tenant, principal, effective scopes, filters and sort.',
  );
const list = (item, description) => ob({ items: arr(ref(item)) }, description);

export const UNITS = ['hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter'];
export const PROJECT_STATUS = [
  'draft',
  'planned',
  'active',
  'completed',
  'archived',
  'handed_over',
];
export const TABS = [
  'overview',
  'works',
  'measure',
  'estimate',
  'schedule',
  'docs',
  'supply',
  'finance',
  'pay',
  'subs',
  'client',
];
export const REJECT_REASONS = [
  'already_in_estimate',
  'client_refused',
  'warranty',
  'not_agreed_with_client',
];
export const SCHEDULE_REASONS = [
  'client_request',
  'material_delay',
  'executor_busy',
  'rework',
  'weather_or_drying',
  'scope_change',
  'other',
];
export const SUPPLY_STATES = ['request', 'reserved', 'issued', 'ordered', 'bought', 'used'];
export const DOC_KINDS = ['contract', 'agreement', 'act', 'invoice', 'handover_act', 'warranty'];
export const DOC_STATES = ['draft', 'wait', 'sms', 'signed', 'paid'];
export const ESTIMATE_STATES = ['draft', 'sent', 'approved', 'replaced'];
export const CHANGE_STATES = ['proposed', 'priced', 'sent', 'signed', 'rejected'];
export const DECISION_KINDS = [
  'no_foreman',
  'work_log_pending',
  'work_log_missing',
  'schedule_slip',
  'stage_no_executor',
  'document_wait_signature',
  'document_ready',
  'supply_pending',
  'estimate_with_client',
  'change_order_new',
  'change_order_priced',
  'change_order_sent',
  'estimate_missing',
  'estimate_draft',
  'estimate_sent',
  'estimate_approved',
];

/** Схемы components/repairs/schemas.yaml (новые и переделанные; Worker и WorkerCreate 0.1 не меняются). */
export const SCHEMAS = {
  RepairUnit: en(UNITS, {
    description:
      'Unit of volume. 0.1 units hour, m2, m3, m, piece plus set (комплект), trip (рейс), mesh (мешок), liter (литр) of the prototype.',
  }),
  RepairRejectReason: en(REJECT_REASONS, {
    description:
      'Reason of rejecting a change order (design/docs/19 «Допработы после договора»): already in the estimate, client refused, warranty, not agreed with the client. The foreman sees it.',
  }),
  RepairScheduleReason: en(SCHEDULE_REASONS, {
    description:
      'Reason of a schedule move (prototype GREASONS): client request, material delay, executor busy, rework, weather or drying, scope change, other.',
  }),
  RepairDocumentKind: en(DOC_KINDS),
  RepairAccessItem: ob({ icon: s({ maxLength: 40 }), text: s({ maxLength: 200 }) }),
  RepairReadiness: ob(
    { acceptedPct: pct(), pendingPct: pct(), clientPct: pct() },
    'Team readiness = accepted volumes to plan (+ pending); client readiness — by signed acts only (Q-W4.00-repair-4). Pending volume is never part of the fact.',
  ),
  RepairDecision: ob(
    {
      kind: en(DECISION_KINDS),
      text: s({ maxLength: 300 }),
      'actionLabel?': s({ maxLength: 60 }),
      tab: en(TABS),
      'refId?': ID,
    },
    'One item of «Требует решения» (the same function feeds the list, the card and «Главная»). Items with sums are returned only with repairs.finance.read.',
  ),
  RepairProject: ob(
    {
      id: ID,
      orgUnitId: ID,
      name: s(),
      address: s(),
      status: en(PROJECT_STATUS),
      foremanMemberId: nul(ID),
      workers: arr(ref('Worker')),
      revision: rev(),
      'kind?': s({ maxLength: 100 }),
      'stage?': s({ maxLength: 100 }),
      'areaM2?': QTY,
      'rooms?': i({ minimum: 0 }),
      'contractNo?': s({ maxLength: 40 }),
      'startOn?': date(),
      'dueOn?': date(),
      'forecastDueOn?': date(),
      'clientName?': s({ maxLength: 150 }),
      'clientPhone?': s({ maxLength: 40 }),
      access: arr(ref('RepairAccessItem')),
      measured: b(),
      'handedOverOn?': date(),
      'warrantyUntil?': date(),
      'templateId?': ID,
      'leadTaskId?': ID,
      readiness: ref('RepairReadiness'),
      todoCount: i({ minimum: 0 }),
      'todoTop?': ref('RepairDecision'),
      'budget?': MONEY,
    },
    'Repair object (RS-08: RepairProject, UI «Объект»). foremanMemberId is null until the owner assigns a foreman; a draft object (status draft) is created at the lead stage «Замер» and has only measurement and estimate. budget (contract amount) and clientPhone are omitted without repairs.finance.read — the server never returns them to the foreman, the crew or a subcontractor.',
  ),
  RepairProjectCreate: ob(
    {
      orgUnitId: ID,
      name: s({ minLength: 1, maxLength: 150 }),
      address: s({ maxLength: 1000 }),
      workers: arr(ref('WorkerCreate'), { maxItems: 100 }),
      'kind?': s({ maxLength: 100 }),
      'areaM2?': QTY,
      'rooms?': i({ minimum: 0 }),
      'clientName?': s({ maxLength: 150 }),
      'clientPhone?': s({ maxLength: 40 }),
      'leadTaskId?': ID,
      'access?': arr(ref('RepairAccessItem'), { maxItems: 30 }),
      'templateId?': ID,
      'foremanMemberId?': nul(ID),
      'budget?': MONEY,
    },
    'Creates a draft object (from a lead at the stage «Замер», Q-W4.00-repair-16) or an active one. Local non-login workers are created in the same transaction. An empty measurement (version 1) is created with the object.',
  ),
  RepairProjectPatch: {
    ...ob({
      'name?': s({ minLength: 1, maxLength: 150 }),
      'address?': s({ maxLength: 1000 }),
      'kind?': s({ maxLength: 100 }),
      'areaM2?': QTY,
      'rooms?': i({ minimum: 0 }),
      'contractNo?': s({ maxLength: 40 }),
      'dueOn?': date(),
      'clientName?': s({ maxLength: 150 }),
      'clientPhone?': s({ maxLength: 40 }),
      'access?': arr(ref('RepairAccessItem'), { maxItems: 30 }),
    }),
    minProperties: 1,
  },
  RepairProjectPage: page('RepairProject'),
  RepairForemanAssign: ob({ foremanMemberId: ID }),
  RepairHandOver: ob(
    { actDocumentId: ID, 'warrantyMonths?': i({ minimum: 1, maximum: 120 }) },
    'The signed «Акт сдачи объекта» (Q-W4.00-repair-21); warranty defaults to the warranty passport of the template (24 or 12 months).',
  ),
  RepairWork: ob({
    id: ID,
    projectId: ID,
    name: s(),
    unit: ref('RepairUnit'),
    plan: QTY,
    fact: QTY,
    pending: QTY,
    'estimateLineId?': ID,
  }),
  RepairWorkList: list('RepairWork'),
  RepairPhoto: ob({
    fileId: ID,
    workLogId: ID,
    takenAt: INSTANT,
    status: en(['accepted', 'pending']),
  }),
  RepairPeople: ob({
    clientName: nul(s()),
    clientLinkActive: b(),
    foreman: nul(ob({ memberId: ID, displayName: s() })),
    crew: arr(ref('Worker')),
    'subcontractor?': ob({ name: s(), accessUntil: nul(date()) }),
  }),
  RepairMoneyCard: ob({
    contract: MONEY,
    received: MONEY,
    expenses: MONEY,
    marginPlan: ref('RepairMoneyDelta'),
  }),
  RepairMoneyDelta: ob(
    { amountMinor: i({ format: 'int64' }), currency: { type: 'string', pattern: '^[A-Z]{3}$' } },
    'Signed minor units (difference, margin).',
  ),
  RepairFeedItem: ob({ at: INSTANT, text: s({ maxLength: 300 }), 'actorName?': s() }),
  RepairProjectOverview: ob(
    {
      project: ref('RepairProject'),
      decisions: arr(ref('RepairDecision')),
      works: arr(ref('RepairWork')),
      photos: arr(ref('RepairPhoto')),
      people: ref('RepairPeople'),
      'money?': ref('RepairMoneyCard'),
      feed: arr(ref('RepairFeedItem')),
    },
    'Overview tab (variant 1a). money is present only with repairs.finance.read.',
  ),
  WorkLogLine: ob(
    {
      quantity: QTY,
      unit: en(UNITS),
      'workId?': ID,
      'workerId?': ID,
      'workCode?': s(),
      'description?': s({ maxLength: 2000 }),
      'presenceMinutes?': i({ minimum: 0, format: 'int64' }),
    },
    'W6.00: one line = one work of the object with a volume (the prototype mark). workerId and workCode of 0.1 stay optional; presence is not implemented in stage 6 (Q-W4.00-repair-14).',
  ),
  WorkLogMaterial: ob({ priceItemId: ID, quantity: QTY }),
  WorkLogCreate: ob(
    {
      projectId: ID,
      workDate: date(),
      timeZone: cref('TimeZone'),
      lines: arr(ref('WorkLogLine'), { minItems: 1, maxItems: 100 }),
      evidenceFileIds: arr(ID, { minItems: 1, maxItems: 20 }),
      'note?': s({ maxLength: 5000 }),
      'crewWorkerIds?': arr(ID, { maxItems: 100 }),
      'materials?': arr(ref('WorkLogMaterial'), { maxItems: 100 }),
    },
    'Only the foreman of the object (repairs.work_logs.submit in its scope). «Отметьте работников» and «Добавьте хотя бы одно фото» of the prototype are validation_failed fields crewWorkerIds and evidenceFileIds; volume above plan + 10 % — reason work_volume_exceeds_plan.',
  ),
  WorkLog: ob(
    {
      id: ID,
      projectId: ID,
      submittedByMemberId: ID,
      workDate: date(),
      timeZone: cref('TimeZone'),
      lines: arr(ref('WorkLogLine')),
      evidenceFileIds: arr(ID),
      status: en(['submitted', 'accepted', 'rejected']),
      createdAt: INSTANT,
      revision: rev(),
      'number?': s({ maxLength: 20 }),
      'crewWorkerIds?': arr(ID),
      'materials?': arr(ref('WorkLogMaterial')),
      'acceptedAt?': INSTANT,
      'acceptedByMemberId?': ID,
      'returnReason?': s({ maxLength: 500 }),
    },
    'Accepted volumes only count in the fact (submitted = «На проверке»). The return reason is visible to the foreman, not to the crew (Q-W4.00-repair-3).',
  ),
  WorkLogPage: page('WorkLog'),
  WorkLogReturn: ob({ reason: s({ minLength: 2, maxLength: 500 }) }),
  ChangeOrder: ob({
    id: ID,
    projectId: ID,
    number: s({ maxLength: 20 }),
    title: s({ maxLength: 300 }),
    quantity: QTY,
    unit: ref('RepairUnit'),
    note: s({ maxLength: 2000 }),
    photoFileIds: arr(ID),
    status: en(CHANGE_STATES),
    createdAt: INSTANT,
    revision: rev(),
    'rejectReason?': ref('RepairRejectReason'),
    'agreementNo?': i({ minimum: 1 }),
    'estimateVersion?': i({ minimum: 1 }),
  }),
  ChangeOrderCreate: ob(
    {
      title: s({ minLength: 1, maxLength: 300 }),
      quantity: QTY,
      unit: ref('RepairUnit'),
      photoFileIds: arr(ID, { minItems: 1, maxItems: 20 }),
      'note?': s({ maxLength: 2000 }),
    },
    'The foreman describes the work without prices. «Опишите, что нужно сделать», «Укажите объём больше нуля», «Приложите хотя бы одно фото»; no change orders before the contract (draft object) and on a handed-over object — change_order_closed.',
  ),
  ChangeOrderReject: ob({ reason: ref('RepairRejectReason') }),
  ChangeOrderList: list('ChangeOrder'),
  MeasurementRoom: ob({
    id: ID,
    name: s({ maxLength: 100 }),
    lengthM: QTY,
    widthM: QTY,
    heightM: QTY,
    openingsM2: QTY,
    'wet?': b(),
  }),
  MeasurementRoomInput: ob({
    name: s({ minLength: 1, maxLength: 100 }),
    lengthM: QTY,
    widthM: QTY,
    heightM: QTY,
    openingsM2: QTY,
    'wet?': b(),
  }),
  MeasurementTotals: ob({
    floorM2: QTY,
    wallsM2: QTY,
    perimeterM: QTY,
    wetFloorM2: QTY,
    wetWallsM2: QTY,
  }),
  Measurement: ob({
    projectId: ID,
    version: i({ minimum: 1 }),
    rooms: arr(ref('MeasurementRoom')),
    totals: ref('MeasurementTotals'),
    revision: rev(),
    'measuredAt?': INSTANT,
    'measuredByMemberId?': ID,
  }),
  MeasurementPut: ob(
    { rooms: arr(ref('MeasurementRoomInput'), { maxItems: 100 }) },
    'A new measurement version; a draft estimate is recalculated (lines «из замера»), sent and approved versions are never changed (Q-W4.00-repair-17).',
  ),
  EstimateSection: ob({ id: ID, name: s({ maxLength: 150 }) }),
  EstimateLine: ob(
    {
      id: ID,
      sectionId: ID,
      name: s({ maxLength: 300 }),
      unit: ref('RepairUnit'),
      kind: en(['work', 'material']),
      price: MONEY,
      quantity: QTY,
      sum: MONEY,
      manual: b(),
      isNew: b(),
      'priceItemId?': ID,
      'formula?': s({ maxLength: 100 }),
      'coef?': QTY,
    },
    'id is the stable key of the line between versions of the estimate (repairs.estimate_lines.line_key): a new version copies the lines with the same id and diffEstimates matches them by it; replacing a price list item is «убрано» plus «добавлено».',
  ),
  Estimate: ob(
    {
      projectId: ID,
      version: i({ minimum: 1 }),
      kind: en(['first', 'revision', 'change']),
      state: en(ESTIMATE_STATES),
      sections: arr(ref('EstimateSection')),
      lines: arr(ref('EstimateLine')),
      discountPct: i({ minimum: 0, maximum: 100 }),
      total: MONEY,
      changeOrderIds: arr(ID),
      revision: rev(),
      'baseVersion?': i({ minimum: 1 }),
      'templateId?': ID,
      'agreementNo?': i({ minimum: 1 }),
      'sentAt?': INSTANT,
      'approvedAt?': INSTANT,
    },
    'Version of the estimate (repairs.finance.read). Sent and approved versions are locked (estimate_version_locked); an approved one is replaced only by a new version (before the contract) or an additional agreement (after it).',
  ),
  EstimateList: list('Estimate'),
  EstimateFromTemplate: ob({ templateId: ID }),
  EstimateRevisionCreate: ob({
    kind: en(['revision', 'change']),
    'changeOrderIds?': arr(ID, { maxItems: 50 }),
  }),
  EstimateLinePatch: ob({
    id: ID,
    'quantity?': QTY,
    'price?': MONEY,
  }),
  EstimateLineAdd: ob({ sectionId: ID, priceItemId: ID, 'quantity?': QTY }),
  EstimateDraftPatch: {
    ...ob({
      'addSections?': arr(s({ minLength: 1, maxLength: 150 }), { maxItems: 20 }),
      'addLines?': arr(ref('EstimateLineAdd'), { maxItems: 100 }),
      'lines?': arr(ref('EstimateLinePatch'), { maxItems: 500 }),
      'removeLineIds?': arr(ID, { maxItems: 500 }),
      'resetLineIds?': arr(ID, { maxItems: 500 }),
      'discountPct?': i({ minimum: 0, maximum: 100 }),
    }),
    minProperties: 1,
  },
  EstimateDiffRow: ob({
    change: en(['added', 'removed', 'changed', 'same']),
    name: s(),
    'lineId?': ID,
    'quantityA?': QTY,
    'quantityB?': QTY,
    'priceA?': MONEY,
    'priceB?': MONEY,
    delta: ref('RepairMoneyDelta'),
  }),
  EstimateDiff: ob({
    projectId: ID,
    from: i({ minimum: 1 }),
    to: i({ minimum: 1 }),
    rows: arr(ref('EstimateDiffRow')),
    totalFrom: MONEY,
    totalTo: MONEY,
    delta: ref('RepairMoneyDelta'),
  }),
  PriceItem: ob({
    id: ID,
    section: s({ maxLength: 100 }),
    name: s({ maxLength: 200 }),
    unit: ref('RepairUnit'),
    kind: en(['work', 'material']),
    price: MONEY,
    usedInTemplates: i({ minimum: 0 }),
    archived: b(),
    revision: rev(),
  }),
  PriceItemCreate: ob({
    section: s({ minLength: 1, maxLength: 100 }),
    name: s({ minLength: 1, maxLength: 200 }),
    unit: ref('RepairUnit'),
    kind: en(['work', 'material']),
    price: MONEY,
  }),
  PriceItemPatch: {
    ...ob({
      'section?': s({ minLength: 1, maxLength: 100 }),
      'name?': s({ minLength: 1, maxLength: 200 }),
      'unit?': ref('RepairUnit'),
      'price?': MONEY,
      'archived?': b(),
    }),
    minProperties: 1,
  },
  PriceItemPage: page('PriceItem'),
  TemplateLine: ob({
    priceItemId: ID,
    section: s({ maxLength: 100 }),
    'quantity?': QTY,
    'formula?': en([
      'floor',
      'floor_dry',
      'walls',
      'walls_dry',
      'wet',
      'perimeter',
      'perimeter_dry',
    ]),
    'coef?': QTY,
  }),
  TemplateStage: ob({ name: s(), 'ratePerDay?': QTY, 'pauseDays?': i(), 'sections?': arr(s()) }),
  Template: ob({
    id: ID,
    name: s({ maxLength: 200 }),
    kind: s({ maxLength: 100 }),
    source: en(['ortus', 'own']),
    usedByObjects: i({ minimum: 0 }),
    updatedAt: INSTANT,
    lines: arr(ref('TemplateLine')),
    stages: arr(ref('TemplateStage')),
    documents: arr(ref('RepairDocumentKind')),
    checklist: arr(s({ maxLength: 300 })),
    materials: arr(ref('TemplateLine')),
    warrantyMonths: i({ minimum: 1, maximum: 120 }),
    revision: rev(),
    'copiedFromId?': ID,
    'sourceProjectId?': ID,
  }),
  TemplatePatch: {
    ...ob({
      'name?': s({ minLength: 1, maxLength: 200 }),
      'lines?': arr(ref('TemplateLine'), { maxItems: 500 }),
      'stages?': arr(ref('TemplateStage'), { maxItems: 100 }),
      'documents?': arr(ref('RepairDocumentKind')),
      'checklist?': arr(s({ maxLength: 300 }), { maxItems: 100 }),
      'materials?': arr(ref('TemplateLine'), { maxItems: 500 }),
      'warrantyMonths?': i({ minimum: 1, maximum: 120 }),
    }),
    minProperties: 1,
  },
  TemplateCopy: ob({ 'name?': s({ minLength: 1, maxLength: 200 }) }),
  TemplateList: list('Template'),
  ScheduleStage: ob({
    id: ID,
    phase: s({ maxLength: 100 }),
    name: s({ maxLength: 200 }),
    startOn: date(),
    endOn: date(),
    durationWd: i({ minimum: 1 }),
    offsetWd: i({ minimum: 0 }),
    slackWd: i({ minimum: 0 }),
    critical: b(),
    status: en(['planned', 'started', 'done']),
    'executorName?': s({ maxLength: 150 }),
    'executorMemberId?': ID,
    'estimateSectionId?': ID,
  }),
  ScheduleLink: ob({
    fromStageId: ID,
    toStageId: ID,
    lagDays: i({ minimum: -60, maximum: 60 }),
    'note?': s({ maxLength: 200 }),
  }),
  ScheduleBaseline: ob({
    version: i({ minimum: 1 }),
    dueOn: date(),
    approvedAt: INSTANT,
    'agreementNo?': i({ minimum: 1 }),
  }),
  ScheduleIssue: ob({
    kind: en(['no_executor', 'executor_busy', 'no_material']),
    stageId: ID,
    text: s({ maxLength: 300 }),
  }),
  ScheduleChangeEntry: ob({
    id: ID,
    at: INSTANT,
    authorName: s(),
    text: s({ maxLength: 500 }),
    'reason?': ref('RepairScheduleReason'),
  }),
  Schedule: ob(
    {
      projectId: ID,
      stages: arr(ref('ScheduleStage')),
      links: arr(ref('ScheduleLink')),
      baseline: nul(ref('ScheduleBaseline')),
      forecastDueOn: nul(date()),
      delayWd: i({ minimum: 0 }),
      holidays: arr(date()),
      issues: arr(ref('ScheduleIssue')),
      changes: arr(ref('ScheduleChangeEntry')),
      revision: rev(),
    },
    'Schedule without sums. Forecast, slack and critical path are computed by the server; the client only shows the preview (design/docs/19 «График»).',
  ),
  ScheduleFromEstimate: ob({ estimateVersion: i({ minimum: 1 }) }),
  ScheduleStageChange: ob({
    stageId: ID,
    'offsetWd?': i({ minimum: 0 }),
    'durationWd?': i({ minimum: 1 }),
    'lagDays?': i({ minimum: -60, maximum: 60 }),
  }),
  SchedulePreviewRequest: ob({
    changes: arr(ref('ScheduleStageChange'), { minItems: 1, maxItems: 100 }),
  }),
  SchedulePreview: ob({
    moved: arr(ob({ stageId: ID, fromStartOn: date(), toStartOn: date() })),
    forecastDueOn: nul(date()),
    delayWd: i({ minimum: 0 }),
    notifyWho: arr(s()),
  }),
  ScheduleChangeApply: ob(
    {
      changes: arr(ref('ScheduleStageChange'), { minItems: 1, maxItems: 100 }),
      reason: ref('RepairScheduleReason'),
    },
    'Without a reason a move is not saved (reason is required, schedule_reason_required in violations). A started stage is not moved (schedule_stage_locked). Notifications go through the outbox to the executors of affected stages and to the client when the due date changes.',
  ),
  StageExecutorSet: ob(
    { 'executorMemberId?': nul(ID), 'executorName?': s({ maxLength: 150 }) },
    'The executor is changed at once, without a reason, and journaled (Q-W4.00-repair-20).',
  ),
  ScheduleBaselineCreate: ob({ agreementNo: i({ minimum: 1 }) }),
  RepairDocument: ob({
    id: ID,
    projectId: ID,
    kind: ref('RepairDocumentKind'),
    title: s({ maxLength: 300 }),
    state: en(DOC_STATES),
    'estimateVersion?': i({ minimum: 1 }),
    'actNo?': i({ minimum: 1 }),
    'amount?': MONEY,
    'signedAt?': INSTANT,
    'sentAt?': INSTANT,
  }),
  RepairDocumentList: list('RepairDocument'),
  RepairSignRequestResult: ob(
    { document: ref('RepairDocument'), codeExpiresAt: INSTANT, deliveredTo: s({ maxLength: 40 }) },
    'The SMS code goes to the client through the code delivery port (SMS provider decision pending: stub; on a stand the code is written to the developer inbox). The code is never returned.',
  ),
  SupplyRequest: ob({
    id: ID,
    number: s({ maxLength: 20 }),
    projectId: ID,
    projectName: s(),
    priceItemId: ID,
    name: s(),
    unit: ref('RepairUnit'),
    quantity: QTY,
    needBy: date(),
    state: en(SUPPLY_STATES),
    createdAt: INSTANT,
    revision: rev(),
    'warehouseId?': ID,
    'purchaseId?': ID,
    'cost?': MONEY,
    'available?': arr(ob({ warehouseId: ID, warehouseName: s(), free: QTY })),
  }),
  SupplyRequestCreate: ob({ priceItemId: ID, quantity: QTY, needBy: date() }),
  SupplyRequestPage: page('SupplyRequest'),
  SupplyReserve: ob({ warehouseId: ID }),
  PurchaseLine: ob({
    supplyRequestId: ID,
    projectId: ID,
    priceItemId: ID,
    quantity: QTY,
    price: MONEY,
  }),
  PurchaseLineInput: ob({ supplyRequestId: ID, 'price?': MONEY }),
  Purchase: ob({
    id: ID,
    number: s({ maxLength: 20 }),
    supplier: s({ maxLength: 150 }),
    state: en(['ordered', 'received']),
    lines: arr(ref('PurchaseLine')),
    total: MONEY,
    createdAt: INSTANT,
    revision: rev(),
    'receiptQr?': s({ maxLength: 500 }),
    'receivedAt?': INSTANT,
  }),
  PurchaseCreate: ob(
    {
      supplier: s({ minLength: 1, maxLength: 150 }),
      lines: arr(ref('PurchaseLineInput'), { minItems: 1, maxItems: 200 }),
    },
    'One purchase for several objects. The default price is the average price of the warehouse, then the last purchase, then the catalog price (Q-W4.00-repair-23).',
  ),
  PurchaseReceive: ob({ receiptQr: s({ minLength: 1, maxLength: 500 }) }),
  PurchasePage: page('Purchase'),
  ProjectStockItem: ob({
    projectId: ID,
    projectName: s(),
    priceItemId: ID,
    name: s(),
    unit: ref('RepairUnit'),
    quantity: QTY,
    cost: MONEY,
  }),
  ProjectStockList: list('ProjectStockItem'),
  StockItemInput: ob({ priceItemId: ID, quantity: QTY }),
  StockReturn: ob({
    warehouseId: ID,
    items: arr(ref('StockItemInput'), { minItems: 1, maxItems: 100 }),
  }),
  StockTransfer: ob({
    toProjectId: ID,
    items: arr(ref('StockItemInput'), { minItems: 1, maxItems: 100 }),
  }),
  StockMoveResult: ob({ movementIds: arr(ID), items: arr(ref('ProjectStockItem')) }),
  ProjectFinance: ob({
    projectId: ID,
    contract: MONEY,
    received: MONEY,
    expenses: MONEY,
    marginPlan: ref('RepairMoneyDelta'),
    movements: arr(
      ob({
        at: INSTANT,
        kind: en(['payment', 'expense', 'accrual']),
        text: s(),
        amount: ref('RepairMoneyDelta'),
      }),
    ),
    'estimateVersion?': i({ minimum: 1 }),
  }),
  CrewAccrual: ob({
    id: ID,
    projectId: ID,
    workerId: ID,
    workerName: s(),
    role: s(),
    amount: MONEY,
    state: en(['pending_act', 'accrued', 'proposed', 'paid']),
    selfEmployed: b(),
    'actId?': ID,
    'work?': s(),
  }),
  CrewAccrualList: list('CrewAccrual'),
  PayoutRequest: ob({ accrualIds: arr(ID, { minItems: 1, maxItems: 200 }) }),
  PayoutResult: ob(
    { proposalId: ID, accruals: arr(ref('CrewAccrual')) },
    'The payout creates a proposal of a cash operation (W5.31, Q-W4.00-repair-12); the payment itself is posted by the cashier. No integration with «Мой налог» — accounting only.',
  ),
  Subcontractor: ob({
    id: ID,
    name: s(),
    scope: s(),
    active: b(),
    'memberId?': ID,
    'accessUntil?': date(),
    'contract?': MONEY,
    'paid?': MONEY,
  }),
  SubcontractorList: list('Subcontractor'),
  SubcontractorAccessSet: ob({ active: b(), 'until?': date() }),
  ClientLink: ob({
    active: b(),
    'sentAt?': INSTANT,
    'expiresAt?': INSTANT,
    'revokedAt?': INSTANT,
    'sentTo?': s({ maxLength: 40 }),
  }),
  ClientLinkIssued: ob(
    { link: ref('ClientLink'), url: s({ maxLength: 500 }) },
    'The URL with the token is returned once; the database keeps only the token hash. The link lives until the object is handed over (Q-W4.00-repair-10).',
  ),
  ClientCabinet: ob({
    projectName: s(),
    address: s(),
    clientName: s(),
    readinessPct: pct(),
    stages: arr(ob({ name: s(), state: en(['done', 'started', 'planned']) })),
    photos: arr(ob({ fileId: ID, date: date() })),
    documents: arr(ref('RepairDocument')),
    paid: MONEY,
    contract: MONEY,
    'estimate?': ob({ version: i({ minimum: 1 }), state: en(ESTIMATE_STATES), total: MONEY }),
  }),
  ClientEstimateApproval: ob({ version: i({ minimum: 1 }), state: en(ESTIMATE_STATES) }),
  ClientSign: ob({ smsCode: s({ pattern: '^[0-9]{4,8}$' }) }),
};

// ---------------------------------------------------------------------------------------------
// Параметры components/common/parameters.yaml.
const pathParam = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { $ref: './schemas.yaml#/Id' },
});
const queryParam = (name, description, schema) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});
export const PARAMETERS = {
  repairProjectId: pathParam(
    'projectId',
    'W6.00 (0.12.0-stage6). Opaque UUID of a repair object (repairs.projects); an object the member may not see — 404, as a missing one.',
  ),
  workLogId: pathParam('workLogId', 'W6.00. Opaque UUID of a work log (mark of the foreman).'),
  changeOrderId: pathParam('changeOrderId', 'W6.00. Opaque UUID of a change order (допработа).'),
  estimateVersion: {
    name: 'version',
    in: 'path',
    required: true,
    description: 'W6.00. Number of an estimate version of the object (1, 2, …).',
    schema: { type: 'integer', minimum: 1 },
  },
  priceItemId: pathParam('priceItemId', 'W6.00. Opaque UUID of a price list item.'),
  templateId: pathParam('templateId', 'W6.00. Opaque UUID of an object template.'),
  stageId: pathParam('stageId', 'W6.00. Opaque UUID of a schedule stage.'),
  documentId: pathParam(
    'documentId',
    'W6.00. Opaque UUID of a document of an object (contract, act, invoice).',
  ),
  supplyRequestId: pathParam('supplyRequestId', 'W6.00. Opaque UUID of a supply request.'),
  purchaseId: pathParam('purchaseId', 'W6.00. Opaque UUID of a purchase.'),
  subcontractorId: pathParam(
    'subcontractorId',
    'W6.00. Opaque UUID of a subcontractor of the object.',
  ),
  clientToken: {
    name: 'clientToken',
    in: 'path',
    required: true,
    description:
      'W6.00. Unpredictable revocable capability of the client cabinet (Q-W4.00-repair-10): the tenant is resolved by the token digest; only the hash is stored; the link lives until the object is handed over. Avoid logs and referrer leakage.',
    schema: { type: 'string', minLength: 32, maxLength: 256 },
  },
  RepairFilter: queryParam(
    'filter',
    'W6.00. Filter of the object list: active, todo («Требуют решения»), draft («До договора»), done («Сданы»).',
    {
      type: 'string',
      enum: ['active', 'todo', 'draft', 'done'],
    },
  ),
  RepairQuery: queryParam('q', 'W6.00. Search by address, client or foreman.', {
    type: 'string',
    maxLength: 200,
  }),
  RepairProjectFilter: queryParam('projectId', 'W6.00. Only the records of one object.', {
    $ref: './schemas.yaml#/Id',
  }),
  WorkLogStatusFilter: queryParam('status', 'W6.00. Status of a work log.', {
    type: 'string',
    enum: ['submitted', 'accepted', 'rejected'],
  }),
  PriceKindFilter: queryParam('kind', 'W6.00. Kind of a price list item.', {
    type: 'string',
    enum: ['work', 'material'],
  }),
  SupplyStateFilter: queryParam('state', 'W6.00. State of a supply request.', {
    type: 'string',
    enum: SUPPLY_STATES,
  }),
  EstimateDiffTo: {
    name: 'to',
    in: 'query',
    required: true,
    description: 'W6.00. Version to compare with.',
    schema: { type: 'integer', minimum: 1 },
  },
};

// ---------------------------------------------------------------------------------------------
// Операции. Поля: id, method, path, perms, scope, step (A = 6.1–6.3, B = 6.4–6.6), status, res, req, params
// (path-параметры выводятся из пути), query (ключи PARAMETERS), ifMatch, mode, summary, errors (доп. статусы).
const SC_TEN = 'tenant';
const SC_UNIT = 'tenant-org-unit';
const SC_PRJ = 'tenant-org-unit-repair-project';
const SC_PUB = 'public-client-capability';

const op = (id, method, path, perms, scope, o = {}) => ({
  id,
  method,
  path,
  perms,
  scope,
  status: method === 'post' ? '201' : '200',
  mode: 'all',
  ifMatch: false,
  query: [],
  step: 'A',
  ...o,
});

export const OPERATIONS = [
  // 6.1 — объекты
  op('listRepairProjects', 'get', `${R}/projects`, ['repairs.projects.read'], SC_PRJ, {
    res: 'RepairProjectPage',
    paged: true,
    query: ['RepairFilter', 'RepairQuery'],
    summary: 'List visible repair objects with the summary of the list',
    legacy: true,
  }),
  op('createRepairProject', 'post', `${R}/projects`, ['repairs.projects.manage'], SC_UNIT, {
    req: 'RepairProjectCreate',
    res: 'RepairProject',
    summary: 'Create a repair object (a draft from a lead or an active one)',
    legacy: true,
  }),
  op('getRepairProject', 'get', P, ['repairs.projects.read'], SC_PRJ, {
    res: 'RepairProject',
    summary: 'Read a repair object',
  }),
  op('updateRepairProject', 'patch', P, ['repairs.projects.manage'], SC_UNIT, {
    req: 'RepairProjectPatch',
    res: 'RepairProject',
    ifMatch: true,
    summary: 'Change fields of a repair object',
  }),
  op('getRepairProjectOverview', 'get', `${P}/overview`, ['repairs.projects.read'], SC_PRJ, {
    res: 'RepairProjectOverview',
    summary: 'Read the overview: decisions, volumes, photos, people, money, feed',
  }),
  op('assignRepairForeman', 'post', `${P}/foreman`, ['repairs.projects.manage'], SC_UNIT, {
    req: 'RepairForemanAssign',
    res: 'RepairProject',
    status: '200',
    summary: 'Assign the foreman of an object',
  }),
  op('activateRepairProject', 'post', `${P}/activate`, ['repairs.projects.manage'], SC_UNIT, {
    res: 'RepairProject',
    status: '200',
    ifMatch: true,
    summary: 'Activate a draft object after the estimate is approved',
  }),
  op('listRepairWorks', 'get', `${P}/works`, ['repairs.projects.read'], SC_PRJ, {
    res: 'RepairWorkList',
    summary: 'List volumes of works: plan, accepted fact, pending',
  }),
  // 6.2 — отметки
  op('listWorkLogs', 'get', `${R}/work-logs`, ['repairs.work_logs.read'], SC_PRJ, {
    res: 'WorkLogPage',
    paged: true,
    query: ['RepairProjectFilter', 'WorkLogStatusFilter'],
    summary: 'List visible work logs',
    legacy: true,
  }),
  op('submitWorkLog', 'post', `${R}/work-logs`, ['repairs.work_logs.submit'], SC_PRJ, {
    req: 'WorkLogCreate',
    res: 'WorkLog',
    summary: 'Send a work mark of the foreman to acceptance',
    legacy: true,
  }),
  op(
    'acceptWorkLog',
    'post',
    `${R}/work-logs/{workLogId}/accept`,
    ['repairs.work_logs.review'],
    SC_PRJ,
    {
      res: 'WorkLog',
      status: '200',
      ifMatch: true,
      summary: 'Accept the volume of a work log (once)',
    },
  ),
  op(
    'returnWorkLog',
    'post',
    `${R}/work-logs/{workLogId}/return`,
    ['repairs.work_logs.review'],
    SC_PRJ,
    {
      req: 'WorkLogReturn',
      res: 'WorkLog',
      status: '200',
      ifMatch: true,
      summary: 'Return a work log to the foreman with a reason',
    },
  ),
  // 6.3 — допработы, замер, смета, справочник, шаблоны
  op('listChangeOrders', 'get', `${P}/change-orders`, ['repairs.projects.read'], SC_PRJ, {
    res: 'ChangeOrderList',
    summary: 'List change orders of an object',
  }),
  op('proposeChangeOrder', 'post', `${P}/change-orders`, ['repairs.changes.submit'], SC_PRJ, {
    req: 'ChangeOrderCreate',
    res: 'ChangeOrder',
    summary: 'Propose a change order (without prices)',
  }),
  op(
    'rejectChangeOrder',
    'post',
    `${R}/change-orders/{changeOrderId}/reject`,
    ['repairs.estimates.edit'],
    SC_PRJ,
    {
      req: 'ChangeOrderReject',
      res: 'ChangeOrder',
      status: '200',
      ifMatch: true,
      summary: 'Reject a change order with a reason',
    },
  ),
  op('getMeasurement', 'get', `${P}/measurement`, ['repairs.projects.read'], SC_PRJ, {
    res: 'Measurement',
    summary: 'Read the measurement of an object',
  }),
  op('putMeasurement', 'put', `${P}/measurement`, ['repairs.measurements.edit'], SC_PRJ, {
    req: 'MeasurementPut',
    res: 'Measurement',
    status: '200',
    ifMatch: true,
    summary: 'Save a new version of the measurement',
  }),
  op('listEstimates', 'get', `${P}/estimates`, ['repairs.finance.read'], SC_PRJ, {
    res: 'EstimateList',
    summary: 'List estimate versions of an object',
  }),
  op('getEstimate', 'get', `${P}/estimates/{version}`, ['repairs.finance.read'], SC_PRJ, {
    res: 'Estimate',
    summary: 'Read an estimate version',
  }),
  op(
    'createEstimateFromTemplate',
    'post',
    `${P}/estimate-drafts`,
    ['repairs.estimates.edit'],
    SC_PRJ,
    {
      req: 'EstimateFromTemplate',
      res: 'Estimate',
      summary: 'Build the first draft estimate from a template and the measurement',
    },
  ),
  op('createEstimateRevision', 'post', `${P}/estimates`, ['repairs.estimates.edit'], SC_PRJ, {
    req: 'EstimateRevisionCreate',
    res: 'Estimate',
    summary: 'Create a draft revision or additional agreement from the current version',
  }),
  op(
    'updateEstimateDraft',
    'patch',
    `${P}/estimates/{version}`,
    ['repairs.estimates.edit'],
    SC_PRJ,
    {
      req: 'EstimateDraftPatch',
      res: 'Estimate',
      status: '200',
      ifMatch: true,
      summary: 'Change lines, sections and discount of a draft estimate',
    },
  ),
  op('sendEstimate', 'post', `${P}/estimates/{version}/send`, ['repairs.estimates.edit'], SC_PRJ, {
    res: 'Estimate',
    status: '200',
    ifMatch: true,
    summary: 'Send the estimate to the client cabinet (fixes the volumes)',
  }),
  op(
    'recallEstimate',
    'post',
    `${P}/estimates/{version}/recall`,
    ['repairs.estimates.edit'],
    SC_PRJ,
    {
      res: 'Estimate',
      status: '200',
      ifMatch: true,
      summary: 'Recall a sent estimate to edit it again',
    },
  ),
  op(
    'deleteEstimateDraft',
    'delete',
    `${P}/estimates/{version}`,
    ['repairs.estimates.edit'],
    SC_PRJ,
    {
      status: '204',
      ifMatch: true,
      summary: 'Delete a draft estimate; its change orders return to proposed',
    },
  ),
  op('diffEstimates', 'get', `${P}/estimates/{version}/diff`, ['repairs.finance.read'], SC_PRJ, {
    res: 'EstimateDiff',
    query: ['EstimateDiffTo'],
    summary: 'Compare two estimate versions by the id of the line',
  }),
  op('saveProjectAsTemplate', 'post', `${P}/save-as-template`, ['repairs.catalog.manage'], SC_TEN, {
    req: 'TemplateCopy',
    res: 'Template',
    summary: 'Save the current estimate of an object as a template',
  }),
  op(
    'listPriceItems',
    'get',
    `${R}/price-items`,
    ['repairs.catalog.manage', 'repairs.estimates.edit'],
    SC_TEN,
    {
      res: 'PriceItemPage',
      paged: true,
      mode: 'any',
      query: ['RepairQuery', 'PriceKindFilter'],
      summary: 'List price list items',
    },
  ),
  op('createPriceItem', 'post', `${R}/price-items`, ['repairs.catalog.manage'], SC_TEN, {
    req: 'PriceItemCreate',
    res: 'PriceItem',
    summary: 'Add a price list item',
  }),
  op(
    'updatePriceItem',
    'patch',
    `${R}/price-items/{priceItemId}`,
    ['repairs.catalog.manage'],
    SC_TEN,
    {
      req: 'PriceItemPatch',
      res: 'PriceItem',
      status: '200',
      ifMatch: true,
      summary: 'Change a price list item (new prices reach only new drafts)',
    },
  ),
  op(
    'listTemplates',
    'get',
    `${R}/templates`,
    ['repairs.catalog.manage', 'repairs.estimates.edit'],
    SC_TEN,
    {
      res: 'TemplateList',
      mode: 'any',
      summary: 'List object templates',
    },
  ),
  op(
    'getTemplate',
    'get',
    `${R}/templates/{templateId}`,
    ['repairs.catalog.manage', 'repairs.estimates.edit'],
    SC_TEN,
    {
      res: 'Template',
      mode: 'any',
      summary: 'Read an object template',
    },
  ),
  op('updateTemplate', 'patch', `${R}/templates/{templateId}`, ['repairs.catalog.manage'], SC_TEN, {
    req: 'TemplatePatch',
    res: 'Template',
    status: '200',
    ifMatch: true,
    summary: 'Change lines, formulas and parts of a template',
  }),
  op(
    'copyTemplate',
    'post',
    `${R}/templates/{templateId}/copy`,
    ['repairs.catalog.manage'],
    SC_TEN,
    {
      req: 'TemplateCopy',
      res: 'Template',
      summary: 'Copy a template',
    },
  ),
  // 6.5 — график
  op('getSchedule', 'get', `${P}/schedule`, ['repairs.schedule.read'], SC_PRJ, {
    res: 'Schedule',
    step: 'B',
    summary: 'Read the schedule: stages, links, baseline, forecast',
  }),
  op(
    'createScheduleFromEstimate',
    'post',
    `${P}/schedule/from-estimate`,
    ['repairs.schedule.shift'],
    SC_PRJ,
    {
      req: 'ScheduleFromEstimate',
      res: 'Schedule',
      step: 'B',
      summary:
        'Build the schedule from the sections of an estimate and the technology of the template',
    },
  ),
  op('previewScheduleChange', 'post', `${P}/schedule/preview`, ['repairs.schedule.shift'], SC_PRJ, {
    req: 'SchedulePreviewRequest',
    res: 'SchedulePreview',
    status: '200',
    step: 'B',
    summary: 'Preview a move without saving',
  }),
  op('applyScheduleChange', 'post', `${P}/schedule/changes`, ['repairs.schedule.shift'], SC_PRJ, {
    req: 'ScheduleChangeApply',
    res: 'Schedule',
    status: '200',
    ifMatch: true,
    step: 'B',
    summary: 'Save a move with a reason and notify',
  }),
  op(
    'setScheduleStageExecutor',
    'patch',
    `${P}/schedule/stages/{stageId}`,
    ['repairs.schedule.shift'],
    SC_PRJ,
    {
      req: 'StageExecutorSet',
      res: 'ScheduleStage',
      status: '200',
      ifMatch: true,
      step: 'B',
      summary: 'Change the executor of a stage',
    },
  ),
  op(
    'createScheduleBaseline',
    'post',
    `${P}/schedule/baselines`,
    ['repairs.schedule.baseline'],
    SC_UNIT,
    {
      req: 'ScheduleBaselineCreate',
      res: 'Schedule',
      ifMatch: true,
      step: 'B',
      summary: 'Fix a new baseline by an additional agreement',
    },
  ),
  // 6.6 — документы, сдача
  op('handOverRepairProject', 'post', `${P}/hand-over`, ['repairs.projects.hand_over'], SC_PRJ, {
    req: 'RepairHandOver',
    res: 'RepairProject',
    status: '200',
    ifMatch: true,
    step: 'B',
    summary: 'Hand the object over: warranty, new marks and change orders are closed',
  }),
  op('listRepairDocuments', 'get', `${P}/documents`, ['repairs.projects.read'], SC_PRJ, {
    res: 'RepairDocumentList',
    step: 'B',
    summary: 'List documents of an object (amounts only with repairs.finance.read)',
  }),
  op(
    'requestDocumentSignature',
    'post',
    `${R}/documents/{documentId}/sign-requests`,
    ['repairs.documents.send'],
    SC_PRJ,
    {
      res: 'RepairSignRequestResult',
      step: 'B',
      summary: 'Send the document to the client for the signature by an SMS code',
    },
  ),
  // 6.4 — снабжение
  op(
    'listSupplyRequests',
    'get',
    `${R}/supply-requests`,
    ['repairs.supply.manage', 'repairs.supply.request'],
    SC_PRJ,
    {
      res: 'SupplyRequestPage',
      paged: true,
      mode: 'any',
      query: ['SupplyStateFilter', 'RepairProjectFilter'],
      step: 'B',
      summary: 'List supply requests of all visible objects',
    },
  ),
  op('createSupplyRequest', 'post', `${P}/supply-requests`, ['repairs.supply.request'], SC_PRJ, {
    req: 'SupplyRequestCreate',
    res: 'SupplyRequest',
    step: 'B',
    summary: 'Ask for a material (foreman)',
  }),
  op(
    'reserveSupplyRequest',
    'post',
    `${R}/supply-requests/{supplyRequestId}/reserve`,
    ['repairs.supply.manage'],
    SC_UNIT,
    {
      req: 'SupplyReserve',
      res: 'SupplyRequest',
      status: '200',
      ifMatch: true,
      step: 'B',
      summary: 'Decide «со склада»: reserve on a warehouse',
    },
  ),
  op(
    'issueSupplyRequest',
    'post',
    `${R}/supply-requests/{supplyRequestId}/issue`,
    ['inventory.movements.post'],
    'tenant-org-unit-warehouse',
    {
      res: 'SupplyRequest',
      status: '200',
      ifMatch: true,
      step: 'B',
      summary: 'Issue a reserved request from the warehouse (storekeeper)',
    },
  ),
  op(
    'consumeSupplyRequest',
    'post',
    `${R}/supply-requests/{supplyRequestId}/consume`,
    ['repairs.supply.request', 'repairs.work_logs.review'],
    SC_PRJ,
    {
      res: 'SupplyRequest',
      status: '200',
      ifMatch: true,
      mode: 'any',
      step: 'B',
      summary: 'Write the material off to the object',
    },
  ),
  op('createPurchase', 'post', `${R}/purchases`, ['repairs.supply.manage'], SC_UNIT, {
    req: 'PurchaseCreate',
    res: 'Purchase',
    step: 'B',
    summary: 'Order one purchase for several requests',
  }),
  op('listPurchases', 'get', `${R}/purchases`, ['repairs.supply.manage'], SC_UNIT, {
    res: 'PurchasePage',
    paged: true,
    step: 'B',
    summary: 'List purchases',
  }),
  op(
    'receivePurchase',
    'post',
    `${R}/purchases/{purchaseId}/receive`,
    ['repairs.supply.manage'],
    SC_UNIT,
    {
      req: 'PurchaseReceive',
      res: 'Purchase',
      status: '200',
      ifMatch: true,
      step: 'B',
      summary: 'Receive a purchase by the receipt QR and spread the cost over the objects',
    },
  ),
  op('listProjectStock', 'get', `${R}/project-stock`, ['repairs.supply.manage'], SC_UNIT, {
    res: 'ProjectStockList',
    step: 'B',
    summary: 'List the stock on objects',
  }),
  op(
    'returnProjectStock',
    'post',
    `${P}/stock/return`,
    ['repairs.supply.manage', 'inventory.movements.post'],
    SC_UNIT,
    {
      req: 'StockReturn',
      res: 'StockMoveResult',
      status: '200',
      step: 'B',
      summary: 'Return the stock of an object to a warehouse',
    },
  ),
  op(
    'transferProjectStock',
    'post',
    `${P}/stock/transfer`,
    ['repairs.supply.manage', 'inventory.movements.post'],
    SC_UNIT,
    {
      req: 'StockTransfer',
      res: 'StockMoveResult',
      status: '200',
      step: 'B',
      summary: 'Move the stock of an object to another object',
    },
  ),
  // 6.6 — финансы, бригада, подрядчики, кабинет
  op('getProjectFinance', 'get', `${P}/finance`, ['repairs.finance.read'], SC_PRJ, {
    res: 'ProjectFinance',
    step: 'B',
    summary: 'Read the finance of an object',
  }),
  op('listCrewAccruals', 'get', `${P}/accruals`, ['repairs.finance.read'], SC_PRJ, {
    res: 'CrewAccrualList',
    step: 'B',
    summary: 'List crew accruals of an object',
  }),
  op('accrueByAct', 'post', `${R}/acts/{documentId}/accruals`, ['repairs.crew.accrue'], SC_PRJ, {
    res: 'CrewAccrualList',
    step: 'B',
    summary: 'Accrue the crew by a signed act',
  }),
  op('payoutAccruals', 'post', `${R}/accruals/payout`, ['repairs.crew.pay'], SC_UNIT, {
    req: 'PayoutRequest',
    res: 'PayoutResult',
    status: '200',
    step: 'B',
    summary: 'Propose the payout of accruals to the cash',
  }),
  op(
    'listSubcontractors',
    'get',
    `${P}/subcontractors`,
    ['repairs.subcontractors.manage'],
    SC_PRJ,
    {
      res: 'SubcontractorList',
      step: 'B',
      summary: 'List subcontractors of an object',
    },
  ),
  op(
    'setSubcontractorAccess',
    'put',
    `${P}/subcontractors/{subcontractorId}`,
    ['repairs.subcontractors.manage'],
    SC_PRJ,
    {
      req: 'SubcontractorAccessSet',
      res: 'Subcontractor',
      status: '200',
      step: 'B',
      summary: 'Open or close the temporary access of a subcontractor',
    },
  ),
  op('getClientLink', 'get', `${P}/client-link`, ['repairs.client_link.manage'], SC_PRJ, {
    res: 'ClientLink',
    step: 'B',
    summary: 'Read the state of the client cabinet link',
  }),
  op('issueClientLink', 'post', `${P}/client-link`, ['repairs.client_link.manage'], SC_PRJ, {
    res: 'ClientLinkIssued',
    step: 'B',
    summary: 'Issue a new client cabinet link',
  }),
  op('revokeClientLink', 'delete', `${P}/client-link`, ['repairs.client_link.manage'], SC_PRJ, {
    status: '204',
    step: 'B',
    summary: 'Revoke the client cabinet link',
  }),
  // публичный контур заказчика
  op('getClientCabinet', 'get', PUB, [], SC_PUB, {
    res: 'ClientCabinet',
    public: true,
    step: 'B',
    summary: 'Read the client cabinet by the link',
  }),
  op('approveEstimateByClient', 'post', `${PUB}/estimates/{version}/approve`, [], SC_PUB, {
    res: 'ClientEstimateApproval',
    status: '200',
    public: true,
    step: 'B',
    summary: 'Approve the sent estimate version',
  }),
  op('signDocumentByClient', 'post', `${PUB}/documents/{documentId}/sign`, [], SC_PUB, {
    req: 'ClientSign',
    res: 'RepairDocument',
    status: '200',
    public: true,
    step: 'B',
    summary: 'Sign a document by the SMS code',
  }),
];

export const OPERATION_IDS = OPERATIONS.map((o) => o.id);

/** Операции 0.1 тега Repairs, которые PR переделывает. */
export const LEGACY = [
  'listRepairProjects',
  'createRepairProject',
  'listWorkLogs',
  'submitWorkLog',
];

/** Схемы 0.1, которые PR меняет (kind: change в source-delta.yaml). */
export const CHANGED_SCHEMAS = [
  'RepairProject',
  'RepairProjectCreate',
  'WorkLogLine',
  'WorkLogCreate',
  'WorkLog',
];

/** Новые ключи прав (permissions.yaml). */
export const NEW_PERMISSIONS = [
  'repairs.measurements.edit',
  'repairs.documents.send',
  'repairs.crew.accrue',
  'repairs.crew.pay',
  'repairs.subcontractors.manage',
  'repairs.client_link.manage',
  'repairs.projects.hand_over',
];

/** Новые причины errors.yaml: код → причины. */
export const REASONS = {
  validation_failed: [
    'work_volume_exceeds_plan',
    'schedule_reason_required',
    'sms_code_invalid',
    'sms_code_expired',
    'price_item_duplicate',
  ],
  invalid_transition: [
    'foreman_already_assigned',
    'work_log_already_reviewed',
    'project_handed_over',
    'schedule_stage_locked',
    'repair_stock_insufficient',
    'repair_project_not_draft',
    'repair_estimate_not_approved',
    'repair_act_not_signed',
    'repair_document_state',
    'repair_supply_state',
    'repair_purchase_state',
  ],
};

/** Экраны этапа 6 (screens.yaml): ключ → { title, ws, reference, operations }. */
export const SCREENS = {
  'repair-list': {
    title: 'Ремонт и стройка · Объекты',
    ws: 'W6.20',
    reference: 'design-2026-10-19 · Ортус CRM.dc.html · Список объектов (CRM:1917–1977)',
    operations: ['listRepairProjects', 'createRepairProject', 'getMyDecisionQueue'],
  },
  'repair-card': {
    title: 'Карточка объекта · Обзор',
    ws: 'W6.20',
    reference: 'design-2026-10-19 · Ортус CRM.dc.html · Карточка объекта (CRM:1978–2075)',
    operations: [
      'getRepairProject',
      'getRepairProjectOverview',
      'updateRepairProject',
      'activateRepairProject',
    ],
  },
  'repair-works': {
    title: 'Карточка объекта · Работы и допработы',
    ws: 'W6.20',
    reference: 'design-2026-10-19 · Ортус CRM.dc.html · Работы (CRM:2077–2119)',
    operations: [
      'listRepairWorks',
      'listWorkLogs',
      'submitWorkLog',
      'acceptWorkLog',
      'returnWorkLog',
      'listChangeOrders',
      'proposeChangeOrder',
    ],
  },
  'modal-assign-foreman': {
    title: 'Назначить прораба?',
    ws: 'W6.20',
    reference:
      'design-2026-10-19 · Ортус CRM.dc.html · Диалог «Назначить прораба?» (CRM:4423–4430)',
    operations: ['assignRepairForeman'],
  },
  'repair-measure': {
    title: 'Карточка объекта · Замер',
    ws: 'W6.21',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Замер (:73–101)',
    operations: ['getMeasurement', 'putMeasurement'],
  },
  'repair-estimate': {
    title: 'Карточка объекта · Смета',
    ws: 'W6.21',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Смета (:103–277)',
    operations: [
      'listEstimates',
      'getEstimate',
      'createEstimateFromTemplate',
      'createEstimateRevision',
      'updateEstimateDraft',
      'sendEstimate',
      'recallEstimate',
      'deleteEstimateDraft',
      'diffEstimates',
      'rejectChangeOrder',
      'listPriceItems',
      'listTemplates',
      'saveProjectAsTemplate',
    ],
  },
  'repair-schedule': {
    title: 'Карточка объекта · График',
    ws: 'W6.23',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · График (:279–511)',
    operations: [
      'getSchedule',
      'createScheduleFromEstimate',
      'previewScheduleChange',
      'applyScheduleChange',
      'setScheduleStageExecutor',
      'createScheduleBaseline',
    ],
  },
  'repair-docs': {
    title: 'Карточка объекта · Документы',
    ws: 'W6.24',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Документы (:513–529)',
    operations: ['listRepairDocuments', 'requestDocumentSignature', 'handOverRepairProject'],
  },
  'repair-supply-tab': {
    title: 'Карточка объекта · Снабжение',
    ws: 'W6.22',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Снабжение (:531–545)',
    operations: ['listSupplyRequests', 'createSupplyRequest', 'consumeSupplyRequest'],
  },
  'repair-finance': {
    title: 'Карточка объекта · Финансы',
    ws: 'W6.24',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Финансы объекта (:547–558)',
    operations: ['getProjectFinance'],
  },
  'repair-pay': {
    title: 'Карточка объекта · Оплата бригады',
    ws: 'W6.24',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Оплата бригад (:560–575)',
    operations: ['listCrewAccruals', 'accrueByAct', 'payoutAccruals'],
  },
  'repair-subs': {
    title: 'Карточка объекта · Подрядчики',
    ws: 'W6.24',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Подрядчики (:577–588)',
    operations: ['listSubcontractors', 'setSubcontractorAccess'],
  },
  'repair-client': {
    title: 'Карточка объекта · Кабинет заказчика',
    ws: 'W6.24',
    reference: 'design-2026-10-19 · Ремонт и стройка.dc.html · Кабинет заказчика (:590–611)',
    operations: ['getClientLink', 'issueClientLink', 'revokeClientLink'],
  },
  'repair-catalog': {
    title: 'Шаблоны и расценки',
    ws: 'W6.25',
    reference:
      'design-2026-10-19 · Ремонт и стройка.dc.html · Шаблоны и расценки (CRM:1903, :613–722)',
    operations: [
      'listPriceItems',
      'createPriceItem',
      'updatePriceItem',
      'listTemplates',
      'getTemplate',
      'updateTemplate',
      'copyTemplate',
    ],
  },
  'repair-supply': {
    title: 'Снабжение',
    ws: 'W6.22',
    reference:
      'design-2026-10-19 · Ремонт и стройка.dc.html · Снабжение и склады (CRM:1910, :724–829)',
    operations: [
      'listSupplyRequests',
      'reserveSupplyRequest',
      'issueSupplyRequest',
      'createPurchase',
      'listPurchases',
      'receivePurchase',
      'listProjectStock',
      'returnProjectStock',
      'transferProjectStock',
    ],
  },
  'public-client-cabinet': {
    title: 'Кабинет заказчика (публичная страница)',
    ws: 'W6.26',
    reference:
      'no-reference · публичная страница по токену (Q-W4.00-repair-10): превью 420 px вкладки «Кабинет заказчика»',
    operations: ['getClientCabinet', 'approveEstimateByClient', 'signDocumentByClient'],
  },
  'repair-supply-request': {
    title: 'Заявка прораба на материал',
    ws: 'W6.22',
    reference:
      'no-reference · форма заявки прораба (Q-W4.00-repair-6): дорисовка во вкладке «Снабжение» объекта',
    operations: ['createSupplyRequest'],
  },
};
