// Срез логистики этапа 1 (W0.13): модуль `fleet` подключается и отключается владельцем; /me/context
// логиста и водителя следует назначениям; операции тега Fleet — 403 module_not_installed без модуля, с модулем —
// хендлеры W2.00 (`adapter/src/msw/fleet/`, кейсы `cases/fleet.ts`).
import { expect } from 'vitest';

import type { Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

interface Me {
  tenants: {
    name: string;
    modules: { moduleKey: string; state: string; accessMode: string; reason: string }[];
    capabilities: { permission: string; scope: { kind: string; resourceIds: string[] } }[];
  }[];
}

const fleetOf = (me: Me) => me.tenants[0]?.modules.find((m) => m.moduleKey === 'fleet');

async function me(s: Session): Promise<Me> {
  return (await s.get('/api/v1/me/context')).body as Me;
}

async function install(ctx: CaseContext, enabled: boolean, revision: number) {
  const owner = await ctx.as('owner');
  return owner.put(`${ctx.alta}/modules/fleet`, { enabled }, { ifMatch: revision });
}

export const logisticsCases = cases('logistics')([
  {
    title: 'без модуля операции логистики закрыты, модуль в контексте не подключён',
    operationId: 'listVehicles',
    expect: 'error',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectProblem(await driver.get(`${ctx.alta}/fleet/vehicles`), 'module_not_installed');
      expect(fleetOf(await me(driver))).toEqual({
        moduleKey: 'fleet',
        state: 'uninstalled',
        accessMode: 'none',
        reason: 'not_installed',
      });
    },
  },
  {
    title:
      'подключение: водитель и логист получают доступ по назначениям, операции логистики отвечают',
    operationId: 'setModuleInstallation',
    expect: 'success',
    run: async (ctx) => {
      expect((await install(ctx, true, 1)).status).toBe(200);
      const driver = await ctx.as('driver');
      expect(fleetOf(await me(driver))).toMatchObject({ state: 'active', accessMode: 'write' });
      const vehicles = await driver.get(`${ctx.alta}/fleet/vehicles`);
      expect(vehicles.status).toBe(200);
      const owner = await ctx.as('owner');
      await owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotova'),
        roleId: ctx.A('r-manager'),
        scope: { kind: 'org_unit', resourceIds: [ctx.A('f-msk-sever')], includeDescendants: true },
      });
      const manager = await ctx.as('manager');
      const caps = (await me(manager)).tenants[0]?.capabilities ?? [];
      expect(caps).toContainEqual({
        permission: 'fleet.earnings.read',
        scope: { kind: 'org_unit', resourceIds: [ctx.A('f-msk-sever')], includeDescendants: true },
      });
      expect(fleetOf(await me(manager))).toMatchObject({
        accessMode: 'write',
        reason: 'available',
      });
      const ownerCaps = (await me(owner)).tenants[0]?.capabilities.map((c) => c.permission) ?? [];
      expect(ownerCaps).toContain('fleet.trips.review');
    },
  },
  {
    title: 'водителю начисления не видны даже через роль (SoD)',
    operationId: 'getMyContext',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const driver = await ctx.as('driver');
      const perms = (await me(driver)).tenants[0]?.capabilities.map((c) => c.permission) ?? [];
      expect(perms.some((p) => p.startsWith('fleet.earnings.'))).toBe(false);
      expect(perms).toContain('fleet.trips.start');
    },
  },
  {
    title: 'отключение возвращает module_not_installed',
    operationId: 'setModuleInstallation',
    expect: 'success',
    run: async (ctx) => {
      await install(ctx, true, 1);
      const off = await install(ctx, false, 2);
      expect(off.body).toMatchObject({ moduleKey: 'fleet', state: 'uninstalled', revision: 3 });
      const driver = await ctx.as('driver');
      ctx.expectProblem(await driver.get(`${ctx.alta}/fleet/vehicles`), 'module_not_installed');
    },
  },
]);
