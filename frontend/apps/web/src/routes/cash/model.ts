// W5.32 · Чистая модель страницы «Касса»: деньги (копейки контракта 0.12 → рубли эталона), подписи и значки
// типов (cash.js :13–57 эталона design-2026-10-19), права кнопок по `account.my` (PD-53), группы касс, фильтр
// журнала, смены. Без React и сети — табличные тесты model.test.ts.
import type { components } from '@ortus/api-client';

type S = components['schemas'];

export type Account = S['CashAccount'];
export type Operation = S['CashOperation'];
export type Shift = S['CashShift'];
export type AccountKind = Account['kind'];
export type OpType = Operation['type'];
export type Method = Operation['method'];
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

const NBSP = '\u00a0';
const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** «3 200 ₽» (cash.js rub): минус — U+2212, пробелы неразрывные. */
export const rub = (minor: number): string =>
  `${minor < 0 ? '−' : ''}${NUMBER.format(Math.abs(minor) / 100)}${NBSP}₽`;

/** «+100 ₽» / «−100 ₽» (cash.js signRub). */
export const signRub = (minor: number): string =>
  `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${rub(Math.abs(minor))}`;

/** Ввод суммы «1 200,50» → копейки; пусто и не число → `null` (cash.js parseSum). */
export function parseRub(text: string): number | null {
  const s = text.replace(/[\s\u00a0₽]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Денежное значение контракта в рублях. */
export const money = (amountMinor: number): S['Money'] => ({ amountMinor, currency: 'RUB' });

/** «5 касс» с склонением (cash.js plural). */
export function plural(n: number, one: string, few: string, many: string): string {
  const w =
    n % 10 === 1 && n % 100 !== 11
      ? one
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
        ? few
        : many;
  return `${n} ${w}`;
}

/** Итог частей «Частями» против суммы предложения (K:710). */
export function splitSum(parts: readonly string[], total: number): { sum: number; ok: boolean } {
  const sum = parts.reduce((s, p) => s + (parseRub(p) ?? 0), 0);
  return { sum, ok: sum === total };
}

/** Номиналы пересчёта (cash.js DENOMS). */
export const DENOMS = [5000, 2000, 1000, 500, 200, 100, 50] as const;

/** Пересчёт при закрытии смены: посчитано вместе с разменом и «В сейф» (K:879–881). */
export function closeTotals(
  counts: Readonly<Record<number, string>>,
  coins: string,
  keep: string,
): { countedMinor: number; toSafeMinor: number } {
  let rubles = 0;
  for (const d of DENOMS) rubles += Math.max(0, Math.floor(Number(counts[d]) || 0)) * d;
  const countedMinor = rubles * 100 + Math.max(0, parseRub(coins) ?? 0);
  const keepMinor = parseRub(keep);
  return {
    countedMinor,
    toSafeMinor: Math.max(0, countedMinor - (keepMinor !== null && keepMinor >= 0 ? keepMinor : 0)),
  };
}

const MSK = 'Europe/Moscow';
const AT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** «30.09 21:04» по Москве (поля `at` и `time` эталона). */
export function fmtAt(iso: string): string {
  const p = Object.fromEntries(AT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

/** Время «ЧЧ:ММ» по Москве. */
export const fmtTime = (iso: string): string => fmtAt(iso).split(' ')[1] ?? '';

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MSK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Срок отчёта относительно сегодняшнего дня по Москве (cash.js dueState; срок — ISO-дата, Q-W4.00-cash-16). */
export function dueState(due: string | undefined, today: Date): 'none' | 'late' | 'today' | 'ok' {
  if (!due) return 'none';
  const now = DAY.format(today);
  return due < now ? 'late' : due === now ? 'today' : 'ok';
}

/** Срок «ДД.ММ» из ISO-даты. */
export const dueText = (due: string | undefined): string =>
  due ? `${due.slice(8, 10)}.${due.slice(5, 7)}` : '—';

export interface KindInfo {
  label: string;
  icon: string;
  hint: string;
}

/** Виды касс (cash.js KIND); `virtual` в эталоне нет — внутренний счёт контракта. */
export const KIND_INFO: Readonly<Record<AccountKind, KindInfo>> = {
  cash_drawer: {
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
  virtual: {
    label: 'Виртуальная касса',
    icon: 'savings',
    hint: 'внутренний счёт без денег в ящике',
  },
};

/** Виды в мастере «Новая касса» в порядке эталона (K:935; `virtual` в мастере нет). */
export const WIZARD_KINDS: readonly AccountKind[] = [
  'cash_drawer',
  'acquiring',
  'advance',
  'safe',
  'bank',
];

export const MODE_LABEL = {
  none: 'Без смен',
  open: 'С ожидаемой суммой',
  blind: 'Вслепую',
} as const;

export const METHOD_INFO: Readonly<Record<Method, { label: string; icon: string }>> = {
  cash: { label: 'Наличные', icon: 'payments' },
  card: { label: 'Карта', icon: 'credit_card' },
  sbp: { label: 'СБП', icon: 'qr_code_2' },
  transfer: { label: 'Безналичный', icon: 'account_balance' },
};

export const METHODS_OF: Readonly<Record<AccountKind, readonly Method[]>> = {
  cash_drawer: ['cash'],
  safe: ['cash'],
  advance: ['cash'],
  acquiring: ['card', 'sbp'],
  bank: ['transfer'],
  virtual: ['transfer'],
};

export const REQ_LABEL = { out: 'Расход', refund: 'Возврат', issue: 'Выдача под отчёт' } as const;

interface OpInfo {
  label: string;
  tone: Tone;
  icon: string;
  sign: 1 | 0 | -1;
}

/** Типы журнала (cash.js OP). */
export const OP_INFO: Readonly<Record<OpType, OpInfo>> = {
  in: { label: 'Приход', tone: 'ok', icon: 'south_west', sign: 1 },
  out: { label: 'Расход', tone: 'neutral', icon: 'north_east', sign: -1 },
  refund: { label: 'Возврат', tone: 'warn', icon: 'undo', sign: -1 },
  move_out: { label: 'Перемещение', tone: 'info', icon: 'call_made', sign: -1 },
  move_in: { label: 'Перемещение', tone: 'info', icon: 'call_received', sign: 1 },
  opening: { label: 'Ввод остатка', tone: 'neutral', icon: 'input', sign: 1 },
  adjust: { label: 'Корректировка', tone: 'warn', icon: 'tune', sign: 0 },
  storno: { label: 'Сторно', tone: 'danger', icon: 'history', sign: 0 },
};

export const opChip = (type: OpType): { label: string; tone: Tone; icon: string } => {
  const { label, tone, icon } = OP_INFO[type];
  return { label, tone, icon };
};

/** Сумма строки журнала со знаком типа (K:618): корректировка и сторно — без знака. */
export function opAmountText(o: Operation): string {
  const sign = OP_INFO[o.type].sign;
  return `${sign > 0 ? '+' : sign < 0 ? '−' : ''}${rub(o.amount.amountMinor)}`;
}

/** Чек строки журнала (K:613). */
export function opReceiptText(r: S['CashReceipt'] | undefined): string {
  if (!r) return '';
  if (r.none) return `Чек не пробит: ${r.reason ?? ''}`;
  if (r.fdNumber) return `ФД ${r.fdNumber}${r.kktShift ? ` · смена ККТ ${r.kktShift}` : ''}`;
  if (r.sellerMemberId) return 'Чек продавца';
  return '';
}

export type OpFilter = 'all' | 'in' | 'out' | 'refund' | 'move' | 'fix';

export const OP_FILTERS: readonly (readonly [OpFilter, string])[] = [
  ['all', 'Все'],
  ['in', 'Приход'],
  ['out', 'Расход'],
  ['refund', 'Возвраты'],
  ['move', 'Перемещения'],
  ['fix', 'Исправления'],
];

/** Фильтр журнала (K:657). */
export function matchFilter(o: Operation, flt: OpFilter): boolean {
  switch (flt) {
    case 'all':
      return true;
    case 'move':
      return o.type === 'move_in' || o.type === 'move_out';
    case 'fix':
      return o.type === 'adjust' || o.type === 'storno';
    case 'in':
      return o.type === 'in' || o.type === 'opening';
    default:
      return o.type === flt;
  }
}

/** Право участника на кассе (`my.rights` — ключи действий модуля, PD-53). */
export const hasRight = (a: Account | undefined, key: string): boolean =>
  !!a && a.my.rights.includes(key);

/** «Сторно» (cash.js :139): право, не исправлена, не сторно и не перемещение; свою — только владелец. */
export function isReversible(
  o: Operation,
  a: Account,
  me?: { memberId: string; owner: boolean },
): boolean {
  if (!hasRight(a, 'cash.reverse')) return false;
  if (o.reversedByOperationId || o.type === 'storno') return false;
  if (o.type === 'move_in' || o.type === 'move_out') return false;
  return !me || me.owner || o.createdByMemberId !== me.memberId;
}

/** Действия модуля по порядку каталога: ключ → «видит операции» (cash.js VERB_TEXT, ключи контракта 0.12). */
const RIGHT_TEXT: readonly (readonly [string, string])[] = [
  ['cash.read', 'видит операции'],
  ['cash.balance.read', 'видит остаток'],
  ['cash.post', 'вносит приход и расход'],
  ['cash.proposals.post', 'проводит предложения модулей'],
  ['cash.shift.operate', 'ведёт смены'],
  ['cash.refund', 'возвраты клиентам'],
  ['cash.transfer', 'перемещает и сдаёт выручку'],
  ['cash.advance.issue', 'выдаёт под отчёт'],
  ['cash.approve', 'согласует расходы'],
  ['cash.reconcile', 'сверяет смены'],
  ['cash.reverse', 'сторнирует'],
  ['cash.accounts.manage', 'настраивает кассы'],
  ['cash.advance.self', 'свой подотчёт'],
];

/** «Ваш доступ: … — {rights}»: действия участника на кассе словами (cash.js rightsText). */
export const rightsText = (rights: readonly string[]): string =>
  RIGHT_TEXT.filter(([k]) => rights.includes(k))
    .map(([, t]) => t)
    .join(', ');

/** Лимит роли без согласования: расход и возврат; приход — без лимита (`null`, 0 — всегда с согласованием). */
export function limitFor(a: Account, type: 'in' | 'out' | 'refund'): number | null {
  if (type === 'out') return a.my.limits.outMinor;
  if (type === 'refund') return a.my.limits.refundMinor;
  return null;
}

export const overLimit = (limit: number | null, amount: number): boolean =>
  limit !== null && amount > limit;

/** Ожидаемая сумма открытой смены (K:144): остаток кассы, пока у участника есть право его видеть. */
export function expectedNow(shift: Shift, a: Account): number | null {
  return shift.status === 'open' && a.balance ? a.balance.amountMinor : null;
}

/** Заявку решает не автор и только с правом «Согласовывать» (cash.js :534). */
export const canDecideRequest = (
  q: S['CashApprovalRequest'],
  a: Account | undefined,
  meId: string,
): boolean =>
  q.status === 'pending' && !!a && hasRight(a, 'cash.approve') && q.requestedByMemberId !== meId;

/** Принимает получатель: держатель подотчёта или роль с «Перемещать» на кассе-получателе (cash.js :97). */
export function canAcceptTransfer(t: S['CashTransfer'], to: Account | undefined): boolean {
  if (t.status !== 'transit' || !to) return false;
  return to.kind === 'advance' ? to.my.isHolder === true : hasRight(to, 'cash.transfer');
}

export interface AccountGroup {
  unitId: string | null;
  items: Account[];
}

/** Кассы по подразделениям в порядке появления, касса организации последней (K:627–629). */
export function accountGroups(list: readonly Account[]): AccountGroup[] {
  const groups: AccountGroup[] = [];
  for (const a of list) {
    const g = groups.find((x) => x.unitId === a.orgUnitId);
    if (g) g.items.push(a);
    else groups.push({ unitId: a.orgUnitId, items: [a] });
  }
  return [...groups.filter((g) => g.unitId !== null), ...groups.filter((g) => g.unitId === null)];
}

export type DeskAction = 'post' | 'openShift' | 'closeShift' | 'transfer';

/** Кнопки карточки кассы (K:640–643), кроме «Выдать под отчёт» (W5.33). */
export function deskActions(
  a: Account,
  ctx: { open: string | undefined; review: string | undefined; others: number },
): DeskAction[] {
  const shifts = a.kind === 'cash_drawer' && a.shiftMode !== 'none';
  const out: DeskAction[] = [];
  if (hasRight(a, 'cash.post') && a.kind !== 'advance' && (!shifts || ctx.open)) out.push('post');
  if (shifts && hasRight(a, 'cash.shift.operate')) out.push(ctx.open ? 'closeShift' : 'openShift');
  if (
    (a.kind === 'cash_drawer' || a.kind === 'safe') &&
    hasRight(a, 'cash.transfer') &&
    ctx.others > 0
  ) {
    out.push('transfer');
  }
  return out;
}

export const shiftChip = (status: Shift['status']): { label: string; tone: Tone; icon: string } =>
  status === 'open'
    ? { label: 'Открыта', tone: 'ok', icon: 'lock_open' }
    : status === 'review'
      ? { label: 'Ждёт решения', tone: 'danger', icon: 'error' }
      : { label: 'Закрыта', tone: 'neutral', icon: 'lock' };

const RANK = { review: 0, open: 1, closed: 2 } as const;

/** Порядок списка смен (K:741): ждёт решения → открыта → закрыта, номер убыванием. */
export const shiftOrder = (list: readonly Shift[]): Shift[] =>
  [...list].sort((x, y) => RANK[x.status] - RANK[y.status] || y.number - x.number);
