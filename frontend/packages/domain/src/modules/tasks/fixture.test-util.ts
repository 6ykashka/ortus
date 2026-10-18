// Общие помощники табличных тестов модуля задач: «Альта» сырого сида 14.10 (люди, роли,
// назначения ap1–ap3) и конструкторы проекта и задачи. Только для тестов.
import { ApiError } from '../../core/errors/index.ts';
import type { Assignment, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import type { Project, ProjectAccessLevel, Task } from './types.ts';
import { buildWf } from './workflow.ts';

export type TestDb = TenantDb & { projects: Project[]; tasks: Task[] };

export function mkProject(
  kind: 'approval' | 'simple',
  access: ProjectAccessLevel = 'limited',
  o: Partial<Project> = {},
): Project {
  return {
    id: 'fleet',
    key: 'LOG',
    name: 'Логистика · Север',
    unit: 'f-msk-sever',
    owner: 'Марина Котова',
    access,
    wf: buildWf(kind),
    automations: [],
    runs: [],
    ...o,
  };
}

export function mkTask(id: string, o: Partial<Task> = {}): Task {
  return {
    id,
    title: 'Задача ' + id,
    assignee: 'Илья Васильев',
    status: 'Новая',
    priority: 'normal',
    due: '—',
    project: 'fleet',
    checklist: [],
    comments: [],
    links: [],
    ...o,
  };
}

/** Код и текст `ApiError`, которую бросает `f`. */
export function apiErr(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('ошибки нет');
}

/** «Альта» с проектами и задачами; `extra` — дополнительные назначения. */
export function altaDb(projects: Project[], tasks: Task[] = [], extra: Assignment[] = []): TestDb {
  const db = createAlta(createPlatform()) as TenantDb;
  db.assignments.push(...extra);
  return Object.assign(db, { projects, tasks });
}
