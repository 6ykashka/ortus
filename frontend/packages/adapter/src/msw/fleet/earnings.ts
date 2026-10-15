// Тег Earnings, контракт 0.5.0-stage2 (W2.00): начисления отдельным маршрутом (S2-12, AC-05). Начисление
// создаёт приёмка смены (reviewTrip approve, Q-55); читает владелец или менеджер с fleet.earnings.read в области
// рейса, правит — владелец (fleet.earnings.manage). Функция «Водитель» закрывает начисления, даже свои.
import type { components } from '@ortus/api-client';

import { isDriver } from '../core/access.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { covers, fleetOf, tripOr404, unitsFor } from './state.ts';

type S = components['schemas'];

function noDriver(ctx: HandlerContext): void {
  const t = ctx.org();
  if (!t.owner && t.member && isDriver(t.org, t.member, ctx.now())) {
    fail('function_blocked', 'Функция «Водитель» закрывает начисления.');
  }
}

function earningsOr404(ctx: HandlerContext, key: string): S['TripEarnings'] {
  noDriver(ctx);
  const trip = tripOr404(ctx, key);
  const e = fleetOf(ctx.org().org).earnings.find((x) => x.tripId === trip.id);
  if (!e) fail('not_found', 'Начисления по рейсу нет: оно появляется при приёмке смены.');
  return e;
}

export const earningsHandlers: Registry = {
  getTripEarnings: (ctx) => ({ body: structuredClone(earningsOr404(ctx, 'fleet.earnings.read')) }),

  setTripEarnings: (ctx) => {
    const e = earningsOr404(ctx, 'fleet.earnings.manage');
    ctx.revision(e.revision);
    const b = ctx.body as S['EarningsUpdate'];
    e.amount = { ...b.amount };
    if (b.calculationNote) e.calculationNote = b.calculationNote;
    else delete e.calculationNote;
    e.updatedByMemberId = ctx.org().member?.id ?? e.updatedByMemberId;
    e.updatedAt = ctx.now();
    e.revision++;
    return { body: structuredClone(e) };
  },

  listTripEarnings: (ctx) => {
    noDriver(ctx);
    const t = ctx.org();
    const f = fleetOf(t.org);
    const units = unitsFor(t, 'fleet.earnings.read', ctx.now());
    const unit = uuidParam(ctx.query, 'orgUnitId', false);
    const items = f.earnings
      .filter((e) => {
        const trip = f.trips.find((x) => x.id === e.tripId);
        return !!trip && covers(units, trip.orgUnitId) && (!unit || trip.orgUnitId === unit);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { body: page(structuredClone(items), ctx.query) };
  },
};
