// Проекция «Задач и проектов» для участника (api.js 14.10:202–205): проекты, к которым у участника
// есть доступ (`projAccess`), и задачи — видимых проектов, назначенные ему или задачи маршрута
// документа, где он автор или его ждёт маршрут. Отличие от эталона (PD-60, TP-03): видимость
// проекта совпадает с доступом — закрытый проект не попадает в список по унаследованной роли.
import type { CoreDb } from '../../core/types/index.ts';
import { projAccess } from './access.ts';
import type { Project, Task } from './types.ts';
import { projectsOf, tasksOf } from './workflow.ts';

export interface TasksView {
  projects: Project[];
  tasks: Task[];
}

export function tasksView(db: CoreDb & { tasks?: Task[] }, actor: string): TasksView {
  const me = db.members.find((m) => m.id === actor);
  const projects = projectsOf(db).filter((p) => projAccess(db, p, actor) !== null);
  const pids = new Set(projects.map((p) => p.id));
  const tasks = tasksOf(db).filter(
    (t) =>
      pids.has(t.project) ||
      (!!me && t.assignee === me.name) ||
      (!!t.docRoute && (t.authorId === actor || (t.docRoute.waiting ?? []).includes(actor))),
  );
  return structuredClone({ projects, tasks });
}
