// Тег Platform, контракт 0.4.0-stage1 (W1.00, S1-04): команды оператора с обязательной причиной —
// приостановка, возобновление, продление пробного периода — и журнал действий платформы (platform_audit).
// Журнал на старте — две строки эталона (пример listPlatformAuditEvents/ok, PD-43); команды добавляют строки
// в состояние сервера (`platformAudit`, JSON — переживает перезагрузку вкладки, как остальное состояние).
import type { components } from '@ortus/api-client';

import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { TenantRow } from '../core/state.ts';
import { addMs, DAY } from '../core/time.ts';
import { auditOf } from './audit.ts';
import { platformActions } from './roles.ts';
import { tenantView } from './usage.ts';

type S = components['schemas'];

const REASON = { reason: 'Причина обязательна: от 5 до 500 символов' } as const;

/** Право на строку журнала по типу цели (listPlatformAuditEvents; Go — operators.targetPermission). */
const TARGET_PERMISSION: Readonly<Record<string, string>> = {
  tenant: 'platform.tenants.read',
  subscription: 'platform.tenants.read',
  account: 'platform.users.read',
  operator: 'platform.operators.manage',
  price_book: 'platform.pricing.manage',
};
const SUSPENDABLE = new Set<TenantRow['status']>(['trial', 'active', 'grace', 'read_only']);
const EXTENDABLE = new Set<S['Subscription']['status']>(['trialing', 'grace', 'read_only']);

/** Статус организации после возобновления — по статусу подписки (как updatePlatformSubscription). */
const STATUS_BY_SUBSCRIPTION: Partial<Record<S['Subscription']['status'], TenantRow['status']>> = {
  trialing: 'trial',
  active: 'active',
  grace: 'grace',
  past_due: 'grace',
  read_only: 'read_only',
};

// Журнал в состоянии сервера — platform/audit.ts (возврат 1 W4.07: его пишут и команды владельца).

const tenantById = (ctx: HandlerContext): TenantRow =>
  ctx.s.tenants.find((t) => t.id === ctx.params.tenantId?.toLowerCase()) ?? fail('not_found');

function audit(
  ctx: HandlerContext,
  action: string,
  t: TenantRow,
  reason: string,
  details: Record<string, string>,
): void {
  const rows = auditOf(ctx.s);
  const next = rows.reduce((n, r) => Math.max(n, Number(r.id)), 0) + 1;
  const actor = ctx.actor;
  rows.push({
    id: String(next),
    at: ctx.now(),
    action,
    actor: actor
      ? { kind: 'operator', accountId: actor.id, displayName: actor.displayName }
      : { kind: 'system' },
    // subscription.* меняют подписку (PlatformAuditTarget): цель subscription, её id контракт не раскрывает.
    target: action.startsWith('subscription.')
      ? { type: 'subscription', tenantId: t.id, name: t.name }
      : { type: 'tenant', id: t.id, tenantId: t.id, name: t.name },
    reason,
    result: 'ok',
    details,
  });
}

export const operatorHandlers: Registry = {
  suspendPlatformTenant: {
    messages: REASON,
    run: (ctx) => {
      const t = tenantById(ctx);
      const b = ctx.body as S['TenantStatusChange'];
      ctx.revision(t.revision);
      if (t.status === 'suspended') fail('invalid_transition', 'Организация уже приостановлена.');
      if (!SUSPENDABLE.has(t.status)) {
        fail('invalid_transition', 'Организацию в этом состоянии нельзя приостановить.');
      }
      const from = t.status;
      t.status = 'suspended';
      t.revision++;
      audit(ctx, 'tenant.suspended', t, b.reason, { fromStatus: from, toStatus: t.status });
      return { body: tenantView(ctx.s, t) };
    },
  },

  resumePlatformTenant: {
    messages: REASON,
    run: (ctx) => {
      const t = tenantById(ctx);
      const b = ctx.body as S['TenantStatusChange'];
      ctx.revision(t.revision);
      if (t.status !== 'suspended') fail('invalid_transition', 'Организация не приостановлена.');
      t.status = STATUS_BY_SUBSCRIPTION[t.subscription.status] ?? 'active';
      t.revision++;
      audit(ctx, 'tenant.resumed', t, b.reason, { fromStatus: 'suspended', toStatus: t.status });
      return { body: tenantView(ctx.s, t) };
    },
  },

  extendPlatformTrial: {
    messages: REASON,
    run: (ctx) => {
      const t = tenantById(ctx);
      const b = ctx.body as S['TrialExtension'];
      const prev = t.subscription;
      ctx.revision(prev.revision);
      if (!EXTENDABLE.has(prev.status)) {
        fail('invalid_transition', 'Подписка оплачена: пробный период не продлевается.');
      }
      const now = ctx.now();
      const base = prev.trialEndsAt && prev.trialEndsAt > now ? prev.trialEndsAt : now;
      const next: S['Subscription'] = {
        ...structuredClone(prev),
        status: 'trialing',
        trialEndsAt: addMs(base, b.days * DAY),
        revision: prev.revision + 1,
      };
      delete next.graceEndsAt;
      t.subscription = next;
      if (t.status === 'grace' || t.status === 'read_only') {
        t.status = 'trial';
        t.revision++;
      }
      audit(ctx, 'subscription.trial_extended', t, b.reason, {
        days: String(b.days),
        trialEndsAt: next.trialEndsAt ?? '',
      });
      return { body: structuredClone(next) };
    },
  },

  // Строки account, operator, price_book видны по праву на тип цели (описание операции); у операторов
  // режима mock все права платформы, поэтому фильтр по типу цели здесь ничего не скрывает.
  listPlatformAuditEvents: (ctx) => {
    const tenantId = uuidParam(ctx.query, 'tenantId', false);
    if (tenantId && !ctx.s.tenants.some((t) => t.id === tenantId)) fail('not_found');
    // Строки — по праву роли на тип цели (контракт; W4.07, возврат 2 — роли операторов на шлюзе).
    const role = ctx.actor?.kind === 'operator' ? ctx.actor.operator.role : '';
    const rights = platformActions(role);
    const items = auditOf(ctx.s)
      .filter((r) => rights.has(TARGET_PERMISSION[r.target.type] ?? 'platform.tenants.read'))
      .filter((r) => !tenantId || r.target.tenantId === tenantId)
      .sort((a, b) => Number(b.id) - Number(a.id));
    return { body: page(structuredClone(items), ctx.query) };
  },
};
