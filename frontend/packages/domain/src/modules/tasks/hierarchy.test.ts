import { describe, expect, it } from 'vitest';
import { ApiError } from '../../core/errors/index.ts';
import { altaDb, mkProject, mkTask } from './fixture.test-util.ts';
import { checkParent } from './hierarchy.ts';
import type { Task } from './types.ts';

const err = (f: () => unknown): { code: string; message: string } => {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('нет ошибки');
};

const fleet = mkProject('approval');
const closed = mkProject('simple', 'closed', { id: 'secret', key: 'SEC', name: 'Секретный' });
const legacy = mkProject('simple', 'limited', {
  id: 'leads',
  key: 'ЗАЯ',
  flow: 'leads',
  wf: undefined,
});

/** T-66 ← T-65, T-58; T-70 ← T-71 ← T-72 (три уровня); отдельные T-1, T-2. */
function db(extra: Task[] = []) {
  return altaDb(
    [fleet, closed, legacy],
    [
      mkTask('T-66', { status: 'В работе' }),
      mkTask('T-65', { parent: 'T-66', status: 'На проверке' }),
      mkTask('T-58', { parent: 'T-66', status: 'В работе' }),
      mkTask('T-70'),
      mkTask('T-71', { parent: 'T-70' }),
      mkTask('T-72', { parent: 'T-71' }),
      mkTask('T-1'),
      mkTask('T-2'),
      mkTask('T-9', { status: 'Готово' }),
      mkTask('S-1', { project: 'secret' }),
      mkTask('L-31', { project: 'leads' }),
      ...extra,
    ],
  );
}
const task = (d: ReturnType<typeof db>, id: string): Task => {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

describe('checkParent: «входит в» (api.js:128–139)', () => {
  it('родитель для новой задачи и для существующей', () => {
    const d = db();
    expect(checkParent(d, 'm-kotova', null, 'T-66').id).toBe('T-66');
    expect(checkParent(d, 'm-kotova', task(d, 'T-1'), 'T-66').id).toBe('T-66');
    expect(checkParent(d, 'm-kotova', task(d, 'T-1'), 'T-71').id).toBe('T-71');
  });

  it.each([
    ['m-kotova', null, 'T-404', 'validation', 'Задача T-404 не найдена'],
    ['m-kotova', null, 'S-1', 'forbidden', 'Нет доступа к задаче S-1'],
    ['m-morozova', null, 'T-66', 'forbidden', 'Нет доступа к задаче T-66'],
    ['m-owner', null, 'L-31', 'forbidden', 'Нет доступа к задаче L-31'],
    ['m-kotova', 'T-1', 'T-1', 'validation', 'Задача не может входить в саму себя'],
    ['m-kotova', 'T-66', 'T-65', 'validation', 'Получится цикл: T-65 уже входит в T-66'],
    ['m-kotova', 'T-70', 'T-72', 'validation', 'Получится цикл: T-72 уже входит в T-70'],
    [
      'm-kotova',
      null,
      'T-72',
      'validation',
      'Не больше трёх уровней: задача → подзадача → подзадача',
    ],
    [
      'm-kotova',
      'T-1',
      'T-72',
      'validation',
      'Не больше трёх уровней: задача → подзадача → подзадача',
    ],
    [
      'm-kotova',
      'T-70',
      'T-1',
      'validation',
      'Не больше трёх уровней: задача → подзадача → подзадача',
    ],
    [
      'm-kotova',
      'T-66',
      'T-71',
      'validation',
      'Не больше трёх уровней: задача → подзадача → подзадача',
    ],
    [
      'm-kotova',
      'T-1',
      'T-9',
      'validation',
      'Задача T-9 уже завершена — сначала верните её в работу',
    ],
  ] as const)('%s: %s → %s — %s «%s»', (actor, child, parent, code, message) => {
    const d = db();
    expect(err(() => checkParent(d, actor, child ? task(d, child) : null, parent))).toEqual({
      code,
      message,
    });
  });

  it('два уровня под задачей с подзадачами допустимы', () => {
    const d = db();
    expect(checkParent(d, 'm-kotova', task(d, 'T-66'), 'T-1').id).toBe('T-1');
    expect(checkParent(d, 'm-kotova', task(d, 'T-2'), 'T-65').id).toBe('T-65');
  });

  it('битая цепочка родителей не зацикливает проверку', () => {
    const loop = [mkTask('A', { parent: 'B' }), mkTask('B', { parent: 'A' })];
    const d = db(loop);
    expect(err(() => checkParent(d, 'm-kotova', null, 'A')).message).toBe(
      'Не больше трёх уровней: задача → подзадача → подзадача',
    );
  });
});
