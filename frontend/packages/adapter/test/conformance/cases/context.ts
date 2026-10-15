// Кейсы тега Context (W0.13): /me/context персонажей пилота, переключатель организации, входящие.
import { expect } from 'vitest';

import { type CaseContext, cases } from '../types.ts';

const NOW = '2026-10-01T07:30:00Z';

/** Персонаж примера getMyContext → вход (owner-lotos — subject acc-11: без выбранной организации). */
const PERSONAS = [
  ['owner', 'owner'],
  ['manager', 'manager'],
  ['driver', 'driver'],
  ['therapist', 'therapist'],
  ['foreman', 'foreman'],
  ['operator', 'operator'],
  ['owner-lotos', 'acc-11'],
] as const;

export const contextCases = cases('context')([
  ...PERSONAS.map(([name, persona]) => ({
    title: `контекст персонажа ${name}`,
    operationId: 'getMyContext',
    expect: 'success' as const,
    example: `getMyContext/${name}`,
    run: async (ctx: CaseContext) => {
      const s = await ctx.as(persona);
      ctx.expectExample(await s.get('/api/v1/me/context'), `getMyContext/${name}`);
    },
  })),
  {
    title: 'без сессии — 401',
    operationId: 'getMyContext',
    expect: 'error',
    example: 'getMyContext/session_expired',
    run: async (ctx) => {
      ctx.expectExample(await ctx.anon().get('/api/v1/me/context'), 'getMyContext/session_expired');
    },
  },
  {
    title: 'приостановленное членство видно без возможностей',
    operationId: 'getMyContext',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('acc-7');
      const me = (await s.get('/api/v1/me/context')).body as {
        tenants: { membershipStatus: string; capabilities: unknown[]; modules: unknown[] }[];
      };
      expect(me.tenants).toEqual([
        expect.objectContaining({ membershipStatus: 'suspended', capabilities: [], modules: [] }),
      ]);
    },
  },
  {
    title: 'Анна Морозова переключается на «Лотос»',
    operationId: 'selectTenant',
    expect: 'success',
    example: 'selectTenant/ok',
    run: async (ctx) => {
      const s = await ctx.as('therapist');
      const r = await s.put('/api/v1/me/selected-tenant', { tenantId: ctx.P('t-lotos') });
      ctx.expectExample(r, 'selectTenant/ok');
      const me = (await s.get('/api/v1/me/context')).body as { lastTenantId?: string };
      expect(me.lastTenantId).toBe(ctx.P('t-lotos'));
    },
  },
  {
    title: 'чужая организация',
    operationId: 'selectTenant',
    expect: 'error',
    example: 'selectTenant/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put('/api/v1/me/selected-tenant', { tenantId: ctx.P('t-lotos') });
      ctx.expectExample(r, 'selectTenant/not_found');
    },
  },
  {
    title: 'входящие владельца «Альты»',
    operationId: 'listMyNotifications',
    expect: 'success',
    example: 'listMyNotifications/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}`);
      ctx.expectExample(r, 'listMyNotifications/ok');
      const unread = await s.get(
        `/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}&filter=unread&limit=1`,
      );
      const page = unread.body as { items: unknown[]; nextCursor: string | null };
      expect(page.items).toHaveLength(1);
      const next = await s.get(
        `/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}&filter=unread&limit=1&cursor=${page.nextCursor}`,
      );
      expect((next.body as { nextCursor: string | null }).nextCursor).toBeNull();
    },
  },
  {
    title: 'входящие владелицы «Лотоса» пусты',
    operationId: 'listMyNotifications',
    expect: 'success',
    example: 'listMyNotifications/empty',
    run: async (ctx) => {
      const s = await ctx.as('acc-11');
      const r = await s.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-lotos')}`);
      ctx.expectExample(r, 'listMyNotifications/empty');
    },
  },
  {
    title: 'входящие чужой организации',
    operationId: 'listMyNotifications',
    expect: 'error',
    example: 'listMyNotifications/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-lotos')}`);
      ctx.expectExample(r, 'listMyNotifications/not_found');
    },
  },
  {
    title: 'без tenantId — 400',
    operationId: 'listMyNotifications',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectProblem(await s.get('/api/v1/me/notifications'), 'malformed_request');
    },
  },
  {
    title: 'сводка непрочитанного',
    operationId: 'getMyNotificationSummary',
    expect: 'success',
    example: 'getMyNotificationSummary/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get('/api/v1/me/notifications/summary'),
        'getMyNotificationSummary/ok',
      );
    },
  },
  {
    title: 'сводка без сессии',
    operationId: 'getMyNotificationSummary',
    expect: 'error',
    example: 'getMyNotificationSummary/session_expired',
    run: async (ctx) => {
      ctx.expectExample(
        await ctx.anon().get('/api/v1/me/notifications/summary'),
        'getMyNotificationSummary/session_expired',
      );
    },
  },
  {
    title: 'прочитать всё до момента',
    operationId: 'markMyNotificationsRead',
    expect: 'success',
    example: 'markMyNotificationsRead/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post('/api/v1/me/notifications/read', {
        tenantId: ctx.P('t-alta'),
        upTo: NOW,
      });
      ctx.expectExample(r, 'markMyNotificationsRead/ok');
      const sum = (await s.get('/api/v1/me/notifications/summary')).body as { totalUnread: number };
      expect(sum.totalUnread).toBe(0);
    },
  },
  {
    title: 'прочитать по списку',
    operationId: 'markMyNotificationsRead',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const page = (await s.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}`)).body as {
        items: { id: string }[];
      };
      const r = await s.post('/api/v1/me/notifications/read', {
        tenantId: ctx.P('t-alta'),
        notificationIds: [page.items[0]?.id],
      });
      expect(r.body).toEqual({ tenantId: ctx.P('t-alta'), unreadCount: 1 });
    },
  },
  {
    title: 'и список, и момент — 422',
    operationId: 'markMyNotificationsRead',
    expect: 'error',
    example: 'markMyNotificationsRead/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post('/api/v1/me/notifications/read', {
        tenantId: ctx.P('t-alta'),
        notificationIds: [ctx.A('m-owner')],
        upTo: NOW,
      });
      ctx.expectExample(r, 'markMyNotificationsRead/validation_failed');
    },
  },
]);
