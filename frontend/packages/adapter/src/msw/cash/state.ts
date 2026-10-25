// Касса сценарного сервера (W5.00, контракт 0.12.0-stage5; W5.31 — настоящий backend, W5.30 — домен): кассы, журнал,
// смены, перемещения, предложения, чеки подотчёта и заявки организации на сиде «Альты» из эталона 19.10
// (design/ortus/cash.js seedAlta: кассы ca-spa, ca-term, ca-sever, подотчёты, сейф, счёт; смены 117 и 118; перемещения
// tr-1…tr-4; чеки rc-1…rc-6; заявка rq-1; предложения pr-1…pr-4). Деньги — копейки; остаток — сумма журнала (как
// balanceOf эталона). Разбор docs/plan/v2/analysis/dor/cash.md §2. Подразделение «spa» эталона в «Альте» не существует
// (cash.md §5.3) — касса салона привязана к фирме «Север» (Q-W5.00-1). Право по кассе — роли и область (PD-53).
import type { components } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';

import { grantsOf, type TenantAccess } from '../core/access.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { Org } from '../core/state.ts';

type S = components['schemas'];

export const CASH_KEYS = [
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
] as const;

export type AcctKind = S['CashAccount']['kind'];
export type OpType = S['CashOperation']['type'];
export type Method = S['CashOperation']['method'];

export interface AcctRow {
  id: string;
  proto: string;
  kind: AcctKind;
  name: string;
  orgUnitId: string | null;
  shiftMode: S['CashAccount']['shiftMode'];
  kktMode: S['CashAccount']['kktMode'];
  balanceLimit: number | null;
  floatAmount: number | null;
  tolerance: number | null;
  responsibleId: string | null;
  holderId: string | null;
  advanceLimit: number | null;
  drawerId: string | null;
  settleDays: number | null;
  feeBasisPoints: number | null;
  categoryIds: string[];
  revision: number;
}

export interface OpRow {
  id: string;
  proto: string;
  number: number;
  accountId: string;
  type: OpType;
  direction: 'in' | 'out';
  amount: number;
  category: S['CashOperation']['category'];
  categoryId: string | null;
  method: Method;
  basis: string | null;
  occurredAt: string;
  by: string;
  approvedBy: string | null;
  origin: S['CashOperation']['origin'];
  related?: S['ObjectRef'];
  reverses: string | null;
  refunds: string | null;
  own: boolean;
  shiftId: string | null;
  groupId: string | null;
  transferId: string | null;
  source: S['CashSourceRef'] | null;
  receipt: S['CashReceipt'] | null;
}

export interface ShiftRow {
  id: string;
  proto: string;
  accountId: string;
  number: number;
  status: S['CashShift']['status'];
  openedAt: string;
  openedBy: string;
  openingFloat: number;
  openingDiff: number | null;
  closedAt: string | null;
  closedBy: string | null;
  counted: number | null;
  counts: Record<string, number>;
  coins: number | null;
  z: S['CashShiftZ'] | null;
  terminal: S['CashShiftTerminal'] | null;
  expected: S['CashShiftExpected'] | null;
  diff: S['CashShiftDiff'] | null;
  decision: S['CashShiftDecision'] | null;
  attempts: S['CashShiftCloseAttempt'][];
  toSafeTransferId: string | null;
  revision: number;
}

export interface TransferRow {
  id: string;
  proto: string;
  fromId: string;
  toId: string;
  amount: number;
  note: string | null;
  purpose: S['CashTransfer']['purpose'];
  status: S['CashTransfer']['status'];
  sentBy: string;
  sentAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  outOp: string | null;
  inOp: string | null;
  backOp: string | null;
  revision: number;
}

export interface ReceiptRow {
  id: string;
  proto: string;
  accountId: string;
  amount: number;
  categoryId: string;
  link: S['CashSourceRef'] | null;
  note: string | null;
  fileId: string;
  qr: string | null;
  status: S['AdvanceReceipt']['status'];
  reason: string | null;
  operationId: string | null;
  by: string;
  at: string;
  decidedBy: string | null;
  decidedAt: string | null;
  redoOf: string | null;
  revision: number;
}

export interface RequestRow {
  id: string;
  proto: string;
  accountId: string;
  type: S['CashApprovalRequest']['type'];
  amount: number;
  method: Method | null;
  categoryId: string | null;
  basis: string | null;
  source: S['CashSourceRef'] | null;
  /** Запрос постановки: выполняется от имени автора при согласовании. */
  payload: { kind: 'op' | 'proposal' | 'issue'; [k: string]: unknown };
  limit: number | null;
  status: S['CashApprovalRequest']['status'];
  by: string;
  at: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  operationId: string | null;
  transferId: string | null;
  revision: number;
}

export interface ProposalRow {
  key: string;
  proto: string;
  kind: S['CashProposal']['kind'];
  title: string;
  amount: number;
  direction: 'in' | 'out';
  accountId: string | null;
  categoryId: string | null;
  method?: Method;
  source: S['CashSourceRef'];
  status: S['CashProposal']['status'];
  parts: S['CashProposalPart'][];
  createdAt: string;
  operationIds: string[];
  groupId: string | null;
  dismissal: S['CashProposalDismissal'] | null;
  /** Финансовый блок — только с cash.payroll.post (Q-W4.00-cash-13). */
  finance: boolean;
}

export interface CashData {
  accounts: AcctRow[];
  ops: OpRow[];
  shifts: ShiftRow[];
  transfers: TransferRow[];
  receipts: ReceiptRow[];
  requests: RequestRow[];
  proposals: ProposalRow[];
  /** Ключи источников, уже проведённых или привязанных (идемпотентность по источнику). */
  claims: string[];
  /** Решения по сменам: возврат на пересчёт хранит причину (Q-W4.00-cash-4). */
  reviews: {
    shiftId: string;
    attempt: number;
    decision: 'accept' | 'recount';
    reason: string;
    by: string;
    at: string;
  }[];
  seq: { op: number; local: number };
}

type WithCash = Org & { cash?: CashData };

/** Лимиты ролей эталона (installCash: r-manager, r-cashier): `null` — без лимита, 0 — всегда с согласованием. */
export const LIMITS: Readonly<Record<string, S['CashLimits']>> = {
  'm-kotova': { outMinor: 500000, refundMinor: 0, advanceMinor: 1500000 },
  'm-morozova': { outMinor: 100000, refundMinor: 300000, advanceMinor: 0 },
};
const NO_LIMITS: S['CashLimits'] = { outMinor: null, refundMinor: null, advanceMinor: null };

export const CATEGORIES: readonly S['CashCategory'][] = (
  [
    ['revenue-spa', 'Выручка · услуги SPA', 'income', 'in', 'spa', null],
    ['revenue-subscriptions', 'Выручка · абонементы и сертификаты', 'income', 'in', 'spa', null],
    ['customer-payment', 'Оплата заказчика', 'income', 'in', 'repairs', null],
    ['refund', 'Возврат клиенту', 'expense', 'out', null, null],
    ['household', 'Хозяйственные расходы', 'expense', 'out', null, null],
    ['fuel', 'Топливо', 'expense', 'out', 'logistics', 'fuel'],
    ['wash', 'Мойка', 'expense', 'out', 'logistics', null],
    ['parking', 'Парковка', 'expense', 'out', 'logistics', null],
    ['repair-small', 'Мелкий ремонт', 'expense', 'out', null, null],
    ['materials', 'Материалы', 'expense', 'out', 'repairs', null],
    ['payroll-crew', 'Выплаты бригаде', 'expense', 'out', 'repairs', null],
    ['transfer', 'Перемещение', 'transfer', null, null, null],
    ['opening', 'Ввод остатка', 'adjustment', null, null, null],
    ['adjustment', 'Корректировка', 'adjustment', null, null, null],
  ] as const
).map(([id, title, group, direction, moduleKey, expenseCategoryCode]) => ({
  id,
  title,
  group,
  direction,
  moduleKey,
  expenseCategoryCode,
}));

const MONTHS_DAY = (s: string): string => {
  // «30.09 21:04» (Москва) → момент UTC 2026.
  const [d = '', t = '00:00'] = s.split(' ');
  const [dd = 1, mm = 10] = d.split('.').map(Number);
  const [h = 0, m = 0] = t.split(':').map(Number);
  return new Date(Date.UTC(2026, mm - 1, dd, h - 3, m)).toISOString().replace('.000Z', 'Z');
};

/** Сумма в копейках из рублей прототипа. */
const kop = (rub: number): number => Math.round(rub * 100);

const SPA_UNIT = 'f-msk-sever';

function seedAlta(org: Org): CashData {
  const U = (proto: string): string => seedUuid(org.proto, proto);
  const unit = (p: string | null): string | null =>
    p === null ? null : U(p === 'spa' ? SPA_UNIT : p);
  const ADV = ['fuel', 'wash', 'parking', 'repair-small'];
  const acct = (
    proto: string,
    kind: AcctKind,
    name: string,
    unitProto: string | null,
    x: Partial<AcctRow> = {},
  ): AcctRow => ({
    id: U(proto),
    proto,
    kind,
    name,
    orgUnitId: unit(unitProto),
    shiftMode: 'none',
    kktMode: 'none',
    balanceLimit: null,
    floatAmount: null,
    tolerance: null,
    responsibleId: null,
    holderId: null,
    advanceLimit: null,
    drawerId: null,
    settleDays: null,
    feeBasisPoints: null,
    categoryIds: [],
    revision: 1,
    ...x,
  });
  const accounts: AcctRow[] = [
    acct('ca-spa', 'cash_drawer', 'Касса салона · ресепшен', 'spa', {
      responsibleId: U('m-morozova'),
      shiftMode: 'blind',
      kktMode: 'manual',
      balanceLimit: kop(30000),
      floatAmount: kop(5000),
      tolerance: kop(100),
      revision: 4,
    }),
    acct('ca-term', 'acquiring', 'Терминал и СБП · салон', 'spa', {
      drawerId: U('ca-spa'),
      settleDays: 1,
      feeBasisPoints: 180,
      revision: 2,
    }),
    acct('ca-sever', 'cash_drawer', 'Касса офиса', 'f-msk-sever', {
      responsibleId: U('m-kotova'),
      balanceLimit: kop(60000),
      revision: 9,
    }),
    acct('ca-adv-vas', 'advance', 'Подотчёт · Илья Васильев', 'f-msk-sever', {
      holderId: U('m-vasiliev'),
      advanceLimit: kop(15000),
      categoryIds: ADV,
      revision: 6,
    }),
    acct('ca-adv-akh', 'advance', 'Подотчёт · Тимур Ахмедов', 'f-msk-sever', {
      holderId: U('m-akhmedov'),
      advanceLimit: kop(15000),
      categoryIds: ADV,
      revision: 3,
    }),
    acct('ca-adv-sok', 'advance', 'Подотчёт · Алексей Соколов', null, {
      holderId: U('m-sokolov'),
      advanceLimit: kop(30000),
      categoryIds: ['materials', 'household'],
      revision: 3,
    }),
    acct('ca-safe', 'safe', 'Сейф офиса', null, { responsibleId: U('m-owner'), revision: 5 }),
    acct('ca-bank', 'bank', 'Расчётный счёт ··4417', null, {
      responsibleId: U('m-owner'),
      revision: 2,
    }),
  ];

  let n = 300;
  const ops: OpRow[] = [];
  const O = (
    no: number,
    account: string,
    type: OpType,
    rub: number,
    method: Method,
    categoryId: string,
    basis: string,
    at: string,
    by: string,
    x: Partial<OpRow> = {},
  ): void => {
    const out = type === 'out' || type === 'refund' || type === 'move_out';
    const adjustOut = type === 'adjust' && x.direction === 'out';
    ops.push({
      id: U(`K-${no}`),
      proto: `K-${no}`,
      number: no,
      accountId: U(account),
      type,
      direction: out || adjustOut ? 'out' : 'in',
      amount: kop(rub),
      category:
        type === 'refund'
          ? 'refund'
          : type === 'opening'
            ? 'opening_balance'
            : type === 'adjust' || type === 'storno'
              ? 'adjustment'
              : type === 'in'
                ? 'service_payment'
                : 'expense',
      categoryId,
      method,
      basis,
      occurredAt: MONTHS_DAY(at),
      by: U(by),
      approvedBy: null,
      origin: 'manual',
      reverses: null,
      refunds: null,
      own: false,
      shiftId: null,
      groupId: null,
      transferId: null,
      source: null,
      receipt: null,
      ...x,
    });
    n = Math.max(n, no);
  };
  const F = (fdNumber: string, kktShift: string, time: string): S['CashReceipt'] => ({
    fdNumber,
    kktShift,
    receiptAt: MONTHS_DAY(time),
  });
  const seller = (by: string): S['CashReceipt'] => ({ sellerMemberId: U(by) });
  const sh = (p: string): string => U(p);
  const tr = (p: string): string => U(p);
  O(
    301,
    'ca-sever',
    'opening',
    50000,
    'cash',
    'opening',
    'Ввод остатка · пересчёт кассы офиса',
    '01.09 09:00',
    'm-owner',
  );
  O(
    310,
    'ca-safe',
    'opening',
    120000,
    'cash',
    'opening',
    'Ввод остатка · пересчёт сейфа',
    '01.09 09:00',
    'm-owner',
  );
  O(
    314,
    'ca-bank',
    'opening',
    1284000,
    'transfer',
    'opening',
    'Остаток по выписке на 30.09',
    '30.09 18:00',
    'm-owner',
  );
  O(
    315,
    'ca-spa',
    'opening',
    5000,
    'cash',
    'opening',
    'Ввод остатка · размен',
    '01.09 09:00',
    'm-owner',
  );
  O(
    302,
    'ca-sever',
    'out',
    1240,
    'cash',
    'household',
    'Канцтовары для офиса',
    '26.09 12:20',
    'm-owner',
    { receipt: seller('m-owner') },
  );
  O(
    303,
    'ca-sever',
    'move_out',
    10000,
    'cash',
    'transfer',
    'Выдача под отчёт · Илья Васильев → «Подотчёт · Илья Васильев»',
    '28.09 08:10',
    'm-owner',
    { transferId: tr('tr-1') },
  );
  O(
    304,
    'ca-adv-vas',
    'move_in',
    10000,
    'cash',
    'transfer',
    'Выдача под отчёт · Илья Васильев ← «Касса офиса»',
    '28.09 08:12',
    'm-vasiliev',
    { transferId: tr('tr-1') },
  );
  O(
    305,
    'ca-adv-vas',
    'out',
    2500,
    'cash',
    'fuel',
    'Чек · Топливо · рейс Р-196',
    '29.09 18:40',
    'm-owner',
    {
      receipt: seller('m-owner'),
      source: { key: 'receipt:rc-1', kind: 'receipt', id: U('rc-1'), label: 'Чек Ильи Васильева' },
    },
  );
  O(
    316,
    'ca-spa',
    'in',
    4800,
    'cash',
    'revenue-spa',
    'SPA-ритуал · Ирина П.',
    '30.09 12:40',
    'm-morozova',
    { shiftId: sh('sh-117'), receipt: F('4388', '117', '30.09 12:41') },
  );
  O(
    317,
    'ca-spa',
    'in',
    3200,
    'cash',
    'revenue-spa',
    'Классический массаж · Мария К.',
    '30.09 15:10',
    'm-morozova',
    { shiftId: sh('sh-117'), receipt: F('4390', '117', '30.09 15:11') },
  );
  O(
    318,
    'ca-spa',
    'refund',
    1600,
    'cash',
    'refund',
    'Возврат за отменённый визит · Мария К.',
    '30.09 16:05',
    'm-owner',
    { shiftId: sh('sh-117'), refunds: U('K-317'), receipt: F('4391', '117', '30.09 16:06') },
  );
  O(
    306,
    'ca-adv-vas',
    'out',
    3050,
    'cash',
    'fuel',
    'Чек · Топливо · рейс Р-201',
    '30.09 17:55',
    'm-owner',
    {
      receipt: seller('m-owner'),
      source: { key: 'receipt:rc-2', kind: 'receipt', id: U('rc-2'), label: 'Чек Ильи Васильева' },
    },
  );
  O(
    320,
    'ca-term',
    'in',
    9600,
    'card',
    'revenue-spa',
    'SPA-ритуал · 2 визита',
    '30.09 18:20',
    'm-morozova',
    { shiftId: sh('sh-117'), receipt: F('4396', '117', '30.09 18:21') },
  );
  O(
    319,
    'ca-spa',
    'in',
    20500,
    'cash',
    'revenue-subscriptions',
    'Абонементы · 3 шт.',
    '30.09 19:30',
    'm-morozova',
    { shiftId: sh('sh-117'), receipt: F('4395', '117', '30.09 19:31') },
  );
  O(
    321,
    'ca-spa',
    'adjust',
    60,
    'cash',
    'adjustment',
    'Недостача при пересчёте · смена 117: сдача мелочью',
    '30.09 21:04',
    'm-morozova',
    { direction: 'out', shiftId: sh('sh-117') },
  );
  O(
    322,
    'ca-spa',
    'move_out',
    26840,
    'cash',
    'transfer',
    'Выручка · смена 117 → «Сейф офиса»',
    '30.09 21:06',
    'm-morozova',
    { transferId: tr('tr-2'), shiftId: sh('sh-117') },
  );
  O(
    323,
    'ca-safe',
    'move_in',
    26840,
    'cash',
    'transfer',
    'Выручка · смена 117 ← «Касса салона · ресепшен»',
    '30.09 21:30',
    'm-owner',
    { transferId: tr('tr-2') },
  );
  O(
    307,
    'ca-sever',
    'move_out',
    8000,
    'cash',
    'transfer',
    'Выдача под отчёт · Тимур Ахмедов → «Подотчёт · Тимур Ахмедов»',
    '30.09 08:05',
    'm-owner',
    { transferId: tr('tr-3') },
  );
  O(
    308,
    'ca-adv-akh',
    'move_in',
    8000,
    'cash',
    'transfer',
    'Выдача под отчёт · Тимур Ахмедов ← «Касса офиса»',
    '30.09 08:07',
    'm-akhmedov',
    { transferId: tr('tr-3') },
  );
  O(
    309,
    'ca-adv-akh',
    'out',
    3000,
    'cash',
    'fuel',
    'Чек · Топливо · рейс Р-204',
    '30.09 19:10',
    'm-owner',
    {
      receipt: seller('m-owner'),
      source: { key: 'receipt:rc-5', kind: 'receipt', id: U('rc-5'), label: 'Чек Тимура Ахмедова' },
    },
  );
  O(
    311,
    'ca-safe',
    'move_out',
    30000,
    'cash',
    'transfer',
    'Выдача под отчёт · Алексей Соколов → «Подотчёт · Алексей Соколов»',
    '30.09 09:30',
    'm-owner',
    { transferId: tr('tr-4') },
  );
  O(
    312,
    'ca-adv-sok',
    'move_in',
    30000,
    'cash',
    'transfer',
    'Выдача под отчёт · Алексей Соколов ← «Сейф офиса»',
    '30.09 09:31',
    'm-sokolov',
    { transferId: tr('tr-4') },
  );
  O(
    313,
    'ca-adv-sok',
    'out',
    18730,
    'cash',
    'materials',
    'Чек · Закупка З-14 · грунт и сетка · чек по QR',
    '30.09 15:20',
    'm-owner',
    {
      receipt: seller('m-owner'),
      source: {
        key: 'receipt:rc-6',
        kind: 'receipt',
        id: U('rc-6'),
        label: 'Чек Алексея Соколова',
      },
    },
  );
  O(
    324,
    'ca-term',
    'in',
    12000,
    'card',
    'revenue-subscriptions',
    'Абонемент на 5 визитов · Светлана Д.',
    '01.10 09:40',
    'm-morozova',
    { shiftId: sh('sh-118'), receipt: F('4519', '118', '01.10 09:41') },
  );
  O(
    325,
    'ca-spa',
    'in',
    3000,
    'cash',
    'revenue-subscriptions',
    'Подарочный сертификат № 214',
    '01.10 10:15',
    'm-morozova',
    { shiftId: sh('sh-118'), receipt: F('4520', '118', '01.10 10:16') },
  );
  O(
    326,
    'ca-spa',
    'out',
    650,
    'cash',
    'household',
    'Вода и салфетки для кабинетов',
    '01.10 10:30',
    'm-morozova',
    { shiftId: sh('sh-118'), receipt: seller('m-morozova') },
  );
  ops.sort((a, b) => a.number - b.number);

  const shift = (no: number, x: Partial<ShiftRow>): ShiftRow => ({
    id: U(`sh-${no}`),
    proto: `sh-${no}`,
    accountId: U('ca-spa'),
    number: no,
    status: 'open',
    openedAt: MONTHS_DAY('01.10 09:02'),
    openedBy: U('m-morozova'),
    openingFloat: kop(5000),
    openingDiff: null,
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
    ...x,
  });
  const money = (rub: number): S['Money'] => ({ amountMinor: kop(rub), currency: 'RUB' });
  const signed = (rub: number): S['SignedMoney'] => ({ amountMinor: kop(rub), currency: 'RUB' });
  const counts117 = { '5000': 3, '2000': 4, '1000': 6, '500': 3, '200': 2, '100': 2 };
  const shifts: ShiftRow[] = [
    shift(118, {}),
    shift(117, {
      status: 'closed',
      openedAt: MONTHS_DAY('30.09 09:00'),
      closedAt: MONTHS_DAY('30.09 21:04'),
      closedBy: U('m-morozova'),
      counted: kop(31840),
      counts: counts117,
      coins: kop(240),
      z: { number: '117', cash: money(26900), card: money(9600) },
      terminal: { card: money(9600), sbp: money(0) },
      expected: {
        cash: signed(31900),
        revCash: signed(26900),
        revCard: signed(9600),
        card: signed(9600),
        sbp: signed(0),
      },
      diff: { cash: signed(-60), kktCash: signed(0), kktCard: signed(0), term: signed(0) },
      decision: {
        kind: 'auto',
        byMemberId: null,
        at: MONTHS_DAY('30.09 21:04'),
        reason: 'В пределах допуска 100 ₽',
        operationId: U('K-321'),
      },
      attempts: [
        {
          closedAt: MONTHS_DAY('30.09 21:04'),
          closedByMemberId: U('m-morozova'),
          counted: money(31840),
          counts: counts117,
          z: { number: '117', cash: money(26900), card: money(9600) },
          terminal: { card: money(9600), sbp: money(0) },
          diff: { cash: signed(-60), kktCash: signed(0), kktCard: signed(0), term: signed(0) },
          recountReason: null,
        },
      ],
      toSafeTransferId: U('tr-2'),
      revision: 3,
    }),
  ];

  const T = (
    p: string,
    from: string,
    to: string,
    rub: number,
    note: string,
    purpose: TransferRow['purpose'],
    by: string,
    at: string,
    outNo: number,
    inNo: number,
    decidedAt = at,
  ): TransferRow => ({
    id: U(p),
    proto: p,
    fromId: U(from),
    toId: U(to),
    amount: kop(rub),
    note,
    purpose,
    status: 'done',
    sentBy: U(by),
    sentAt: MONTHS_DAY(at),
    decidedBy: U('m-owner'),
    decidedAt: MONTHS_DAY(decidedAt),
    reason: null,
    outOp: U(`K-${outNo}`),
    inOp: U(`K-${inNo}`),
    backOp: null,
    revision: 2,
  });
  const transfers: TransferRow[] = [
    T(
      'tr-4',
      'ca-safe',
      'ca-adv-sok',
      30000,
      'Выдача под отчёт · Алексей Соколов',
      'advance_issue',
      'm-owner',
      '30.09 09:30',
      311,
      312,
    ),
    T(
      'tr-3',
      'ca-sever',
      'ca-adv-akh',
      8000,
      'Выдача под отчёт · Тимур Ахмедов',
      'advance_issue',
      'm-owner',
      '30.09 08:05',
      307,
      308,
    ),
    T(
      'tr-2',
      'ca-spa',
      'ca-safe',
      26840,
      'Выручка · смена 117',
      'shift_handover',
      'm-morozova',
      '30.09 21:06',
      322,
      323,
      '30.09 21:30',
    ),
    T(
      'tr-1',
      'ca-sever',
      'ca-adv-vas',
      10000,
      'Выдача под отчёт · Илья Васильев',
      'advance_issue',
      'm-owner',
      '28.09 08:10',
      303,
      304,
    ),
  ];

  const R = (
    p: string,
    account: string,
    rub: number,
    categoryId: string,
    linkLabel: string,
    linkId: string,
    by: string,
    at: string,
    status: ReceiptRow['status'],
    x: Partial<ReceiptRow> = {},
  ): ReceiptRow => ({
    id: U(p),
    proto: p,
    accountId: U(account),
    amount: kop(rub),
    categoryId,
    link: { key: `trip:${linkId}`, kind: 'trip', id: U(`trip-${linkId}`), label: linkLabel },
    note: null,
    fileId: U(`file-${p}`),
    qr: null,
    status,
    reason: null,
    operationId: null,
    by: U(by),
    at: MONTHS_DAY(at),
    decidedBy: null,
    decidedAt: null,
    redoOf: null,
    revision: status === 'review' ? 1 : 2,
    ...x,
  });
  const receipts: ReceiptRow[] = [
    R(
      'rc-3',
      'ca-adv-vas',
      600,
      'wash',
      'Рейс Р-203',
      'r203',
      'm-vasiliev',
      '30.09 19:20',
      'review',
    ),
    R(
      'rc-4',
      'ca-adv-vas',
      400,
      'parking',
      'Рейс Р-203',
      'r203',
      'm-vasiliev',
      '30.09 19:22',
      'rejected',
      {
        reason: 'Не видна сумма на фото — переснимите чек',
        decidedBy: U('m-owner'),
        decidedAt: MONTHS_DAY('30.09 20:05'),
      },
    ),
    R(
      'rc-2',
      'ca-adv-vas',
      3050,
      'fuel',
      'Рейс Р-201',
      'r201',
      'm-vasiliev',
      '30.09 17:40',
      'accepted',
      { operationId: U('K-306'), decidedBy: U('m-owner'), decidedAt: MONTHS_DAY('30.09 17:55') },
    ),
    R(
      'rc-1',
      'ca-adv-vas',
      2500,
      'fuel',
      'Рейс Р-196',
      'r196',
      'm-vasiliev',
      '29.09 18:10',
      'accepted',
      { operationId: U('K-305'), decidedBy: U('m-owner'), decidedAt: MONTHS_DAY('29.09 18:40') },
    ),
    R(
      'rc-5',
      'ca-adv-akh',
      3000,
      'fuel',
      'Рейс Р-204',
      'r204',
      'm-akhmedov',
      '30.09 18:50',
      'accepted',
      { operationId: U('K-309'), decidedBy: U('m-owner'), decidedAt: MONTHS_DAY('30.09 19:10') },
    ),
    R(
      'rc-6',
      'ca-adv-sok',
      18730,
      'materials',
      'Закупка З-14 · ЖК Речной, кв. 42',
      'z14',
      'm-sokolov',
      '30.09 14:55',
      'accepted',
      {
        operationId: U('K-313'),
        qr: 'qr',
        decidedBy: U('m-owner'),
        decidedAt: MONTHS_DAY('30.09 15:20'),
      },
    ),
  ];

  const requests: RequestRow[] = [
    {
      id: U('rq-1'),
      proto: 'rq-1',
      accountId: U('ca-sever'),
      type: 'out',
      amount: kop(6500),
      method: 'cash',
      categoryId: 'repair-small',
      basis: 'Ремонт ворот склада · ИП Гаврилов',
      source: null,
      payload: {
        kind: 'op',
        accountId: U('ca-sever'),
        type: 'out',
        method: 'cash',
        categoryId: 'repair-small',
        basis: 'Ремонт ворот склада · ИП Гаврилов',
        amount: kop(6500),
        receipt: seller('m-kotova'),
      },
      limit: kop(5000),
      status: 'pending',
      by: U('m-kotova'),
      at: MONTHS_DAY('01.10 08:50'),
      decidedBy: null,
      decidedAt: null,
      reason: null,
      operationId: null,
      transferId: null,
      revision: 1,
    },
  ];

  const P = (
    p: string,
    kind: ProposalRow['kind'],
    title: string,
    rub: number,
    direction: 'in' | 'out',
    account: string,
    categoryId: string,
    srcKind: string,
    srcLabel: string,
    x: Partial<ProposalRow> = {},
  ): ProposalRow => ({
    key: `${srcKind}:${p}`,
    proto: p,
    kind,
    title,
    amount: kop(rub),
    direction,
    accountId: U(account),
    categoryId,
    source: { key: `${srcKind}:${p}`, kind: srcKind, id: U(`${srcKind}-${p}`), label: srcLabel },
    status: 'open',
    parts: [{ label: title, amount: { amountMinor: kop(rub), currency: 'RUB' } }],
    createdAt: MONTHS_DAY('01.10 08:00'),
    operationIds: [],
    groupId: null,
    dismissal: null,
    finance: false,
    ...x,
  });
  const proposals: ProposalRow[] = [
    P(
      'pr-1',
      'visit',
      'Наталья С. · Массаж лица',
      2800,
      'in',
      'ca-spa',
      'revenue-spa',
      'visit',
      'Визит 30.09 18:00',
    ),
    P(
      'pr-2',
      'refund',
      'Ирина П. · компенсация по жалобе',
      1600,
      'out',
      'ca-spa',
      'refund',
      'service_request',
      'Обращение · жалоба на визит',
    ),
    P(
      'pr-3',
      'invoice',
      'Оплата заказчика · акт № 3',
      462000,
      'in',
      'ca-bank',
      'customer-payment',
      'repair_act',
      'Акт № 3',
      { method: 'transfer' },
    ),
    P(
      'pr-4',
      'payroll',
      'Бригада · сентябрь',
      186000,
      'out',
      'ca-bank',
      'payroll-crew',
      'repair_act',
      'Начисления бригаде',
      { method: 'transfer', finance: true },
    ),
  ];

  return {
    accounts,
    ops,
    shifts,
    transfers,
    receipts,
    requests,
    proposals,
    claims: ops.flatMap((o) => (o.source ? [o.source.key] : [])),
    reviews: [],
    seq: { op: n, local: 0 },
  };
}

function seedOther(org: Org): CashData {
  const id = seedUuid(org.proto, 'ca-lotos');
  const unit = org.units.find((u) => u.parentId !== null)?.id ?? org.units[0]?.id ?? null;
  return {
    accounts: [
      {
        id,
        proto: 'ca-lotos',
        kind: 'cash_drawer',
        name: 'Касса «Лотос»',
        orgUnitId: unit,
        shiftMode: 'none',
        kktMode: 'none',
        balanceLimit: null,
        floatAmount: null,
        tolerance: null,
        responsibleId: null,
        holderId: null,
        advanceLimit: null,
        drawerId: null,
        settleDays: null,
        feeBasisPoints: null,
        categoryIds: [],
        revision: 1,
      },
    ],
    ops: [],
    shifts: [],
    transfers: [],
    receipts: [],
    requests: [],
    proposals: [],
    claims: [],
    reviews: [],
    seq: { op: 0, local: 0 },
  };
}

/** Данные кассы организации (после первого чтения): «Альта» — сид эталона, остальные — одна пустая касса. */
export function cashOf(org: Org): CashData {
  const x = org as WithCash;
  x.cash ??= org.proto === 't-alta' ? seedAlta(org) : seedOther(org);
  return x.cash;
}

// ───────────────────────────── права по кассе ─────────────────────────────

export interface Rights {
  via: S['CashAccountMy']['via'];
  rights: string[];
  limits: S['CashLimits'];
  isHolder: boolean;
}

/** Подразделение и все его потомки. */
function subtree(org: Org, unitId: string): string[] {
  const out = [unitId];
  for (let i = 0; i < out.length; i++) {
    for (const u of org.units) if (u.parentId === out[i] && !out.includes(u.id)) out.push(u.id);
  }
  return out;
}

const unitChain = (org: Org, unitId: string | null): string[] => {
  const out: string[] = [];
  let cur = org.units.find((u) => u.id === unitId);
  while (cur) {
    out.push(cur.id);
    cur = org.units.find((u) => u.id === cur?.parentId);
  }
  return out;
};

/** Права участника на кассу: владелец — все; остальные — роли с областью организации, подразделения кассы, кассы или «своё». */
export function rightsOf(t: TenantAccess, data: CashData, a: AcctRow, now: string): Rights {
  const drawer = a.drawerId ? data.accounts.find((x) => x.id === a.drawerId) : undefined;
  if (t.owner) {
    return {
      via: 'owner',
      rights: [...CASH_KEYS],
      limits: NO_LIMITS,
      isHolder: a.holderId === t.member?.id,
    };
  }
  const m = t.member;
  if (!m) return { via: 'role', rights: [], limits: NO_LIMITS, isHolder: false };
  const rights = new Set<string>();
  let viaSelf = true;
  for (const g of grantsOf(t.org, m.id, now)) {
    const keys = g.keys.filter((k) => (CASH_KEYS as readonly string[]).includes(k));
    if (!keys.length) continue;
    const kind = g.scope.kind;
    const ids = g.scope.resourceIds.map((x) => x.toLowerCase());
    const chain = unitChain(t.org, a.orgUnitId);
    let ok = false;
    if (kind === 'tenant') ok = true;
    else if (kind === 'org_unit')
      ok = ids.some((i) => chain.includes(i) || subtree(t.org, i).includes(a.orgUnitId ?? ''));
    else if (kind === 'account')
      ok = ids.includes(a.id) || (drawer !== undefined && ids.includes(drawer.id));
    else if (kind === 'self') ok = a.holderId === m.id;
    if (!ok) continue;
    for (const k of keys) rights.add(k);
    if (kind !== 'self') viaSelf = false;
  }
  const list = CASH_KEYS.filter((k) => rights.has(k));
  const limits = LIMITS[m.proto] ?? NO_LIMITS;
  return {
    via: list.length && viaSelf ? 'self' : 'role',
    rights: list,
    limits,
    isHolder: a.holderId === m.id,
  };
}

export const can = (r: Rights, key: string): boolean => r.rights.includes(key);

/** Остаток кассы: сумма журнала (приход минус расход). */
export const balanceOf = (data: CashData, accountId: string): number =>
  data.ops.reduce(
    (sum, o) =>
      o.accountId === accountId ? sum + (o.direction === 'in' ? o.amount : -o.amount) : sum,
    0,
  );

// ───────────────────────────── DTO ─────────────────────────────

export const rub = (minor: number): S['Money'] => ({ amountMinor: minor, currency: 'RUB' });
export const signedRub = (minor: number): S['SignedMoney'] => ({
  amountMinor: minor,
  currency: 'RUB',
});
const nullMoney = (minor: number | null): S['Money'] | null => (minor === null ? null : rub(minor));

export function accountDto(data: CashData, a: AcctRow, r: Rights): S['CashAccount'] {
  const open = data.shifts.find((s) => s.accountId === a.id && s.status === 'open');
  return {
    id: a.id,
    orgUnitId: a.orgUnitId,
    name: a.name,
    currency: 'RUB',
    kind: a.kind,
    balance: can(r, 'cash.balance.read') ? signedRub(balanceOf(data, a.id)) : null,
    revision: a.revision,
    shiftMode: a.shiftMode,
    kktMode: a.kktMode,
    balanceLimit: nullMoney(a.balanceLimit),
    floatAmount: nullMoney(a.floatAmount),
    tolerance: nullMoney(a.tolerance),
    responsibleMemberId: a.responsibleId,
    holderMemberId: a.holderId,
    advanceLimit: nullMoney(a.advanceLimit),
    drawerAccountId: a.drawerId,
    settleDays: a.settleDays,
    feeBasisPoints: a.feeBasisPoints,
    categoryIds: a.categoryIds,
    openShiftId: open?.id ?? null,
    my: { via: r.via, rights: r.rights, limits: r.limits, isHolder: r.isHolder },
  } as S['CashAccount'];
}

export function opDto(o: OpRow): S['CashOperation'] {
  const out: S['CashOperation'] = {
    id: o.id,
    accountId: o.accountId,
    direction: o.direction,
    amount: rub(o.amount),
    category: o.category,
    occurredAt: o.occurredAt,
    postedAt: o.occurredAt,
    createdByMemberId: o.by,
    type: o.type,
    method: o.method,
    origin: o.origin,
    categoryId: o.categoryId,
    ...(o.basis ? { basis: o.basis } : {}),
    ...(o.receipt ? { receipt: o.receipt } : {}),
    ...(o.source ? { source: o.source } : {}),
    shiftId: o.shiftId,
    groupId: o.groupId,
    transferId: o.transferId,
    approvedByMemberId: o.approvedBy,
    reconcileStatus: 'unmatched',
    own: o.own,
    ...(o.related ? { relatedObject: o.related } : {}),
    ...(o.reverses ? { reversesOperationId: o.reverses } : {}),
  } as S['CashOperation'];
  return out;
}

export const withReversed = (data: CashData, o: OpRow): S['CashOperation'] => {
  const dto = opDto(o);
  const rev = data.ops.find((x) => x.reverses === o.id);
  return rev
    ? ({ ...dto, reversedByOperationId: rev.id } as S['CashOperation'])
    : ({ ...dto, reversedByOperationId: null } as S['CashOperation']);
};

export function shiftDto(s: ShiftRow, canBalance: boolean): S['CashShift'] {
  return {
    id: s.id,
    accountId: s.accountId,
    number: s.number,
    status: s.status,
    openedAt: s.openedAt,
    openedByMemberId: s.openedBy,
    openingFloat: rub(s.openingFloat),
    openingDiff: s.openingDiff === null ? null : signedRub(s.openingDiff),
    closedAt: s.closedAt,
    closedByMemberId: s.closedBy,
    counted: s.counted === null ? null : rub(s.counted),
    counts: s.counts,
    coins: s.coins === null ? null : rub(s.coins),
    z: s.z,
    terminal: s.terminal,
    expected: canBalance ? s.expected : null,
    diff: canBalance ? s.diff : null,
    decision: s.decision,
    attempts: s.attempts.map((a) => (canBalance ? a : { ...a, diff: null })),
    toSafeTransferId: s.toSafeTransferId,
    revision: s.revision,
  };
}

export const transferDto = (t: TransferRow): S['CashTransfer'] => ({
  id: t.id,
  fromAccountId: t.fromId,
  toAccountId: t.toId,
  amount: rub(t.amount),
  note: t.note,
  purpose: t.purpose,
  status: t.status,
  sentByMemberId: t.sentBy,
  sentAt: t.sentAt,
  decidedByMemberId: t.decidedBy,
  decidedAt: t.decidedAt,
  reason: t.reason,
  outOperationId: t.outOp,
  inOperationId: t.inOp,
  backOperationId: t.backOp,
  revision: t.revision,
});

export const receiptDto = (r: ReceiptRow): S['AdvanceReceipt'] => ({
  id: r.id,
  accountId: r.accountId,
  amount: rub(r.amount),
  categoryId: r.categoryId,
  link: r.link,
  note: r.note,
  fileId: r.fileId,
  qr: r.qr,
  status: r.status,
  reason: r.reason,
  operationId: r.operationId,
  submittedByMemberId: r.by,
  submittedAt: r.at,
  decidedByMemberId: r.decidedBy,
  decidedAt: r.decidedAt,
  redoOfReceiptId: r.redoOf,
  revision: r.revision,
});

export const requestDto = (q: RequestRow): S['CashApprovalRequest'] => ({
  id: q.id,
  accountId: q.accountId,
  type: q.type,
  amount: rub(q.amount),
  method: q.method,
  categoryId: q.categoryId,
  basis: q.basis,
  source: q.source,
  status: q.status,
  limit: nullMoney(q.limit),
  requestedByMemberId: q.by,
  requestedAt: q.at,
  decidedByMemberId: q.decidedBy,
  decidedAt: q.decidedAt,
  reason: q.reason,
  operationId: q.operationId,
  transferId: q.transferId,
  revision: q.revision,
});

export const proposalDto = (p: ProposalRow): S['CashProposal'] => ({
  key: p.key,
  kind: p.kind,
  title: p.title,
  amount: rub(p.amount),
  direction: p.direction,
  defaultAccountId: p.accountId,
  categoryId: p.categoryId,
  source: p.source,
  status: p.status,
  parts: p.parts,
  createdAt: p.createdAt,
  operationIds: p.operationIds,
  dismissal: p.dismissal,
});

/** Контекст запроса кассы: организация, данные, «сейчас». */
export interface CashView {
  t: TenantAccess;
  data: CashData;
  now: string;
  rights(a: AcctRow): Rights;
  /** Касса видна, если у актора есть хоть одно право кассы по ней. */
  visible(a: AcctRow): boolean;
}

export function viewOf(ctx: HandlerContext): CashView {
  const t = ctx.org();
  const data = cashOf(t.org);
  const now = ctx.now();
  const cache = new Map<string, Rights>();
  const rights = (a: AcctRow): Rights => {
    let r = cache.get(a.id);
    if (!r) {
      r = rightsOf(t, data, a, now);
      cache.set(a.id, r);
    }
    return r;
  };
  return { t, data, now, rights, visible: (a) => rights(a).rights.length > 0 };
}
