// Тег Platform, контракт 0.8.0-stage4 (W4.07, шаг 4.6): «Использование» — только метаданные control DB: места,
// объём файлов, подключённые модули, последние входы (17-users-and-billing «Использование»). Пороги сигналов —
// таблица документа (гипотеза): места = лимит — high, ≥ 85% — medium; хранилище ≥ 75% — medium, ≥ 95% — high;
// пробный период ≤ 14 дней — low; read_only — medium; suspended — medium; никто не входил > 7 дней — medium.
import type { components } from '@ortus/api-client';
import { createPlatform } from '@ortus/domain/seed';

import { plansOf, seatUsage } from '../billing/plans.ts';
import { brandMark } from '../branding/index.ts';
import { DOMAIN_TO_MODULE, INSTALLABLE_KEYS } from '../core/catalog.ts';
import { quotaBytes, tenantDto } from '../core/dto.ts';
import type { Registry } from '../core/registry.ts';
import type { ScenarioState, TenantRow } from '../core/state.ts';
import { DAY, iso } from '../core/time.ts';

type S = components['schemas'];
type Signal = S['PlatformUsageSignal'];

const KIND_ORDER: readonly Signal['kind'][] = [
  'seats_full',
  'seats_low',
  'storage_high',
  'trial_ending',
  'trial_expired',
  'suspended',
  'inactive',
];
const LEVEL_ORDER: readonly Signal['level'][] = ['high', 'medium', 'low'];
const STATUS_ORDER: readonly TenantRow['status'][] = [
  'provisioning',
  'trial',
  'active',
  'grace',
  'read_only',
  'suspended',
  'closing',
  'closed',
];

/** Подключаемые модули организации: из её БД, без неё — из сида платформы (modules.installations). */
function moduleKeys(s: ScenarioState, t: TenantRow): string[] {
  const org = s.orgs[t.id];
  if (org) {
    return INSTALLABLE_KEYS.filter((k) => {
      const st = org.modules[k]?.state;
      return st === 'active' || st === 'read_only' || st === 'draining';
    });
  }
  const seed = createPlatform().tenants.find((x) => x.id === t.proto);
  return (seed?.modules ?? []).flatMap((m) => {
    const k = DOMAIN_TO_MODULE[m];
    return k ? [k] : [];
  });
}

/** Членства организации, которые не завершены (счётчик «участники»). */
const memberCount = (s: ScenarioState, t: TenantRow): number =>
  s.memberships.filter((m) => m.tenantId === t.id && m.status !== 'ended').length;

/**
 * Tenant оператора (W4.07, возврат 1): тело W0.13 + места, участники, тариф и знак организации — те же значения,
 * что в строке «Использования» (списки организаций и карточка оператора, команды приостановки и возобновления).
 */
export function tenantView(s: ScenarioState, t: TenantRow): S['Tenant'] {
  return {
    ...tenantDto(s, t),
    seats: seatUsage(s, t),
    memberCount: memberCount(s, t),
    tierCode: t.subscription.planKey,
    brand: brandMark(s, t),
  };
}

function tenantRow(s: ScenarioState, t: TenantRow, now: string): S['PlatformUsageTenant'] {
  const ms = s.memberships.filter((m) => m.tenantId === t.id);
  const active = ms.filter((m) => m.status === 'active');
  const logins = active
    .map((m) => s.accounts.find((a) => a.id === m.accountId)?.lastLoginAt)
    // Входы «из будущего» сида (fillAccounts добирает время до вечера 01.10) — не позже «сейчас» сервера.
    .filter((x): x is string => Boolean(x) && (x as string) <= now);
  const weekAgo = iso(new Date(Date.parse(now) - 7 * DAY));
  const owner = ms.find((m) => m.owner && m.status === 'active');
  const ownerName = owner ? s.accounts.find((a) => a.id === owner.accountId)?.displayName : '';
  const row: S['PlatformUsageTenant'] = {
    tenantId: t.id,
    name: t.name,
    status: t.status,
    tierCode: t.subscription.planKey,
    seats: seatUsage(s, t),
    storageUsedBytes: t.storage.committedBytes,
    storageQuotaBytes: quotaBytes(t),
    moduleKeys: moduleKeys(s, t),
    memberCount: memberCount(s, t),
    activeMembers: active.length,
    activeMembers7d: logins.filter((at) => at >= weekAgo).length,
    brand: brandMark(s, t),
  };
  if (ownerName) row.ownerName = ownerName;
  const tier = plansOf(s)
    .versions.find((v) => v.version === plansOf(s).terms[t.id]?.priceVersion)
    ?.tiers.find((x) => x.code === t.subscription.planKey);
  if (tier) row.tierName = tier.name;
  const last = logins.sort().at(-1);
  if (last) row.lastSignInAt = last;
  return row;
}

function signals(s: ScenarioState, rows: S['PlatformUsageTenant'][], now: string): Signal[] {
  const out: Signal[] = [];
  for (const r of rows) {
    const t = s.tenants.find((x) => x.id === r.tenantId);
    if (!t || t.status === 'closed' || t.status === 'provisioning') continue;
    const base = { tenantId: r.tenantId, tenantName: r.name };
    const { limit, used } = r.seats;
    if (limit !== null && limit > 0 && used / limit >= 0.85) {
      const sig: Signal = {
        ...base,
        kind: used >= limit ? 'seats_full' : 'seats_low',
        level: used >= limit ? 'high' : 'medium',
        seatsUsed: used,
        seatsLimit: limit,
      };
      const pending = plansOf(s).requests.find(
        (x) => x.tenantId === t.id && x.status === 'pending',
      );
      if (pending) {
        sig.changeRequestId = pending.id;
        sig.changeRequestNumber = pending.number;
      }
      out.push(sig);
    }
    const share = r.storageQuotaBytes > 0 ? r.storageUsedBytes / r.storageQuotaBytes : 0;
    if (share >= 0.75) {
      out.push({
        ...base,
        kind: 'storage_high',
        level: share >= 0.95 ? 'high' : 'medium',
        storageUsedBytes: r.storageUsedBytes,
        storageQuotaBytes: r.storageQuotaBytes,
        storagePercent: Math.round(share * 100),
      });
    }
    const trialEndsAt = t.subscription.trialEndsAt;
    if (t.status === 'trial' && trialEndsAt && trialEndsAt > now) {
      const daysLeft = Math.floor((Date.parse(trialEndsAt) - Date.parse(now)) / DAY);
      if (daysLeft <= 14) {
        out.push({ ...base, kind: 'trial_ending', level: 'low', trialEndsAt, daysLeft });
      }
    }
    if (t.status === 'read_only') out.push({ ...base, kind: 'trial_expired', level: 'medium' });
    if (t.status === 'suspended') out.push({ ...base, kind: 'suspended', level: 'medium' });
    const idle = r.lastSignInAt
      ? Math.floor((Date.parse(now) - Date.parse(r.lastSignInAt)) / DAY)
      : undefined;
    if (idle === undefined || idle > 7) {
      const sig: Signal = { ...base, kind: 'inactive', level: 'medium' };
      if (idle !== undefined) sig.lastSignInDays = idle;
      out.push(sig);
    }
  }
  const by = <T>(order: readonly T[], x: T): number => order.indexOf(x);
  return out.sort(
    (a, b) =>
      by(LEVEL_ORDER, a.level) - by(LEVEL_ORDER, b.level) ||
      (a.tenantName < b.tenantName ? -1 : a.tenantName > b.tenantName ? 1 : 0) ||
      by(KIND_ORDER, a.kind) - by(KIND_ORDER, b.kind),
  );
}

export const usageHandlers: Registry = {
  getPlatformUsage: (ctx) => {
    const now = ctx.now();
    const rows = ctx.s.tenants
      .filter((t) => t.status !== 'closed')
      .map((t) => tenantRow(ctx.s, t, now));
    const sum = (f: (r: S['PlatformUsageTenant']) => number): number =>
      rows.reduce((n, r) => n + f(r), 0);
    const byModule = new Map<string, S['PlatformUsageTenant'][]>();
    for (const r of rows) {
      for (const k of r.moduleKeys) byModule.set(k, [...(byModule.get(k) ?? []), r]);
    }
    const body: S['PlatformUsage'] = {
      measuredAt: now,
      summary: {
        tenantCount: rows.length,
        tenantsByStatus: STATUS_ORDER.flatMap((status) => {
          const count = rows.filter((r) => r.status === status).length;
          return count ? [{ status, count }] : [];
        }),
        seatsUsed: sum((r) => r.seats.used),
        seatsSold: sum((r) => r.seats.limit ?? 0),
        storageUsedBytes: sum((r) => r.storageUsedBytes),
        storageQuotaBytes: sum((r) => r.storageQuotaBytes),
        activeMembers: sum((r) => r.activeMembers),
        activeMembers7d: sum((r) => r.activeMembers7d),
      },
      signals: signals(ctx.s, rows, now),
      modules: INSTALLABLE_KEYS.flatMap((moduleKey) => {
        const list = byModule.get(moduleKey) ?? [];
        return list.length
          ? [
              {
                moduleKey,
                tenantCount: list.length,
                seatsUsed: list.reduce((n, r) => n + r.seats.used, 0),
                storageUsedBytes: list.reduce((n, r) => n + r.storageUsedBytes, 0),
                tenants: list.map((r) => ({ tenantId: r.tenantId, name: r.name })),
              },
            ]
          : [];
      }),
      tenants: rows,
    };
    return { body };
  },
};
