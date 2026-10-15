// Тег Fleet, контракт 0.5.0-stage2 (W2.00): межфирменный ресурсный пул водителей (S2-14; api.js requestDriver,
// decideRequest). Пул показывает минимум сведений; запрос не даёт доступа до одобрения фирмой-источником.
// Демо-ответ «Одобрить» / «Отклонить» эталона не переносится (PD-54): решает менеджер фирмы-источника или владелец.
import type { components } from '@ortus/api-client';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { covers, fleetOf, type PoolDriverRow, tripVisible, unitsFor } from './state.ts';

type S = components['schemas'];

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function instant(ctx: HandlerContext, name: string): string {
  const v = ctx.query.get(name);
  if (v === null || !INSTANT.test(v)) fail('malformed_request', `Нужен параметр ${name}.`);
  return v;
}

/** Запрос виден логисту фирмы-источника или получателя (и владельцу). */
function transferVisible(ctx: HandlerContext, x: S['DriverTransfer']): boolean {
  const units = unitsFor(ctx.org(), 'fleet.driver_transfers.read', ctx.now());
  return covers(units, x.sourceOrgUnitId) || covers(units, x.targetOrgUnitId);
}

function transferOr404(ctx: HandlerContext): S['DriverTransfer'] {
  const x = fleetOf(ctx.org().org).transfers.find(
    (r) => r.id === ctx.params.requestId?.toLowerCase(),
  );
  if (!x || !transferVisible(ctx, x)) fail('not_found', 'Запрос не найден.');
  return x;
}

/** DriverAvailability без служебного id прототипа. */
function availability(d: PoolDriverRow): S['DriverAvailability'] {
  const out: Partial<PoolDriverRow> = structuredClone(d);
  delete out.proto;
  return out as S['DriverAvailability'];
}

export const poolHandlers: Registry = {
  listAvailableDrivers: (ctx) => {
    const from = instant(ctx, 'availableFrom');
    const until = instant(ctx, 'availableUntil');
    const f = fleetOf(ctx.org().org);
    const busy = (id: string) =>
      f.transfers.some(
        (x) =>
          x.driverMemberId === id &&
          x.status === 'approved' &&
          x.window.startsAt < until &&
          from < x.window.endsAt,
      );
    const items = f.pool
      .filter(
        (d) =>
          d.freeWindow.startsAt < until && from < d.freeWindow.endsAt && !busy(d.driverMemberId),
      )
      .map((d) => availability(d));
    return { body: page(items, ctx.query) };
  },

  listDriverTransfers: (ctx) => {
    const items = fleetOf(ctx.org().org).transfers.filter((x) => transferVisible(ctx, x));
    return { body: page(structuredClone(items), ctx.query) };
  },

  getDriverTransfer: (ctx) => ({ body: structuredClone(transferOr404(ctx)) }),

  requestDriverTransfer: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['DriverTransferCreate'];
    const target = b.targetOrgUnitId.toLowerCase();
    const source = b.sourceOrgUnitId.toLowerCase();
    if (!covers(unitsFor(t, 'fleet.driver_transfers.request', ctx.now()), target)) {
      fail('forbidden_action');
    }
    const driver = f.pool.find((d) => d.driverMemberId === b.driverMemberId.toLowerCase());
    if (!driver) fail('not_found', 'Водитель не опубликован в пуле.');
    if (driver.homeOrgUnitId !== source || source === target) {
      fail('validation_failed', 'Фирма-источник — домашняя фирма водителя.', {
        violations: [
          { field: 'sourceOrgUnitId', code: 'source', message: 'Другая фирма водителя' },
        ],
      });
    }
    if (b.window.startsAt >= b.window.endsAt) {
      fail('validation_failed', 'Проверьте срок.', {
        violations: [
          { field: 'window', code: 'range', message: 'Окончание должно быть позже начала' },
        ],
      });
    }
    const trip = b.tripId ? f.trips.find((x) => x.id === b.tripId?.toLowerCase()) : undefined;
    if (b.tripId && (!trip || !tripVisible(ctx, trip))) fail('not_found', 'Рейс не найден.');
    if (trip?.driverMemberId) fail('invalid_transition', 'У рейса уже есть водитель.');
    const pending = f.transfers.some(
      (x) =>
        x.driverMemberId === driver.driverMemberId &&
        x.status === 'requested' &&
        (x.tripId ?? null) === (trip?.id ?? null),
    );
    if (pending) fail('invalid_transition', 'Запрос уже отправлен');
    const row: S['DriverTransfer'] = {
      id: ctx.newId(),
      driverMemberId: driver.driverMemberId,
      sourceOrgUnitId: source,
      targetOrgUnitId: target,
      window: { ...b.window },
      status: 'requested',
      revision: 1,
      ...(trip ? { tripId: trip.id } : {}),
    };
    f.transfers.push(row);
    return { status: 201, body: structuredClone(row) };
  },

  decideDriverTransfer: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const x = transferOr404(ctx);
    if (!covers(unitsFor(t, 'fleet.driver_transfers.approve', ctx.now()), x.sourceOrgUnitId)) {
      fail('forbidden_action');
    }
    ctx.revision(x.revision);
    const b = ctx.body as S['DriverTransferDecision'];
    if (b.decision === 'revoke' ? x.status !== 'approved' : x.status !== 'requested') {
      fail('invalid_transition', 'Запрос уже рассмотрен.');
    }
    x.status =
      b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'revoked';
    x.revision++;
    const trip = x.tripId ? f.trips.find((r) => r.id === x.tripId) : undefined;
    const driver = f.pool.find((d) => d.driverMemberId === x.driverMemberId);
    if (trip && x.status === 'approved' && !trip.driverMemberId) {
      trip.driverMemberId = x.driverMemberId;
      trip.driverDisplayName = `${driver?.displayName ?? 'Водитель'} · временно`;
      trip.revision++;
    }
    if (
      trip &&
      x.status === 'revoked' &&
      trip.driverMemberId === x.driverMemberId &&
      trip.state === 'planned'
    ) {
      delete trip.driverMemberId;
      delete trip.driverDisplayName;
      trip.revision++;
    }
    return { body: structuredClone(x) };
  },
};
