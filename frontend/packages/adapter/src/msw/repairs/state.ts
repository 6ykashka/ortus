// Состояние «Ремонта и стройки» сценарного сервера (W6.00, контракт 0.12.0-stage6): строки таблиц схемы repairs
// (tenant 0050–0054) для организации «Альта» (сид эталона — data.ts), доступ к объектам (прораб видит только свои
// объекты без черновиков и без цен, офис — всё), очередь «Требует решения» (одна функция для списка, карточки и
// «Главной», design/docs/19 «Правила карточки») и DTO контракта. Данные организации лежат в `org.repairs` и
// создаются при первом обращении.
import type { components } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';

import { actionsFor, type TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { MemberRow, Org } from '../core/state.ts';
import {
  buildLines,
  dayIso,
  estimateTotals,
  fmtQty,
  type Line,
  type Meas,
  measOf,
  scheduleOf,
  type StageCalc,
  isoDay,
  wdIn,
} from './calc.ts';
import { type Formula, type TechStage, type Unit } from './data.ts';

type S = components['schemas'];

/** UUID сида → идентификатор прототипа (для генератора примеров: tools/gen/examples-w600.mjs). */
export const PROTO_OF = new Map<string, string>();

export const A = (id: string): string => {
  const u = seedUuid('t-alta', id);
  PROTO_OF.set(u, id);
  return u;
};

export const SCOPE = 'tenant-org-unit-repair-project';

export interface ProjectRow {
  id: string;
  proto: string;
  orgUnitId: string;
  name: string;
  address: string;
  status: S['RepairProject']['status'];
  kind?: string;
  stage?: string;
  areaM2?: number;
  rooms?: number;
  contractNo?: string;
  startOn?: string;
  dueOn?: string;
  clientName?: string;
  clientPhone?: string;
  foremanId: string | null;
  access: S['RepairAccessItem'][];
  templateId?: string;
  leadTaskId?: string;
  budgetMinor?: number;
  paidMinor: number;
  spentMinor: number;
  handedOverOn?: string;
  warrantyUntil?: string;
  revision: number;
  scheduleRevision: number;
  createdAt: string;
}

export interface WorkerRow {
  id: string;
  projectId: string;
  displayName: string;
  trade: string;
  status: 'active' | 'archived';
}

export interface WorkRow {
  id: string;
  projectId: string;
  name: string;
  unit: Unit;
  plan: number;
  fact: number;
  estimateLineId?: string;
}

export interface LogLine {
  workId?: string;
  quantity: number;
  unit: Unit;
  description?: string;
}

export interface LogRow {
  id: string;
  number: string;
  projectId: string;
  submittedBy: string;
  workDate: string;
  timeZone: string;
  status: 'submitted' | 'accepted' | 'rejected';
  note?: string;
  crew: string[];
  materials: { priceItemId: string; quantity: number }[];
  evidence: string[];
  lines: LogLine[];
  reviewedBy?: string;
  reviewedAt?: string;
  returnReason?: string;
  revision: number;
  createdAt: string;
}

export interface ChangeRow {
  id: string;
  projectId: string;
  seq: number;
  title: string;
  quantity: number;
  unit: Unit;
  note: string;
  photos: string[];
  status: S['ChangeOrder']['status'];
  rejectReason?: S['RepairRejectReason'];
  agreementNo?: number;
  estimateVersion?: number;
  createdBy: string;
  revision: number;
  createdAt: string;
  /** Позиции справочника, которые подставляются в черновик допсоглашения (эталон: suggest). */
  suggest: [string, number][];
}

export interface RoomRow {
  id: string;
  name: string;
  l: number;
  w: number;
  h: number;
  o: number;
  wet: boolean;
}

export interface MeasRow {
  projectId: string;
  version: number;
  rooms: RoomRow[];
  by?: string;
  at: string;
}

export interface PriceRow {
  id: string;
  section: string;
  name: string;
  unit: Unit;
  kind: 'work' | 'material';
  priceMinor: number;
  archived: boolean;
  revision: number;
}

export interface TplLine {
  priceItemId: string;
  section: string;
  quantity?: number;
  formula?: Formula;
  coef?: number;
}

export interface TemplateRow {
  id: string;
  proto: string;
  name: string;
  kind: string;
  source: 'ortus' | 'own';
  copiedFrom?: string;
  sourceProjectId?: string;
  used: number;
  updatedAt: string;
  lines: TplLine[];
  stages: TechStage[];
  documents: S['RepairDocumentKind'][];
  checklist: string[];
  materials: TplLine[];
  warrantyMonths: number;
  revision: number;
}

export interface EstLine {
  id: string;
  sectionId: string;
  priceItemId?: string;
  name: string;
  unit: Unit;
  kind: 'work' | 'material';
  price: number;
  qty: number;
  formula?: Formula;
  coef?: number;
  manual: boolean;
  isNew: boolean;
}

export interface EstimateRow {
  id: string;
  projectId: string;
  version: number;
  kind: 'first' | 'revision' | 'change';
  state: 'draft' | 'sent' | 'approved' | 'replaced';
  baseVersion?: number;
  templateId?: string;
  sections: { id: string; name: string }[];
  lines: EstLine[];
  discountPct: number;
  changeOrderIds: string[];
  agreementNo?: number;
  sentAt?: string;
  approvedAt?: string;
  revision: number;
}

export interface StageRow {
  id: string;
  phase: string;
  name: string;
  durationWd: number;
  milestone: boolean;
  actualStart: number | null;
  status: 'planned' | 'started' | 'done';
  executorMemberId?: string;
  executorName?: string;
  sectionId?: string;
}

export interface ScheduleRow {
  projectId: string;
  stages: StageRow[];
  links: { from: string; to: string; lag: number; note?: string }[];
  baseline: { version: number; dueOn: string; approvedAt: string; agreementNo?: number } | null;
  changes: S['ScheduleChangeEntry'][];
  off: Record<string, number>;
  dur: Record<string, number>;
  lag: Record<string, number>;
}

export interface DocRow {
  id: string;
  projectId: string;
  kind: S['RepairDocumentKind'];
  title: string;
  state: S['RepairDocument']['state'];
  estimateVersion?: number;
  actNo?: number;
  amountMinor?: number;
  signedAt?: string;
  sentAt?: string;
  /** Код SMS (в MSW хранится открыто; настоящий сервер — только хеш). */
  signCode?: string;
  codeExpiresAt?: string;
  attempts: number;
  revision: number;
}

export interface SupplyRow {
  id: string;
  number: string;
  projectId: string;
  priceItemId: string;
  quantity: number;
  needBy: string;
  state: S['SupplyRequest']['state'];
  warehouseId?: string;
  purchaseId?: string;
  costMinor?: number;
  createdAt: string;
  revision: number;
}

export interface PurchaseRow {
  id: string;
  number: string;
  supplier: string;
  state: 'ordered' | 'received';
  lines: {
    supplyRequestId: string;
    projectId: string;
    priceItemId: string;
    quantity: number;
    priceMinor: number;
  }[];
  receiptQr?: string;
  createdAt: string;
  receivedAt?: string;
  revision: number;
}

export interface StockRow {
  projectId: string;
  priceItemId: string;
  quantity: number;
  costMinor: number;
}

export interface WhStockRow {
  warehouseId: string;
  priceItemId: string;
  quantity: number;
  reserved: number;
  avgMinor: number;
}

export interface AccrualRow {
  id: string;
  projectId: string;
  workerId: string;
  workerName: string;
  role: string;
  work: string;
  amountMinor: number;
  state: S['CrewAccrual']['state'];
  selfEmployed: boolean;
  actId?: string;
}

export interface SubRow {
  id: string;
  projectId: string;
  name: string;
  scope: string;
  active: boolean;
  accessUntil?: string;
  contractMinor?: number;
  paidMinor?: number;
}

export interface LinkRow {
  id: string;
  projectId: string;
  token: string;
  sentTo?: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface FeedRow {
  projectId: string;
  at: string;
  text: string;
  actorName?: string;
}

export interface RepairsData {
  projects: ProjectRow[];
  workers: WorkerRow[];
  works: WorkRow[];
  logs: LogRow[];
  changes: ChangeRow[];
  meas: MeasRow[];
  prices: PriceRow[];
  templates: TemplateRow[];
  estimates: EstimateRow[];
  schedules: ScheduleRow[];
  docs: DocRow[];
  supply: SupplyRow[];
  purchases: PurchaseRow[];
  stock: StockRow[];
  whStock: WhStockRow[];
  accruals: AccrualRow[];
  subs: SubRow[];
  links: LinkRow[];
  feed: FeedRow[];
  seq: number;
}

export type WithRepairs = Org & { repairs?: RepairsData };

/** Данные модуля организации; сид есть только у «Альты» (обязательная фабрика — seed.ts, чтобы не было цикла). */
let factory: ((org: Org, now: string) => RepairsData) | undefined;
export function registerSeed(f: (org: Org, now: string) => RepairsData): void {
  factory = f;
}

export function repairsOf(org: Org, now: string): RepairsData {
  const o = org as WithRepairs;
  if (!o.repairs) {
    if (!factory) throw new Error('сид «Ремонта и стройки» не подключён');
    o.repairs = factory(org, now);
  }
  return o.repairs;
}

// ---------------------------------------------------------------------------------------------
// Доступ

export interface View {
  t: TenantAccess;
  org: Org;
  rp: RepairsData;
  keys: Set<string>;
  owner: boolean;
  member: MemberRow | undefined;
  /** repairs.finance.read: цены, сметы, суммы. */
  finance: boolean;
  /** Видит все объекты организации (офис, владелец) и черновики. */
  office: boolean;
  now: string;
  s: HandlerContext['s'];
}

export function viewOf(ctx: HandlerContext): View {
  const t = ctx.org();
  const keys = actionsFor(t, SCOPE, ctx.now());
  const owner = t.owner;
  const office =
    owner ||
    keys.has('repairs.projects.manage') ||
    keys.has('repairs.estimates.edit') ||
    keys.has('repairs.supply.manage') ||
    keys.has('repairs.catalog.manage');
  return {
    t,
    org: t.org,
    rp: repairsOf(t.org, ctx.now()),
    keys,
    owner,
    member: t.member,
    finance: owner || keys.has('repairs.finance.read'),
    office,
    now: ctx.now(),
    s: ctx.s,
  };
}

export const can = (v: View, key: string): boolean => v.owner || v.keys.has(key);

export const canSee = (v: View, p: ProjectRow): boolean =>
  v.office || (p.status !== 'draft' && !!v.member && p.foremanId === v.member.id);

export function projectOr404(v: View, id: string | undefined): ProjectRow {
  const p = v.rp.projects.find((x) => x.id === (id ?? '').toLowerCase());
  if (!p || !canSee(v, p)) return fail('not_found', 'Объект не найден.');
  return p;
}

export const isForeman = (v: View, p: ProjectRow): boolean =>
  !!v.member && p.foremanId === v.member.id;

export function needFinance(v: View): void {
  if (!v.finance) fail('forbidden_action', 'Нужно право «Видеть финансы объекта».');
}

export const nextSeq = (v: View): number => ++v.rp.seq;
export const newRid = (v: View, scope: string): string =>
  seedUuid('t-alta:repairs', `${scope}-${nextSeq(v)}`);

// ---------------------------------------------------------------------------------------------
// Денежные и числовые помощники

export const money = (minor: number): S['Money'] => ({
  amountMinor: Math.round(minor),
  currency: 'RUB',
});
export const delta = (minor: number): S['RepairMoneyDelta'] => ({
  amountMinor: Math.round(minor),
  currency: 'RUB',
});
export const qty = (n: number): string => fmtQty(n);

export const isoDate = (at: string): string => at.slice(0, 10);

export function priceOf(v: View, id: string): PriceRow {
  const p = v.rp.prices.find((x) => x.id === id);
  if (!p)
    return fail('validation_failed', 'Позиции нет в справочнике.', {
      violations: [
        { field: 'priceItemId', code: 'unknown', message: 'Позиции нет в справочнике.' },
      ],
    });
  return p;
}

export function measOfProject(v: View, p: ProjectRow): { row: MeasRow; m: Meas } {
  const rows = v.rp.meas.filter((x) => x.projectId === p.id).sort((a, b) => a.version - b.version);
  const row = rows.at(-1) ?? { projectId: p.id, version: 1, rooms: [], at: v.now };
  return { row, m: measOf(row.rooms) };
}

export const estimatesOf = (v: View, p: ProjectRow): EstimateRow[] =>
  v.rp.estimates.filter((e) => e.projectId === p.id).sort((a, b) => a.version - b.version);

export const currentEstimate = (v: View, p: ProjectRow): EstimateRow | undefined =>
  [...estimatesOf(v, p)].reverse().find((e) => e.state === 'approved');

export const totalOf = (e: EstimateRow): S['Money'] =>
  money(estimateTotals(e.lines, e.discountPct).total);

// ---------------------------------------------------------------------------------------------
// Работы, готовность, очередь решений

export function worksOf(v: View, p: ProjectRow): { w: WorkRow; pending: number }[] {
  return v.rp.works
    .filter((w) => w.projectId === p.id)
    .map((w) => ({
      w,
      pending: v.rp.logs
        .filter((l) => l.projectId === p.id && l.status === 'submitted')
        .flatMap((l) => l.lines)
        .filter((ln) => ln.workId === w.id)
        .reduce((a, ln) => a + ln.quantity, 0),
    }));
}

export function readinessOf(v: View, p: ProjectRow): S['RepairReadiness'] {
  if (p.status === 'handed_over') return { acceptedPct: 100, pendingPct: 0, clientPct: 100 };
  const ws = worksOf(v, p);
  const plan = ws.reduce((a, x) => a + x.w.plan, 0);
  const pct = (n: number) => (plan ? Math.min(100, Math.round((n / plan) * 100)) : 0);
  const acts = v.rp.docs.filter((d) => d.projectId === p.id && d.kind === 'act');
  const signed = acts.filter((d) => d.state === 'signed' || d.state === 'paid').length;
  return {
    acceptedPct: pct(ws.reduce((a, x) => a + x.w.fact, 0)),
    pendingPct: pct(ws.reduce((a, x) => a + x.pending, 0)),
    clientPct: acts.length ? Math.round((signed / acts.length) * 100) : 0,
  };
}

export const SCHEDULE_START = '2026-10-05';

export interface Forecast {
  calc: Record<string, StageCalc>;
  dueDay: number | null;
  finDay: number | null;
  delayWd: number;
}

export function forecastOf(sch: ScheduleRow | undefined): Forecast {
  if (!sch || !sch.stages.length) return { calc: {}, dueDay: null, finDay: null, delayWd: 0 };
  const calc = scheduleOf(
    sch.stages.map((s) => ({
      id: s.id,
      durationWd: s.durationWd,
      milestone: s.milestone,
      actualStart: s.actualStart,
    })),
    sch.links,
    sch,
  );
  const last = sch.stages.at(-1);
  const finDay = last ? (calc[last.id]?.end ?? null) : null;
  const dueDay = sch.baseline ? isoDay(sch.baseline.dueOn) : null;
  const delayWd = finDay !== null && dueDay !== null ? Math.max(0, wdIn(dueDay, finDay)) : 0;
  return { calc, dueDay, finDay, delayWd };
}

export const ruDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const UNIT_RU: Record<Unit, string> = {
  hour: 'ч',
  m2: 'м²',
  m3: 'м³',
  m: 'м',
  piece: 'шт',
  set: 'компл',
  trip: 'рейс',
  mesh: 'меш',
  liter: 'л',
};
export const unitRu = (u: Unit): string => UNIT_RU[u];

export function decisionsOf(v: View, p: ProjectRow): S['RepairDecision'][] {
  const out: S['RepairDecision'][] = [];
  const foreman = isForeman(v, p) && !v.office;
  const reviewer = can(v, 'repairs.work_logs.review');
  const estimator = v.finance && can(v, 'repairs.estimates.edit');
  const push = (d: S['RepairDecision']) => out.push(d);
  const est = estimatesOf(v, p);
  if (p.status === 'draft') {
    const cur = est.at(-1);
    if (!est.length)
      push({
        kind: 'estimate_missing',
        text: 'Смета не собрана',
        actionLabel: 'Собрать смету',
        tab: 'estimate',
      });
    else if (cur?.state === 'draft')
      push({
        kind: 'estimate_draft',
        text: 'Черновик сметы не отправлен заказчику',
        actionLabel: 'Открыть смету',
        tab: 'estimate',
      });
    else if (cur?.state === 'sent')
      push({
        kind: 'estimate_sent',
        text: 'Смета у заказчика на согласовании',
        actionLabel: 'Открыть смету',
        tab: 'estimate',
      });
    else if (cur?.state === 'approved')
      push({
        kind: 'estimate_approved',
        text: 'Смета согласована: следующий шаг — договор',
        actionLabel: 'Открыть смету',
        tab: 'estimate',
      });
    return v.finance ? out : out.filter((d) => !d.kind.startsWith('estimate_'));
  }
  if (!p.foremanId && p.status === 'active' && can(v, 'repairs.projects.manage')) {
    push({
      kind: 'no_foreman',
      text: 'Не назначен прораб',
      actionLabel: 'Назначить прораба',
      tab: 'overview',
    });
  }
  for (const l of v.rp.logs.filter((x) => x.projectId === p.id && x.status === 'submitted')) {
    const ln = l.lines[0];
    const w = v.rp.works.find((x) => x.id === ln?.workId);
    const text = `${w?.name ?? 'Работа'}: ${fmtQty(ln?.quantity ?? 0)} ${unitRu(ln?.unit ?? 'm2')}`;
    if (reviewer)
      push({
        kind: 'work_log_pending',
        text,
        actionLabel: 'Принять объём',
        tab: 'works',
        refId: l.id,
      });
    else if (foreman)
      push({
        kind: 'work_log_pending',
        text: `Отметка ${l.number} ждёт приёмки`,
        tab: 'works',
        refId: l.id,
      });
  }
  if (foreman && p.status === 'active') {
    const today = isoDate(v.now);
    if (!v.rp.logs.some((l) => l.projectId === p.id && l.workDate === today)) {
      push({
        kind: 'work_log_missing',
        text: 'Отметка за сегодня не отправлена',
        actionLabel: 'Отметить работу',
        tab: 'works',
      });
    }
  }
  const sch = v.rp.schedules.find((x) => x.projectId === p.id);
  if (sch) {
    const f = forecastOf(sch);
    if (f.delayWd > 0 && f.finDay !== null) {
      push({
        kind: 'schedule_slip',
        text: `Сдача сдвигается на ${ruDate(dayIso(f.finDay))}`,
        actionLabel: 'Открыть график',
        tab: 'schedule',
      });
    }
    const idle = sch.stages.filter(
      (s) => !s.executorName && !s.executorMemberId && s.status !== 'done',
    );
    if (idle.length) {
      push({
        kind: 'stage_no_executor',
        text: `Не назначен исполнитель: ${idle.map((s) => s.name).join(', ')}`,
        actionLabel: 'Открыть график',
        tab: 'schedule',
        refId: undefined,
      });
    }
  }
  if (v.finance) {
    for (const d of v.rp.docs.filter((x) => x.projectId === p.id)) {
      if (d.state === 'sms' || d.state === 'wait')
        push({
          kind: 'document_wait_signature',
          text: `${d.title}: ждёт подписи заказчика`,
          actionLabel: 'Открыть документы',
          tab: 'docs',
          refId: d.id,
        });
      else if (d.state === 'draft' && d.kind === 'act')
        push({
          kind: 'document_ready',
          text: `${d.title}: готов к отправке`,
          actionLabel: 'Открыть документы',
          tab: 'docs',
          refId: d.id,
        });
    }
  }
  const reqs = v.rp.supply.filter((r) => r.projectId === p.id && r.state === 'request');
  if (reqs.length && can(v, 'repairs.supply.manage')) {
    push({
      kind: 'supply_pending',
      text: `Заявки на материалы ждут решения снабжения: ${reqs.length}`,
      actionLabel: 'Решить в снабжении',
      tab: 'supply',
    });
  }
  if (v.finance) {
    const sent = est.find((e) => e.state === 'sent');
    if (sent)
      push({
        kind: 'estimate_with_client',
        text: `Смета v${sent.version}: у заказчика`,
        actionLabel: 'Открыть смету',
        tab: 'estimate',
      });
  }
  if (estimator) {
    for (const c of v.rp.changes.filter((x) => x.projectId === p.id)) {
      if (c.status === 'proposed')
        push({
          kind: 'change_order_new',
          text: `Допработа ДР-${c.seq} ждёт оценки: ${c.title}`,
          actionLabel: 'Оценить в смете',
          tab: 'estimate',
          refId: c.id,
        });
      else if (c.status === 'priced')
        push({
          kind: 'change_order_priced',
          text: `Допработа ДР-${c.seq} в черновике допсоглашения`,
          actionLabel: 'Открыть смету',
          tab: 'estimate',
          refId: c.id,
        });
      else if (c.status === 'sent')
        push({
          kind: 'change_order_sent',
          text: `Допработа ДР-${c.seq} в допсоглашении у заказчика`,
          actionLabel: 'Открыть смету',
          tab: 'estimate',
          refId: c.id,
        });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// DTO

export const workerDto = (w: WorkerRow): S['Worker'] => ({
  id: w.id,
  displayName: w.displayName,
  trade: w.trade,
  status: w.status,
});

export function projectDto(v: View, p: ProjectRow): S['RepairProject'] {
  const todo = decisionsOf(v, p);
  const sch = v.rp.schedules.find((x) => x.projectId === p.id);
  const f = forecastOf(sch);
  const dto: S['RepairProject'] = {
    id: p.id,
    orgUnitId: p.orgUnitId,
    name: p.name,
    address: p.address,
    status: p.status,
    foremanMemberId: p.foremanId,
    workers: v.rp.workers.filter((w) => w.projectId === p.id).map(workerDto),
    revision: p.revision,
    access: structuredClone(p.access),
    measured: v.rp.meas.some((m) => m.projectId === p.id && m.rooms.length > 0),
    readiness: readinessOf(v, p),
    todoCount: todo.length,
  };
  if (p.kind) dto.kind = p.kind;
  if (p.stage) dto.stage = p.stage;
  if (p.areaM2 !== undefined) dto.areaM2 = qty(p.areaM2);
  if (p.rooms !== undefined) dto.rooms = p.rooms;
  if (p.contractNo) dto.contractNo = p.contractNo;
  if (p.startOn) dto.startOn = p.startOn;
  if (p.dueOn) dto.dueOn = p.dueOn;
  if (p.dueOn && f.finDay !== null && f.delayWd > 0) dto.forecastDueOn = dayIso(f.finDay);
  else if (p.dueOn) dto.forecastDueOn = p.dueOn;
  if (p.clientName) dto.clientName = p.clientName;
  if (p.clientPhone && v.finance) dto.clientPhone = p.clientPhone;
  if (p.handedOverOn) dto.handedOverOn = p.handedOverOn;
  if (p.warrantyUntil) dto.warrantyUntil = p.warrantyUntil;
  if (p.templateId) dto.templateId = p.templateId;
  if (p.leadTaskId) dto.leadTaskId = p.leadTaskId;
  if (todo[0]) dto.todoTop = todo[0];
  if (v.finance && p.budgetMinor !== undefined) dto.budget = money(p.budgetMinor);
  return dto;
}

export function logDto(v: View, l: LogRow): S['WorkLog'] {
  const dto: S['WorkLog'] = {
    id: l.id,
    projectId: l.projectId,
    submittedByMemberId: l.submittedBy,
    workDate: l.workDate,
    timeZone: l.timeZone,
    lines: l.lines.map((ln) => {
      const o: S['WorkLogLine'] = { quantity: qty(ln.quantity), unit: ln.unit };
      if (ln.workId) o.workId = ln.workId;
      if (ln.description) o.description = ln.description;
      return o;
    }),
    evidenceFileIds: [...l.evidence],
    status: l.status,
    createdAt: l.createdAt,
    revision: l.revision,
    number: l.number,
    crewWorkerIds: [...l.crew],
    materials: l.materials.map((m) => ({ priceItemId: m.priceItemId, quantity: qty(m.quantity) })),
  };
  if (l.reviewedAt && l.status === 'accepted') {
    dto.acceptedAt = l.reviewedAt;
    if (l.reviewedBy) dto.acceptedByMemberId = l.reviewedBy;
  }
  const p = v.rp.projects.find((x) => x.id === l.projectId);
  if (l.returnReason && p && (v.office || isForeman(v, p))) dto.returnReason = l.returnReason;
  return dto;
}

export const changeDto = (c: ChangeRow): S['ChangeOrder'] => {
  const dto: S['ChangeOrder'] = {
    id: c.id,
    projectId: c.projectId,
    number: `ДР-${c.seq}`,
    title: c.title,
    quantity: qty(c.quantity),
    unit: c.unit,
    note: c.note,
    photoFileIds: [...c.photos],
    status: c.status,
    createdAt: c.createdAt,
    revision: c.revision,
  };
  if (c.rejectReason) dto.rejectReason = c.rejectReason;
  if (c.agreementNo) dto.agreementNo = c.agreementNo;
  if (c.estimateVersion) dto.estimateVersion = c.estimateVersion;
  return dto;
};

export function measDto(m: MeasRow): S['Measurement'] {
  const t = measOf(m.rooms);
  const dto: S['Measurement'] = {
    projectId: m.projectId,
    version: m.version,
    rooms: m.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      lengthM: qty(r.l),
      widthM: qty(r.w),
      heightM: qty(r.h),
      openingsM2: qty(r.o),
      wet: r.wet,
    })),
    totals: {
      floorM2: qty(t.F),
      wallsM2: qty(t.W),
      perimeterM: qty(t.P),
      wetFloorM2: qty(t.bf),
      wetWallsM2: qty(t.bw),
    },
    revision: m.version,
    measuredAt: m.at,
  };
  if (m.by) dto.measuredByMemberId = m.by;
  return dto;
}

export function estimateDto(e: EstimateRow): S['Estimate'] {
  const dto: S['Estimate'] = {
    projectId: e.projectId,
    version: e.version,
    kind: e.kind,
    state: e.state,
    sections: e.sections.map((s) => ({ id: s.id, name: s.name })),
    lines: e.lines.map((l) => {
      const o: S['EstimateLine'] = {
        id: l.id,
        sectionId: l.sectionId,
        name: l.name,
        unit: l.unit,
        kind: l.kind,
        price: money(l.price * 100),
        quantity: qty(l.qty),
        sum: money(Math.round(l.price * 100 * l.qty)),
        manual: l.manual,
        isNew: l.isNew,
      };
      if (l.priceItemId) o.priceItemId = l.priceItemId;
      if (l.formula) o.formula = l.formula;
      if (l.coef && l.coef !== 1) o.coef = qty(l.coef);
      return o;
    }),
    discountPct: e.discountPct,
    total: totalOf(e),
    changeOrderIds: [...e.changeOrderIds],
    revision: e.revision,
  };
  if (e.baseVersion) dto.baseVersion = e.baseVersion;
  if (e.templateId) dto.templateId = e.templateId;
  if (e.agreementNo) dto.agreementNo = e.agreementNo;
  if (e.sentAt) dto.sentAt = e.sentAt;
  if (e.approvedAt) dto.approvedAt = e.approvedAt;
  return dto;
}

export const priceDto = (v: View, p: PriceRow): S['PriceItem'] => ({
  id: p.id,
  section: p.section,
  name: p.name,
  unit: p.unit,
  kind: p.kind,
  price: money(p.priceMinor),
  usedInTemplates: v.rp.templates.filter((t) =>
    [...t.lines, ...t.materials].some((l) => l.priceItemId === p.id),
  ).length,
  archived: p.archived,
  revision: p.revision,
});

const tplLineDto = (l: TplLine): S['TemplateLine'] => {
  const o: S['TemplateLine'] = { priceItemId: l.priceItemId, section: l.section };
  if (l.quantity !== undefined) o.quantity = qty(l.quantity);
  if (l.formula) o.formula = l.formula;
  if (l.coef && l.coef !== 1) o.coef = qty(l.coef);
  return o;
};

export function templateDto(v: View, t: TemplateRow): S['Template'] {
  const dto: S['Template'] = {
    id: t.id,
    name: t.name,
    kind: t.kind,
    source: t.source,
    usedByObjects: v.rp.projects.filter((p) => p.templateId === t.id).length || t.used,
    updatedAt: t.updatedAt,
    lines: t.lines.map(tplLineDto),
    stages: t.stages.map((s) => {
      const o: S['TemplateStage'] = { name: s.name, pauseDays: s.pauseDays };
      if (s.ratePerDay !== null) o.ratePerDay = qty(s.ratePerDay);
      return o;
    }),
    documents: [...t.documents],
    checklist: [...t.checklist],
    materials: t.materials.map(tplLineDto),
    warrantyMonths: t.warrantyMonths,
    revision: t.revision,
  };
  if (t.copiedFrom) dto.copiedFromId = t.copiedFrom;
  if (t.sourceProjectId) dto.sourceProjectId = t.sourceProjectId;
  return dto;
}

/** Строки сметы из строк шаблона на замере объекта (цены справочника на дату сборки). */
export function linesFromTemplate(
  v: View,
  t: TemplateRow,
  m: Meas,
): { lines: EstLine[]; sections: { id: string; name: string }[] } {
  const sections: { id: string; name: string }[] = [];
  const secId = (name: string): string => {
    let s = sections.find((x) => x.name === name);
    if (!s) {
      s = { id: newRid(v, 'sec'), name };
      sections.push(s);
    }
    return s.id;
  };
  const cat = v.rp.prices.map((p) => ({
    id: p.id,
    cat: p.section,
    name: p.name,
    unit: p.unit,
    kind: p.kind,
    price: p.priceMinor / 100,
  }));
  const built: Line[] = buildLines(
    cat,
    t.lines.map((l) => ({
      section: l.section,
      item: l.priceItemId,
      formula: l.formula ?? null,
      coef: l.coef ?? 1,
      quantity: l.quantity ?? 1,
    })),
    m,
  );
  const lines = built.map<EstLine>((b) => ({
    id: newRid(v, 'line'),
    sectionId: secId(b.section),
    priceItemId: b.item,
    name: b.name,
    unit: b.unit,
    kind: b.kind,
    price: b.price,
    qty: b.qty,
    ...(b.formula ? { formula: b.formula } : {}),
    ...(b.coef !== 1 ? { coef: b.coef } : {}),
    manual: false,
    isNew: false,
  }));
  return { lines, sections };
}

/** Количество строки «из замера» при пересчёте: ручной объём не пересчитывается. */
export function liveQty(l: EstLine, m: Meas): number {
  if (!l.formula || l.manual) return l.qty;
  const built = buildLines(
    [{ id: 'x', cat: '', name: l.name, unit: l.unit, kind: l.kind, price: l.price }],
    [{ section: '', item: 'x', formula: l.formula, coef: l.coef ?? 1, quantity: l.qty }],
    m,
  );
  return built[0]?.qty ?? l.qty;
}

export const docDto = (v: View, d: DocRow): S['RepairDocument'] => {
  const dto: S['RepairDocument'] = {
    id: d.id,
    projectId: d.projectId,
    kind: d.kind,
    title: d.title,
    state: d.state,
  };
  if (d.estimateVersion) dto.estimateVersion = d.estimateVersion;
  if (d.actNo) dto.actNo = d.actNo;
  if (d.amountMinor !== undefined && v.finance) dto.amount = money(d.amountMinor);
  if (d.signedAt) dto.signedAt = d.signedAt;
  if (d.sentAt) dto.sentAt = d.sentAt;
  return dto;
};

export const addFeed = (v: View, projectId: string, text: string, actor?: string): void => {
  v.rp.feed.unshift({ projectId, at: v.now, text, actorName: actor ?? v.t.member?.displayName });
};
