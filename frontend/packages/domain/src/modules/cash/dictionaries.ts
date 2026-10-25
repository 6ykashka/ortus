// Справочники и чистые функции «Кассы» (cash.js 14.10/19.10:8–57). Тексты и подписи — дословно
// из эталона. «Сегодня» кассы — не константа `CASH_DAY`, а часы домена; для демо-«сейчас»
// это `DEMO.cashDay` (01.10).
import { DEMO } from '../../core/clock.ts';
import type { ToneKey, Verb } from '../../core/types/index.ts';
import type {
  CashAccount,
  CashKind,
  CashMethod,
  CashMode,
  CashOp,
  CashOpType,
  CashOpts,
  CashRequestType,
  CashShift,
  CashSlice,
} from './types.ts';

export const KIND: Readonly<Record<CashKind, { label: string; icon: string; hint: string }>> = {
  drawer: {
    label: 'Наличная касса',
    icon: 'point_of_sale',
    hint: 'денежный ящик точки: смены, пересчёт, сдача выручки',
  },
  acquiring: {
    label: 'Терминал и СБП',
    icon: 'contactless',
    hint: 'оплаты картой и по QR до зачисления на счёт',
  },
  advance: {
    label: 'Подотчёт сотрудника',
    icon: 'badge',
    hint: 'деньги на руках у водителя или прораба, отчёт чеками',
  },
  safe: { label: 'Сейф', icon: 'lock', hint: 'принимает выручку касс' },
  bank: {
    label: 'Банковский счёт',
    icon: 'account_balance',
    hint: 'остаток по выписке; импорт выписки — во второй версии',
  },
};

export const MODE: Readonly<Record<CashMode, string>> = {
  none: 'Без смен',
  open: 'С ожидаемой суммой',
  blind: 'Вслепую',
};

export const KKT = { none: 'Нет', manual: 'Есть · вношу вручную' } as const;

export const OP: Readonly<
  Record<CashOpType, { label: string; tone: ToneKey; icon: string; sign: number }>
> = {
  in: { label: 'Приход', tone: 'ok', icon: 'south_west', sign: 1 },
  out: { label: 'Расход', tone: 'neutral', icon: 'north_east', sign: -1 },
  refund: { label: 'Возврат', tone: 'warn', icon: 'undo', sign: -1 },
  move_out: { label: 'Перемещение', tone: 'info', icon: 'call_made', sign: -1 },
  move_in: { label: 'Перемещение', tone: 'info', icon: 'call_received', sign: 1 },
  opening: { label: 'Ввод остатка', tone: 'neutral', icon: 'input', sign: 1 },
  adjust: { label: 'Корректировка', tone: 'warn', icon: 'tune', sign: 0 },
  storno: { label: 'Сторно', tone: 'danger', icon: 'history', sign: 0 },
};

export const REQ_LABEL: Readonly<Record<CashRequestType, string>> = {
  out: 'Расход',
  refund: 'Возврат',
  issue: 'Выдача под отчёт',
};

export const METHOD: Readonly<Record<CashMethod, { label: string; icon: string }>> = {
  cash: { label: 'Наличные', icon: 'payments' },
  card: { label: 'Карта', icon: 'credit_card' },
  sbp: { label: 'СБП', icon: 'qr_code_2' },
  transfer: { label: 'Безналичный', icon: 'account_balance' },
};

export const METHODS_OF: Readonly<Record<CashKind, readonly CashMethod[]>> = {
  drawer: ['cash'],
  safe: ['cash'],
  advance: ['cash'],
  acquiring: ['card', 'sbp'],
  bank: ['transfer'],
};

export const CATS = {
  in: [
    'Выручка · услуги SPA',
    'Выручка · абонементы и сертификаты',
    'Оплата заказчика',
    'Прочий приход',
  ],
  out: [
    'Топливо',
    'Мойка',
    'Парковка',
    'Мелкий ремонт',
    'Материалы',
    'Инструмент',
    'Хозяйственные расходы',
    'Комиссии банка',
    'Выплаты бригаде',
    'Прочий расход',
  ],
  refund: ['Возврат клиенту'],
} as const;

export const DENOMS: readonly number[] = [5000, 2000, 1000, 500, 200, 100, 50];

export const PRICE: Readonly<Record<string, number>> = {
  'Классический массаж': 3200,
  'SPA-ритуал': 5400,
  'Массаж спины': 2400,
};

export const CASH_OPT0: CashOpts = {
  balance: false,
  self: false,
  out: null,
  refund: null,
  advance: null,
};

export const VERB_TEXT: Readonly<Partial<Record<Verb, string>>> = {
  view: 'видит операции',
  create: 'вносит и проводит, ведёт смены',
  edit: 'возвраты, перемещения, подотчёт',
  review: 'согласует, сверяет, сторнирует',
  settings: 'настраивает кассы',
};

export const ALL_VERBS: readonly Verb[] = [
  'view',
  'create',
  'edit',
  'review',
  'export',
  'settings',
];

/** Демо-подразделение кассы салона: в «Альте» такого unit нет (B §3.5, риск), подпись — по таблице. */
const UNIT_X: Readonly<Record<string, string>> = { spa: 'Салон SPA' };

export const nameOf = (db: { members?: { id: string; name: string }[] }, id: string): string =>
  (db.members ?? []).find((m) => m.id === id)?.name || '—';

export const rub = (n: number): string =>
  Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '\u00a0₽';

export const signRub = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '') + rub(Math.abs(n));

export const plural = (n: number, a: string, b: string, c: string): string =>
  n +
  ' ' +
  (n % 10 === 1 && n % 100 !== 11
    ? a
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
      ? b
      : c);

const dnum = (d: string | null | undefined): number => {
  const [dd, mm] = String(d || '')
    .split('.')
    .map(Number);
  return (mm || 0) * 100 + (dd || 0);
};

/** Срок отчёта (`ДД.ММ`) против «сегодня» (по умолчанию демо-день кассы). */
export const dueState = (
  due: string | null | undefined,
  today: string = DEMO.cashDay,
): 'none' | 'late' | 'today' | 'ok' =>
  !due ? 'none' : dnum(due) < dnum(today) ? 'late' : dnum(due) === dnum(today) ? 'today' : 'ok';

export const unitTitle = (
  db: { units?: { id: string; name: string }[] },
  id: string | null | undefined,
): string =>
  !id ? 'Вся организация' : (UNIT_X[id] ?? (db.units ?? []).find((u) => u.id === id)?.name ?? id);

export const opSign = (o: Pick<CashOp, 'type'> & { sign?: number }): number =>
  OP[o.type]?.sign || o.sign || 0;

export const balanceOf = (X: Pick<CashSlice, 'ops'>, id: string): number =>
  Math.round(
    X.ops.filter((o) => o.account === id).reduce((s, o) => s + opSign(o) * o.amount, 0) * 100,
  ) / 100;

export const openShift = (X: Pick<CashSlice, 'shifts'>, id: string): CashShift | null =>
  (X.shifts ?? []).find((h) => h.account === id && h.status === 'open') ?? null;

export function parseSum(v: unknown): number {
  const s = String(v == null ? '' : v)
    .replace(/[\s\u00a0₽]/g, '')
    .replace(',', '.');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const drawerFor = (
  X: Pick<CashSlice, 'accounts'>,
  unit: string | null | undefined,
): CashAccount | null =>
  X.accounts.find((a) => a.kind === 'drawer' && a.unit === unit && !a.archived) ?? null;
