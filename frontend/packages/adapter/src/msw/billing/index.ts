// Тег Billing (W0.13): подписка и место организации глазами владельца. Тарифная сетка — версия 2 сида
// домена W0.12 (modules/platform/seed.ts: «Старт» 10, «Команда» 25, «Бизнес» 50, «Сеть» 100 мест,
// «Безлимит» — по запросу). Расширение места — 10 ₽ за ГБ в месяц (пример requestStorageChange/ok).
import type { components } from '@ortus/api-client';

import { quotaBytes, storageUsageDto } from '../core/dto.ts';
import { subscriptionWithTerms } from './plans.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { seatsUsed, type TenantRow } from '../core/state.ts';
import { addMs, DAY, HOUR, mskDayPlusMonths } from '../core/time.ts';

type S = components['schemas'];

const GiB = 1024 ** 3;
const PRICE_BOOK = 2;
const STORAGE_PRICE_MINOR_PER_GB = 1000;

/** Тарифы и число мест (null — без лимита). */
export const TIERS: Readonly<Record<string, { name: string; seats: number | null }>> = {
  start: { name: 'Старт', seats: 10 },
  team: { name: 'Команда', seats: 25 },
  biz: { name: 'Бизнес', seats: 50 },
  net: { name: 'Сеть', seats: 100 },
  unl: { name: 'Безлимит', seats: null },
};

/** Права подписки тарифа: места и квота (квота не меняется сменой тарифа). */
export function planEntitlements(
  planKey: string,
  source: S['Entitlement']['sourceType'],
  quota: number,
): S['Entitlement'][] {
  const sourceRef = `price-book:v${PRICE_BOOK}:${planKey}`;
  const seats = TIERS[planKey]?.seats ?? 1_000_000;
  return [
    { key: 'seats', sourceType: source, sourceRef, value: seats },
    { key: 'storage_quota_bytes', sourceType: source, sourceRef, value: quota },
  ];
}

const tenantOf = (ctx: HandlerContext): TenantRow => ctx.org().tenant;

/** «46,2» — ГБ с одной цифрой после запятой, целые без дробной части. */
export const gbText = (bytes: number): string =>
  String(Math.round((bytes / GiB) * 10) / 10).replace('.', ',');

function changePlan(ctx: HandlerContext, t: TenantRow, planKey: string | undefined): void {
  const tier = planKey ? TIERS[planKey] : undefined;
  if (!planKey || !tier) {
    fail('validation_failed', 'Выберите тариф из тарифной сетки.', {
      violations: [{ field: 'planKey', code: 'enum', message: 'Нет такого тарифа' }],
    });
  }
  const used = seatsUsed(ctx.org().org);
  if (tier.seats !== null && tier.seats < used) {
    fail('tier_below_usage', `В тарифе «${tier.name}» ${tier.seats} мест, а занято ${used}.`);
  }
  const sub = t.subscription;
  const next: S['Subscription'] = {
    planKey,
    status: 'active',
    cancelAtPeriodEnd: false,
    entitlements: planEntitlements(planKey, 'plan', quotaBytes(t)),
    revision: sub.revision + 1,
    periodEndsAt: mskDayPlusMonths(ctx.now(), 12),
  };
  t.subscription = next;
  if (t.status === 'trial' || t.status === 'read_only' || t.status === 'grace') {
    t.status = 'active';
    t.revision++;
  }
}

export const billingHandlers: Registry = {
  // W4.07: условия оплаченного периода и места (Subscription.tierCode … seats) — billing/plans.ts.
  getTenantSubscription: (ctx) => ({ body: subscriptionWithTerms(ctx.s, tenantOf(ctx)) }),

  requestSubscriptionChange: (ctx) => {
    const t = tenantOf(ctx);
    const b = ctx.body as S['SubscriptionChange'];
    ctx.revision(t.subscription.revision);
    const sub = t.subscription;
    switch (b.action) {
      case 'change_plan':
        changePlan(ctx, t, b.planKey);
        break;
      case 'start_trial':
        if (sub.status !== 'read_only' && sub.status !== 'cancelled') {
          fail('invalid_transition', 'Пробный период уже идёт или тариф оплачен.');
        }
        sub.status = 'trialing';
        sub.trialEndsAt = addMs(ctx.now(), 14 * DAY);
        sub.revision++;
        break;
      case 'cancel_at_period_end':
        if (sub.status !== 'active')
          fail('invalid_transition', 'Отменить можно только оплаченный тариф.');
        sub.cancelAtPeriodEnd = true;
        sub.revision++;
        break;
      case 'resume':
        if (!sub.cancelAtPeriodEnd) fail('invalid_transition', 'Отмена не запланирована.');
        sub.cancelAtPeriodEnd = false;
        sub.revision++;
        break;
    }
    return { body: structuredClone(t.subscription) };
  },

  getStorageUsage: (ctx) => ({ body: storageUsageDto(tenantOf(ctx)) }),

  requestStorageChange: (ctx) => {
    const t = tenantOf(ctx);
    const b = ctx.body as S['StorageChangeRequest'];
    const used = t.storage.committedBytes;
    if (b.requestedQuotaBytes < used) {
      fail(
        'downgrade_below_usage',
        `Новая квота ${gbText(b.requestedQuotaBytes)} ГБ меньше занятых ${gbText(used)} ГБ. ` +
          `Освободите ${gbText(used - b.requestedQuotaBytes)} ГБ.`,
      );
    }
    if (b.mode === 'quote') {
      const row = {
        id: ctx.newId(),
        state: 'quoted' as const,
        requestedQuotaBytes: b.requestedQuotaBytes,
        quoteId: ctx.newId(),
        quoteExpiresAt: addMs(ctx.now(), HOUR),
        recurringCharge: {
          amountMinor: Math.round(b.requestedQuotaBytes / GiB) * STORAGE_PRICE_MINOR_PER_GB,
          currency: 'RUB',
        },
      };
      t.storageChanges.push(row);
      return { status: 201, body: structuredClone(row) };
    }
    const quote = t.storageChanges.find(
      (c) => c.quoteId === b.acceptedQuoteId && c.state === 'quoted',
    );
    if (!quote || quote.requestedQuotaBytes !== b.requestedQuotaBytes) {
      fail('validation_failed', 'Подтвердите действующий расчёт.', {
        violations: [{ field: 'acceptedQuoteId', code: 'unknown', message: 'Расчёт не найден' }],
      });
    }
    if (ctx.now() >= quote.quoteExpiresAt) fail('invalid_transition', 'Срок расчёта истёк.');
    quote.state = 'applied';
    quote.effectiveAt = ctx.now();
    for (const e of t.subscription.entitlements) {
      if (e.key === 'storage_quota_bytes') e.value = b.requestedQuotaBytes;
    }
    t.subscription.revision++;
    const body: S['StorageChange'] = {
      id: quote.id,
      state: 'applied',
      requestedQuotaBytes: quote.requestedQuotaBytes,
      effectiveAt: quote.effectiveAt,
      quoteId: quote.quoteId,
      recurringCharge: quote.recurringCharge,
    };
    return { status: 201, body };
  },
};
