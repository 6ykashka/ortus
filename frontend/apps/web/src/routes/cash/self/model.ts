// W5.33 · Модель страницы «Мой подотчёт» (эталон Касса.dc.html selfVM :802–818): карточка остатка держателя
// подотчёта, строки «В пути» и «Чеки», статьи диалога, чип срока, ввод сумм и разбор QR чека ФНС. Чистые
// функции над ответами контракта 0.12.0-stage5 (деньги — целые копейки).
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';

import { SELF_TEXT as T } from './texts.ts';

type S = components['schemas'];

export type Account = S['CashAccount'];
export type Operation = S['CashOperation'];
export type Transfer = S['CashTransfer'];
export type Receipt = S['AdvanceReceipt'];
export type Category = S['CashCategory'];

export type Tone = 'ok' | 'warn' | 'danger' | 'info';

export interface Chip {
  text: string;
  tone: Tone;
  icon: string;
}

export interface Move {
  id: string;
  icon: 'payments' | 'schedule';
  text: string;
  /** «Получил(а)»: входящее перемещение в пути и право приёма на счёте. */
  canAccept: boolean;
}

export interface ReceiptRow {
  id: string;
  title: string;
  amount: string;
  status: string;
  tone: Tone;
  icon: string;
  /** «Переснять»: чек отклонён и ещё не переснят. */
  redo: boolean;
  /** Исходные значения для диалога «Переснять чек». */
  amountMinor: number;
  categoryId: string;
  note: string;
}

export interface SelfCard {
  id: string;
  name: string;
  balanceMinor: number;
  balance: string;
  line: string;
  pct: number;
  due: Chip | null;
  moves: Move[];
  receipts: ReceiptRow[];
  canReturn: boolean;
  categories: { id: string; title: string }[];
  linkHint: string;
}

export interface CardData {
  ops: readonly Operation[];
  transfers: readonly Transfer[];
  receipts: readonly Receipt[];
  categories: readonly Category[];
  /** Сегодня — ISO-дата московских суток (`mskDay`). */
  today: string;
  /** Названия видимых касс по id (для «Возврат … ждёт приёма в «…»»). */
  names?: ReadonlyMap<string, string>;
}

const MSK = 'Europe/Moscow';
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
});
const ISO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: MSK });

/** «28.09» по московскому времени. */
export const ddmm = (iso: string): string => DAY_MONTH.format(new Date(iso));

/** ISO-дата (`2026-09-30`) московских суток момента `iso`. */
export const mskDay = (iso: string): string => ISO_DAY.format(new Date(iso));

const NBSP = String.fromCharCode(160);

/** Сумма как в эталоне (cash.js rub): неразрывный пробел перед ₽. */
export const rubles = (minor: number): string =>
  `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${NBSP}₽`;

const MAX_RUB = 1_000_000_000;

/** Ввод суммы в рублях («1 260,50») → копейки; пусто, ноль, минус и не число — `null`. */
export function toMinor(text: string): number | null {
  // `\s` в JS включает NBSP.
  const s = text.replace(/[\s₽]/g, '');
  if (!/^\d+([.,]\d*)?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_RUB) return null;
  const minor = Math.round(n * 100);
  return minor > 0 ? minor : null;
}

/** Полезная нагрузка QR чека ФНС (`t=…&s=1260.00&fn=…&i=…&fp=…&n=1`): сумма из `s`. */
export function parseReceiptQr(payload: string): { amountMinor: number } | null {
  const query = payload.includes('?') ? (payload.split('?').pop() ?? '') : payload;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq).trim() !== 's') continue;
    const v = pair.slice(eq + 1).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
    const minor = Math.round(Number(v) * 100);
    return minor > 0 ? { amountMinor: minor } : null;
  }
  return null;
}

/** Свои счета «подотчёт»: у держателя — он сам (`my.isHolder`). */
export const holderAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => a.kind === 'advance' && a.my.isHolder === true);

/** Чип срока отчёта (:808). Срок — ISO-дата или `null` (контракт его не отдаёт, Q-W5.33-5). */
export function dueChip(balanceMinor: number, due: string | null, today: string): Chip | null {
  if (balanceMinor <= 0) return { text: T.card.paid, tone: 'ok', icon: 'check_circle' };
  if (!due) return null;
  const date = ddmm(`${due}T12:00:00+03:00`);
  if (due < today) {
    return { text: format(T.card.late, { date }), tone: 'danger', icon: 'event_busy' };
  }
  if (due === today) return { text: T.card.today, tone: 'warn', icon: 'event' };
  return { text: format(T.card.until, { date }), tone: 'warn', icon: 'event' };
}

const reportDue = (a: Account): string | null =>
  (a as Account & { reportDueDate?: string | null }).reportDueDate ?? null;

const sum = (rows: readonly Operation[]): number =>
  rows.reduce((t, o) => t + o.amount.amountMinor, 0);

const STATUS: Record<Receipt['status'], { tone: Tone; icon: string }> = {
  review: { tone: 'info', icon: 'schedule' },
  accepted: { tone: 'ok', icon: 'check_circle' },
  rejected: { tone: 'danger', icon: 'cancel' },
};

function statusText(r: Receipt): string {
  if (r.status === 'review') return T.receipts.review;
  if (r.status === 'accepted') return T.receipts.accepted;
  return format(T.receipts.rejected, { reason: r.reason ?? '' });
}

function moves(
  a: Account,
  transfers: readonly Transfer[],
  names?: ReadonlyMap<string, string>,
): Move[] {
  const canAccept = a.my.rights.includes('cash.transfer');
  return transfers
    .filter((t) => t.status === 'transit' && (t.toAccountId === a.id || t.fromAccountId === a.id))
    .map((t): Move => {
      const sumText = rubles(t.amount.amountMinor);
      if (t.toAccountId === a.id) {
        return {
          id: t.id,
          icon: 'payments',
          text: format(T.moves.incoming, { sum: sumText }),
          canAccept,
        };
      }
      const to = names?.get(t.toAccountId);
      return {
        id: t.id,
        icon: 'schedule',
        text: to
          ? format(T.moves.outgoingTo, { sum: sumText, to })
          : format(T.moves.outgoing, { sum: sumText }),
        canAccept: false,
      };
    });
}

function receiptRows(
  a: Account,
  receipts: readonly Receipt[],
  categories: readonly Category[],
): ReceiptRow[] {
  const mine = receipts.filter((r) => r.accountId === a.id);
  const redone = new Set(mine.flatMap((r) => (r.redoOfReceiptId ? [r.redoOfReceiptId] : [])));
  const title = (id: string) => categories.find((c) => c.id === id)?.title ?? id;
  return mine
    .filter((r) => !redone.has(r.id))
    .map((r): ReceiptRow => {
      const link = (r.link?.label ?? r.note ?? '').trim();
      const sumText = rubles(r.amount.amountMinor);
      const st = STATUS[r.status];
      return {
        id: r.id,
        title: [title(r.categoryId), link, sumText].filter(Boolean).join(' · '),
        amount: sumText,
        status: statusText(r),
        tone: st.tone,
        icon: st.icon,
        redo: r.status === 'rejected',
        amountMinor: r.amount.amountMinor,
        categoryId: r.categoryId,
        note: link,
      };
    });
}

/** Карточка «Подотчёт · на руках» держателя счёта `a`. */
export function buildCard(a: Account, d: CardData): SelfCard {
  const ops = d.ops.filter((o) => o.accountId === a.id);
  const live = (o: Operation) => !o.reversedByOperationId;
  const issued = sum(ops.filter((o) => o.type === 'move_in' && live(o)));
  const spent = sum(ops.filter((o) => o.type === 'out' && live(o)));
  // Остаток скрыт без права «Видеть остаток»: у держателя он считается по своему журналу.
  const balanceMinor =
    a.balance?.amountMinor ??
    ops.reduce((t, o) => t + (o.direction === 'in' ? 1 : -1) * o.amount.amountMinor, 0);
  // Держателю список перемещений может не отдаваться (listCashTransfers — cash.read): тогда дата — по журналу.
  const issuedAt = d.transfers
    .filter((t) => t.toAccountId === a.id && t.purpose === 'advance_issue' && t.status === 'done')
    .map((t) => t.decidedAt ?? t.sentAt);
  const last = (
    issuedAt.length
      ? issuedAt
      : ops.filter((o) => o.type === 'move_in' && live(o)).map((o) => o.occurredAt)
  )
    .sort()
    .at(-1);
  const line = [
    `${T.card.issued} ${rubles(issued)}`,
    last ? ddmm(last) : '',
    `${T.card.reported} ${rubles(spent)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const allowed = a.categoryIds?.length ? new Set(a.categoryIds) : null;
  return {
    id: a.id,
    name: T.card.name,
    balanceMinor,
    balance: rubles(balanceMinor),
    line,
    pct: issued > 0 ? Math.min(100, Math.round((spent / issued) * 100)) : 0,
    due: dueChip(balanceMinor, reportDue(a), d.today),
    moves: moves(a, d.transfers, d.names),
    receipts: receiptRows(a, d.receipts, d.categories),
    canReturn: balanceMinor > 0,
    categories: d.categories
      .filter((c) => c.group === 'expense' && (!allowed || allowed.has(c.id)))
      .map((c) => ({ id: c.id, title: c.title })),
    linkHint: a.orgUnitId ? T.receiptDialog.linkTrip : T.receiptDialog.linkObject,
  };
}
