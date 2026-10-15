// Тег Home, контракт 0.5.0-stage2 (W2.00, S2-18): «Главная · Требует решения» — персональная лента по одной
// организации. Реестр источников (план v2 §3.5, 01-shell §23): логистика (блокирующий дефект, смена на приёмке,
// рейс без водителя), организация для владельца (пробный период, место, сотрудники без роли). Каждый источник
// проверяет права участника сам; текст карточки собирает клиент по kind и params. Сортировка по тону, затем
// порядок источников (homeVM эталона).
import type { components } from '@ortus/api-client';

import { accessOf } from '../context/index.ts';
import { grantsOf, type TenantAccess } from '../core/access.ts';
import { quotaBytes } from '../core/dto.ts';
import { uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { DAY } from '../core/time.ts';
import { covers, fleetOf, unitsFor } from './state.ts';

type S = components['schemas'];
type Item = S['DecisionItem'];

const TONE: Readonly<Record<Item['tone'], number>> = { danger: 0, warn: 1, info: 2, neutral: 3 };
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 8;

const tripRef = (id: string): S['ObjectRef'] => ({
  moduleKey: 'fleet',
  entityType: 'trip',
  entityId: id,
});

/** Источник логистики: только при подключённом (или доступном для чтения) модуле. */
function fleetSource(t: TenantAccess, now: string): Item[] {
  const st = t.org.modules.fleet?.state;
  if (st !== 'active' && st !== 'read_only' && st !== 'draining') return [];
  const f = fleetOf(t.org);
  const out: Item[] = [];
  const review = unitsFor(t, 'fleet.inspections.review', now);
  for (const d of f.defects) {
    const trip = d.tripId ? f.trips.find((x) => x.id === d.tripId) : undefined;
    const v = f.vehicles.find((x) => x.id === d.vehicleId);
    if (d.state !== 'in_review' || !trip || !v || !covers(review, v.orgUnitId)) continue;
    out.push({
      key: `fleet.blocking_defect:${d.id}`,
      kind: 'fleet.blocking_defect',
      moduleKey: 'fleet',
      tone: 'danger',
      object: tripRef(trip.id),
      params: {
        tripNumber: trip.number,
        zone: d.zone,
        description: d.description,
        driverName: trip.driverDisplayName ?? '',
      },
      occurredAt: d.reportedAt,
    });
  }
  const accept = unitsFor(t, 'fleet.trips.review', now);
  for (const trip of f.trips) {
    if (trip.state !== 'submitted' || !covers(accept, trip.orgUnitId)) continue;
    out.push({
      key: `fleet.trip_review:${trip.id}`,
      kind: 'fleet.trip_review',
      moduleKey: 'fleet',
      tone: 'warn',
      object: tripRef(trip.id),
      params: { tripNumber: trip.number, driverName: trip.driverDisplayName ?? '' },
      ...(trip.returnedAt ? { occurredAt: trip.returnedAt } : {}),
    });
  }
  const plan = unitsFor(t, 'fleet.routes.manage', now);
  if (st === 'active') {
    for (const trip of f.trips) {
      if (trip.state !== 'planned' || trip.driverMemberId || !covers(plan, trip.orgUnitId))
        continue;
      const req = f.transfers.find((x) => x.tripId === trip.id && x.status === 'requested');
      const unit = req ? t.org.units.find((u) => u.id === req.sourceOrgUnitId) : undefined;
      out.push({
        key: `fleet.trip_without_driver:${trip.id}`,
        kind: 'fleet.trip_without_driver',
        moduleKey: 'fleet',
        tone: 'info',
        object: tripRef(trip.id),
        params: {
          tripNumber: trip.number,
          title: trip.title,
          cargo: trip.cargo.description,
          startsAt: trip.plannedWindow.startsAt,
          ...(req ? { poolRequest: 'pending', poolHome: unit?.name ?? '' } : {}),
        },
      });
    }
  }
  return out;
}

/** Источник организации (только владелец): пробный период, место, сотрудники без роли. */
function tenantSource(t: TenantAccess, now: string): Item[] {
  if (!t.owner) return [];
  const out: Item[] = [];
  const id = t.tenant.id;
  const sub = t.tenant.subscription;
  if (t.tenant.status === 'read_only' || t.tenant.status === 'grace') {
    out.push({
      key: `tenant.trial_ended:${id}`,
      kind: 'tenant.trial_ended',
      moduleKey: 'billing',
      tone: 'danger',
      params: {},
    });
  } else if (t.tenant.status === 'trial' && sub.trialEndsAt) {
    const days = Math.floor((Date.parse(sub.trialEndsAt) - Date.parse(now)) / DAY);
    if (days >= 0 && days <= 14) {
      out.push({
        key: `tenant.trial_ending:${id}`,
        kind: 'tenant.trial_ending',
        moduleKey: 'billing',
        tone: 'neutral',
        params: { daysLeft: String(days), trialEndsAt: sub.trialEndsAt },
      });
    }
  }
  const quota = quotaBytes(t.tenant);
  const used = t.tenant.storage.committedBytes;
  if (quota > 0 && used / quota > 0.85) {
    out.push({
      key: `tenant.storage_high:${id}`,
      kind: 'tenant.storage_high',
      moduleKey: 'billing',
      tone: used >= quota ? 'danger' : 'warn',
      params: {
        percent: String(Math.round((used / quota) * 100)),
        usedBytes: String(used),
        quotaBytes: String(quota),
      },
    });
  }
  // «Без роли» — нет назначения с областью организации, подразделения или «своего» (проектная роль доступа
  // к модулям не даёт, PD-53).
  const noRole = t.org.members.filter(
    (m) =>
      m.status === 'active' &&
      m.id !== t.membership.memberId &&
      !grantsOf(t.org, m.id, now).some((g) => g.scope.kind !== 'project'),
  );
  if (noRole.length) {
    out.push({
      key: `access.members_without_role:${id}`,
      kind: 'access.members_without_role',
      moduleKey: 'members',
      tone: 'neutral',
      params: { count: String(noRole.length), names: noRole.map((m) => m.displayName).join(', ') },
    });
  }
  return out;
}

export const homeHandlers: Registry = {
  getMyDecisionQueue: (ctx) => {
    const user = ctx.user();
    const tenantId = uuidParam(ctx.query, 'tenantId') ?? '';
    const raw = ctx.query.get('limit');
    const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
    if (raw !== null && (!/^\d+$/.test(raw) || limit < 1 || limit > MAX_LIMIT))
      fail('malformed_request');
    const m = ctx.s.memberships.find(
      (x) => x.accountId === user.id && x.tenantId === tenantId && x.status === 'active',
    );
    const t = m ? accessOf(ctx.s, m) : undefined;
    if (!t || t.tenant.status === 'suspended') fail('not_found', 'Организация не найдена.');
    const now = ctx.now();
    const all = [...fleetSource(t, now), ...tenantSource(t, now)]
      .map((item, i) => ({ item, i }))
      .sort((a, b) => TONE[a.item.tone] - TONE[b.item.tone] || a.i - b.i)
      .map((x) => x.item);
    const body: S['DecisionQueue'] = {
      tenantId: t.tenant.id,
      items: all.slice(0, limit),
      total: all.length,
      generatedAt: now,
    };
    return { body };
  },
};
