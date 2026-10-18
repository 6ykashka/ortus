// Модуль «Задачи» по контракту `DomainModule` ядра и подключение к сборке сида: реестр модулей и
// хук стадии `normProjects` держит интегратор (план v2 §3.5); оба подключены при вливании W4.10.
import { describe, expect, it } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import { createIdGen } from '../../core/ids.ts';
import {
  composeCommands,
  composeDelays,
  createModuleCtx,
  type DomainModule,
} from '../../core/module.ts';
import { SEED_STAGES } from '../../core/seed-hooks.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { createPlatform } from '../../seed/platform.ts';
import { createPilotModules } from '../index.ts';
import { TASK_METHODS } from './commands.ts';
import { normProjectsHook, tasksModule } from './module.ts';
import { createTaskPort } from './task-port.ts';

const opts = (tenantId: string) => ({ tenantId, clock: demoClock });

// Реестр пилота и хук normProjects подключены интегратором: сид по умолчанию уже с задачами.
const seedWithTasks = () => createSeed();

describe('tasksModule: DomainModule «Задачи»', () => {
  it('ключ, 20 методов с задержками', () => {
    expect(tasksModule.key).toBe('tasks');
    expect(tasksModule.methods).toEqual(TASK_METHODS);
    expect(Object.keys(composeDelays([tasksModule as DomainModule]))).toEqual(TASK_METHODS);
  });

  it('install: проекты и задачи организации; повторная установка не затирает изменения', () => {
    const db: TenantDb = createAlta(createPlatform());
    tasksModule.install(db, opts('t-alta'));
    expect(db.projects?.map((p) => p.id)).toEqual(['fleet', 'leads']);
    expect(db.tasks).toHaveLength(9);
    db.tasks?.pop();
    tasksModule.install(db, opts('t-alta'));
    expect(db.tasks).toHaveLength(8);
  });

  it('view: проекция участника; без среза задач — null', () => {
    const db: TenantDb = createAlta(createPlatform());
    expect(tasksModule.view(db, 'm-owner', undefined)).toBeNull();
    tasksModule.install(db, opts('t-alta'));
    expect(tasksModule.view(db, 'm-kotova', undefined)?.projects.map((p) => p.id)).toEqual([
      'fleet',
    ]);
  });

  it('команды собираются реестром ядра вместе с модулями пилота; TaskPort ядра — реализация W4.10', () => {
    const S = seedWithTasks();
    const db = S.dbs['t-alta'];
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => 'm-kotova',
      clock: demoClock,
      tasks: createTaskPort(
        () => db,
        createIdGen(() => db),
      ),
    });
    const cmds = composeCommands(createPilotModules(), ctx);
    expect(Object.keys(cmds)).toEqual(TASK_METHODS);
    const id = (cmds['createProjectTask'] as (a: unknown) => string)({
      project: 'fleet',
      title: 'Через реестр',
    });
    expect(ctx.tasks.get(id)).toMatchObject({
      title: 'Через реестр',
      status: 'Новая',
      authorId: 'm-kotova',
    });
    ctx.tasks.update(id, { status: ctx.tasks.statusName('fleet', 'progress', 'На проверке') });
    expect(db.tasks?.[0]).toMatchObject({ id, status: 'На проверке' });
  });
});

describe('сборка сида с модулем задач и стадией normProjects', () => {
  it('стадия normProjects — первая в порядке ядра', () => {
    expect(SEED_STAGES[0]).toBe('normProjects');
  });

  it('«Альта»: LOG с процессом и демо T-65/T-66; «Заявки» — воронка без процесса', () => {
    const db = seedWithTasks().dbs['t-alta'];
    expect(db.tasks?.map((t) => t.id).slice(0, 2)).toEqual(['T-66', 'T-65']);
    expect(db.tasks).toHaveLength(11);
    const [fleet, leads] = (db.projects ?? []) as { id: string; wf?: unknown; access?: string }[];
    expect(fleet).toMatchObject({ id: 'fleet', access: 'limited' });
    expect(fleet?.wf).toBeDefined();
    expect(leads).not.toHaveProperty('wf');
  });

  it('«Лотос»: стадии normProjects нет — салон без процесса, как в эталоне', () => {
    const db = seedWithTasks().dbs['t-lotos'];
    expect(db.tasks?.map((t) => t.id)).toEqual(['T-7', 'T-8']);
    expect(db.projects?.[0]).not.toHaveProperty('wf');
  });

  it('модуль задач — в реестре пилота, хук normProjects — в стадиях сида', () => {
    expect(createPilotModules().map((m) => m.key)).toContain('tasks');
    expect(FUTURE_STAGE_HOOKS.normProjects).toBe(normProjectsHook);
  });
});
