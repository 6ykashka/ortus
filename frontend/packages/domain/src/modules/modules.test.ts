// Модули пилота по контракту `DomainModule` ядра (B §5.1): установка в БД организации,
// проекция для участника; команд у модулей пилота нет (их дают MSW-хендлеры W0.13 и шаги этапа 2),
// кроме модуля «Задачи» (W4.10).
import { describe, expect, it } from 'vitest';
import { demoClock } from '../core/clock.ts';
import { composeCommands, composeDelays, createModuleCtx } from '../core/module.ts';
import { createFakeTaskPort } from '../core/testing/index.ts';
import type { TenantDb } from '../core/types/index.ts';
import { createAlta } from '../seed/alta.ts';
import { createLotos } from '../seed/lotos.ts';
import { createPlatform } from '../seed/platform.ts';
import { createPilotModules, PILOT_MODULES, TASK_METHODS } from './index.ts';

const opts = (tenantId: string) => ({ tenantId, clock: demoClock });

describe('реестр модулей пилота', () => {
  it('логистика, календарь, файлы, задачи — в этом порядке', () => {
    expect(PILOT_MODULES.map((m) => m.key)).toEqual(['logistics', 'calendar', 'files', 'tasks']);
  });

  it('собирается реестром команд ядра без ошибок; команды — только у задач (W4.10)', () => {
    const pilot = PILOT_MODULES.filter((m) => m.key !== 'tasks');
    const db = createAlta(createPlatform());
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => 'm-owner',
      clock: demoClock,
      tasks: createFakeTaskPort(),
    });
    expect(composeCommands(pilot, ctx)).toEqual({});
    expect(composeDelays(pilot)).toEqual({});
    for (const m of pilot) expect(m.methods).toEqual([]);
    expect(Object.keys(composeCommands(PILOT_MODULES, ctx))).toEqual([...TASK_METHODS]);
    expect(Object.keys(composeDelays(PILOT_MODULES))).toEqual([...TASK_METHODS]);
  });
});

describe('install: срезы модулей в БД организации', () => {
  it('«Альта»: автопарк, календарь и место', () => {
    const db: TenantDb = createAlta(createPlatform());
    for (const m of PILOT_MODULES) m.install(db, opts('t-alta'));
    expect(db.vehicles).toHaveLength(7);
    expect(db.trips).toHaveLength(2);
    expect(db.pool?.drivers).toHaveLength(2);
    expect(db.earnings).toEqual([]);
    expect(db.calendar?.bookings).toHaveLength(6);
    expect(db.storage?.breakdown).toHaveLength(4);
  });

  it('повторная установка ничего не меняет и не затирает изменённые данные', () => {
    const db: TenantDb = createAlta(createPlatform());
    for (const m of PILOT_MODULES) m.install(db, opts('t-alta'));
    db.vehicles?.pop();
    const before = structuredClone(db);
    for (const m of PILOT_MODULES) m.install(db, opts('t-alta'));
    expect(db).toEqual(before);
    expect(db.vehicles).toHaveLength(6);
  });

  it('«Лотос» без утечек календаря при prototypeLeaks: false', () => {
    const db: TenantDb = createLotos(createPlatform());
    for (const m of createPilotModules({ prototypeLeaks: false })) m.install(db, opts('t-lotos'));
    expect(db.vehicles).toEqual([]);
    expect(db.calendar?.bookings.map((b) => b.id)).toEqual(['b-a1', 'b-a2', 'b-a3', 'b-br']);
  });
});

describe('view: проекция среза для участника', () => {
  const db: TenantDb = createAlta(createPlatform());
  for (const m of PILOT_MODULES) m.install(db, opts('t-alta'));
  const [logistics, calendar, files] = PILOT_MODULES;

  it('логистика и календарь — по правам участника', () => {
    const fleet = logistics?.view(db, 'm-vasiliev', db) as { trips: { id: string }[] };
    expect(fleet.trips.map((t) => t.id)).toEqual(['Р-208']);
    const cal = calendar?.view(db, 'm-morozova', db) as { bookings: unknown[] };
    expect(cal.bookings).toHaveLength(5);
  });

  it('место — без фильтра, копией; модуль не установлен → null', () => {
    const s = files?.view(db, 'm-vasiliev', db.storage) as { breakdown: unknown[] };
    expect(s).toEqual(db.storage);
    expect(s).not.toBe(db.storage);
    expect(files?.view(db, 'm-owner', undefined)).toBeNull();
    expect(logistics?.view({ ...db, vehicles: undefined }, 'm-owner', undefined)).toBeNull();
    expect(calendar?.view({ ...db, calendar: undefined }, 'm-owner', undefined)).toBeNull();
  });
});
