// Иерархия задач (api.js 14.10:128–139, docs/21 «Связи задач»): один родитель, до трёх уровней,
// без циклов; родитель — видимая актору незавершённая задача проекта с процессом.
import { ApiError } from '../../core/errors/index.ts';
import type { CoreDb } from '../../core/types/index.ts';
import { projCan } from './access.ts';
import type { Task } from './types.ts';
import { isDone, projectOf, tasksOf } from './workflow.ts';

const MAX_LEVELS = 3;
/** Предел обхода цепочки родителей (защита от битых данных). */
const MAX_WALK = 10;

/**
 * Проверяет, что `t` (или новая задача при `t = null`) может войти в `parentId`; возвращает родителя.
 * Ошибки: `validation` (нет задачи, сама в себя, цикл, уровни, завершена) и `forbidden` (не видна).
 */
export function checkParent(
  db: CoreDb & { tasks?: Task[] },
  actor: string,
  t: Task | null,
  parentId: string,
): Task {
  const all = tasksOf(db);
  const par = all.find((x) => x.id === parentId);
  if (!par) throw new ApiError('validation', 'Задача ' + parentId + ' не найдена');
  const pp = projectOf(db, par.project);
  if (!pp?.wf || !projCan(db, pp, actor, 'view').ok) {
    throw new ApiError('forbidden', 'Нет доступа к задаче ' + parentId);
  }
  if (t && par.id === t.id) throw new ApiError('validation', 'Задача не может входить в саму себя');
  let up: Task | undefined = par;
  let depth = 1;
  while (up?.parent) {
    if (t && up.parent === t.id) {
      throw new ApiError('validation', 'Получится цикл: ' + par.id + ' уже входит в ' + t.id);
    }
    const next: string = up.parent;
    up = all.find((x) => x.id === next);
    depth++;
    if (depth > MAX_WALK) break;
  }
  const below = (x: Task): number =>
    1 + Math.max(0, ...all.filter((y) => y.parent === x.id).map(below));
  if (depth + (t ? below(t) : 1) > MAX_LEVELS) {
    throw new ApiError('validation', 'Не больше трёх уровней: задача → подзадача → подзадача');
  }
  if (isDone(db, par)) {
    throw new ApiError(
      'validation',
      'Задача ' + par.id + ' уже завершена — сначала верните её в работу',
    );
  }
  return par;
}
