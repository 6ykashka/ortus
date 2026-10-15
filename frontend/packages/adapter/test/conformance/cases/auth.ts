// Кейсы тега Auth (W0.13): вход через BFF (поставщик режима mock), CSRF, выход, приглашение.
import { expect } from 'vitest';

import type { Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

/** Токен приглашения сида по почте (dev-маршрут сценариев). */
async function invitationToken(ctx: CaseContext, email: string): Promise<string> {
  const r = await ctx.anon().get('/api/v1/dev/scenario');
  const inv = (r.body as { invitations: { email: string; token: string }[] }).invitations;
  const token = inv.find((i) => i.email === email)?.token;
  if (!token) throw new Error(`нет приглашения ${email}`);
  return token;
}

/** Вход через startLogin → completeLogin; `code` — персонаж поставщика mock. */
async function browserLogin(s: Session, persona: string, returnTo = '/users') {
  const start = await s.get(`/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const location = new URL(start.headers.get('Location') ?? '');
  location.searchParams.set('code', `dev:${persona}`);
  return { start, done: await s.get(`${location.pathname}${location.search}`) };
}

const PETROVA = 'o.petrova@alta.example';

export const authCases = cases('auth')([
  {
    title: 'вход: редирект на поставщика и обратно на returnTo с сессией',
    operationId: 'startLogin',
    expect: 'success',
    run: async (ctx) => {
      const s = ctx.anon();
      const { start, done } = await browserLogin(s, 'manager');
      expect(start.status).toBe(302);
      expect(start.headers.get('Location')).toMatch(/\/api\/v1\/auth\/callback\?/);
      expect(done.status).toBe(302);
      expect(done.headers.get('Location')).toBe('/users');
      const me = (await s.get('/api/v1/me/context')).body as { displayName: string };
      expect(me.displayName).toBe('Марина Котова');
    },
  },
  {
    title: 'returnTo вне приложения — 400',
    operationId: 'startLogin',
    expect: 'error',
    example: 'startLogin/malformed_request',
    run: async (ctx) => {
      const r = await ctx.anon().get('/api/v1/auth/login?returnTo=https://evil.example/');
      ctx.expectExample(r, 'startLogin/malformed_request');
    },
  },
  {
    title: 'возврат поставщика с сессией владельца',
    operationId: 'completeLogin',
    expect: 'success',
    run: async (ctx) => {
      const s = ctx.anon();
      const { done } = await browserLogin(s, 'owner', '/');
      expect(done.status).toBe(302);
      expect(done.headers.get('Location')).toBe('/');
      expect((await s.get('/api/v1/me/context')).status).toBe(200);
    },
  },
  {
    title: 'неизвестный state — 401',
    operationId: 'completeLogin',
    expect: 'error',
    example: 'completeLogin/session_expired',
    run: async (ctx) => {
      const r = await ctx.anon().get('/api/v1/auth/callback?code=dev:owner&state=stale-state-000');
      ctx.expectExample(r, 'completeLogin/session_expired');
    },
  },
  {
    title: 'заблокированный аккаунт — 403',
    operationId: 'completeLogin',
    expect: 'error',
    example: 'completeLogin/forbidden_action',
    run: async (ctx) => {
      const { done } = await browserLogin(ctx.anon(), 'acc-13');
      ctx.expectExample(done, 'completeLogin/forbidden_action');
    },
  },
  {
    title: 'CSRF-токен сессии, срок — 8 часов',
    operationId: 'getCsrfToken',
    expect: 'success',
    example: 'getCsrfToken/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get('/api/v1/auth/csrf');
      ctx.expectExample(r, 'getCsrfToken/ok');
      expect((r.body as { csrfToken: string }).csrfToken).toBe(s.csrf);
    },
  },
  {
    title: 'CSRF без сессии',
    operationId: 'getCsrfToken',
    expect: 'error',
    example: 'getCsrfToken/session_expired',
    run: async (ctx) => {
      ctx.expectExample(await ctx.anon().get('/api/v1/auth/csrf'), 'getCsrfToken/session_expired');
    },
  },
  {
    title: 'выход гасит сессию',
    operationId: 'logout',
    expect: 'success',
    example: 'logout/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.post('/api/v1/auth/logout'), 'logout/ok');
      expect((await s.get('/api/v1/me/context')).status).toBe(401);
    },
  },
  {
    title: 'выход без CSRF',
    operationId: 'logout',
    expect: 'error',
    example: 'logout/csrf_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.post('/api/v1/auth/logout', undefined, { csrf: false }),
        'logout/csrf_failed',
      );
    },
  },
  {
    title: 'превью приглашения Олеси Петровой',
    operationId: 'inspectInvitation',
    expect: 'success',
    example: 'inspectInvitation/ok',
    run: async (ctx) => {
      const token = await invitationToken(ctx, PETROVA);
      const r = await ctx.anon().post('/api/v1/auth/invitations/inspect', { token });
      ctx.expectExample(r, 'inspectInvitation/ok');
    },
  },
  {
    title: 'превью истёкшего приглашения',
    operationId: 'inspectInvitation',
    expect: 'success',
    example: 'inspectInvitation/expired',
    run: async (ctx) => {
      const token = await invitationToken(ctx, PETROVA);
      ctx.server.setNow('2026-10-09T07:30:00Z');
      const r = await ctx.anon().post('/api/v1/auth/invitations/inspect', { token });
      ctx.expectExample(r, 'inspectInvitation/expired');
    },
  },
  {
    title: 'неизвестный токен',
    operationId: 'inspectInvitation',
    expect: 'error',
    example: 'inspectInvitation/not_found',
    run: async (ctx) => {
      const r = await ctx.anon().post('/api/v1/auth/invitations/inspect', {
        token: 'inv_00000000000000000000000000000000',
      });
      ctx.expectExample(r, 'inspectInvitation/not_found');
    },
  },
  {
    title: 'Олеся Петрова принимает приглашение',
    operationId: 'acceptInvitation',
    expect: 'success',
    example: 'acceptInvitation/ok',
    run: async (ctx) => {
      const token = await invitationToken(ctx, PETROVA);
      const s = await ctx.as('acc-6');
      ctx.expectExample(
        await s.post('/api/v1/auth/invitations/accept', { token }),
        'acceptInvitation/ok',
      );
      const me = (await s.get('/api/v1/me/context')).body as {
        tenants: { name: string; membershipStatus: string }[];
      };
      expect(me.tenants).toEqual([
        expect.objectContaining({ name: 'Альта Групп', membershipStatus: 'active' }),
      ]);
      const owner = await ctx.as('owner');
      const member = (await owner.get(`${ctx.alta}/members/${ctx.A('m-petrova')}`)).body;
      expect(member).toMatchObject({ status: 'active' });
      const inbox = (await owner.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}`))
        .body as { items: { kind: string; title: string }[] };
      expect(inbox.items[0]).toMatchObject({
        kind: 'members.invitation.accepted',
        title: 'Олеся Петрова приняла приглашение',
      });
      const again = await ctx.anon().post('/api/v1/auth/invitations/inspect', { token });
      expect(again.body).toMatchObject({ status: 'accepted' });
    },
  },
  {
    title: 'приглашение на другую почту',
    operationId: 'acceptInvitation',
    expect: 'error',
    example: 'acceptInvitation/forbidden_action',
    run: async (ctx) => {
      const token = await invitationToken(ctx, PETROVA);
      const s = await ctx.as('owner');
      const r = await s.post('/api/v1/auth/invitations/accept', { token });
      ctx.expectExample(r, 'acceptInvitation/forbidden_action');
    },
  },
  {
    title: 'истёкшее приглашение',
    operationId: 'acceptInvitation',
    expect: 'error',
    example: 'acceptInvitation/public_token_expired',
    run: async (ctx) => {
      const token = await invitationToken(ctx, PETROVA);
      ctx.server.setNow('2026-10-09T07:30:00Z');
      const s = await ctx.as('acc-6');
      const r = await s.post('/api/v1/auth/invitations/accept', { token });
      ctx.expectExample(r, 'acceptInvitation/public_token_expired');
    },
  },
]);
