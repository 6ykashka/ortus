// Предложения модулей (cash.js 14.10/19.10:103–124): принятый расход смены рейса → «Возместить»,
// завершённый визит SPA → приход по цене услуги, плюс сидовые предложения ремонта и обращений.
// Предложение не меняет остаток, пока его не провели: деньги двигает человек.
import { canEarnings, moduleOn } from '../../core/access/can.ts';
import type { ModuleKey } from '../../core/types/index.ts';
import { EXPENSE_CAT } from '../logistics/dictionaries.ts';
import { accCan, cashAccess } from './access.ts';
import { PRICE, drawerFor } from './dictionaries.ts';
import type { CashProposalRow, CashTenantDb } from './types.ts';

interface TripExpense {
  id: string;
  amount: number;
  category: string;
}

interface TripLike {
  id: string;
  unit: string;
  status: string;
  driverName?: string | null;
  expenses?: TripExpense[];
}

interface Appointment {
  id: string;
  status: string;
  client: string;
  service: string;
  time: string;
  room: string;
}

/** Срезы соседних модулей читаются структурно: связь с кассой — только через данные (B §3.5). */
type NeighbourDb = { trips?: TripLike[]; spa?: { appointments?: Appointment[] } };

const expenseCat = (key: string): string =>
  (EXPENSE_CAT as Record<string, { label: string } | undefined>)[key]?.label ?? 'Прочий расход';

/** Предложения, которые `actor` может провести: по правам на кассу, модулям и начислениям. */
export function cashProposals(db: CashTenantDb, actor: string): CashProposalRow[] {
  const X = db.cash;
  if (!X?.v1) return [];
  const neighbours = db as NeighbourDb;
  const done = new Set<string>([
    ...X.ops.flatMap((o) => (o.src?.key && !o.reversedBy ? [o.src.key] : [])),
    ...X.requests.flatMap((q) => (q.status === 'pending' && q.src?.key ? [q.src.key] : [])),
    ...X.dismissed.map((d) => d.key),
  ]);
  const list: CashProposalRow[] = X.proposals.map((p) => ({ ...p, key: p.id }));
  for (const t of neighbours.trips ?? []) {
    if (t.status !== 'accepted') continue;
    for (const e of t.expenses ?? []) {
      const a = drawerFor(X, t.unit);
      if (!a) continue;
      const cat = expenseCat(e.category);
      list.push({
        id: 'tx:' + e.id,
        key: 'tx:' + e.id,
        mod: 'logistics',
        kind: 'out',
        amount: e.amount,
        account: a.id,
        method: 'cash',
        cat,
        seller: true,
        title: 'Возместить · ' + (t.driverName || 'водитель'),
        sub: 'Рейс ' + t.id + ' · ' + cat.toLowerCase() + ' · расход принят в приёмке смены',
        src: { kind: 'trip', id: t.id, label: 'Рейс ' + t.id, nav: 'review' },
      });
    }
  }
  for (const ap of neighbours.spa?.appointments ?? []) {
    if (!['done', 'done_pending'].includes(ap.status)) continue;
    const a = drawerFor(X, 'spa');
    if (!a) continue;
    list.push({
      id: 'ap:' + ap.id,
      key: 'ap:' + ap.id,
      mod: 'spa',
      kind: 'in',
      amount: PRICE[ap.service] || 3000,
      account: a.id,
      cat: 'Выручка · услуги SPA',
      title: ap.client + ' · ' + ap.service,
      sub: 'Визит сегодня ' + ap.time + ' · ' + ap.room,
      src: { kind: 'spa', id: ap.id, label: 'Визит ' + ap.time, nav: 'spa' },
    });
  }
  return list
    .filter(
      (p) =>
        !done.has(p.key) &&
        (!p.mod || moduleOn(db, p.mod as ModuleKey)) &&
        (!p.fin || canEarnings(db, actor).ok),
    )
    .filter((p) => {
      const a = X.accounts.find((x) => x.id === p.account);
      if (!a) return false;
      const r = cashAccess(db, actor, a);
      return r.ok && !r.opt.self && accCan(r, p.kind === 'refund' ? 'edit' : 'create');
    });
}
