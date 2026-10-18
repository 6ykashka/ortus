// Срез «Задачи и проекты» (mock-data.js 14.10, models.js:164–235, api.js:23–36, 618–769, docs/21).
// Проект расширяет `ProjectRef` ядра: процесс с версиями, уровень доступа, автоматизация и журнал.
// Проект «на всю организацию» — без `unit` (в эталоне `unit: null`).
import type { ProjectRef, Verb } from '../../core/types/index.ts';
import type { StatusCat, TaskComment, TaskLink, TaskPriority } from '../../core/task-port.ts';

export type { StatusCat, TaskComment, TaskLink, TaskPriority };

/** Уровень доступа проекта: открытый — все права ролей области, ограниченный — чтение, закрытый — ничего. */
export type ProjectAccessLevel = 'open' | 'limited' | 'closed';

export interface WfStatus {
  id: string;
  name: string;
  cat: StatusCat;
}

/** «Кто может» выполнить переход: роль проекта, исполнитель или автор задачи. */
export type TransitionWho = 'r-pm' | 'r-approver' | 'r-exec' | 'assignee' | 'author';

export interface TransitionApproval {
  /** `any` — достаточно одного согласующего, `all` — нужны все. */
  mode: 'any' | 'all';
  /** Статус, куда возвращается задача при отказе. */
  rejectTo: string;
}

export interface Transition {
  id: string;
  name: string;
  /** Статусы-источники; `'*'` — из любого, кроме целевого. */
  from: string[];
  to: string;
  who: TransitionWho[];
  notAuthor: boolean;
  approval: TransitionApproval | null;
  comment: boolean;
  checklist: boolean;
  assignAuthor: boolean;
  /** Подзадачи должны быть завершены. */
  children?: boolean;
}

export interface WorkflowDraft {
  statuses: WfStatus[];
  transitions: Transition[];
}

export interface Workflow extends WorkflowDraft {
  v: number;
  draft?: WorkflowDraft;
}

export type AutomationTrigger = 'created' | 'status';

export interface AutomationAction {
  kind: 'assign' | 'priority' | 'comment';
  value: string;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  /** Для `status` — id статуса, в который перешла задача. */
  to: string | null;
  cond: { priority?: TaskPriority } | null;
  action: AutomationAction;
  on: boolean;
  version: number;
  /** Автор правила: правило выполняется от его имени. */
  by: string;
  byId: string;
}

export type RunResult = 'ok' | 'stopped' | 'error';

export interface AutomationRun {
  at: string;
  rule: string;
  name: string;
  rv: number;
  res: RunResult;
  text: string;
  task: string;
}

export interface Project extends ProjectRef {
  key: string;
  owner: string;
  /** `leads` — воронка заявок (старый канбан, `WORKFLOWS.leads`), процесса нет. */
  flow?: 'leads';
  access?: ProjectAccessLevel;
  wf?: Workflow;
  automations?: Automation[];
  runs?: AutomationRun[];
}

export interface ChecklistItem {
  t: string;
  d: boolean;
}

export interface TaskFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string | null;
  by: string;
  byId: string;
  at: string;
}

/** Файл до прикрепления (`checkFiles`). */
export interface FileDraft {
  name: string;
  size: number;
  type?: string;
  url?: string | null;
}

export interface ApprovalVote {
  tr: string;
  by: string;
  name: string;
  at: string;
}

export interface TaskApproval {
  tr: string;
  votes: ApprovalVote[];
}

export interface Lead {
  client: string;
  source: string;
  sum: number | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  files?: TaskFile[];
  /** Имя исполнителя (в эталоне задачи адресуются по имени). */
  assignee: string;
  author?: string;
  authorId?: string;
  status: string;
  priority: TaskPriority;
  due: string;
  project: string;
  parent?: string | null;
  checklist: ChecklistItem[];
  comments: TaskComment[];
  links: TaskLink[];
  approval?: TaskApproval | null;
  /** Ответ формы и правило, создавшие задачу. */
  source?: string;
  rule?: string;
  lead?: Lead;
  /** Сводка маршрута документа (`documents.js` `syncTask`): статус меняет маршрут. */
  docRoute?: DocRouteSummary;
}

export interface DocRouteSummary {
  title: string;
  waiting?: string[];
  [key: string]: unknown;
}

/** Доступ участника к проекту и его происхождение (`projAccess`). */
export interface ProjAccess {
  verbs: Verb[];
  via: string;
  inherited: boolean;
  roleName: string;
  owner?: true;
  role?: string;
  aid?: string;
}

export type ProjCanResult =
  { ok: true; a: ProjAccess } | { ok: false; why: string; a?: ProjAccess };

/** Результат проверки перехода: `hide` — переход не из текущего статуса, кнопки нет. */
export type TrCheck = { ok: true } | { ok: false; hide: true } | { ok: false; why: string };

export interface TasksSlices {
  tasks?: Task[];
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends TasksSlices {}
}
