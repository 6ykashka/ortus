// Тестовый двойник `TaskPort` для модулей (документы, чаты, обращения) до реализации W4.10.
// Хранит задачи в памяти; статусы процесса проекта задаются в опциях.
import { createIdGen, type IdGen } from '../ids.ts';
import { DEFAULT_STATUS, type StatusCat, type TaskPort, type TaskSnapshot } from '../task-port.ts';

export interface FakeTaskPortOpts {
  /** Статусы процесса по проектам (`p.wf.statuses`). */
  statuses?: Record<string, { id: string; name: string; cat: StatusCat }[]>;
  ids?: IdGen;
}

export interface FakeTaskPort extends TaskPort {
  all(): TaskSnapshot[];
}

export function createFakeTaskPort(opts: FakeTaskPortOpts = {}): FakeTaskPort {
  const ids = opts.ids ?? createIdGen({ seq: 1 });
  const tasks = new Map<string, TaskSnapshot>();
  const statusName: TaskPort['statusName'] = (projectId, cat, preferred) => {
    const list = opts.statuses?.[projectId] ?? [];
    const hit = list.find((s) => s.name === preferred) ?? list.find((s) => s.cat === cat);
    return hit?.name ?? preferred ?? DEFAULT_STATUS[cat];
  };
  return {
    create(d) {
      const id = ids.next(d.idPrefix ?? 'T-', d.idBase ?? 0);
      const t: TaskSnapshot = {
        id,
        project: d.project,
        title: d.title,
        status: d.status ?? statusName(d.project, 'todo'),
        assignee: d.assignee,
        comments: [...(d.comments ?? [])],
        links: [...(d.links ?? [])],
      };
      if (d.due) t.due = d.due;
      if (d.priority) t.priority = d.priority;
      if (d.authorId) t.authorId = d.authorId;
      tasks.set(id, t);
      return { id };
    },
    get: (id) => tasks.get(id),
    update(id, patch) {
      const t = tasks.get(id);
      if (t) Object.assign(t, patch);
    },
    comment(id, c) {
      tasks.get(id)?.comments.push(c);
    },
    statusName,
    all: () => [...tasks.values()],
  };
}
