// Тег Fleet, контракт 0.5.0-stage2 (W2.00): расходы рейса (api.js addExpense: сумма 0 < a ≤ 200 000 ₽, чек готов)
// и их проверка менеджером (S2-11). Категории — пять кодов D-12 комплекта; расход ≠ выплата ≠ начисление.
import type { components } from '@ortus/api-client';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { fleetOf, tripForCommand, tripOr404 } from './state.ts';

type S = components['schemas'];

/** 200 000 ₽ в копейках — верхняя граница суммы расхода (validateExpense эталона). */
const MAX_MINOR = 200_000 * 100;
/** Расходы пишутся в рейсе, который идёт или сдаётся (dr.showExp эталона: в рейсе и при сдаче). */
const OPEN: readonly S['TripState'][] = ['on_route', 'returning', 'rework'];

function expenseOr404(ctx: HandlerContext, key: string): S['TripExpense'] {
  const trip = key === 'fleet.expenses.review' ? tripForCommand(ctx, key) : tripOr404(ctx, key);
  const x = fleetOf(ctx.org().org).expenses.find(
    (e) => e.tripId === trip.id && e.id === ctx.params.expenseId?.toLowerCase(),
  );
  if (!x) fail('not_found', 'Расход не найден.');
  return x;
}

export const expenseHandlers: Registry = {
  listTripExpenses: (ctx) => {
    const trip = tripOr404(ctx, 'fleet.expenses.read');
    const items = fleetOf(ctx.org().org).expenses.filter((x) => x.tripId === trip.id);
    return { body: page(structuredClone(items), ctx.query) };
  },

  getTripExpense: (ctx) => ({ body: structuredClone(expenseOr404(ctx, 'fleet.expenses.read')) }),

  createTripExpense: (ctx) => {
    const t = ctx.org();
    const trip = tripForCommand(ctx, 'fleet.expenses.create');
    if (!OPEN.includes(trip.state))
      fail('invalid_transition', 'Расходы добавляются в рейсе и при сдаче.');
    const b = ctx.body as S['TripExpenseCreate'];
    const minor = b.amount.amountMinor;
    if (minor <= 0) fail('amount_invalid', 'Сумма должна быть больше нуля');
    if (minor > MAX_MINOR) fail('amount_invalid', 'Больше 200 000 ₽ — проверьте сумму');
    if (!b.receiptFileIds.length) {
      fail('validation_failed', 'Добавьте фото чека', {
        violations: [{ field: 'receiptFileIds', code: 'required', message: 'Добавьте фото чека' }],
      });
    }
    const ready = b.receiptFileIds.every(
      (id) => t.org.files.find((x) => x.id === id.toLowerCase())?.status === 'ready',
    );
    if (!ready) fail('photo_not_ready', 'Фото чека ещё не загружено');
    const row: S['TripExpense'] = {
      id: ctx.newId(),
      tripId: trip.id,
      kind: b.kind,
      occurredAt: b.occurredAt,
      amount: { ...b.amount },
      ...(b.quantity ? { quantity: b.quantity } : {}),
      receiptFileIds: b.receiptFileIds.map((id) => id.toLowerCase()),
      reviewState: 'pending',
      revision: 1,
      ...(b.comment ? { comment: b.comment } : {}),
    };
    fleetOf(t.org).expenses.push(row);
    return { status: 201, body: structuredClone(row) };
  },

  reviewTripExpense: (ctx) => {
    const x = expenseOr404(ctx, 'fleet.expenses.review');
    ctx.revision(x.revision);
    if (x.reviewState !== 'pending') fail('invalid_transition', 'Расход уже проверен.');
    const b = ctx.body as S['ExpenseReview'];
    x.reviewState = b.decision === 'approve' ? 'approved' : 'rejected';
    x.revision++;
    return { body: structuredClone(x) };
  },
};
