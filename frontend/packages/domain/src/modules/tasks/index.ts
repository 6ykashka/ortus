// Модуль «Задачи и проекты» (W4.10, P1a tasks): движок проектов задач из прототипа 14.10.
export type * from './types.ts';
export type { BoardFlow, StatusTone } from './dictionaries.ts';
export type { Automations } from './automation.ts';
export type { CheckedFile } from './files.ts';
export type { TasksSeed } from './seed.ts';
export type {
  CreateProjectInput,
  CreateProjectTaskInput,
  CreateTaskInput,
  TaskFieldPatch,
  TasksApi,
} from './commands.ts';
export type { TasksView } from './view.ts';
export { normProjectsHook, tasksModule } from './module.ts';
export { normProjects, tasksSeed } from './seed.ts';
export {
  DONE_NAMES,
  PRIORITY,
  PROJECT_ROLES,
  STATUS_CAT,
  TASK_FLOW,
  TASK_STATUSES,
  TASK_TONE,
  VERB_LABEL,
  WHO_LABEL,
  WHO_VERB,
  WORKFLOWS,
} from './dictionaries.ts';
export { buildWf, childrenOf, isDone, projectOf, projectsOf, tasksOf, wfOf } from './workflow.ts';
export { approversOf, projAccess, projCan } from './access.ts';
export { trCheck } from './transitions.ts';
export { checkFiles, FILE_MAX_BYTES, FILES_PER_TASK } from './files.ts';
export { checkParent } from './hierarchy.ts';
export { createAutomation, ownerIds, RUNS_KEPT } from './automation.ts';
export { createTaskPort } from './task-port.ts';
export { TASK_DELAYS, TASK_METHODS, tasksCommands } from './commands.ts';
export { tasksView } from './view.ts';
