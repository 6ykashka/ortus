// Модуль «Обращения» как `DomainModule`: ключ, установка, проекция, команды ядра, задержки.
import { describe, expect, it } from 'vitest';
import { demoClock, fixedClock, DEMO } from '../../core/clock.ts';
import { composeCommands, composeDelays, createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { createPilotModules } from '../index.ts';
import { must } from './fixture.test-util.ts';
import { serviceHook } from './seed.ts';
import { SERVICE_METHODS } from './commands.ts';
import { serviceModule } from './module.ts';
import type { ServiceView } from './types.ts';

const svcOf = (db: unknown): { requests: { priority: string }[] } | undefined =>
  (db as { service?: { requests: { priority: string }[] } }).service;

const seeded = () =>
  createSeed({
    modules: [...createPilotModules(), serviceModule as never],
    hooks: { ...FUTURE_STAGE_HOOKS, service: serviceHook },
  });

describe('serviceModule', () => {
  it('ключ «service», десять методов с задержками', () => {
    expect(serviceModule.key).toBe('service');
    expect(serviceModule.methods).toEqual(SERVICE_METHODS);
    expect(composeDelays([serviceModule as never])).toEqual(
      Object.fromEntries(SERVICE_METHODS.map((m) => [m, 420])),
    );
  });

  it('установка не создаёт срез: его сеет стадия сида `service` и только у «Альты»', () => {
    const { dbs } = createSeed({
      modules: [...createPilotModules(), serviceModule as never],
      hooks: {},
    });
    expect(svcOf(dbs['t-alta'])).toBeUndefined();
    expect(svcOf(dbs['t-lotos'])).toBeUndefined();
    serviceModule.install(dbs['t-alta'], { tenantId: 't-alta', clock: demoClock });
    expect(svcOf(dbs['t-alta'])).toBeUndefined();
  });

  it('стадия `service` сеет только «Альту»; у «Лотоса» проекция — null', () => {
    const { dbs } = seeded();
    expect(svcOf(dbs['t-alta'])).toBeTruthy();
    expect(svcOf(dbs['t-lotos'])).toBeUndefined();
    expect(serviceModule.view(dbs['t-lotos'], 'm-owner', undefined)).toBeNull();
  });

  it('проекция для участника: владелец — всё, Котова — «Грузоперевозки»', () => {
    const { dbs } = seeded();
    const owner = must(serviceModule.view(dbs['t-alta'], 'm-owner', undefined)) as ServiceView;
    expect(owner.requests).toHaveLength(8);
    const kotova = must(serviceModule.view(dbs['t-alta'], 'm-kotova', undefined)) as ServiceView;
    expect(kotova.requests.map((r) => r.key)).toEqual(['ГРЗ-57', 'ГРЗ-55']);
  });

  it('собирается реестром команд ядра вместе с модулями пилота: имена не пересекаются', () => {
    const { dbs } = seeded();
    const db = dbs['t-alta'];
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => 'm-owner',
      clock: fixedClock(DEMO.svcBase),
      tasks: createFakeTaskPort(),
    });
    const all = composeCommands([...createPilotModules(), serviceModule as never], ctx);
    for (const m of SERVICE_METHODS) expect(typeof all[m]).toBe('function');
    expect(all['svcPriority']).toBeTypeOf('function');
    (all['svcPriority'] as (id: string, p: string) => void)('r-57', 'low');
    expect(svcOf(db)?.requests[0]?.priority).toBe('low');
  });
});
