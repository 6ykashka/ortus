// Кейсы тега Platform (W0.13): «Ортус · Платформа» — организации, каталог аккаунтов, подписки (оператор).
import { expect } from 'vitest';

import { cases } from '../types.ts';

const T = '/api/v1/platform/tenants';
const MISSING = '00000000-0000-5000-8000-000000000000';

export const platformCases = cases('platform')([
  {
    title: 'организации платформы',
    operationId: 'listPlatformTenants',
    expect: 'success',
    example: 'listPlatformTenants/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(T), 'listPlatformTenants/ok');
    },
  },
  {
    title: 'не оператору — 404, как стенд',
    operationId: 'listPlatformTenants',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectProblem(await owner.get(T), 'not_found');
    },
  },
  {
    title: 'новая организация «Северный ветер»',
    operationId: 'createPlatformTenant',
    expect: 'success',
    example: 'createPlatformTenant/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(T, {
        name: 'Северный ветер',
        ownerEmail: 'owner@veter.example',
        timeZone: 'Europe/Moscow',
        planKey: 'start',
      });
      ctx.expectExample(r, 'createPlatformTenant/ok', 201);
      const list = (await op.get(T)).body as { items: { name: string }[] };
      expect(list.items.map((t) => t.name)).toContain('Северный ветер');
    },
  },
  {
    title: 'почта владельца с ошибкой',
    operationId: 'createPlatformTenant',
    expect: 'error',
    example: 'createPlatformTenant/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(T, {
        name: 'Северный ветер',
        ownerEmail: 'veter.example',
        timeZone: 'Europe/Moscow',
        planKey: 'start',
      });
      ctx.expectExample(r, 'createPlatformTenant/validation_failed');
    },
  },
  {
    title: 'карточка «Альты»',
    operationId: 'getPlatformTenant',
    expect: 'success',
    example: 'getPlatformTenant/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(`${T}/${ctx.P('t-alta')}`), 'getPlatformTenant/ok');
    },
  },
  {
    title: 'неизвестная организация',
    operationId: 'getPlatformTenant',
    expect: 'error',
    example: 'getPlatformTenant/not_found',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(`${T}/${MISSING}`), 'getPlatformTenant/not_found');
    },
  },
  {
    title: 'оператор возобновляет «Карго Сити»',
    operationId: 'updatePlatformTenant',
    expect: 'success',
    example: 'updatePlatformTenant/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(
        `${T}/${ctx.P('t-cargo')}`,
        { status: 'active', reason: 'Оплата получена, доступ возобновлён' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updatePlatformTenant/ok');
    },
  },
  {
    title: 'приостановка «Лотоса» закрывает организацию участникам',
    operationId: 'updatePlatformTenant',
    expect: 'success',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(
        `${T}/${ctx.P('t-lotos')}`,
        { status: 'suspended', reason: 'Неоплата счёта за октябрь' },
        { ifMatch: 1 },
      );
      expect(r.body).toMatchObject({ status: 'suspended', revision: 2 });
      const owner = await ctx.as('acc-11');
      ctx.expectProblem(await owner.get(`${ctx.lotos}/members`), 'tenant_suspended');
    },
  },
  {
    title: 'устаревшая ревизия',
    operationId: 'updatePlatformTenant',
    expect: 'error',
    example: 'updatePlatformTenant/revision_mismatch',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(
        `${T}/${ctx.P('t-cargo')}`,
        { status: 'active', reason: 'Оплата получена' },
        { ifMatch: 7 },
      );
      ctx.expectExample(r, 'updatePlatformTenant/revision_mismatch');
    },
  },
  {
    title: 'смена статуса без причины',
    operationId: 'updatePlatformTenant',
    expect: 'error',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.patch(`${T}/${ctx.P('t-cargo')}`, { status: 'active' }, { ifMatch: 1 });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'каталог аккаунтов',
    operationId: 'listPlatformUsers',
    expect: 'success',
    example: 'listPlatformUsers/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get('/api/v1/platform/users?limit=200'), 'listPlatformUsers/ok');
    },
  },
  {
    title: 'каталог не оператору — 404',
    operationId: 'listPlatformUsers',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectProblem(await owner.get('/api/v1/platform/users'), 'not_found');
    },
  },
  {
    title: 'подписка «Альты» глазами оператора',
    operationId: 'getPlatformSubscription',
    expect: 'success',
    example: 'getPlatformSubscription/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.get(`${T}/${ctx.P('t-alta')}/subscription`);
      ctx.expectExample(r, 'getPlatformSubscription/ok');
    },
  },
  {
    title: 'подписка неизвестной организации',
    operationId: 'getPlatformSubscription',
    expect: 'error',
    example: 'getPlatformSubscription/not_found',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${T}/${MISSING}/subscription`),
        'getPlatformSubscription/not_found',
      );
    },
  },
  {
    title: 'оператор продлевает пробный период',
    operationId: 'updatePlatformSubscription',
    expect: 'success',
    example: 'updatePlatformSubscription/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.put(
        `${T}/${ctx.P('t-alta')}/subscription`,
        {
          planKey: 'start',
          status: 'trialing',
          trialEndsAt: '2026-10-27T21:00:00Z',
          cancelAtPeriodEnd: false,
          manualEntitlements: [],
          reason: 'Продление пробного периода на 14 дней',
        },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'updatePlatformSubscription/ok');
      const owner = await ctx.as('owner');
      const sub = (await owner.get(`${ctx.alta}/subscription`)).body;
      expect(sub).toMatchObject({ trialEndsAt: '2026-10-27T21:00:00Z', revision: 3 });
    },
  },
  {
    title: 'без причины изменения',
    operationId: 'updatePlatformSubscription',
    expect: 'error',
    example: 'updatePlatformSubscription/validation_failed',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.put(
        `${T}/${ctx.P('t-alta')}/subscription`,
        {
          planKey: 'start',
          status: 'trialing',
          trialEndsAt: '2026-10-27T21:00:00Z',
          cancelAtPeriodEnd: false,
          manualEntitlements: [],
        },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'updatePlatformSubscription/validation_failed');
    },
  },
]);
