// Тег Platform (W0.13): «Ортус · Платформа» для операторов — организации, каталог аккаунтов, подписки.
// Не оператору шлюз отвечает 404 (как cmd/api W0.09). Новая организация — в состоянии provisioning:
// провижининг (W1.02) в режиме mock не выполняется.
import type { components } from '@ortus/api-client';

import { planEntitlements, TIERS } from '../billing/index.ts';
import { subscriptionWithTerms } from '../billing/plans.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { TenantRow } from '../core/state.ts';
import { addMs, DAY } from '../core/time.ts';
import { tenantView } from './usage.ts';

type S = components['schemas'];

const GiB = 1024 ** 3;
const TRIAL_DAYS = 14;
const DEFAULT_QUOTA = 100 * GiB;

const tenantById = (ctx: HandlerContext): TenantRow =>
  ctx.s.tenants.find((t) => t.id === ctx.params.tenantId?.toLowerCase()) ?? fail('not_found');

/** Статус организации по статусу подписки (если организация не приостановлена оператором). */
const STATUS_BY_SUBSCRIPTION: Partial<Record<S['Subscription']['status'], TenantRow['status']>> = {
  trialing: 'trial',
  active: 'active',
  grace: 'grace',
  read_only: 'read_only',
  past_due: 'grace',
};

const reasonRequired = (field = 'reason'): never =>
  fail('validation_failed', 'Укажите причину изменения.', {
    violations: [{ field, code: 'required', message: 'Причина обязательна: от 5 до 500 символов' }],
  });

export const platformHandlers: Registry = {
  listPlatformTenants: (ctx) => ({
    body: page(
      ctx.s.tenants.map((t) => tenantView(ctx.s, t)),
      ctx.query,
    ),
  }),

  createPlatformTenant: {
    messages: { ownerEmail: 'Укажите почту владельца' },
    run: (ctx) => {
      const b = ctx.body as S['TenantCreate'];
      if (!TIERS[b.planKey]) {
        fail('validation_failed', 'Проверьте поля формы.', {
          violations: [{ field: 'planKey', code: 'enum', message: 'Нет такого тарифа' }],
        });
      }
      const id = ctx.newId('platform');
      const row: TenantRow = {
        id,
        proto: `t-new-${ctx.s.seq}`,
        name: b.name.trim(),
        status: 'provisioning',
        createdAt: ctx.now(),
        revision: 1,
        subscription: {
          planKey: b.planKey,
          status: 'trialing',
          trialEndsAt: addMs(ctx.now(), TRIAL_DAYS * DAY),
          cancelAtPeriodEnd: false,
          entitlements: planEntitlements(b.planKey, 'trial', DEFAULT_QUOTA),
          revision: 1,
        },
        storage: {
          committedBytes: 0,
          reservedBytes: 0,
          buckets: { attachments: 0, database: 0, versions: 0, trash: 0 },
          measuredAt: ctx.now(),
        },
        storageChanges: [],
      };
      ctx.s.tenants.push(row);
      return { status: 201, body: tenantView(ctx.s, row) };
    },
  },

  getPlatformTenant: (ctx) => ({ body: tenantView(ctx.s, tenantById(ctx)) }),

  updatePlatformTenant: (ctx) => {
    const t = tenantById(ctx);
    const b = ctx.body as S['TenantPatch'];
    ctx.revision(t.revision);
    if (b.status && b.status !== t.status && !b.reason) reasonRequired();
    if (b.name) t.name = b.name.trim();
    if (b.status) t.status = b.status;
    t.revision++;
    return { body: tenantView(ctx.s, t) };
  },

  // listPlatformUsers — platform/accounts.ts (W4.07: поиск, организация, фильтры, второй фактор, блокировка).

  // W4.07 (возврат 1): условия оплаченного периода и места, как у владельца (getTenantSubscription).
  getPlatformSubscription: (ctx) => ({ body: subscriptionWithTerms(ctx.s, tenantById(ctx)) }),

  updatePlatformSubscription: {
    messages: { reason: 'Причина обязательна: от 5 до 500 символов' },
    run: (ctx) => {
      const t = tenantById(ctx);
      const b = ctx.body as S['PlatformSubscriptionUpdate'];
      ctx.revision(t.subscription.revision);
      const prev = t.subscription;
      const quota =
        prev.entitlements.filter((e) => e.key === 'storage_quota_bytes').at(-1)?.value ??
        DEFAULT_QUOTA;
      const base =
        b.planKey === prev.planKey
          ? prev.entitlements.filter((e) => e.sourceType !== 'manual')
          : planEntitlements(b.planKey, b.status === 'trialing' ? 'trial' : 'plan', quota);
      const next: S['Subscription'] = {
        planKey: b.planKey,
        status: b.status,
        cancelAtPeriodEnd: b.cancelAtPeriodEnd,
        entitlements: [
          ...base,
          ...b.manualEntitlements.map((e) => ({ ...e, sourceType: 'manual' as const })),
        ],
        revision: prev.revision + 1,
      };
      if (b.trialEndsAt) next.trialEndsAt = b.trialEndsAt;
      if (b.periodEndsAt) next.periodEndsAt = b.periodEndsAt;
      if (b.graceEndsAt) next.graceEndsAt = b.graceEndsAt;
      t.subscription = next;
      const status = STATUS_BY_SUBSCRIPTION[b.status];
      if (
        status &&
        t.status !== 'suspended' &&
        t.status !== 'provisioning' &&
        status !== t.status
      ) {
        t.status = status;
        t.revision++;
      }
      return { body: structuredClone(next) };
    },
  },
};
