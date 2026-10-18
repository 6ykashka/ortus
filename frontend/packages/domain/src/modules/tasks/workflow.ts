// Процесс проекта и иерархия задач (models.js 14.10:178, 185–193, 214–215).
import { DONE_NAMES, WORKFLOWS, type BoardFlow } from './dictionaries.ts';
import type { Project, Task, Transition, Workflow } from './types.ts';

/** Проекты и задачи среза; у ядра `projects` — `ProjectRef[]`, модуль задач читает их как `Project[]`. */
export const projectsOf = (db: { projects?: readonly unknown[] }): Project[] =>
  (db.projects ?? []) as Project[];
export const tasksOf = (db: { tasks?: Task[] }): Task[] => db.tasks ?? [];
export const projectOf = (db: { projects?: readonly unknown[] }, id: string): Project | undefined =>
  projectsOf(db).find((p) => p.id === id);

/** Процесс по умолчанию: «Простой» (принимает руководитель проекта) или «С согласованием». */
export function buildWf(kind: string): Workflow {
  const approval = kind === 'approval';
  const tr = (
    id: string,
    name: string,
    from: string[],
    to: string,
    o: Partial<Transition> = {},
  ): Transition => ({
    id,
    name,
    from,
    to,
    who: [],
    notAuthor: false,
    approval: null,
    comment: false,
    checklist: false,
    assignAuthor: false,
    ...o,
  });
  const transitions = [
    tr('t1', 'Взять в работу', ['s1'], 's2'),
    tr('t2', 'На проверку', ['s2'], 's3'),
    approval
      ? tr('t3', 'Согласовать', ['s3'], 's4', {
          notAuthor: true,
          approval: { mode: 'any', rejectTo: 's2' },
          checklist: true,
          children: true,
          assignAuthor: true,
        })
      : tr('t3', 'Принять', ['s3'], 's4', { who: ['r-pm'], checklist: true, children: true }),
    ...(approval
      ? []
      : [tr('t4', 'Вернуть на доработку', ['s3'], 's2', { who: ['r-pm'], comment: true })]),
    tr('t5', 'Отменить', ['*'], 's5', { who: ['r-pm'], comment: true }),
  ];
  return {
    v: 1,
    statuses: [
      { id: 's1', name: 'Новая', cat: 'todo' },
      { id: 's2', name: 'В работе', cat: 'progress' },
      { id: 's3', name: 'На проверке', cat: 'progress' },
      { id: 's4', name: 'Готово', cat: 'done' },
      { id: 's5', name: 'Отменена', cat: 'done' },
    ],
    transitions,
  };
}

/** Процесс старой доски для задачи: воронка «Заявки» или процесс задач (пустой flow — задачи). */
export const wfOf = (db: { projects?: readonly unknown[] }, t: Task): BoardFlow =>
  WORKFLOWS[projectOf(db, t.project)?.flow || 'tasks'];

export const childrenOf = (db: { tasks?: Task[] }, t: Task): Task[] =>
  tasksOf(db).filter((x) => x.parent === t.id);

/** Завершена ли задача: статус категории «Готово» процесса проекта, без процесса — по имени статуса. */
export function isDone(db: { projects?: readonly unknown[] }, t: Task): boolean {
  const st = projectOf(db, t.project)?.wf?.statuses.find((s) => s.name === t.status);
  return st ? st.cat === 'done' : DONE_NAMES.includes(t.status);
}
