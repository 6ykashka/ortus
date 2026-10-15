// Тег Auth (W0.13): вход в браузере через BFF в режиме mock. Поставщик входа — dev-провайдер: startLogin
// перенаправляет сразу на callback с `code=dev:<персонаж>` (по умолчанию — владелец «Альты»), completeLogin
// выдаёт сессию BFF, как dev-вход W0.09. CSRF-токен, выход, превью и принятие приглашения — по контракту W0.08.
import type { components } from '@ortus/api-client';

import { notifyOwners, pastVerb } from '../core/notify.ts';
import { maskEmail } from '../core/people.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import {
  issueSession,
  lookupActor,
  PERSONAS,
  randomToken,
  sessionCookies,
} from '../core/session.ts';
import {
  type InvitationRow,
  type Org,
  type ScenarioState,
  seatsUsed,
  type TenantRow,
} from '../core/state.ts';
import { seatsLimit } from '../core/dto.ts';
import { addMs, MINUTE } from '../core/time.ts';

type S = components['schemas'];

/** returnTo — относительный путь приложения (схема параметра startLogin): один «/», без хоста и «\». */
const safeReturnTo = (p: string): boolean =>
  p.length <= 512 &&
  p.startsWith('/') &&
  !p.startsWith('//') &&
  ![...p].some(
    (ch) => ch === '\\' || /\s/.test(ch) || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f,
  );
const LOGIN_TTL_MS = 10 * MINUTE;
const END_SESSION_URL =
  'https://id.example.invalid/realms/ortus/protocol/openid-connect/logout?client_id=ortus-web';

interface Found {
  tenant: TenantRow;
  org: Org;
  inv: InvitationRow;
}

/** Приглашение по токену во всех организациях с данными. */
function findInvitation(s: ScenarioState, token: string): Found | undefined {
  for (const org of Object.values(s.orgs)) {
    const inv = org.invitations.find((i) => i.token === token);
    const tenant = s.tenants.find((t) => t.id === org.tenantId);
    if (inv && tenant) return { tenant, org, inv };
  }
  return undefined;
}

/** Статус приглашения на «сейчас»: ожидающее после срока — истёкшее. */
const statusOf = (inv: InvitationRow, now: string): InvitationRow['status'] =>
  inv.status === 'pending' && now >= inv.expiresAt ? 'expired' : inv.status;

export const authHandlers: Registry = {
  startLogin: (ctx) => {
    const returnTo = ctx.query.get('returnTo') ?? '/';
    if (!safeReturnTo(returnTo)) fail('malformed_request');
    const state = randomToken();
    ctx.s.logins[state] = { state, returnTo, createdAt: ctx.now() };
    const callback = new URL('/api/v1/auth/callback', ctx.url.origin);
    callback.searchParams.set('code', 'dev:owner');
    callback.searchParams.set('state', state);
    return { status: 302, headers: { Location: callback.href } };
  },

  completeLogin: (ctx) => {
    const state = ctx.query.get('state');
    if (!state) fail('malformed_request');
    const login = ctx.s.logins[state];
    Reflect.deleteProperty(ctx.s.logins, state);
    if (!login || ctx.now() >= addMs(login.createdAt, LOGIN_TTL_MS) || ctx.query.get('error')) {
      fail('session_expired');
    }
    const persona = (ctx.query.get('code') ?? '').replace(/^dev:/, '');
    const subject = PERSONAS[persona] ?? persona;
    const locked = ctx.s.accounts.find((a) => a.proto === subject && a.status === 'locked');
    if (locked) fail('forbidden_action');
    const actor = lookupActor(ctx.s, persona);
    if (!actor) fail('session_expired');
    const row = issueSession(ctx.s, actor.id);
    ctx.setCookies(sessionCookies(row));
    return { status: 302, headers: { Location: login.returnTo } };
  },

  getCsrfToken: (ctx) => {
    const sess = ctx.session ?? fail('session_expired');
    return {
      body: { csrfToken: sess.csrf, headerName: 'X-CSRF-Token', expiresAt: sess.expiresAt },
    };
  },

  logout: (ctx) => {
    if (ctx.session) Reflect.deleteProperty(ctx.s.sessions, ctx.session.id);
    ctx.setCookies(sessionCookies(null));
    return { body: { endSessionUrl: END_SESSION_URL } };
  },

  inspectInvitation: (ctx) => {
    const found = findInvitation(ctx.s, String(ctx.body.token)) ?? fail('not_found');
    const body: S['InvitationPreview'] = {
      tenantName: found.tenant.name,
      invitedEmailMasked: maskEmail(found.inv.email),
      status: statusOf(found.inv, ctx.now()),
      expiresAt: found.inv.expiresAt,
    };
    return { body };
  },

  acceptInvitation: (ctx) => {
    const actor = ctx.user();
    const { tenant, org, inv } = findInvitation(ctx.s, String(ctx.body.token)) ?? fail('not_found');
    const status = statusOf(inv, ctx.now());
    if (status === 'revoked') fail('not_found');
    if (status === 'expired') fail('public_token_expired');
    if (actor.account.email.toLowerCase() !== inv.email.toLowerCase()) {
      fail(
        'forbidden_action',
        `Приглашение отправлено на другой адрес. Войдите под ${maskEmail(inv.email)}.`,
      );
    }
    const membership =
      ctx.s.memberships.find((m) => m.accountId === actor.id && m.tenantId === tenant.id) ??
      fail('not_found');
    const member = org.members.find((m) => m.id === inv.memberId) ?? fail('not_found');
    if (status === 'pending') {
      const used = seatsUsed(org);
      const limit = seatsLimit(tenant);
      if (used > limit) {
        fail(
          'seats_exhausted',
          `Свободных мест нет: занято ${used} из ${limit}. Отзовите приглашение или запросите расширение тарифа.`,
        );
      }
      inv.status = 'accepted';
      member.status = 'active';
      member.userId = actor.id;
      member.revision++;
      membership.status = 'active';
      membership.memberId = member.id;
      if (actor.account.status === 'pending') actor.account.status = 'active';
      notifyOwners(ctx.s, org, {
        kind: 'members.invitation.accepted',
        severity: 'info',
        title: `${member.displayName} ${pastVerb(member.displayName, 'приняла', 'принял')} приглашение`,
        object: { moduleKey: 'members', entityType: 'member', entityId: member.id },
        link: '/users',
      });
    }
    const body: S['InvitationAcceptance'] = {
      tenantId: tenant.id,
      membershipId: membership.id,
      tenantName: tenant.name,
      membershipStatus: 'active',
    };
    return { body };
  },
};
