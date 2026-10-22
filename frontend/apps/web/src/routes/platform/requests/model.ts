// W4.61 · Модель «Заявок на тариф» оператора (requestsVM «Ортус CRM.dc.html» :3586–3617, design-2026-10-19) по
// listPlatformSubscriptionRequests (W4.07): фильтр, карточка заявки, диалоги подтверждения и отказа. Цена — расчёт
// заявки по её версии сетки (`quote`, Q-W4.07-2), а не по текущей сетке, как считает эталон.
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';

import type { ConfirmSpec } from '../kit/confirm.tsx';
import { type Chip, mskStamp, rubMinor, shortName } from '../kit/format.ts';
import { KIT_TEXT } from '../kit/texts.ts';
import type { Pill } from '../kit/ui.tsx';
import { REQUESTS_TEXT as T } from './texts.ts';

type Req = components['schemas']['SubscriptionChangeRequest'];
export type Filter = 'pending' | 'all';

export interface RequestCard {
  id: string;
  number: string;
  org: string;
  chip: Chip;
  meta: string;
  from: string;
  to: string;
  used: string;
  term: string;
  price: string;
  comment: string | undefined;
  decision: string | undefined;
  pending: boolean;
}

const CHIPS: Readonly<Record<Req['status'], Chip>> = {
  pending: { label: T.status.pending, tone: 'warn', icon: 'pending' },
  approved: { label: T.status.approved, tone: 'ok', icon: 'check_circle' },
  rejected: { label: T.status.rejected, tone: 'danger', icon: 'block' },
  cancelled: { label: T.status.cancelled, tone: 'neutral', icon: 'undo' },
};

/** «На рассмотрении · N», «Все заявки · M» (requestsVM :3594). */
export function filterPills(list: readonly Req[]): Pill<Filter>[] {
  const pending = list.filter((r) => r.status === 'pending').length;
  return [
    { key: 'pending', label: format(T.filters.pending, { n: pending }) },
    { key: 'all', label: format(T.filters.all, { n: list.length }) },
  ];
}

/** Заявки фильтра в порядке ответа (новые сверху). */
export const visible = (list: readonly Req[], f: Filter): Req[] =>
  list.filter((r) => f === 'all' || r.status === 'pending');

/** «“Бизнес” · до 50 мест» / «… · без ограничения» (requestsVM :3590). */
function tierText(name: string | null | undefined, seats: number | null | undefined): string {
  if (!name) return KIT_TEXT.dash;
  return seats ? format(T.tier, { name, seats }) : format(T.tierUnlimited, { name });
}

/** «Помесячно» / «{n} месяцев» — без согласования падежа, как эталон (:3600, 04 §9 п. 7). */
const termText = (months: number): string =>
  months === 1 ? T.monthly : format(T.months, { n: months });

function priceText(r: Req): string {
  const q = r.quote;
  if (!q) return T.individual;
  const base = format(T.price, {
    month: rubMinor(q.monthlyAmount.amountMinor),
    total: rubMinor(q.periodAmount.amountMinor),
  });
  return q.discountPercent ? base + format(T.discount, { off: q.discountPercent }) : base;
}

/** Строка решения: «Статус · кто · когда — заметка» (requestsVM :3603); автор — сокращённое имя. */
function decisionText(r: Req): string | undefined {
  if (r.status === 'pending') return undefined;
  let s = CHIPS[r.status].label;
  if (r.decidedBy) s += format(T.decisionBy, { by: shortName(r.decidedBy.displayName) });
  if (r.decidedAt) s += format(T.decisionAt, { at: mskStamp(r.decidedAt) });
  if (r.decisionNote) s += format(T.decisionNote, { note: r.decisionNote });
  return s;
}

export function requestCard(r: Req): RequestCard {
  return {
    id: r.id,
    number: r.number,
    org: r.tenantName,
    chip: CHIPS[r.status],
    meta: format(T.meta, {
      at: mskStamp(r.requestedAt),
      by: r.requestedBy?.displayName ?? KIT_TEXT.dash,
    }),
    from: tierText(r.fromTierName, r.fromSeatsLimit),
    to: tierText(r.toTierName, r.toSeatsLimit),
    used: r.toSeatsLimit
      ? format(T.usedAfter, { used: r.seatsUsed, seats: r.toSeatsLimit })
      : String(r.seatsUsed),
    term: termText(r.termMonths),
    price: priceText(r),
    comment: r.comment ? format(T.comment, { comment: r.comment }) : undefined,
    decision: decisionText(r),
    pending: r.status === 'pending',
  };
}

/** Диалог «Подтвердить заявку …?» (requestsVM :3605–3609). */
export function approveSpec(r: Req): ConfirmSpec {
  const D = T.approveDialog;
  const term = r.termMonths === 1 ? D.termMonthly : format(D.termMonths, { n: r.termMonths });
  const total = r.quote
    ? format(D.total, { total: rubMinor(r.quote.periodAmount.amountMinor) })
    : '';
  return {
    title: format(D.title, { number: r.number }),
    text: format(D.text, { org: r.tenantName, tier: tierText(r.toTierName, r.toSeatsLimit) }),
    items: [
      { icon: 'group_add', tone: 'ok', text: D.seats },
      { icon: 'receipt_long', tone: 'info', text: term + total + D.pilot },
      { icon: 'history', tone: 'neutral', text: D.journal },
    ],
    confirmLabel: D.confirm,
    tone: 'info',
  };
}

/** Диалог «Отклонить заявку …?» (requestsVM :3612): причина обязательна (проверяет страница). */
export function rejectSpec(r: Req, note: string): ConfirmSpec {
  const D = T.rejectDialog;
  return {
    title: format(D.title, { number: r.number }),
    text: format(D.text, { note: note.trim() }),
    items: [
      { icon: 'block', tone: 'warn', text: D.keep },
      { icon: 'inventory_2', tone: 'ok', text: D.data },
    ],
    confirmLabel: D.confirm,
    tone: 'danger',
  };
}
