// Тег Cash сценарного сервера (W5.00, контракт 0.12.0-stage5; W5.31 — backend, W5.32, W5.33 — страницы): кассы и журнал,
// сторно и связь с источником, «похоже на дубль», предложения модулей, смены и сверка, перемещения, подотчёт и чеки,
// заявки сверх лимита роли, статьи. Эталон — «Касса.dc.html» и ortus/cash.js (design-2026-10-19), разбор
// docs/plan/v2/analysis/dor/cash.md §2. Права — по кассе (область роли, PD-53); сверх лимита роли — 202 и заявка
// внутри модуля (Q-W4.00-cash-2); автор не решает своё (self_approval); журнал неизменяем — исправление сторно.
import type { components } from '@ortus/api-client';

import { page, uuidParam } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { HandlerContext, HandlerResult, Registry } from '../core/registry.ts';
import {
  accountDto,
  type AcctKind,
  type AcctRow,
  balanceOf,
  can,
  CATEGORIES,
  type CashView,
  type Method,
  type OpRow,
  proposalDto,
  type ProposalRow,
  receiptDto,
  type ReceiptRow,
  requestDto,
  type RequestRow,
  rightsOf,
  rub,
  shiftDto,
  type ShiftRow,
  signedRub,
  transferDto,
  type TransferRow,
  viewOf,
  withReversed,
} from './state.ts';

type S = components['schemas'];

const body = <T>(ctx: HandlerContext): T => ctx.body as T;
const lower = (id: string | undefined | null): string => (id ?? '').toLowerCase();

function invalid(field: string, message: string, code = 'invalid'): never {
  const v: Violation = { field, code, message };
  return fail('validation_failed', message, { violations: [v] });
}

/** Физическая касса (наличные) не уходит в минус; терминал, счёт и виртуальная — могут. */
const PHYSICAL: readonly AcctKind[] = ['cash_drawer', 'safe', 'advance'];

const money = (m: S['Money'] | undefined, field: string, currency = 'RUB'): number => {
  if (!m || m.currency !== currency) invalid(field, 'Валюта суммы не совпадает с валютой кассы.');
  return m.amountMinor;
};

const fmtRub = (minor: number): string => {
  const rubles = minor / 100;
  const s = Number.isInteger(rubles) ? String(rubles) : rubles.toFixed(2).replace('.', ',');
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0₽`;
};

// ───────────────────────────── ядро журнала ─────────────────────────────

function accountOr404(v: CashView, id: string | undefined): AcctRow {
  const a = v.data.accounts.find((x) => x.id === lower(id));
  if (!a || !v.visible(a)) return fail('not_found', 'Касса не найдена.');
  return a;
}

function need(v: CashView, a: AcctRow, key: string, text: string): void {
  if (!can(v.rights(a), key)) fail('forbidden_action', text);
}

const NEED_POST = 'Нет права «Вносить приход и расход».';

/** Касса точки: сама касса или касса терминала. */
const pointOf = (v: CashView, a: AcctRow): AcctRow =>
  (a.drawerId && v.data.accounts.find((x) => x.id === a.drawerId)) || a;

const openShift = (v: CashView, a: AcctRow): ShiftRow | undefined =>
  v.data.shifts.find((s) => s.accountId === pointOf(v, a).id && s.status === 'open');

interface PostInput {
  account: AcctRow;
  type: OpRow['type'];
  amount: number;
  method: Method;
  categoryId: string | null;
  basis: string | null;
  occurredAt: string;
  by: string;
  approvedBy?: string | null;
  origin?: OpRow['origin'];
  receipt?: S['CashReceipt'] | null;
  source?: S['CashSourceRef'] | null;
  related?: S['ObjectRef'];
  reverses?: string | null;
  refunds?: string | null;
  own?: boolean;
  groupId?: string | null;
  transferId?: string | null;
  /** Не привязывать к смене (перемещения, корректировки смены). */
  shiftId?: string | null;
  direction?: 'in' | 'out';
}

/** Одна запись журнала: остаток не уходит в минус (409 insufficient_funds), № ФД уникален (409 duplicate_receipt). */
function post(ctx: HandlerContext, v: CashView, p: PostInput): OpRow {
  const out = p.direction ? p.direction === 'out' : ['out', 'refund', 'move_out'].includes(p.type);
  const a = p.account;
  if (out && PHYSICAL.includes(a.kind) && balanceOf(v.data, a.id) - p.amount < 0) {
    fail('insufficient_funds', 'В кассе нет столько наличных.');
  }
  const point = pointOf(v, a);
  const fd = p.receipt?.fdNumber;
  if (fd !== undefined) {
    const dup = v.data.ops.some((o) => {
      const pa = v.data.accounts.find((x) => x.id === o.accountId);
      return (
        o.receipt?.fdNumber === fd &&
        o.receipt.kktShift === p.receipt?.kktShift &&
        pa &&
        pointOf(v, pa).id === point.id
      );
    });
    if (dup) fail('duplicate_receipt', `Чек № ФД ${fd} уже внесён.`);
  }
  const number = ++v.data.seq.op;
  const row: OpRow = {
    id: ctx.newId(v.t.org.proto),
    proto: `K-${number}`,
    number,
    accountId: a.id,
    type: p.type,
    direction: out ? 'out' : 'in',
    amount: p.amount,
    category:
      p.type === 'refund'
        ? 'refund'
        : p.type === 'opening'
          ? 'opening_balance'
          : p.type === 'adjust' || p.type === 'storno'
            ? 'adjustment'
            : p.type === 'in'
              ? 'service_payment'
              : 'expense',
    categoryId: p.categoryId,
    method: p.method,
    basis: p.basis,
    occurredAt: p.occurredAt,
    by: p.by,
    approvedBy: p.approvedBy ?? null,
    origin: p.origin ?? 'manual',
    reverses: p.reverses ?? null,
    refunds: p.refunds ?? null,
    own: p.own ?? false,
    shiftId: p.shiftId === undefined ? (openShift(v, a)?.id ?? null) : p.shiftId,
    groupId: p.groupId ?? null,
    transferId: p.transferId ?? null,
    source: p.source ?? null,
    receipt: p.receipt ?? null,
  };
  if (p.related) row.related = p.related;
  v.data.ops.push(row);
  return row;
}

function claim(v: CashView, key: string | undefined): void {
  if (!key) return;
  if (v.data.claims.includes(key)) fail('duplicate_source', 'Этот источник уже проведён в кассе.');
  v.data.claims.push(key);
}

const needsApproval = (limit: number | null, amount: number): boolean =>
  limit !== null && amount > limit;

function request(
  ctx: HandlerContext,
  v: CashView,
  a: AcctRow,
  type: RequestRow['type'],
  amount: number,
  limit: number | null,
  x: Partial<RequestRow> & { payload: RequestRow['payload'] },
): RequestRow {
  const q: RequestRow = {
    id: ctx.newId(v.t.org.proto),
    proto: `rq-n${v.data.requests.length + 1}`,
    accountId: a.id,
    type,
    amount,
    method: null,
    categoryId: null,
    basis: null,
    source: null,
    limit,
    status: 'pending',
    by: v.t.member?.id ?? '',
    at: v.now,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    operationId: null,
    transferId: null,
    revision: 1,
    ...x,
  };
  v.data.requests.push(q);
  return q;
}

const accepted = (q: RequestRow): HandlerResult => ({
  status: 202,
  body: requestDto(q),
  etag: q.revision,
});

// ───────────────────────────── кассы ─────────────────────────────

const KINDS = ['cash_drawer', 'safe', 'advance', 'acquiring', 'bank', 'virtual'];

function listCashAccounts(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const kind = ctx.query.get('kind');
  if (kind !== null && !KINDS.includes(kind)) invalid('kind', 'Неизвестный вид кассы.');
  const unit = uuidParam(ctx.query, 'orgUnitId', false);
  const items = v.data.accounts
    .filter((a) => v.visible(a) && (!kind || a.kind === kind) && (!unit || a.orgUnitId === unit))
    .map((a) => accountDto(v.data, a, v.rights(a)));
  return { body: page(items, ctx.query) };
}

interface AccountInput {
  orgUnitId: string | null;
  name: string;
  kind: AcctKind;
  shiftMode?: AcctRow['shiftMode'];
  kktMode?: AcctRow['kktMode'];
  balanceLimit?: S['Money'] | null;
  floatAmount?: S['Money'] | null;
  tolerance?: S['Money'] | null;
  responsibleMemberId?: string | null;
  holderMemberId?: string | null;
  advanceLimit?: S['Money'] | null;
  drawerAccountId?: string | null;
  settleDays?: number | null;
  feeBasisPoints?: number | null;
  categoryIds?: string[];
}

function validateAccount(v: CashView, b: AccountInput, except?: string): void {
  const name = b.name.trim();
  if (!name) invalid('name', 'Укажите название кассы.');
  if (v.data.accounts.some((a) => a.id !== except && a.name.toLowerCase() === name.toLowerCase())) {
    invalid('name', 'Касса с таким названием уже есть.', 'taken');
  }
  if (b.orgUnitId && !v.t.org.units.some((u) => u.id === lower(b.orgUnitId))) {
    invalid('orgUnitId', 'Подразделение не найдено.');
  }
  if (b.kind === 'acquiring') {
    if (!b.drawerAccountId)
      invalid('drawerAccountId', 'Для терминала укажите кассу точки.', 'required');
    const d = v.data.accounts.find((a) => a.id === lower(b.drawerAccountId));
    if (!d || d.kind !== 'cash_drawer') invalid('drawerAccountId', 'Касса точки не найдена.');
  }
  if (b.kind === 'advance') {
    if (!b.holderMemberId) invalid('holderMemberId', 'Укажите сотрудника подотчёта.', 'required');
    if (!v.t.org.members.some((m) => m.id === lower(b.holderMemberId))) {
      invalid('holderMemberId', 'Сотрудник не найден.');
    }
  }
}

function createCashAccount(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const b = body<AccountInput>(ctx);
  validateAccount(v, b);
  const unit = b.orgUnitId ? lower(b.orgUnitId) : null;
  if (!v.t.owner) {
    const ok =
      v.t.member &&
      rightsOf(v.t, v.data, { id: '', orgUnitId: unit } as AcctRow, v.now).rights.includes(
        'cash.accounts.manage',
      );
    if (!ok) fail('forbidden_action', 'Нет права «Кассы, статьи и лимиты».');
  }
  const m = (x: S['Money'] | null | undefined): number | null => (x ? x.amountMinor : null);
  const row: AcctRow = {
    id: ctx.newId(v.t.org.proto),
    proto: `ca-n${v.data.accounts.length + 1}`,
    kind: b.kind,
    name: b.name.trim(),
    orgUnitId: unit,
    shiftMode: b.shiftMode ?? 'none',
    kktMode: b.kktMode ?? 'none',
    balanceLimit: m(b.balanceLimit),
    floatAmount: m(b.floatAmount),
    tolerance: m(b.tolerance),
    responsibleId: b.responsibleMemberId ? lower(b.responsibleMemberId) : null,
    holderId: b.holderMemberId ? lower(b.holderMemberId) : null,
    advanceLimit: m(b.advanceLimit),
    drawerId: b.drawerAccountId ? lower(b.drawerAccountId) : null,
    settleDays: b.settleDays ?? null,
    feeBasisPoints: b.feeBasisPoints ?? null,
    categoryIds: b.categoryIds ?? [],
    revision: 1,
  };
  v.data.accounts.push(row);
  return { status: 201, body: accountDto(v.data, row, v.rights(row)), etag: 1 };
}

function previewCashAccountAccess(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const kind = ctx.query.get('kind');
  if (!kind || !KINDS.includes(kind)) invalid('kind', 'Укажите вид кассы.', 'required');
  const unit = uuidParam(ctx.query, 'orgUnitId', false) ?? null;
  const holder = uuidParam(ctx.query, 'holderMemberId', false) ?? null;
  const drawer = ctx.query.get('drawerAccountId');
  if (kind === 'acquiring' && !drawer)
    invalid('drawerAccountId', 'Для терминала укажите кассу точки.', 'required');
  const probe = {
    id: '',
    kind,
    orgUnitId: unit,
    holderId: holder,
    drawerId: null,
  } as unknown as AcctRow;
  const people: S['CashAccessPerson'][] = [];
  for (const m of v.t.org.members) {
    if (m.status !== 'active') continue;
    const owner =
      v.t.org === v.t.org && m.userId !== undefined && v.t.owner && m.id === v.t.member?.id;
    const t = { ...v.t, member: m, owner };
    const r = rightsOf(t, v.data, probe, v.now);
    if (!r.rights.length) continue;
    const conflicts: string[] = [];
    if (can(r, 'cash.post') && can(r, 'cash.approve'))
      conflicts.push('Вносит и согласует расходы: назначьте разных людей');
    if (can(r, 'cash.shift.operate') && can(r, 'cash.reconcile'))
      conflicts.push('Закрывает смену и принимает расхождение: назначьте разных людей');
    people.push({
      memberId: m.id,
      name: m.displayName,
      via: r.via,
      rights: r.rights,
      limits: r.limits,
      conflicts,
    });
  }
  return { body: { items: people } };
}

// ───────────────────────────── журнал ─────────────────────────────

const TYPES = ['in', 'out', 'refund', 'move_in', 'move_out', 'opening', 'adjust', 'storno'];

function listCashOperations(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const accountId = uuidParam(ctx.query, 'accountId', false);
  const shiftId = uuidParam(ctx.query, 'shiftId', false);
  const type = ctx.query.get('type');
  if (type !== null && !TYPES.includes(type)) invalid('type', 'Неизвестный тип операции.');
  const items = v.data.ops
    .filter((o) => {
      const a = v.data.accounts.find((x) => x.id === o.accountId);
      return (
        a &&
        v.visible(a) &&
        (!accountId || o.accountId === accountId) &&
        (!shiftId || o.shiftId === shiftId) &&
        (!type || o.type === type)
      );
    })
    .sort((x, y) =>
      x.occurredAt === y.occurredAt ? y.number - x.number : x.occurredAt < y.occurredAt ? 1 : -1,
    )
    .map((o) => withReversed(v.data, o));
  return { body: page(items, ctx.query) };
}

interface OpInput {
  accountId: string;
  type?: 'in' | 'out' | 'refund' | 'opening';
  direction: 'in' | 'out';
  method?: Method;
  amount: S['Money'];
  category: S['CashOperation']['category'];
  categoryId?: string | null;
  basis?: string;
  occurredAt: string;
  receipt?: S['CashReceipt'];
  source?: S['CashSourceRef'];
  relatedObject?: S['ObjectRef'];
  refundsOperationId?: string;
  reversesOperationId?: string;
  note?: string;
}

const CATEGORY_OF: Record<string, S['CashOperation']['category'][]> = {
  in: ['service_payment'],
  out: ['expense'],
  refund: ['refund'],
  opening: ['opening_balance'],
};

function checkReceipt(r: S['CashReceipt'] | undefined): void {
  if (!r) return;
  if ((r.fdNumber === undefined) !== (r.kktShift === undefined)) {
    invalid('receipt.kktShift', 'Укажите № ФД и смену ККТ вместе.');
  }
  if (r.none && !r.reason) invalid('receipt.reason', 'Укажите, почему чек не пробивали.');
}

function postCashOperation(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const b = body<OpInput>(ctx);
  const a = accountOr404(v, b.accountId);
  const type =
    b.type ??
    (b.category === 'refund'
      ? 'refund'
      : b.category === 'opening_balance'
        ? 'opening'
        : b.direction);
  const r = v.rights(a);
  if (type === 'opening') {
    if (!can(r, 'cash.accounts.manage'))
      fail('forbidden_action', 'Ввод остатка — только с правом «Кассы, статьи и лимиты».');
    if (v.data.ops.some((o) => o.accountId === a.id)) {
      invalid('type', 'Остаток вводится первой записью кассы.', 'opening_not_first');
    }
    if (!b.basis || b.basis.trim().length < 3)
      invalid('basis', 'Основание — не короче 3 знаков.', 'required');
  } else if (type === 'refund') {
    need(v, a, 'cash.refund', 'Нет права «Возвраты клиентам».');
  } else {
    need(v, a, 'cash.post', NEED_POST);
  }
  if (!CATEGORY_OF[type]?.includes(b.category))
    invalid('category', 'Категория не соответствует типу операции.');
  if (type === 'in' || type === 'opening' ? b.direction !== 'in' : b.direction !== 'out') {
    invalid('direction', 'Направление не соответствует типу операции.');
  }
  const amount = money(b.amount, 'amount');
  if (amount <= 0) invalid('amount', 'Сумма должна быть больше нуля.');
  const basis = (b.basis ?? '').trim();
  if (type !== 'opening' && basis.length < 3)
    invalid('basis', 'Основание — не короче 3 знаков.', 'required');
  checkReceipt(b.receipt);
  if (b.categoryId && !CATEGORIES.some((c) => c.id === b.categoryId))
    invalid('categoryId', 'Статья не найдена.');
  if (a.kind === 'advance' && type === 'in')
    invalid('type', 'В подотчёт деньги выдаются перемещением.');
  let refunds: string | null = null;
  if (type === 'refund') {
    const orig = v.data.ops.find((o) => o.id === lower(b.refundsOperationId));
    if (!orig || orig.type !== 'in')
      invalid('refundsOperationId', 'Укажите оплату, по которой возвращаете деньги.', 'required');
    const done = v.data.ops.filter((o) => o.refunds === orig.id).reduce((s, o) => s + o.amount, 0);
    if (done + amount > orig.amount)
      invalid('amount', 'Возвраты больше исходной оплаты.', 'refund_exceeds_payment');
    refunds = orig.id;
  }
  const shiftOpen = openShift(v, a);
  if (
    type !== 'opening' &&
    a.shiftMode !== 'none' &&
    PHYSICAL.includes(pointOf(v, a).kind) &&
    !shiftOpen
  ) {
    fail('shift_closed', `Смена кассы «${a.name}» закрыта — откройте смену.`);
  }
  const limit =
    type === 'out' ? r.limits.outMinor : type === 'refund' ? r.limits.refundMinor : null;
  const me = v.t.member?.id ?? '';
  if (!v.t.owner && needsApproval(limit, amount)) {
    return accepted(
      request(ctx, v, a, type === 'refund' ? 'refund' : 'out', amount, limit, {
        method: b.method ?? 'cash',
        categoryId: b.categoryId ?? null,
        basis,
        source: b.source ?? null,
        payload: {
          kind: 'op',
          accountId: a.id,
          type,
          method: b.method ?? 'cash',
          categoryId: b.categoryId ?? null,
          basis,
          amount,
          receipt: b.receipt ?? null,
          source: b.source ?? null,
          refunds,
        },
      }),
    );
  }
  claim(v, b.source?.key);
  const row = post(ctx, v, {
    account: a,
    type,
    amount,
    method: b.method ?? 'cash',
    categoryId: b.categoryId ?? null,
    basis: basis || null,
    occurredAt: b.occurredAt,
    by: me,
    receipt: b.receipt ?? null,
    source: b.source ?? null,
    ...(b.relatedObject ? { related: b.relatedObject } : {}),
    refunds,
  });
  return { status: 201, body: withReversed(v.data, row) };
}

function reverseCashOperation(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const orig = v.data.ops.find((o) => o.id === lower(ctx.params.operationId));
  const a = orig && v.data.accounts.find((x) => x.id === orig.accountId);
  if (!orig || !a || !v.visible(a)) return fail('not_found', 'Операция не найдена.');
  need(v, a, 'cash.reverse', 'Нет права «Сторнировать».');
  if (orig.type === 'storno' || v.data.ops.some((o) => o.reverses === orig.id)) {
    fail('invalid_transition', 'Операция уже сторнирована.');
  }
  const { reason } = body<{ reason: string }>(ctx);
  if (reason.trim().length < 3) invalid('reason', 'Причина — не короче 3 знаков.', 'required');
  const me = v.t.member?.id ?? '';
  const mine = orig.by === me;
  if (mine && !v.t.owner) fail('self_approval', 'Свою операцию сторнирует другой сотрудник.');
  const row = post(ctx, v, {
    account: a,
    type: 'storno',
    amount: orig.amount,
    method: orig.method,
    categoryId: orig.categoryId,
    basis: `Сторно ${orig.proto}: ${reason.trim()}`,
    occurredAt: v.now,
    by: me,
    reverses: orig.id,
    own: mine,
    direction: orig.direction === 'in' ? 'out' : 'in',
    shiftId: orig.shiftId,
  });
  return { status: 201, body: withReversed(v.data, row) };
}

function linkCashOperationSource(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const op = v.data.ops.find((o) => o.id === lower(ctx.params.operationId));
  const a = op && v.data.accounts.find((x) => x.id === op.accountId);
  if (!op || !a || !v.visible(a)) return fail('not_found', 'Операция не найдена.');
  need(v, a, 'cash.post', NEED_POST);
  const { source } = body<{ source: S['CashSourceRef'] }>(ctx);
  if (op.source || v.data.claims.includes(source.key)) {
    fail('duplicate_source', 'Этот источник уже проведён в кассе.');
  }
  v.data.claims.push(source.key);
  // PD-60: операция неизменяема — связь хранится отдельной записью; в журнале источник показывается из неё.
  op.source = source;
  return {
    status: 201,
    body: { operationId: op.id, source, linkedAt: v.now, linkedByMemberId: v.t.member?.id ?? '' },
  };
}

function findCashDuplicates(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const a = accountOr404(v, uuidParam(ctx.query, 'accountId'));
  need(v, a, 'cash.post', NEED_POST);
  const amount = Number(ctx.query.get('amountMinor'));
  if (!Number.isInteger(amount) || amount < 1) invalid('amountMinor', 'Укажите сумму.', 'required');
  const method = ctx.query.get('method');
  const type = ctx.query.get('type');
  const at = Date.parse(ctx.query.get('at') ?? v.now);
  const point = pointOf(v, a).id;
  const items = v.data.ops
    .filter((o) => {
      const oa = v.data.accounts.find((x) => x.id === o.accountId);
      return (
        oa !== undefined &&
        pointOf(v, oa).id === point &&
        o.amount === amount &&
        (!method || o.method === method) &&
        (!type || o.type === type) &&
        Math.abs(Date.parse(o.occurredAt) - at) <= 10 * 60_000
      );
    })
    .map((o) => withReversed(v.data, o));
  return { body: { items } };
}

// ───────────────────────────── предложения ─────────────────────────────

function proposalOr404(v: CashView, key: string | undefined): ProposalRow {
  const p = v.data.proposals.find((x) => x.key === key);
  if (!p) return fail('not_found', 'Предложение не найдено.');
  const a = v.data.accounts.find((x) => x.id === p.accountId);
  if (a && !v.visible(a)) return fail('not_found', 'Предложение не найдено.');
  if (p.finance && !(v.t.owner || (a && can(v.rights(a), 'cash.payroll.post')))) {
    return fail('not_found', 'Предложение не найдено.');
  }
  return p;
}

function listCashProposals(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const status = ctx.query.get('status');
  if (status !== null && !['open', 'posted', 'dismissed'].includes(status))
    invalid('status', 'Неизвестный статус.');
  const items = v.data.proposals
    .filter((p) => {
      const a = v.data.accounts.find((x) => x.id === p.accountId);
      if (a && !v.visible(a)) return false;
      if (p.finance && !(v.t.owner || (a && can(v.rights(a), 'cash.payroll.post')))) return false;
      return !status || p.status === status;
    })
    .map(proposalDto);
  return { body: page(items, ctx.query) };
}

function postCashProposal(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const p = proposalOr404(v, ctx.params.proposalKey);
  const b = body<{
    accountId: string;
    parts: { method: Method; amount: S['Money'] }[];
    receipt?: S['CashReceipt'];
    basis?: string;
  }>(ctx);
  const a = accountOr404(v, b.accountId);
  need(v, a, 'cash.proposals.post', 'Нет права «Проводить предложения модулей».');
  if (p.status !== 'open') fail('invalid_transition', 'Предложение уже проведено или отклонено.');
  const parts = b.parts.map((x, i) => ({
    method: x.method,
    amount: money(x.amount, `parts[${i}].amount`),
  }));
  const sum = parts.reduce((s, x) => s + x.amount, 0);
  if (sum !== p.amount)
    invalid('parts', 'Сумма частей не равна сумме предложения.', 'sum_mismatch');
  checkReceipt(b.receipt);
  const type = p.direction === 'in' ? 'in' : p.kind === 'refund' ? 'refund' : 'out';
  const r = v.rights(a);
  const limit =
    type === 'out' ? r.limits.outMinor : type === 'refund' ? r.limits.refundMinor : null;
  const me = v.t.member?.id ?? '';
  if (!v.t.owner && needsApproval(limit, p.amount)) {
    return accepted(
      request(ctx, v, a, type === 'refund' ? 'refund' : 'out', p.amount, limit, {
        categoryId: p.categoryId,
        basis: p.title,
        source: p.source,
        payload: {
          kind: 'proposal',
          key: p.key,
          accountId: a.id,
          parts,
          receipt: b.receipt ?? null,
          basis: b.basis ?? null,
        },
      }),
    );
  }
  const shiftOpen = openShift(v, a);
  if (a.shiftMode !== 'none' && PHYSICAL.includes(pointOf(v, a).kind) && !shiftOpen) {
    fail('shift_closed', `Смена кассы «${a.name}» закрыта — откройте смену.`);
  }
  claim(v, p.source.key);
  const group = ctx.newId(v.t.org.proto);
  const rows: OpRow[] = [];
  for (const part of parts) {
    const target =
      part.method === 'card' || part.method === 'sbp'
        ? (v.data.accounts.find((x) => x.id === a.drawerId || x.drawerId === a.id) ?? a)
        : a;
    rows.push(
      post(ctx, v, {
        account: target,
        type,
        amount: part.amount,
        method: part.method,
        categoryId: p.categoryId,
        basis: (b.basis ?? p.title).trim(),
        occurredAt: v.now,
        by: me,
        origin: 'proposal',
        receipt: b.receipt ?? null,
        source: p.source,
        groupId: group,
        refunds: null,
      }),
    );
  }
  p.status = 'posted';
  p.operationIds = rows.map((r2) => r2.id);
  p.groupId = group;
  return {
    status: 201,
    body: { proposal: proposalDto(p), operations: rows.map((r2) => withReversed(v.data, r2)) },
  };
}

function dismissCashProposal(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const p = proposalOr404(v, ctx.params.proposalKey);
  const a = v.data.accounts.find((x) => x.id === p.accountId);
  if (a) need(v, a, 'cash.proposals.post', 'Нет права «Проводить предложения модулей».');
  if (p.status !== 'open') fail('invalid_transition', 'Предложение уже проведено или отклонено.');
  const { reason } = body<{ reason: string }>(ctx);
  if (reason.trim().length < 3) invalid('reason', 'Причина — не короче 3 знаков.', 'required');
  p.status = 'dismissed';
  p.dismissal = { reason: reason.trim(), byMemberId: v.t.member?.id ?? '', at: v.now };
  return { body: proposalDto(p) };
}

// ───────────────────────────── смены ─────────────────────────────

function shiftOr404(v: CashView, id: string | undefined): { s: ShiftRow; a: AcctRow } {
  const s = v.data.shifts.find((x) => x.id === lower(id));
  const a = s && v.data.accounts.find((x) => x.id === s.accountId);
  if (!s || !a || !v.visible(a)) return fail('not_found', 'Смена не найдена.');
  return { s, a };
}

function listCashShifts(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const accountId = uuidParam(ctx.query, 'accountId', false);
  const status = ctx.query.get('status');
  if (status !== null && !['open', 'review', 'closed'].includes(status))
    invalid('status', 'Неизвестный статус.');
  const items = v.data.shifts
    .filter((s) => {
      const a = v.data.accounts.find((x) => x.id === s.accountId);
      return (
        a &&
        v.visible(a) &&
        (!accountId || s.accountId === accountId) &&
        (!status || s.status === status)
      );
    })
    .sort((x, y) => y.number - x.number)
    .map((s) => {
      const a = v.data.accounts.find((x) => x.id === s.accountId) as AcctRow;
      return shiftDto(s, can(v.rights(a), 'cash.balance.read'));
    });
  return { body: page(items, ctx.query) };
}

function openCashShift(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const a = accountOr404(v, ctx.params.accountId);
  need(v, a, 'cash.shift.operate', 'Нет права «Открывать и закрывать смену».');
  if (a.shiftMode === 'none' || !PHYSICAL.includes(a.kind))
    fail('invalid_transition', 'У кассы нет смен.');
  if (v.data.shifts.some((s) => s.accountId === a.id && s.status === 'open')) {
    fail('invalid_transition', 'Смена уже открыта.');
  }
  const b = body<{ countedFloat: S['Money']; note?: string }>(ctx);
  const counted = money(b.countedFloat, 'countedFloat');
  const me = v.t.member?.id ?? '';
  const expected = balanceOf(v.data, a.id);
  const diff = counted - expected;
  const number =
    v.data.shifts.filter((s) => s.accountId === a.id).reduce((m, s) => Math.max(m, s.number), 0) +
    1;
  const shift: ShiftRow = {
    id: ctx.newId(v.t.org.proto),
    proto: `sh-n${number}`,
    accountId: a.id,
    number,
    status: 'open',
    openedAt: v.now,
    openedBy: me,
    openingFloat: counted,
    openingDiff: diff === 0 ? null : diff,
    closedAt: null,
    closedBy: null,
    counted: null,
    counts: {},
    coins: null,
    z: null,
    terminal: null,
    expected: null,
    diff: null,
    decision: null,
    attempts: [],
    toSafeTransferId: null,
    revision: 1,
  };
  v.data.shifts.push(shift);
  if (diff !== 0) {
    post(ctx, v, {
      account: a,
      type: 'adjust',
      amount: Math.abs(diff),
      method: 'cash',
      categoryId: 'adjustment',
      basis: `Расхождение при открытии смены ${number}`,
      occurredAt: v.now,
      by: me,
      direction: diff > 0 ? 'in' : 'out',
      shiftId: shift.id,
    });
  }
  return {
    status: 201,
    body: shiftDto(shift, can(v.rights(a), 'cash.balance.read')),
    etag: shift.revision,
  };
}

/** Ожидаемые суммы смены: Ортус ↔ ККТ ↔ факт (reconcile эталона, cash.md §1.4). */
function expectedOf(v: CashView, s: ShiftRow) {
  const inShift = v.data.ops.filter((o) => o.shiftId === s.id);
  const sum = (f: (o: OpRow) => boolean): number =>
    inShift.filter(f).reduce((t, o) => t + o.amount, 0);
  const revCash =
    sum((o) => o.method === 'cash' && o.type === 'in') -
    sum((o) => o.method === 'cash' && o.type === 'refund');
  const revCard =
    sum((o) => o.method === 'card' && o.type === 'in') -
    sum((o) => o.method === 'card' && o.type === 'refund');
  const revSbp =
    sum((o) => o.method === 'sbp' && o.type === 'in') -
    sum((o) => o.method === 'sbp' && o.type === 'refund');
  const expCash = s.openingFloat + revCash - sum((o) => o.method === 'cash' && o.type === 'out');
  return { revCash, revCard, revSbp, expCash };
}

function closeCashShift(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const { s, a } = shiftOr404(v, ctx.params.shiftId);
  need(v, a, 'cash.shift.operate', 'Нет права «Открывать и закрывать смену».');
  ctx.revision(s.revision);
  if (s.status !== 'open') fail('shift_closed', 'Смена уже закрыта.');
  const b = body<{
    counted: S['Money'];
    counts?: Record<string, number>;
    coins?: S['Money'];
    z?: S['CashShiftZ'];
    terminal?: S['CashShiftTerminal'];
    toSafe?: boolean;
  }>(ctx);
  if (a.kktMode === 'manual' && !b.z) invalid('z', 'Заполните итоги Z-отчёта.', 'required');
  const counted = money(b.counted, 'counted');
  const me = v.t.member?.id ?? '';
  const e = expectedOf(v, s);
  const diffCash = counted - e.expCash;
  const z = b.z ?? null;
  const term = b.terminal ?? null;
  const kktCash = z ? z.cash.amountMinor - e.revCash : 0;
  const kktCard = z ? z.card.amountMinor - e.revCard : 0;
  const termDiff = term ? term.card.amountMinor + term.sbp.amountMinor - (e.revCard + e.revSbp) : 0;
  const expected: S['CashShiftExpected'] = {
    cash: signedRub(e.expCash),
    revCash: signedRub(e.revCash),
    revCard: signedRub(e.revCard),
    card: signedRub(e.revCard),
    sbp: signedRub(e.revSbp),
  };
  const diff: S['CashShiftDiff'] = {
    cash: signedRub(diffCash),
    kktCash: signedRub(kktCash),
    kktCard: signedRub(kktCard),
    term: signedRub(termDiff),
  };
  const tol = a.tolerance ?? 0;
  const within = [diffCash, kktCash, kktCard, termDiff].every((x) => Math.abs(x) <= tol);
  const counts = b.counts ?? {};
  s.attempts.push({
    closedAt: v.now,
    closedByMemberId: me,
    counted: rub(counted),
    counts,
    z,
    terminal: term,
    diff,
    recountReason: null,
  });
  s.closedAt = v.now;
  s.closedBy = me;
  s.counted = counted;
  s.counts = counts;
  s.coins = b.coins ? b.coins.amountMinor : null;
  s.z = z;
  s.terminal = term;
  s.expected = expected;
  s.diff = diff;
  if (within) {
    s.status = 'closed';
    let opId: string | null = null;
    if (diffCash !== 0) {
      opId = post(ctx, v, {
        account: a,
        type: 'adjust',
        amount: Math.abs(diffCash),
        method: 'cash',
        categoryId: 'adjustment',
        basis: `${diffCash < 0 ? 'Недостача' : 'Излишек'} при пересчёте · смена ${s.number}`,
        occurredAt: v.now,
        by: me,
        direction: diffCash > 0 ? 'in' : 'out',
        shiftId: s.id,
      }).id;
    }
    s.decision = {
      kind: 'auto',
      byMemberId: null,
      at: v.now,
      reason: diffCash === 0 ? 'Без расхождений' : `В пределах допуска ${fmtRub(tol)}`,
      operationId: opId,
    };
    if (b.toSafe) handOver(ctx, v, s, a, me);
  } else {
    s.status = 'review';
  }
  s.revision++;
  return { body: shiftDto(s, can(v.rights(a), 'cash.balance.read')), etag: s.revision };
}

/** Сдача выручки: ближайший сейф по цепочке подразделений кассы, затем сейф организации (Q-W4.00-cash-15). */
function handOver(ctx: HandlerContext, v: CashView, s: ShiftRow, a: AcctRow, me: string): void {
  const chain = unitChainOf(v, a);
  const safes = v.data.accounts.filter((x) => x.kind === 'safe');
  const safe =
    chain.map((u) => safes.find((x) => x.orgUnitId === u)).find(Boolean) ??
    safes.find((x) => x.orgUnitId === null);
  if (!safe) return;
  const amount = balanceOf(v.data, a.id) - (a.floatAmount ?? 0);
  if (amount <= 0) return;
  const t = transfer(ctx, v, a, safe, amount, `Выручка · смена ${s.number}`, 'shift_handover', me);
  s.toSafeTransferId = t.id;
}

function unitChainOf(v: CashView, a: AcctRow): string[] {
  const out: string[] = [];
  let cur = v.t.org.units.find((u) => u.id === a.orgUnitId);
  while (cur) {
    out.push(cur.id);
    cur = v.t.org.units.find((u) => u.id === cur?.parentId);
  }
  return out;
}

function reviewCashShift(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const { s, a } = shiftOr404(v, ctx.params.shiftId);
  need(v, a, 'cash.reconcile', 'Нет права «Сверять и принимать расхождения».');
  ctx.revision(s.revision);
  if (s.status !== 'review') fail('invalid_transition', 'Смена не ждёт решения.');
  const me = v.t.member?.id ?? '';
  if (s.closedBy === me) fail('self_approval', 'Расхождение принимает не тот, кто закрывал смену.');
  const b = body<{ decision: 'accept' | 'recount'; reason: string; comment?: string }>(ctx);
  const reason = b.reason.trim();
  if (!reason) invalid('reason', 'Укажите причину.', 'required');
  v.data.reviews.push({
    shiftId: s.id,
    attempt: s.attempts.length,
    decision: b.decision,
    reason,
    by: me,
    at: v.now,
  });
  if (b.decision === 'recount') {
    const last = s.attempts[s.attempts.length - 1];
    if (last) last.recountReason = reason;
    // Попытка закрытия сохраняется (Q-W4.00-cash-4, PD-60); смена снова open.
    s.status = 'open';
    s.closedAt = null;
    s.closedBy = null;
    s.counted = null;
    s.counts = {};
    s.coins = null;
    s.z = null;
    s.terminal = null;
    s.expected = null;
    s.diff = null;
  } else {
    const diffCash = s.diff?.cash.amountMinor ?? 0;
    let opId: string | null = null;
    if (diffCash !== 0) {
      opId = post(ctx, v, {
        account: a,
        type: 'adjust',
        amount: Math.abs(diffCash),
        method: 'cash',
        categoryId: 'adjustment',
        basis: `${diffCash < 0 ? 'Недостача' : 'Излишек'} · смена ${s.number}: ${reason}`,
        occurredAt: v.now,
        by: me,
        direction: diffCash > 0 ? 'in' : 'out',
        shiftId: s.id,
      }).id;
    }
    s.status = 'closed';
    s.decision = { kind: 'accepted', byMemberId: me, at: v.now, reason, operationId: opId };
  }
  s.revision++;
  return { body: shiftDto(s, can(v.rights(a), 'cash.balance.read')), etag: s.revision };
}

// ───────────────────────────── перемещения ─────────────────────────────

function transfer(
  ctx: HandlerContext,
  v: CashView,
  from: AcctRow,
  to: AcctRow,
  amount: number,
  note: string | null,
  purpose: TransferRow['purpose'],
  by: string,
  done = false,
): TransferRow {
  const id = ctx.newId(v.t.org.proto);
  const out = post(ctx, v, {
    account: from,
    type: 'move_out',
    amount,
    method: 'cash',
    categoryId: 'transfer',
    basis: `${note ?? 'Перемещение'} → «${to.name}»`,
    occurredAt: v.now,
    by,
    transferId: id,
  });
  const row: TransferRow = {
    id,
    proto: `tr-n${v.data.transfers.length + 1}`,
    fromId: from.id,
    toId: to.id,
    amount,
    note,
    purpose,
    status: 'transit',
    sentBy: by,
    sentAt: v.now,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    outOp: out.id,
    inOp: null,
    backOp: null,
    revision: 1,
  };
  v.data.transfers.push(row);
  if (done) accept(ctx, v, row, by);
  return row;
}

function accept(ctx: HandlerContext, v: CashView, t: TransferRow, by: string): void {
  const to = v.data.accounts.find((x) => x.id === t.toId) as AcctRow;
  const from = v.data.accounts.find((x) => x.id === t.fromId) as AcctRow;
  t.inOp = post(ctx, v, {
    account: to,
    type: 'move_in',
    amount: t.amount,
    method: 'cash',
    categoryId: 'transfer',
    basis: `${t.note ?? 'Перемещение'} ← «${from.name}»`,
    occurredAt: v.now,
    by,
    transferId: t.id,
    shiftId: null,
  }).id;
  t.status = 'done';
  t.decidedBy = by;
  t.decidedAt = v.now;
  t.revision++;
}

function listCashTransfers(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const status = ctx.query.get('status');
  if (status !== null && !['transit', 'done', 'rejected'].includes(status))
    invalid('status', 'Неизвестный статус.');
  const accountId = uuidParam(ctx.query, 'accountId', false);
  const items = v.data.transfers
    .filter((t) => {
      const f = v.data.accounts.find((x) => x.id === t.fromId);
      const to = v.data.accounts.find((x) => x.id === t.toId);
      return (
        ((f && v.visible(f)) || (to && v.visible(to))) &&
        (!status || t.status === status) &&
        (!accountId || t.fromId === accountId || t.toId === accountId)
      );
    })
    .sort((x, y) => (x.sentAt < y.sentAt ? 1 : x.sentAt > y.sentAt ? -1 : 0))
    .map(transferDto);
  return { body: page(items, ctx.query) };
}

function createCashTransfer(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const b = body<{ fromAccountId: string; toAccountId: string; amount: S['Money']; note?: string }>(
    ctx,
  );
  const from = accountOr404(v, b.fromAccountId);
  const to = accountOr404(v, b.toAccountId);
  need(v, from, 'cash.transfer', 'Нет права «Перемещать и сдавать выручку».');
  if (from.id === to.id) invalid('toAccountId', 'Выберите другую кассу.', 'same_account');
  const amount = money(b.amount, 'amount');
  if (amount <= 0) invalid('amount', 'Сумма должна быть больше нуля.');
  if (from.kind === 'advance' || to.kind === 'advance') {
    invalid('toAccountId', 'В подотчёт и из него — выдача и возврат подотчёта.', 'advance_account');
  }
  const t = transfer(
    ctx,
    v,
    from,
    to,
    amount,
    b.note?.trim() || null,
    'transfer',
    v.t.member?.id ?? '',
  );
  return { status: 201, body: transferDto(t), etag: t.revision };
}

function decideCashTransfer(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const t = v.data.transfers.find((x) => x.id === lower(ctx.params.transferId));
  const to = t && v.data.accounts.find((x) => x.id === t.toId);
  const from = t && v.data.accounts.find((x) => x.id === t.fromId);
  if (!t || !to || !from || !(v.visible(to) || v.visible(from)))
    return fail('not_found', 'Перемещение не найдено.');
  need(v, v.visible(to) ? to : from, 'cash.transfer', 'Нет права «Перемещать и сдавать выручку».');
  ctx.revision(t.revision);
  if (t.status !== 'transit')
    fail('invalid_transition', 'Перемещение уже принято или отклонено.', {
      reason: 'transfer_decided',
    });
  const b = body<{ decision: 'accept' | 'reject'; reason?: string }>(ctx);
  const me = v.t.member?.id ?? '';
  if (b.decision === 'accept') {
    accept(ctx, v, t, me);
  } else {
    const reason = (b.reason ?? '').trim();
    if (!reason) invalid('reason', 'Укажите причину отказа.', 'required');
    t.backOp = post(ctx, v, {
      account: from,
      type: 'move_in',
      amount: t.amount,
      method: 'cash',
      categoryId: 'transfer',
      basis: `Отказ от перемещения → возврат в «${from.name}»: ${reason}`,
      occurredAt: v.now,
      by: me,
      transferId: t.id,
      shiftId: null,
    }).id;
    t.status = 'rejected';
    t.decidedBy = me;
    t.decidedAt = v.now;
    t.reason = reason;
    t.revision++;
  }
  return { body: transferDto(t), etag: t.revision };
}

// ───────────────────────────── подотчёт ─────────────────────────────

function advanceOr422(v: CashView, id: string | undefined): AcctRow {
  const a = accountOr404(v, id);
  if (a.kind !== 'advance') invalid('accountId', 'Это не подотчёт.', 'not_advance');
  return a;
}

function issueCashAdvance(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const adv = advanceOr422(v, ctx.params.accountId);
  const b = body<{ sourceAccountId: string; amount: S['Money']; dueDate: string; note?: string }>(
    ctx,
  );
  const src = accountOr404(v, b.sourceAccountId);
  need(v, src, 'cash.advance.issue', 'Нет права «Выдавать под отчёт».');
  if (src.kind === 'advance' || !PHYSICAL.includes(src.kind))
    invalid('sourceAccountId', 'Выдавать можно из кассы или сейфа.', 'source_kind');
  const amount = money(b.amount, 'amount');
  if (amount <= 0) invalid('amount', 'Сумма должна быть больше нуля.');
  const me = v.t.member?.id ?? '';
  if (adv.holderId === me) fail('self_approval', 'Под отчёт себе выдаёт другой сотрудник.');
  const r = v.rights(src);
  if (adv.advanceLimit !== null && balanceOf(v.data, adv.id) + amount > adv.advanceLimit) {
    invalid('amount', `Лимит на руках — ${fmtRub(adv.advanceLimit)}.`, 'advance_limit');
  }
  if (!v.t.owner && needsApproval(r.limits.advanceMinor, amount)) {
    return accepted(
      request(ctx, v, adv, 'issue', amount, r.limits.advanceMinor, {
        basis: b.note ?? null,
        payload: {
          kind: 'issue',
          accountId: adv.id,
          sourceAccountId: src.id,
          amount,
          dueDate: b.dueDate,
          note: b.note ?? null,
        },
      }),
    );
  }
  const t = transfer(
    ctx,
    v,
    src,
    adv,
    amount,
    `Выдача под отчёт · ${holderName(v, adv)}`,
    'advance_issue',
    me,
    true,
  );
  return { status: 201, body: transferDto(t), etag: t.revision };
}

const holderName = (v: CashView, a: AcctRow): string =>
  v.t.org.members.find((m) => m.id === a.holderId)?.displayName ?? a.name;

function listAdvanceReceipts(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const accountId = uuidParam(ctx.query, 'accountId', false);
  const status = ctx.query.get('status');
  if (status !== null && !['review', 'accepted', 'rejected'].includes(status))
    invalid('status', 'Неизвестный статус.');
  const items = v.data.receipts
    .filter((r) => {
      const a = v.data.accounts.find((x) => x.id === r.accountId);
      if (!a || !v.visible(a)) return false;
      const rights = v.rights(a);
      // Держатель видит свои чеки, выдающий — чеки касс области.
      const issuer = can(rights, 'cash.advance.issue') || can(rights, 'cash.read');
      return (
        (issuer || r.by === v.t.member?.id) &&
        (!accountId || r.accountId === accountId) &&
        (!status || r.status === status)
      );
    })
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    .map(receiptDto);
  return { body: page(items, ctx.query) };
}

function submitAdvanceReceipt(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const a = advanceOr422(v, ctx.params.accountId);
  need(v, a, 'cash.advance.self', 'Нет права «Свой подотчёт».');
  const me = v.t.member?.id ?? '';
  if (!v.t.owner && a.holderId !== me)
    fail('forbidden_action', 'Чек добавляет держатель подотчёта.');
  const b = body<{
    amount: S['Money'];
    categoryId: string;
    fileId: string;
    note?: string;
    link?: S['CashSourceRef'];
    qr?: string;
    redoOfReceiptId?: string;
  }>(ctx);
  const amount = money(b.amount, 'amount');
  if (amount <= 0) invalid('amount', 'Сумма должна быть больше нуля.');
  if (
    !CATEGORIES.some((c) => c.id === b.categoryId) ||
    (a.categoryIds.length && !a.categoryIds.includes(b.categoryId))
  ) {
    invalid('categoryId', 'Статья не разрешена для этого подотчёта.');
  }
  if (amount > balanceOf(v.data, a.id))
    fail('insufficient_funds', 'Сумма чека больше остатка подотчёта.');
  if (
    b.redoOfReceiptId &&
    !v.data.receipts.some((r) => r.id === lower(b.redoOfReceiptId) && r.status === 'rejected')
  ) {
    invalid('redoOfReceiptId', 'Переснять можно только отклонённый чек.');
  }
  const row: ReceiptRow = {
    id: ctx.newId(v.t.org.proto),
    proto: `rc-n${v.data.receipts.length + 1}`,
    accountId: a.id,
    amount,
    categoryId: b.categoryId,
    link: b.link ?? null,
    note: b.note?.trim() || null,
    fileId: lower(b.fileId),
    qr: b.qr ?? null,
    status: 'review',
    reason: null,
    operationId: null,
    by: me,
    at: v.now,
    decidedBy: null,
    decidedAt: null,
    redoOf: b.redoOfReceiptId ? lower(b.redoOfReceiptId) : null,
    revision: 1,
  };
  v.data.receipts.push(row);
  return { status: 201, body: receiptDto(row), etag: row.revision };
}

function decideAdvanceReceipt(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const r = v.data.receipts.find((x) => x.id === lower(ctx.params.receiptId));
  const a = r && v.data.accounts.find((x) => x.id === r.accountId);
  if (!r || !a || !v.visible(a)) return fail('not_found', 'Чек не найден.');
  need(v, a, 'cash.advance.issue', 'Нет права «Выдавать под отчёт».');
  ctx.revision(r.revision);
  if (r.status !== 'review') fail('invalid_transition', 'Чек уже проверен.');
  const me = v.t.member?.id ?? '';
  if (r.by === me) fail('self_approval', 'Чек принимает не его автор.');
  const b = body<{ decision: 'accept' | 'reject'; reason?: string }>(ctx);
  if (b.decision === 'accept') {
    claim(v, `receipt:${r.proto}`);
    const op = post(ctx, v, {
      account: a,
      type: 'out',
      amount: r.amount,
      method: 'cash',
      categoryId: r.categoryId,
      basis: `Чек · ${r.link?.label ?? 'расход подотчёта'}`,
      occurredAt: v.now,
      by: me,
      source: {
        key: `receipt:${r.proto}`,
        kind: 'receipt',
        id: r.id,
        label: `Чек ${holderName(v, a)}`,
      },
      receipt: { sellerMemberId: r.by },
    });
    r.status = 'accepted';
    r.operationId = op.id;
  } else {
    const reason = (b.reason ?? '').trim();
    if (!reason) invalid('reason', 'Укажите причину отказа.', 'required');
    r.status = 'rejected';
    r.reason = reason;
  }
  r.decidedBy = me;
  r.decidedAt = v.now;
  r.revision++;
  return { body: receiptDto(r), etag: r.revision };
}

function returnCashAdvance(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const a = advanceOr422(v, ctx.params.accountId);
  need(v, a, 'cash.advance.self', 'Нет права «Свой подотчёт».');
  const me = v.t.member?.id ?? '';
  if (!v.t.owner && a.holderId !== me)
    fail('forbidden_action', 'Остаток возвращает держатель подотчёта.');
  const b = body<{ amount: S['Money']; targetAccountId?: string; note?: string }>(ctx);
  const amount = money(b.amount, 'amount');
  if (amount <= 0) invalid('amount', 'Сумма должна быть больше нуля.');
  if (amount > balanceOf(v.data, a.id))
    fail('insufficient_funds', 'Возвращаемая сумма больше остатка подотчёта.');
  const issuer = v.data.transfers
    .filter((t) => t.toId === a.id && t.purpose === 'advance_issue')
    .sort((x, y) => (x.sentAt < y.sentAt ? 1 : -1))[0];
  const target = b.targetAccountId
    ? accountOr404(v, b.targetAccountId)
    : v.data.accounts.find((x) => x.id === issuer?.fromId);
  if (!target) invalid('targetAccountId', 'Укажите кассу, куда вернуть остаток.', 'required');
  const t = transfer(
    ctx,
    v,
    a,
    target,
    amount,
    b.note?.trim() || 'Возврат остатка',
    'advance_return',
    me,
  );
  return { status: 201, body: transferDto(t), etag: t.revision };
}

// ───────────────────────────── заявки ─────────────────────────────

function listCashApprovalRequests(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const status = ctx.query.get('status');
  if (status !== null && !['pending', 'approved', 'rejected'].includes(status))
    invalid('status', 'Неизвестный статус.');
  const items = v.data.requests
    .filter((q) => {
      const a = v.data.accounts.find((x) => x.id === q.accountId);
      return a && v.visible(a) && (!status || q.status === status);
    })
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    .map(requestDto);
  return { body: page(items, ctx.query) };
}

function decideCashApprovalRequest(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  const q = v.data.requests.find((x) => x.id === lower(ctx.params.approvalRequestId));
  const a = q && v.data.accounts.find((x) => x.id === q.accountId);
  if (!q || !a || !v.visible(a)) return fail('not_found', 'Заявка не найдена.');
  need(v, a, 'cash.approve', 'Нет права «Согласовывать расходы».');
  ctx.revision(q.revision);
  if (q.status !== 'pending') fail('invalid_transition', 'Заявка уже решена.');
  const me = v.t.member?.id ?? '';
  if (q.by === me) fail('self_approval', 'Заявку согласует не её автор.');
  const b = body<{ decision: 'approve' | 'reject'; reason?: string }>(ctx);
  if (b.decision === 'approve') {
    const pl = q.payload as Record<string, unknown>;
    if (q.payload.kind === 'op') {
      const op = post(ctx, v, {
        account: a,
        type: pl.type as OpRow['type'],
        amount: q.amount,
        method: (pl.method as Method) ?? 'cash',
        categoryId: (pl.categoryId as string | null) ?? null,
        basis: (pl.basis as string | null) ?? null,
        occurredAt: v.now,
        by: q.by,
        approvedBy: me,
        receipt: (pl.receipt as S['CashReceipt'] | null) ?? null,
        source: (pl.source as S['CashSourceRef'] | null) ?? null,
        refunds: (pl.refunds as string | null) ?? null,
      });
      q.operationId = op.id;
    } else if (q.payload.kind === 'issue') {
      const src = v.data.accounts.find((x) => x.id === pl.sourceAccountId) as AcctRow;
      const t = transfer(
        ctx,
        v,
        src,
        a,
        q.amount,
        `Выдача под отчёт · ${holderName(v, a)}`,
        'advance_issue',
        q.by,
        true,
      );
      q.transferId = t.id;
    } else {
      const p = v.data.proposals.find((x) => x.key === pl.key);
      if (p) {
        claim(v, p.source.key);
        const group = ctx.newId(v.t.org.proto);
        const rows = (pl.parts as { method: Method; amount: number }[]).map((part) =>
          post(ctx, v, {
            account: a,
            type: p.direction === 'in' ? 'in' : p.kind === 'refund' ? 'refund' : 'out',
            amount: part.amount,
            method: part.method,
            categoryId: p.categoryId,
            basis: p.title,
            occurredAt: v.now,
            by: q.by,
            approvedBy: me,
            origin: 'proposal',
            source: p.source,
            groupId: group,
          }),
        );
        p.status = 'posted';
        p.operationIds = rows.map((r) => r.id);
        p.groupId = group;
        q.operationId = rows[0]?.id ?? null;
      }
    }
    q.status = 'approved';
  } else {
    const reason = (b.reason ?? '').trim();
    if (!reason) invalid('reason', 'Укажите причину отказа.', 'required');
    q.status = 'rejected';
    q.reason = reason;
  }
  q.decidedBy = me;
  q.decidedAt = v.now;
  q.revision++;
  return { body: requestDto(q), etag: q.revision };
}

function listCashCategories(ctx: HandlerContext): HandlerResult {
  const v = viewOf(ctx);
  if (!v.data.accounts.some((a) => v.visible(a)))
    fail('forbidden_action', 'Нет права «Видеть кассы и операции».');
  return { body: { items: [...CATEGORIES] } };
}

export const cashHandlers: Registry = {
  listCashAccounts,
  createCashAccount,
  previewCashAccountAccess,
  listCashOperations,
  postCashOperation,
  reverseCashOperation,
  linkCashOperationSource,
  findCashDuplicates,
  listCashProposals,
  postCashProposal,
  dismissCashProposal,
  listCashShifts,
  openCashShift,
  closeCashShift,
  reviewCashShift,
  listCashTransfers,
  createCashTransfer,
  decideCashTransfer,
  issueCashAdvance,
  submitAdvanceReceipt,
  listAdvanceReceipts,
  decideAdvanceReceipt,
  returnCashAdvance,
  listCashApprovalRequests,
  decideCashApprovalRequest,
  listCashCategories,
};
