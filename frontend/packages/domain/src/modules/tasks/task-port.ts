// Реализация `TaskPort` ядра поверх `db.tasks` и процессов проектов (W0.11 → W4.10). Документы
// (маршрут → задача согласования, `syncTask`), чаты («Задача из сообщения») и обращения создают
// и синхронизируют задачи через порт, не импортируя модуль задач. Автоматизацию порт не запускает:
// в эталоне задачи документов и чатов создаются напрямую в `db.tasks` (documents.js:861, chats.js:497).
import type { IdGen } from '../../core/ids.ts';
import {
  DEFAULT_STATUS,
  type TaskPatch,
  type TaskPort,
  type TaskSnapshot,
} from '../../core/task-port.ts';
import type { TenantDb } from '../../core/types/index.ts';
import type { DocRouteSummary, Task } from './types.ts';
import { projectOf } from './workflow.ts';

function snapshot(t: Task): TaskSnapshot {
  const s: TaskSnapshot = {
    id: t.id,
    project: t.project,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    due: t.due,
    priority: t.priority,
    comments: t.comments.map((c) => ({ ...c })),
    links: t.links.map((l) => ({ ...l })),
  };
  if (t.authorId) s.authorId = t.authorId;
  if (t.docRoute) s.docRoute = structuredClone(t.docRoute);
  return s;
}

function applyPatch(t: Task, patch: TaskPatch): void {
  if (patch.status !== undefined) t.status = patch.status;
  if (patch.assignee !== undefined) t.assignee = patch.assignee;
  if (patch.due !== undefined) t.due = patch.due;
  if (patch.priority !== undefined) t.priority = patch.priority;
  if (patch.docRoute === null) delete t.docRoute;
  else if (patch.docRoute !== undefined) t.docRoute = patch.docRoute as DocRouteSummary;
}

export function createTaskPort(getDb: () => TenantDb, ids: IdGen): TaskPort {
  const find = (id: string): Task | undefined => (getDb().tasks ?? []).find((x) => x.id === id);

  const statusName: TaskPort['statusName'] = (projectId, cat, preferred) => {
    const list = projectOf(getDb(), projectId)?.wf?.statuses ?? [];
    const hit = list.find((s) => s.name === preferred) ?? list.find((s) => s.cat === cat);
    return hit?.name ?? preferred ?? DEFAULT_STATUS[cat];
  };

  return {
    create(d) {
      const db = getDb();
      const t: Task = {
        id: ids.next(d.idPrefix ?? 'T-', d.idBase ?? 0),
        title: d.title,
        description: d.description ?? '',
        labels: [...(d.labels ?? [])],
        assignee: d.assignee,
        status: d.status ?? statusName(d.project, 'todo'),
        priority: d.priority ?? 'normal',
        due: d.due ?? '—',
        project: d.project,
        checklist: [],
        comments: (d.comments ?? []).map((c) => ({ ...c })),
        links: (d.links ?? []).map((l) => ({ ...l })),
        files: [],
      };
      if (d.author) t.author = d.author;
      if (d.authorId) t.authorId = d.authorId;
      (db.tasks ??= []).unshift(t);
      return { id: t.id };
    },
    get: (id) => {
      const t = find(id);
      return t ? snapshot(t) : undefined;
    },
    update(id, patch) {
      const t = find(id);
      if (t) applyPatch(t, patch);
    },
    comment(id, c) {
      find(id)?.comments.push({ ...c });
    },
    statusName,
  };
}
