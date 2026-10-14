import { describe, expect, it } from 'vitest';
import { DEMO, fixedClock } from './clock.ts';
import { ApiError } from './errors/index.ts';
import {
  ACCESS,
  composeCommands,
  composeDelays,
  createModuleCtx,
  type DomainModule,
  type ModuleCtx,
} from './module.ts';
import { createFakeTaskPort } from './testing/fake-task-port.ts';
import { altaFixture } from './testing/fixture.ts';

const mod = (
  key: DomainModule['key'],
  methods: string[],
  delays?: Record<string, number>,
): DomainModule => ({
  key,
  methods,
  delays: delays ?? Object.fromEntries(methods.map((m) => [m, 200])),
  install: () => undefined,
  view: (_db, _actor, slice) => slice,
  commands: (ctx) => Object.fromEntries(methods.map((m) => [m, () => m + ':' + ctx.getActor()])),
});

describe('createModuleCtx: контекст команд модуля', () => {
  it('собирает БД, актора, часы, id, события, доступ и порт задач', () => {
    const db = altaFixture();
    let actor: string | null = 'm-kotova';
    const tasks = createFakeTaskPort();
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => actor,
      clock: fixedClock(DEMO.now),
      tasks,
    });
    expect(ctx.getDb()).toBe(db);
    expect(ctx.getActor()).toBe('m-kotova');
    actor = null;
    expect(ctx.getActor()).toBeNull();
    expect(ctx.ids.next('kb-')).toBe('kb-100');
    expect(ctx.emit('Текст', ['m-owner']).id).toBe('e101');
    expect(db.events?.[0]?.at).toBe('10:30');
    expect(ctx.ApiError).toBe(ApiError);
    expect(ctx.can).toBe(ACCESS);
    expect(
      ctx.can.can(db, 'm-kotova', 'tasks', 'settings', null, { type: 'project', id: 'fleet' }).ok,
    ).toBe(true);
    expect(ctx.tasks).toBe(tasks);
  });
});

describe('composeCommands: реестр методов модулей', () => {
  const ctx: ModuleCtx = createModuleCtx({
    getDb: () => altaFixture(),
    getActor: () => 'm-owner',
    clock: fixedClock(DEMO.now),
    tasks: createFakeTaskPort(),
  });

  it('объединяет команды модулей по строковому имени метода', () => {
    const reg = composeCommands(
      [mod('service', ['svcReply', 'svcAssign']), mod('cash', ['cashPost'])],
      ctx,
    );
    expect(Object.keys(reg)).toEqual(['svcReply', 'svcAssign', 'cashPost']);
    expect((reg.cashPost as () => string)()).toBe('cashPost:m-owner');
  });

  it('один метод в двух модулях — ошибка с именами модулей', () => {
    expect(() =>
      composeCommands([mod('service', ['svcReply']), mod('chat', ['svcReply'])], ctx),
    ).toThrow('Метод «svcReply» объявлен в модулях service и chat');
  });

  it('методы и команды модуля должны совпадать', () => {
    const broken: DomainModule = {
      ...mod('cash', ['cashPost']),
      methods: ['cashPost', 'cashReverse'],
    };
    expect(() => composeCommands([broken], ctx)).toThrow('Модуль cash: нет команды «cashReverse»');
    const extra: DomainModule = {
      ...mod('cash', ['cashPost', 'cashReverse']),
      methods: ['cashPost'],
    };
    expect(() => composeCommands([extra], ctx)).toThrow(
      'Модуль cash: команда «cashReverse» не объявлена в methods',
    );
  });

  it('у каждого метода есть задержка ≥ 0', () => {
    expect(() => composeCommands([mod('chat', ['chatOpen'], {})], ctx)).toThrow(
      'Модуль chat: нет задержки для «chatOpen»',
    );
    expect(() => composeDelays([mod('chat', ['chatOpen'], { chatOpen: -1 })])).toThrow(
      'Модуль chat: нет задержки для «chatOpen»',
    );
  });

  it('composeDelays собирает задержки; 0 допустим (chatOpen, docJobPoll)', () => {
    expect(
      composeDelays([
        mod('chat', ['chatOpen', 'chatSend'], { chatOpen: 0, chatSend: 260 }),
        mod('docs', ['docJobPoll'], { docJobPoll: 0 }),
      ]),
    ).toEqual({ chatOpen: 0, chatSend: 260, docJobPoll: 0 });
  });
});
