// Контракт команд маршрута: реестр, задержки, сборка с ядром документов и экспорт.
import { describe, expect, it } from 'vitest';
import { composeCommands, composeDelays, type DomainModule } from '../../../core/module.ts';
import { docsCoreModule } from '../core/module.ts';
import * as route from './index.ts';
import { routeRig } from './fixture.test-util.ts';

describe('команды маршрута', () => {
  it('8 методов с задержками эталона; реестр = methods', () => {
    expect(route.ROUTE_METHODS).toEqual([
      'docRouteStart',
      'docRouteDecide',
      'docSignStart',
      'docSign',
      'docAck',
      'docAckClose',
      'docRouteResume',
      'docRouteCancel',
    ]);
    expect(route.ROUTE_DELAYS).toEqual({
      docRouteStart: 420,
      docRouteDecide: 300,
      docSignStart: 400,
      docSign: 420,
      docAck: 300,
      docAckClose: 300,
      docRouteResume: 350,
      docRouteCancel: 300,
    });
    const r = routeRig();
    expect(Object.keys(r.cmds).sort()).toEqual([...route.ROUTE_METHODS].sort());
  });

  it('ядро + маршрут собираются в одном модуле `docs` без дублей', () => {
    const r = routeRig();
    const mod: DomainModule = {
      ...(docsCoreModule as DomainModule),
      commands: (ctx) => route.createDocsRouteCommands(ctx),
      methods: route.ROUTE_METHODS,
      delays: route.ROUTE_DELAYS,
    };
    expect(Object.keys(composeCommands([mod], r.ctx))).toHaveLength(8);
    expect(composeDelays([mod]).docSign).toBe(420);
  });

  it('экспортирует движок и лист согласования', () => {
    expect(typeof route.routeSheet).toBe('function');
    expect(typeof route.createRouteEngine).toBe('function');
  });
});
