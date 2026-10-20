// Тег Platform, контракт 0.8.0-stage4 (W4.07, шаг 4.6): каталог аккаунтов оператора (поиск, организация,
// фильтры со счётчиками, участия, второй фактор, блокировка входа с причиной) и операторы системной организации
// «Ортус · Платформа» (17-users-and-billing «Каталог пользователей у оператора», «Организация платформы»).
// Второй фактор, блокировка и сведения операторов, которых нет в строках состояния W0.13, лежат в состоянии
// сервера (`platformPeople`, JSON) и на старте строятся из сида домена W0.12 (`createPlatform()`).
import type { components } from '@ortus/api-client';
import { createPlatform, seedUuid } from '@ortus/domain/seed';

import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { AccountRow, OperatorRow, ScenarioState } from '../core/state.ts';
import { iso, mskEndOfDay, mskStamp } from '../core/time.ts';
import { audit } from './audit.ts';

type S = components['schemas'];

const P = (id: string): string => seedUuid('platform', id);

/** Домен почты операторов платформы (realm ortus-operators). */
export const OPERATOR_DOMAIN = 'ortus.example';

/** Момент блокировки входа заблокированных аккаунтов сида (в сиде его нет; после последнего входа). */
export const SEED_LOCKED_AT = '2026-09-18T21:10:00Z';

interface AccountExt {
  mfa: boolean;
  lockedAt?: string;
  lockReason?: string;
}

interface OperatorExt {
  mfa?: 'totp' | 'webauthn';
  lastSeenAt?: string;
  disabledAt?: string;
  disabledReason?: string;
  revision: number;
}

interface PeopleState {
  accounts: Record<string, AccountExt>;
  operators: Record<string, OperatorExt>;
}

type WithPeople = ScenarioState & { platformPeople?: PeopleState };

const MFA: Readonly<Record<string, OperatorExt['mfa']>> = {
  'аппаратный ключ': 'webauthn',
  приложение: 'totp',
};

/** «Отключён 15.08: …» → начало этих суток по Москве. */
function disabledAt(note: string | undefined): string | undefined {
  const m = /(\d{2})\.(\d{2})/.exec(note ?? '');
  const end = m ? mskEndOfDay(`${m[1]}.${m[2]}.2026`) : undefined;
  return end ? iso(new Date(Date.parse(end) - 86_400_000)) : undefined;
}

function seedPeople(): PeopleState {
  const P0 = createPlatform();
  const accounts: Record<string, AccountExt> = {};
  for (const a of P0.accounts) {
    const ext: AccountExt = { mfa: a.mfa };
    if (a.status === 'locked') {
      ext.lockedAt = SEED_LOCKED_AT;
      if (a.lockReason) ext.lockReason = a.lockReason;
    }
    accounts[P(a.id)] = ext;
  }
  const operators: Record<string, OperatorExt> = {};
  for (const o of P0.operators) {
    const ext: OperatorExt = { revision: 1 };
    const mfa = o.mfa ? MFA[o.mfa] : undefined;
    if (mfa) ext.mfa = mfa;
    const seen = mskStamp(o.lastLogin);
    if (seen) ext.lastSeenAt = seen;
    if (o.status === 'disabled') {
      const at = disabledAt(o.disabledNote);
      if (at) ext.disabledAt = at;
      if (o.disabledNote) ext.disabledReason = o.disabledNote;
    }
    operators[P(o.id)] = ext;
  }
  return { accounts, operators };
}

/** Состояние каталога шага 4.6 (на старте — из сида домена). */
export function peopleOf(s: ScenarioState): PeopleState {
  const x = s as WithPeople;
  x.platformPeople ??= seedPeople();
  return x.platformPeople;
}

const accountExt = (s: ScenarioState, id: string): AccountExt =>
  (peopleOf(s).accounts[id] ??= { mfa: false });
const operatorExt = (s: ScenarioState, id: string): OperatorExt =>
  (peopleOf(s).operators[id] ??= { revision: 1 });

const STATUS: Readonly<Record<AccountRow['status'], S['PlatformUser']['status']>> = {
  active: 'active',
  pending: 'invited',
  locked: 'suspended',
};

const liveMemberships = (s: ScenarioState, accountId: string) =>
  s.memberships.filter((m) => m.accountId === accountId && m.status !== 'ended');

/** Строка каталога; `card` — с участиями (getPlatformUser и команды). */
export function platformUser(s: ScenarioState, a: AccountRow, card = false): S['PlatformUser'] {
  const ext = accountExt(s, a.id);
  const u: S['PlatformUser'] = {
    id: a.id,
    displayName: a.displayName,
    email: a.email,
    status: STATUS[a.status],
    tenantCount: liveMemberships(s, a.id).length,
    mfaEnabled: ext.mfa,
  };
  if (a.lastLoginAt) u.lastSeenAt = a.lastLoginAt;
  if (a.status === 'locked' && ext.lockedAt) {
    u.lockedAt = ext.lockedAt;
    if (ext.lockReason) u.lockReason = ext.lockReason;
  }
  if (card) {
    u.memberships = s.memberships
      .filter((m) => m.accountId === a.id)
      .flatMap((m) => {
        const t = s.tenants.find((x) => x.id === m.tenantId);
        return t
          ? [
              {
                tenantId: t.id,
                tenantName: t.name,
                tenantStatus: t.status,
                status: m.status,
                owner: m.owner,
              },
            ]
          : [];
      });
  }
  return u;
}

const FILTERS = new Set(['multi_tenant', 'no_mfa', 'locked', 'never_signed_in']);

type Filter = 'multi_tenant' | 'no_mfa' | 'locked' | 'never_signed_in';

function matches(s: ScenarioState, a: AccountRow, f: Filter): boolean {
  switch (f) {
    case 'multi_tenant':
      return liveMemberships(s, a.id).length > 1;
    case 'no_mfa':
      return a.status === 'active' && !accountExt(s, a.id).mfa;
    case 'locked':
      return a.status === 'locked';
    case 'never_signed_in':
      return !a.lastLoginAt;
  }
}

const accountById = (ctx: HandlerContext): AccountRow =>
  ctx.s.accounts.find((a) => a.id === ctx.params.accountId?.toLowerCase()) ?? fail('not_found');

/** Сессии аккаунта завершаются сразу (блокировка входа, отключение оператора). */
function endSessions(s: ScenarioState, accountId: string): void {
  for (const [id, row] of Object.entries(s.sessions)) {
    if (row.accountId === accountId) Reflect.deleteProperty(s.sessions, id);
  }
}

const accountTarget = (a: AccountRow): S['PlatformAuditTarget'] => ({
  type: 'account',
  id: a.id,
  name: a.email,
});

// ---------------------------------------------------------------------------------------------
// Операторы

export function operatorDto(
  s: ScenarioState,
  o: OperatorRow,
  actorId: string | undefined,
): S['PlatformOperator'] {
  const ext = operatorExt(s, o.id);
  const dto: S['PlatformOperator'] = {
    id: o.id,
    accountId: o.accountId,
    displayName: o.displayName,
    email: o.email,
    role: o.role as S['PlatformOperator']['role'],
    status: o.status,
    me: o.accountId === actorId,
    revision: ext.revision,
  };
  if (ext.mfa) dto.mfa = ext.mfa;
  if (ext.lastSeenAt) dto.lastSeenAt = ext.lastSeenAt;
  if (ext.disabledAt) dto.disabledAt = ext.disabledAt;
  if (ext.disabledReason) dto.disabledReason = ext.disabledReason;
  return dto;
}

const activeOwners = (s: ScenarioState): number =>
  s.operators.filter((o) => o.role === 'owner' && o.status === 'active').length;

const operatorById = (ctx: HandlerContext): OperatorRow =>
  ctx.s.operators.find((o) => o.id === ctx.params.operatorId?.toLowerCase()) ?? fail('not_found');

const operatorTarget = (o: OperatorRow): S['PlatformAuditTarget'] => ({
  type: 'operator',
  id: o.id,
  name: o.email,
});

const ROLE_OWNER_FIELD = {
  violations: [
    {
      field: 'role',
      code: 'owner_requires_active_mfa',
      message: 'Владельцем может стать только активный оператор со вторым фактором',
    },
  ],
};

function changeRole(ctx: HandlerContext, o: OperatorRow, role: string): void {
  if (role === o.role) return;
  if (role === 'owner' && (o.status !== 'active' || !operatorExt(ctx.s, o.id).mfa)) {
    fail('validation_failed', undefined, ROLE_OWNER_FIELD);
  }
  if (o.role === 'owner' && o.status === 'active' && activeOwners(ctx.s) <= 1) {
    fail('last_owner_required');
  }
  const from = o.role;
  o.role = role;
  audit(ctx, 'operator.role_changed', operatorTarget(o), { from, to: role });
}

function setActive(ctx: HandlerContext, o: OperatorRow, active: boolean, reason?: string): void {
  const ext = operatorExt(ctx.s, o.id);
  if (active) {
    if (o.status !== 'disabled') fail('invalid_transition', 'Оператор уже работает.');
    o.status = 'active';
    delete ext.disabledAt;
    delete ext.disabledReason;
    audit(ctx, 'operator.enabled', operatorTarget(o));
    return;
  }
  if (o.status === 'disabled') fail('invalid_transition', 'Оператор уже отключён.');
  if (o.role === 'owner' && o.status === 'active' && activeOwners(ctx.s) <= 1) {
    fail('last_owner_required');
  }
  const invited = o.status === 'invited';
  o.status = 'disabled';
  ext.disabledAt = ctx.now();
  if (reason) ext.disabledReason = reason;
  endSessions(ctx.s, o.accountId);
  audit(
    ctx,
    invited ? 'operator.invitation_revoked' : 'operator.disabled',
    operatorTarget(o),
    {},
    reason,
  );
  // Отзыв приглашения удаляет строку (platform_operators): ответ — последнее состояние оператора.
  if (invited) ctx.s.operators = ctx.s.operators.filter((x) => x !== o);
}

export const accountsHandlers: Registry = {
  listPlatformUsers: (ctx) => {
    const q = ctx.query.get('q')?.trim().toLowerCase();
    if (q !== undefined && (q.length < 1 || q.length > 100)) fail('malformed_request');
    const tenantId = uuidParam(ctx.query, 'tenantId', false);
    if (tenantId && !ctx.s.tenants.some((t) => t.id === tenantId)) fail('not_found');
    const filter = ctx.query.get('filter');
    if (filter !== null && !FILTERS.has(filter)) fail('malformed_request');
    const base = ctx.s.accounts.filter((a) => {
      if (tenantId && !liveMemberships(ctx.s, a.id).some((m) => m.tenantId === tenantId)) {
        return false;
      }
      if (!q) return true;
      const names = ctx.s.memberships
        .filter((m) => m.accountId === a.id)
        .map((m) => ctx.s.tenants.find((t) => t.id === m.tenantId)?.name ?? '');
      return [a.displayName, a.email, ...names].some((x) => x.toLowerCase().includes(q));
    });
    const count = (f: Filter): number => base.filter((a) => matches(ctx.s, a, f)).length;
    const counts: S['PlatformUserCounts'] = {
      all: base.length,
      multiTenant: count('multi_tenant'),
      noMfa: count('no_mfa'),
      locked: count('locked'),
      neverSignedIn: count('never_signed_in'),
    };
    const items = base
      .filter((a) => !filter || matches(ctx.s, a, filter as Filter))
      .map((a) => platformUser(ctx.s, a));
    return { body: { ...page(items, ctx.query), counts } };
  },

  getPlatformUser: (ctx) => ({ body: platformUser(ctx.s, accountById(ctx), true) }),

  lockPlatformUser: {
    messages: { reason: 'Не короче 5 символов' },
    run: (ctx) => {
      const a = accountById(ctx);
      const b = ctx.body as S['PlatformUserLock'];
      if (a.status === 'locked') fail('invalid_transition');
      const reason = b.reason.trim();
      a.status = 'locked';
      const ext = accountExt(ctx.s, a.id);
      ext.lockedAt = ctx.now();
      ext.lockReason = reason;
      endSessions(ctx.s, a.id);
      audit(ctx, 'account.locked', accountTarget(a), {}, reason);
      return { body: platformUser(ctx.s, a, true) };
    },
  },

  unlockPlatformUser: (ctx) => {
    const a = accountById(ctx);
    if (a.status !== 'locked') fail('invalid_transition');
    a.status = a.lastLoginAt ? 'active' : 'pending';
    const ext = accountExt(ctx.s, a.id);
    delete ext.lockedAt;
    delete ext.lockReason;
    audit(ctx, 'account.unlocked', accountTarget(a));
    return { body: platformUser(ctx.s, a, true) };
  },

  resetPlatformUserMfa: (ctx) => {
    const a = accountById(ctx);
    const ext = accountExt(ctx.s, a.id);
    if (!ext.mfa) fail('invalid_transition');
    ext.mfa = false;
    audit(ctx, 'account.mfa_reset', accountTarget(a));
    return { body: platformUser(ctx.s, a, true) };
  },

  listPlatformOperators: (ctx) => {
    const items = ctx.s.operators.map((o) => operatorDto(ctx.s, o, ctx.actor?.id));
    return { body: { ...page(items, ctx.query), activeOwnerCount: activeOwners(ctx.s) } };
  },

  invitePlatformOperator: {
    messages: { email: 'Укажите рабочую почту', displayName: 'Укажите имя' },
    run: (ctx) => {
      const b = ctx.body as S['PlatformOperatorInvite'];
      const email = b.email.trim().toLowerCase();
      const field = (f: string, code: string, message: string) => ({
        violations: [{ field: f, code, message }],
      });
      if (!email.endsWith(`@${OPERATOR_DOMAIN}`)) {
        fail(
          'validation_failed',
          undefined,
          field(
            'email',
            'domain',
            `Оператором может быть только сотрудник платформы: почта в домене ${OPERATOR_DOMAIN}`,
          ),
        );
      }
      if (ctx.s.operators.some((o) => o.email.toLowerCase() === email)) {
        fail('invalid_transition', 'Оператор с такой почтой уже есть.');
      }
      if (ctx.s.accounts.some((a) => a.email.toLowerCase() === email)) {
        fail(
          'validation_failed',
          'Проверьте почту оператора.',
          field(
            'email',
            'client_account',
            'Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт',
          ),
        );
      }
      if (b.role === 'owner') {
        fail(
          'validation_failed',
          'Владельцем платформы назначают уже работающего оператора.',
          field('role', 'owner_invite', 'Владельцем платформы назначают уже работающего оператора'),
        );
      }
      const n = ctx.s.operators.reduce((m, o) => Math.max(m, Number(o.proto.slice(3)) || 0), 0);
      const row: OperatorRow = {
        id: ctx.newId('platform'),
        accountId: ctx.newId('platform'),
        proto: `op-${n + 1}`,
        displayName: b.displayName.trim(),
        email,
        role: b.role,
        status: 'invited',
      };
      ctx.s.operators.push(row);
      peopleOf(ctx.s).operators[row.id] = { revision: 1 };
      audit(ctx, 'operator.invited', operatorTarget(row), { role: b.role });
      return { status: 201, body: operatorDto(ctx.s, row, ctx.actor?.id) };
    },
  },

  updatePlatformOperator: {
    messages: { reason: 'От 5 до 500 символов' },
    run: (ctx) => {
      const o = operatorById(ctx);
      const b = ctx.body as S['PlatformOperatorPatch'];
      const ext = operatorExt(ctx.s, o.id);
      ctx.revision(ext.revision);
      if (b.role !== undefined && b.active !== undefined) {
        fail('validation_failed', 'Измените роль или состояние — по одному.', {
          violations: [{ field: 'active', code: 'one_of', message: 'Только роль или состояние' }],
        });
      }
      if (o.accountId === ctx.actor?.id) {
        fail(
          'invalid_transition',
          b.role !== undefined
            ? 'Свою роль менять нельзя: попросите другого владельца.'
            : 'Себя отключить нельзя.',
        );
      }
      if (b.role !== undefined) changeRole(ctx, o, b.role);
      if (b.active !== undefined) setActive(ctx, o, b.active, b.reason?.trim());
      ext.revision++;
      return { body: operatorDto(ctx.s, o, ctx.actor?.id) };
    },
  },
};
