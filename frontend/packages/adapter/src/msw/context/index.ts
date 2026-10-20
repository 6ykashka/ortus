// Тег Context (W0.13): GET /me/context (getMyContext), переключатель организации (selectTenant) и входящие
// (listMyNotifications, getMyNotificationSummary, markMyNotificationsRead). Контекст строится как в mehttp
// W0.09: видимые членства (active, suspended) организаций, которые не скрыты; возможности и доступность модулей
// — у активного членства организации с данными. Порядок организаций — порядок членств аккаунта (примеры W0.07).
import type { components } from '@ortus/api-client';

import { brandingTheme } from '../branding/index.ts';
import { capabilities, moduleAvailability, type TenantAccess } from '../core/access.ts';
import { notificationDto, storageUsageDto } from '../core/dto.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { Actor } from '../core/session.ts';
import { type MembershipRow, type ScenarioState, SEED_NOW } from '../core/state.ts';

type S = components['schemas'];

const HIDDEN = new Set(['provisioning', 'closing', 'closed']);
const ENRICHED = new Set(['trial', 'active', 'grace', 'read_only']);

/** Доступ участника к организации членства (как собирает шлюз). */
export function accessOf(s: ScenarioState, m: MembershipRow): TenantAccess | undefined {
  const tenant = s.tenants.find((t) => t.id === m.tenantId);
  const org = s.orgs[m.tenantId];
  if (!tenant || !org) return undefined;
  const member = org.members.find((x) => x.id === m.memberId);
  return {
    tenant,
    org,
    membership: m,
    member,
    owner: m.owner,
    readOnly: tenant.status === 'read_only' || tenant.status === 'grace',
  };
}

/** Видимые членства аккаунта: у организации есть данные, она не скрыта, членство активно или приостановлено. */
export function visibleMemberships(s: ScenarioState, accountId: string): TenantAccess[] {
  return s.memberships
    .filter((m) => m.accountId === accountId && (m.status === 'active' || m.status === 'suspended'))
    .map((m) => accessOf(s, m))
    .filter((t): t is TenantAccess => !!t && !HIDDEN.has(t.tenant.status));
}

/** Состояние организации для баннеров оболочки (0.4.0-stage1, W1.00, S1-19): статус, сроки, запись. */
function tenantState(t: TenantAccess): S['TenantState'] {
  const sub = t.tenant.subscription;
  const out: S['TenantState'] = {
    status: t.tenant.status,
    storageWriteStatus: storageUsageDto(t.tenant).writeStatus,
  };
  if (t.tenant.status === 'trial' && sub.trialEndsAt) out.trialEndsAt = sub.trialEndsAt;
  if (t.tenant.status === 'grace' && sub.graceEndsAt) out.graceEndsAt = sub.graceEndsAt;
  return out;
}

function tenantContext(s: ScenarioState, t: TenantAccess, now: string): S['TenantContext'] {
  const base: S['TenantContext'] = {
    tenantId: t.tenant.id,
    name: t.tenant.name,
    membershipId: t.membership.id,
    membershipStatus: t.membership.status === 'suspended' ? 'suspended' : 'active',
    orgUnitIds: [],
    modules: [],
    capabilities: [],
    tenantState: tenantState(t),
    // W4.07: действующее оформление — одно на всех участников (18-branding «Заметки по реализации»); возврат 2 —
    // тема без автора версии (BrandingTheme).
    branding: brandingTheme(s, t.tenant),
  };
  if (t.membership.status !== 'active' || !ENRICHED.has(t.tenant.status)) return base;
  const caps = capabilities(t, now);
  const keys = [...new Set(caps.map((c) => c.permission))];
  return { ...base, modules: moduleAvailability(t, keys), capabilities: caps };
}

/** Непрозрачная версия прав: момент сида и сумма изменений политики видимых организаций. */
const permissionVersion = (ts: TenantAccess[]): string =>
  `${SEED_NOW}.${1 + ts.reduce((n, t) => n + t.org.policyVersion - 1, 0)}`;

/** MeContext субъекта (оператор — без организаций). */
export function meContext(s: ScenarioState, actor: Actor, now: string): S['MeContext'] {
  if (actor.kind === 'operator') {
    return {
      userId: actor.id,
      displayName: actor.displayName,
      platformOperator: true,
      tenants: [],
      permissionVersion: permissionVersion([]),
    };
  }
  const visible = visibleMemberships(s, actor.id);
  const out: S['MeContext'] = {
    userId: actor.id,
    displayName: actor.displayName,
    platformOperator: false,
    tenants: visible.map((t) => tenantContext(s, t, now)),
    permissionVersion: permissionVersion(visible.filter((t) => t.membership.status === 'active')),
  };
  if (actor.account.lastTenantId) out.lastTenantId = actor.account.lastTenantId;
  return out;
}

const NOT_MINE = 'Организация не найдена среди ваших.';

/** Активное членство субъекта в организации с данными или 404. */
function mine(ctx: HandlerContext, tenantId: string): TenantAccess {
  const actor = ctx.user();
  const t = visibleMemberships(ctx.s, actor.id).find(
    (x) => x.tenant.id === tenantId && x.membership.status === 'active',
  );
  return t ?? fail('not_found', NOT_MINE);
}

const unread = (ctx: HandlerContext, t: TenantAccess) =>
  t.org.notifications.filter((n) => n.accountId === ctx.user().id && n.readAt === null);

export const contextHandlers: Registry = {
  getMyContext: (ctx) => {
    const actor = ctx.actor ?? fail('session_expired');
    return { body: meContext(ctx.s, actor, ctx.now()) };
  },

  selectTenant: (ctx) => {
    const actor = ctx.user();
    const t = mine(ctx, String(ctx.body.tenantId).toLowerCase());
    actor.account.lastTenantId = t.tenant.id;
    return { body: meContext(ctx.s, actor, ctx.now()) };
  },

  listMyNotifications: (ctx) => {
    const tenantId = uuidParam(ctx.query, 'tenantId') ?? '';
    const filter = ctx.query.get('filter') ?? 'all';
    if (filter !== 'all' && filter !== 'unread') fail('malformed_request');
    const t = mine(ctx, tenantId);
    const me = ctx.user().id;
    const items = t.org.notifications
      .filter((n) => n.accountId === me && (filter === 'all' || n.readAt === null))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((n) => notificationDto(t.tenant.id, n));
    return { body: { ...page(items, ctx.query), unreadCount: unread(ctx, t).length } };
  },

  getMyNotificationSummary: (ctx) => {
    const me = ctx.user().id;
    const tenants = visibleMemberships(ctx.s, me)
      .filter((t) => t.membership.status === 'active')
      .map((t) => {
        const mineAll = t.org.notifications.filter((n) => n.accountId === me);
        const latest =
          mineAll
            .map((n) => n.createdAt)
            .sort()
            .at(-1) ?? null;
        return { tenantId: t.tenant.id, unreadCount: unread(ctx, t).length, latestAt: latest };
      });
    const totalUnread = tenants.reduce((n, t) => n + t.unreadCount, 0);
    return { body: { totalUnread, tenants } };
  },

  markMyNotificationsRead: {
    run: (ctx) => {
      const b = ctx.body as S['NotificationReadRequest'];
      if (b.notificationIds && b.upTo) {
        fail('validation_failed', undefined, {
          violations: [
            { field: 'upTo', code: 'exclusive', message: 'Нельзя вместе с notificationIds' },
          ],
        });
      }
      const t = mine(ctx, b.tenantId.toLowerCase());
      const ids = new Set(b.notificationIds ?? []);
      for (const n of unread(ctx, t)) {
        if (b.upTo ? n.createdAt <= b.upTo : ids.has(n.id)) n.readAt = ctx.now();
      }
      return { body: { tenantId: t.tenant.id, unreadCount: unread(ctx, t).length } };
    },
  },
};
