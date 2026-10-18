import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../core/clock.ts';
import { createEmitter } from '../../core/events.ts';
import { createAutomation } from './automation.ts';
import { altaDb, mkProject, mkTask, type TestDb } from './fixture.test-util.ts';
import type { Automation, Project, Task, Transition } from './types.ts';

// 1 октября 2026, 09:12 по Москве.
const clock = fixedClock('2026-10-01T09:12:00+03:00');

const rule = (o: Partial<Automation> = {}): Automation => ({
  id: 'ar-1',
  name: 'Срочная задача → назначить руководителю проекта',
  trigger: 'created',
  to: null,
  cond: { priority: 'urgent' },
  action: { kind: 'assign', value: 'Марина Котова' },
  on: true,
  version: 1,
  by: 'Марина Котова',
  byId: 'm-kotova',
  ...o,
});

function setup(automations: Automation[], t: Task = mkTask('LOG-101', { priority: 'urgent' })) {
  const p: Project = mkProject('approval', 'limited', { automations, runs: [] });
  const db: TestDb = altaDb([p], [t]);
  db.events = [];
  const emit = createEmitter(() => db, clock);
  const auto = createAutomation(() => db, clock, emit);
  return { db, p, t, auto };
}

describe('autoFire: правила проекта от имени автора (api.js:149–165)', () => {
  it('«задача создана» + условие по приоритету → назначение, журнал и отметка правила', () => {
    const { p, t, auto } = setup([rule()]);
    t.assignee = 'Илья Васильев';
    auto.autoFire(p, t, 'created', null);
    expect(t.assignee).toBe('Марина Котова');
    expect(p.runs).toEqual([
      {
        at: '09:12',
        rule: 'ar-1',
        name: 'Срочная задача → назначить руководителю проекта',
        rv: 1,
        res: 'ok',
        text: 'LOG-101 назначена: Марина Котова',
        task: 'LOG-101',
      },
    ]);
    expect(t.comments).toEqual([
      {
        by: 'Автоматизация',
        at: '09:12',
        text: 'Правило «Срочная задача → назначить руководителю проекта» v1',
        system: true,
      },
    ]);
  });

  it('условие не выполнено — запуск «остановлен» с причиной, задача не меняется', () => {
    const { p, t, auto } = setup([rule()], mkTask('T-63', { priority: 'normal' }));
    auto.autoFire(p, t, 'created', null);
    expect(p.runs?.[0]).toMatchObject({
      res: 'stopped',
      text: 'T-63: приоритет «Обычный» — условие не выполнено',
    });
    expect(t.comments).toEqual([]);
    expect(t.assignee).toBe('Илья Васильев');
  });

  it('у автора правила нет права менять задачи — ошибка в журнал и событие владельцам', () => {
    const { db, p, t, auto } = setup([rule({ byId: 'm-kotelnikova', by: 'Вера Котельникова' })]);
    auto.autoFire(p, t, 'created', null);
    const why = 'роль «Согласующий» не даёт «Менять статус»';
    expect(p.runs?.[0]).toMatchObject({
      res: 'error',
      text: 'У автора правила Вера Котельникова нет права менять задачи: ' + why,
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'Правило «Срочная задача → назначить руководителю проекта» не выполнено: ' + why,
      to: ['m-owner'],
      at: '09:12',
    });
    expect(t.comments).toEqual([]);
  });

  it('назначить неактивного или неизвестного нельзя', () => {
    const { p, t, auto } = setup([
      rule({ cond: null, action: { kind: 'assign', value: 'Олеся Петрова' } }),
      rule({ id: 'ar-9', cond: null, action: { kind: 'assign', value: 'Никто' } }),
    ]);
    auto.autoFire(p, t, 'created', null);
    expect(p.runs?.map((r) => r.text)).toEqual([
      'Сотрудник «Никто» не найден или неактивен',
      'Сотрудник «Олеся Петрова» не найден или неактивен',
    ]);
    expect(t.assignee).toBe('Илья Васильев');
  });

  it('действия «приоритет» и «комментарий»; правило со старой версией без номера — v1', () => {
    const { p, t, auto } = setup([
      rule({
        id: 'ar-2',
        trigger: 'status',
        to: 's4',
        cond: null,
        version: 3,
        action: { kind: 'priority', value: 'low' },
      }),
      rule({
        id: 'ar-3',
        trigger: 'status',
        to: 's4',
        cond: null,
        version: 0,
        name: 'Готово → напомнить',
        action: { kind: 'comment', value: 'Проверьте, что путевой лист сдан в бухгалтерию' },
      }),
      rule({ id: 'ar-4', trigger: 'status', to: 's2', cond: null }),
      rule({ id: 'ar-5', on: false, trigger: 'status', to: 's4', cond: null }),
    ]);
    auto.autoFire(p, t, 'status', 's4');
    expect(t.priority).toBe('low');
    expect(p.runs?.map((r) => [r.rule, r.rv, r.text])).toEqual([
      ['ar-3', 1, 'LOG-101: добавлен комментарий'],
      ['ar-2', 3, 'LOG-101: приоритет «Низкий»'],
    ]);
    expect(t.comments.map((c) => c.text)).toEqual([
      'Правило «Срочная задача → назначить руководителю проекта» v3',
      'Проверьте, что путевой лист сдан в бухгалтерию',
      'Правило «Готово → напомнить» v1',
    ]);
  });

  it('неизвестный приоритет подписывается своим значением; журнал — не больше 30 записей', () => {
    const { p, t, auto } = setup([
      rule({ cond: null, action: { kind: 'priority', value: 'asap' } }),
    ]);
    p.runs = Array.from({ length: 30 }, (_, i) => ({
      at: '08:00',
      rule: 'ar-0',
      name: 'старое',
      rv: 1,
      res: 'ok' as const,
      text: 'старый запуск ' + i,
      task: 'T-1',
    }));
    auto.autoFire(p, t, 'created', null);
    expect(p.runs).toHaveLength(30);
    expect(p.runs[0]?.text).toBe('LOG-101: приоритет «asap»');
    expect(p.runs[29]?.text).toBe('старый запуск 28');
  });

  it('изменения правил не запускают правила: повторный вход во время запуска игнорируется', () => {
    const p: Project = mkProject('approval', 'limited', {
      automations: [rule({ byId: 'm-kotelnikova', cond: null })],
      runs: [],
    });
    const t = mkTask('LOG-101');
    const db = altaDb([p], [t]);
    let reentered = 0;
    const auto = createAutomation(
      () => db,
      clock,
      (text, to) => {
        reentered++;
        auto.autoFire(p, t, 'created', null);
        return { id: 'e1', at: '09:12', text, to: [...to], sensitive: null };
      },
    );
    auto.autoFire(p, t, 'created', null);
    expect(reentered).toBe(1);
    expect(p.runs).toHaveLength(1);
    // После завершения запуска правила снова срабатывают.
    auto.autoFire(p, t, 'created', null);
    expect(p.runs).toHaveLength(2);
  });

  it('проект без правил и журнала — без эффекта', () => {
    const { auto } = setup([]);
    const bare = mkProject('simple', 'open', { automations: undefined, runs: undefined });
    const t = mkTask('X-1');
    auto.autoFire(bare, t, 'created', null);
    expect(t.comments).toEqual([]);
  });
});

describe('moveTo: переход статуса (api.js:142–148)', () => {
  const trOf = (p: Project, id: string): Transition => {
    const tr = p.wf?.transitions.find((x) => x.id === id);
    if (!tr) throw new Error(id);
    return tr;
  };

  it('статус, сброс согласования, системный комментарий, «назначить на автора», автоматизация', () => {
    const ar2 = rule({
      id: 'ar-2',
      trigger: 'status',
      to: 's4',
      cond: null,
      action: { kind: 'comment', value: 'Проверьте, что путевой лист сдан в бухгалтерию' },
    });
    const t = mkTask('T-65', {
      status: 'На проверке',
      author: 'Илья Васильев',
      authorId: 'm-vasiliev',
      assignee: 'Марина Котова',
      approval: { tr: 't3', votes: [] },
    });
    const { p, auto } = setup([ar2], t);
    const me = { id: 'm-kotelnikova', name: 'Вера Котельникова' };
    auto.moveTo(p, t, trOf(p, 't3'), me, 'Счёт проверен');
    expect(t).toMatchObject({ status: 'Готово', approval: null, assignee: 'Илья Васильев' });
    expect(t.comments.map((c) => [c.by, c.text])).toEqual([
      ['Вера Котельникова', 'Согласовать: На проверке → Готово. Счёт проверен'],
      ['Процесс', 'Назначено на автора: Илья Васильев'],
      ['Автоматизация', 'Проверьте, что путевой лист сдан в бухгалтерию'],
      ['Автоматизация', 'Правило «Срочная задача → назначить руководителю проекта» v1'],
    ]);
  });

  it('без актора — «Система»; без автора задача не переназначается', () => {
    const t = mkTask('LOG-101', { status: 'В работе' });
    const { p, auto } = setup([], t);
    const send = trOf(p, 't2');
    auto.moveTo(p, t, { ...send, assignAuthor: true }, null, '');
    expect(t.status).toBe('На проверке');
    expect(t.assignee).toBe('Илья Васильев');
    expect(t.comments).toEqual([
      { by: 'Система', at: '09:12', text: 'На проверку: В работе → На проверке', system: true },
    ]);
  });

  it('переход на удалённый статус — ошибка процесса', () => {
    const t = mkTask('LOG-101', { status: 'В работе' });
    const { p, auto } = setup([], t);
    expect(() => auto.moveTo(p, t, { ...trOf(p, 't2'), to: 's9' }, null, '')).toThrow(
      'Переход удалён из процесса',
    );
  });
});
