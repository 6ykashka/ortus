// Модель «Кассы» (cash.js 14.10/19.10, docs/26-cash.md, B §3.5): кассы пяти видов, операции,
// смены, перемещения, чеки подотчёта, заявки на согласование и предложения модулей.
import type { TenantDb } from '../../core/types/index.ts';

export type CashKind = 'drawer' | 'acquiring' | 'advance' | 'safe' | 'bank';
export type CashMode = 'none' | 'open' | 'blind';
export type CashKkt = 'none' | 'manual';
export type CashMethod = 'cash' | 'card' | 'sbp' | 'transfer';
export type CashOpType =
  'in' | 'out' | 'refund' | 'move_out' | 'move_in' | 'opening' | 'adjust' | 'storno';
/** Тип заявки на согласование: расход, возврат клиенту, выдача под отчёт. */
export type CashRequestType = 'out' | 'refund' | 'issue';

export interface CashAccount {
  id: string;
  kind: CashKind;
  name: string;
  /** Подразделение; `null` — касса организации (сейф, счёт). */
  unit: string | null;
  resp: string | null;
  mode: CashMode;
  kkt: CashKkt;
  /** Лимит: для кассы — остаток, для подотчёта — сумма на руках. */
  limit: number | null;
  float: number;
  /** Допуск расхождения при закрытии смены, ₽. */
  tol: number;
  member: string | null;
  from: string | null;
  term: string | null;
  drawer: string | null;
  due: string | null;
  cats: string[] | null;
  /** Счёт зачисления эквайринга и комиссия, % (только `acquiring`). */
  settle?: string;
  fee?: number;
  archived?: boolean;
  createdBy?: string;
  createdAt?: string;
}

/** Чек ККТ операции: № ФД, «чек у продавца» или причина, почему не пробит. */
export type CashOpReceipt =
  { fd: string; kkt: string; time: string } | { seller: true } | { none: true; reason: string };

export interface CashSrc {
  key?: string;
  kind: string;
  id?: string | null;
  label: string;
  nav?: string | null;
  linkedBy?: string;
}

export interface CashOp {
  id: string;
  account: string;
  type: CashOpType;
  amount: number;
  method: CashMethod;
  cat: string;
  basis: string;
  at: string;
  time: string;
  by: string;
  src: CashSrc | null;
  ref: string | null;
  receipt: CashOpReceipt | null;
  shift: string | null;
  group: string | null;
  /** Знак для `adjust` и `storno`. */
  sign?: number;
  reverses?: string;
  reversedBy?: string;
  tr?: string;
  approvedBy?: string | null;
}

export type CashShiftStatus = 'open' | 'review' | 'closed';

export interface CashShiftDiff {
  cash: number;
  kktCash: number;
  kktCard: number;
  term: number;
}

export interface CashShiftExpected {
  cash: number;
  revCash: number;
  revCard: number;
  card: number;
  sbp: number;
}

export interface CashShiftDecision {
  kind: 'auto' | 'accepted';
  at: string;
  reason: string;
  by?: string;
  op?: string;
}

export interface CashShift {
  id: string;
  account: string;
  no: number;
  status: CashShiftStatus;
  openedAt: string;
  openedBy: string;
  float: number;
  openDiff?: { amount: number; op: string };
  closedAt?: string;
  closedBy?: string;
  counted?: number;
  counts?: Record<string, number>;
  coins?: number;
  z?: { no: string; cash: number; card: number } | null;
  term?: { card: number; sbp: number } | null;
  expected?: CashShiftExpected;
  diff?: CashShiftDiff;
  decision?: CashShiftDecision;
  toSafe?: number;
  recount?: { by: string; at: string; reason: string };
}

export type CashTransferStatus = 'transit' | 'done' | 'rejected';

export interface CashTransfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  note: string;
  by: string;
  at: string;
  status: CashTransferStatus;
  outOp?: string;
  inOp?: string;
  backOp?: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
}

export type AdvanceReceiptStatus = 'review' | 'accepted' | 'rejected';

/** Чек сотрудника по подотчёту (фото чека, статья, привязка). */
export interface AdvanceReceipt {
  id: string;
  account: string;
  amount: number;
  cat: string;
  link: string;
  note: string;
  photo: boolean;
  qr?: boolean;
  by: string;
  at: string;
  status: AdvanceReceiptStatus;
  op?: string;
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
  redoneBy?: string;
}

/** Чек операции, как его вводит кассир: № ФД из чека, «у продавца» или причина без чека. */
export interface ReceiptInput {
  seller?: boolean;
  none?: boolean;
  reason?: string;
  fd?: string;
  kkt?: string;
  time?: string;
}

export interface CashRequestSpec {
  type: CashRequestType;
  amount: number;
  method: CashMethod;
  cat: string;
  basis: string;
  ref?: string | null;
  receipt?: ReceiptInput | CashOpReceipt | null;
  src?: CashSrc | null;
  from?: string;
  due?: string;
}

export interface CashRequest extends CashRequestSpec {
  id: string;
  account: string;
  by: string;
  at: string;
  status: 'pending' | 'approved' | 'rejected';
  /** Лимит роли, превышение которого потребовало согласования. */
  limit: number;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  result?: string;
}

/** Предложение модуля к проведению (визит, возмещение, возврат, оплата заказчика). */
export interface CashProposal {
  id: string;
  mod?: string;
  kind: 'in' | 'out' | 'refund';
  amount: number;
  account: string;
  method?: CashMethod;
  cat: string;
  ref?: string | null;
  /** Предложение с деньгами бригады: только с правом на начисления. */
  fin?: boolean;
  /** Чек у продавца (возмещение расхода). */
  seller?: boolean;
  title: string;
  sub?: string;
  src: Omit<CashSrc, 'key'>;
}

export interface CashProposalRow extends CashProposal {
  key: string;
}

export interface CashDismissed {
  key: string;
  reason: string;
  by: string;
  at: string;
  title: string;
  amount: number;
}

export interface CashSlice {
  v1: true;
  accounts: CashAccount[];
  ops: CashOp[];
  shifts: CashShift[];
  transfers: CashTransfer[];
  receipts: AdvanceReceipt[];
  requests: CashRequest[];
  proposals: CashProposal[];
  dismissed: CashDismissed[];
}

/** Срез «Кассы» 14.10 до установки модуля: счета и операции без `v1`. */
export interface LegacyCashSlice {
  v1?: undefined;
  accounts: { id: string; name: string; unit?: string }[];
  ops: Partial<CashOp>[];
}

/** Параметры роли в кассе с применёнными умолчаниями. */
export interface CashOpts {
  balance: boolean;
  self: boolean;
  out: number | null;
  refund: number | null;
  advance: number | null;
}

export type CashVerb = 'view' | 'create' | 'edit' | 'review' | 'export' | 'settings';

/** Доступ участника к кассе (`cashAccess`). */
export type CashAccessResult =
  | { ok: false; why: string }
  | {
      ok: true;
      all: boolean;
      own: boolean;
      verbs: readonly CashVerb[];
      opt: CashOpts;
      via: string;
    };

/** БД организации с срезом кассы: до установки модуля — старый (без `v1`), после — CashSlice. */
export type CashTenantDb = TenantDb & { cash?: CashSlice | LegacyCashSlice };
