// Порт задач (B §5.1): документы (маршрут → задача согласования), чаты («Задача из сообщения»)
// и обращения создают и синхронизируют задачи через этот интерфейс, не импортируя модуль задач.
// Реализация поверх `db.tasks` и процессов проектов — W4.10 (P1a tasks); в ядре — только контракт
// и тестовый двойник `testing/fake-task-port.ts`.

export type StatusCat = 'todo' | 'progress' | 'done';

/** Имя статуса категории, если у проекта нет процесса (`documents.js` `syncTask`). */
export const DEFAULT_STATUS: Readonly<Record<StatusCat, string>> = {
  todo: 'Новая',
  progress: 'В работе',
  done: 'Готово',
};

export interface TaskLink {
  kind: string;
  id: string;
  label: string;
}

export interface TaskComment {
  by: string;
  at: string;
  text: string;
  system?: boolean;
}

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface TaskDraft {
  project: string;
  title: string;
  assignee: string;
  description?: string;
  labels?: string[];
  author?: string;
  authorId?: string;
  priority?: TaskPriority;
  due?: string;
  /** Имя статуса; без него — первый статус категории `todo` процесса проекта. */
  status?: string;
  links?: TaskLink[];
  comments?: TaskComment[];
  /** Схема id: `idPrefix + (idBase + seq)`; по умолчанию `'T-' + seq`. Проекты с процессом — `KEY-` и 100. */
  idPrefix?: string;
  idBase?: number;
}

export interface TaskSnapshot {
  id: string;
  project: string;
  title: string;
  status: string;
  assignee: string;
  due?: string;
  priority?: TaskPriority;
  authorId?: string;
  docRoute?: unknown;
  comments: TaskComment[];
  links: TaskLink[];
}

export interface TaskPatch {
  status?: string;
  assignee?: string;
  due?: string;
  priority?: TaskPriority;
  /** Сводка маршрута документа на задаче; `null` — снять. */
  docRoute?: unknown;
}

export interface TaskPort {
  create(draft: TaskDraft): { id: string };
  get(id: string): TaskSnapshot | undefined;
  /** Несуществующая задача — без эффекта (задачу могли удалить). */
  update(id: string, patch: TaskPatch): void;
  comment(id: string, c: TaskComment): void;
  /** Имя статуса процесса проекта: `preferred`, иначе первый статус категории, иначе `preferred` или `DEFAULT_STATUS`. */
  statusName(projectId: string, cat: StatusCat, preferred?: string): string;
}
