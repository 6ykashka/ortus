// Кейсы тега Modules (W0.13): каталог подключаемых модулей, подключение, настройки.
import { expect } from 'vitest';

import { cases } from '../types.ts';

const SPA = {
  moduleKey: 'spa',
  cancellationMinutes: 180,
  allowNegativeStock: false,
  defaultTimeZone: 'Europe/Moscow',
};

export const modulesCases = cases('modules')([
  {
    title: 'каталог модулей «Альты»',
    operationId: 'listModuleCatalog',
    expect: 'success',
    example: 'listModuleCatalog/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/modules`), 'listModuleCatalog/ok');
    },
  },
  {
    title: 'логисту каталог закрыт',
    operationId: 'listModuleCatalog',
    expect: 'error',
    example: 'listModuleCatalog/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/modules`), 'listModuleCatalog/forbidden_action');
    },
  },
  {
    title: 'модуль «Салон и SPA»',
    operationId: 'getModuleInstallation',
    expect: 'success',
    example: 'getModuleInstallation/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/modules/spa`), 'getModuleInstallation/ok');
    },
  },
  {
    title: 'неизвестный модуль',
    operationId: 'getModuleInstallation',
    expect: 'error',
    example: 'getModuleInstallation/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(`${ctx.alta}/modules/aquarium`),
        'getModuleInstallation/not_found',
      );
    },
  },
  {
    title: 'подключение «Логистики»',
    operationId: 'setModuleInstallation',
    expect: 'success',
    example: 'setModuleInstallation/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(`${ctx.alta}/modules/fleet`, { enabled: true }, { ifMatch: 1 });
      ctx.expectExample(r, 'setModuleInstallation/ok');
      const settings = await s.get(`${ctx.alta}/modules/fleet/settings`);
      expect(settings.body).toMatchObject({ moduleKey: 'fleet' });
    },
  },
  {
    title: 'устаревшее состояние модуля',
    operationId: 'setModuleInstallation',
    expect: 'error',
    example: 'setModuleInstallation/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(`${ctx.alta}/modules/fleet`, { enabled: true }, { ifMatch: 4 });
      ctx.expectExample(r, 'setModuleInstallation/revision_mismatch');
    },
  },
  {
    title: 'модуль подключает только владелец',
    operationId: 'setModuleInstallation',
    expect: 'error',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const s = await ctx.as('manager');
      const r = await s.put(`${ctx.alta}/modules/spa`, { enabled: false }, { ifMatch: 1 });
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
  {
    title: 'настройки «Салон и SPA»',
    operationId: 'getModuleSettings',
    expect: 'success',
    example: 'getModuleSettings/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(`${ctx.alta}/modules/spa/settings`);
      ctx.expectExample(r, 'getModuleSettings/ok');
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'настройки неподключённой «Логистики»',
    operationId: 'getModuleSettings',
    expect: 'error',
    example: 'getModuleSettings/module_not_installed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(`${ctx.alta}/modules/fleet/settings`),
        'getModuleSettings/module_not_installed',
      );
    },
  },
  {
    title: 'отмена записи — за 3 часа',
    operationId: 'updateModuleSettings',
    expect: 'success',
    example: 'updateModuleSettings/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(`${ctx.alta}/modules/spa/settings`, SPA, { ifMatch: 1 });
      ctx.expectExample(r, 'updateModuleSettings/ok');
      expect(r.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    title: 'отрицательное время отмены',
    operationId: 'updateModuleSettings',
    expect: 'error',
    example: 'updateModuleSettings/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(
        `${ctx.alta}/modules/spa/settings`,
        { ...SPA, cancellationMinutes: -5 },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateModuleSettings/validation_failed');
    },
  },
  {
    title: 'настройки другого модуля в пути',
    operationId: 'updateModuleSettings',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(`${ctx.alta}/modules/tasks/settings`, SPA, { ifMatch: 1 });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
]);
