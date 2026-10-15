// Кейсы тега Billing (W0.13): подписка и место организации глазами владельца.
import { expect } from 'vitest';

import { cases } from '../types.ts';

const GiB = 1024 ** 3;

export const billingCases = cases('billing')([
  {
    title: 'подписка «Альты» — пробный «Старт»',
    operationId: 'getTenantSubscription',
    expect: 'success',
    example: 'getTenantSubscription/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/subscription`), 'getTenantSubscription/ok');
    },
  },
  {
    title: 'логисту подписка закрыта',
    operationId: 'getTenantSubscription',
    expect: 'error',
    example: 'getTenantSubscription/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(`${ctx.alta}/subscription`),
        'getTenantSubscription/forbidden_action',
      );
    },
  },
  {
    title: 'переход на «Команду» на год',
    operationId: 'requestSubscriptionChange',
    expect: 'success',
    example: 'requestSubscriptionChange/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/subscription`,
        { action: 'change_plan', planKey: 'team' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'requestSubscriptionChange/ok');
      const me = (await s.get('/api/v1/me/context')).body as { tenants: { name: string }[] };
      expect(me.tenants[0]?.name).toBe('Альта Групп');
      const op = await ctx.as('operator');
      const t = (await op.get(`/api/v1/platform/tenants/${ctx.P('t-alta')}`)).body;
      expect(t).toMatchObject({ status: 'active' });
    },
  },
  {
    title: 'неизвестный тариф',
    operationId: 'requestSubscriptionChange',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/subscription`,
        { action: 'change_plan', planKey: 'galaxy' },
        { ifMatch: 2 },
      );
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'не владельцу — 403 (x-scope tenant-owner)',
    operationId: 'requestSubscriptionChange',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      const r = await s.patch(
        `${ctx.alta}/subscription`,
        { action: 'change_plan', planKey: 'team' },
        { ifMatch: 2 },
      );
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
  {
    title: 'место «Альты»',
    operationId: 'getStorageUsage',
    expect: 'success',
    example: 'getStorageUsage/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/storage`), 'getStorageUsage/ok');
    },
  },
  {
    title: 'логисту место закрыто',
    operationId: 'getStorageUsage',
    expect: 'error',
    example: 'getStorageUsage/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/storage`), 'getStorageUsage/forbidden_action');
    },
  },
  {
    title: 'расчёт расширения до 150 ГБ',
    operationId: 'requestStorageChange',
    expect: 'success',
    example: 'requestStorageChange/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/storage/changes`, {
        requestedQuotaBytes: 150 * GiB,
        mode: 'quote',
      });
      ctx.expectExample(r, 'requestStorageChange/ok', 201);
    },
  },
  {
    title: 'принятый расчёт меняет квоту',
    operationId: 'requestStorageChange',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const quote = (
        await s.post(`${ctx.alta}/storage/changes`, {
          requestedQuotaBytes: 150 * GiB,
          mode: 'quote',
        })
      ).body as { quoteId: string };
      const r = await s.post(`${ctx.alta}/storage/changes`, {
        requestedQuotaBytes: 150 * GiB,
        mode: 'commit',
        acceptedQuoteId: quote.quoteId,
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ state: 'applied', requestedQuotaBytes: 150 * GiB });
      const usage = (await s.get(`${ctx.alta}/storage`)).body;
      expect(usage).toMatchObject({ quotaBytes: 150 * GiB });
    },
  },
  {
    title: 'уменьшение ниже занятого',
    operationId: 'requestStorageChange',
    expect: 'error',
    example: 'requestStorageChange/downgrade_below_usage',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/storage/changes`, {
        requestedQuotaBytes: 25 * GiB,
        mode: 'quote',
      });
      ctx.expectExample(r, 'requestStorageChange/downgrade_below_usage');
    },
  },
]);
