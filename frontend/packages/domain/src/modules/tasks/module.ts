// Модуль «Задачи и проекты» по контракту `DomainModule` ядра (B §5.1): установка сида, проекция,
// 20 команд с задержками. Стадия сида `normProjects` — отдельный хук (`SEED_STAGES` ядра).
// Регистрацию в `modules/index.ts` и хук в `seed/compose.ts` подключает интегратор (план v2 §3.5).
import type { DomainModule } from '../../core/module.ts';
import type { SeedHook } from '../../core/seed-hooks.ts';
import { TASK_DELAYS, TASK_METHODS, tasksCommands } from './commands.ts';
import { normProjects, tasksSeed } from './seed.ts';
import { tasksView, type TasksView } from './view.ts';

export const tasksModule: DomainModule<TasksView | undefined> = {
  key: 'tasks',
  install(db, opts) {
    const seed = tasksSeed(opts.tenantId);
    db.projects ??= seed.projects;
    db.tasks ??= seed.tasks;
  },
  view: (db, actor) => (db.tasks ? tasksView(db, actor) : null),
  commands: (ctx) => tasksCommands(ctx),
  methods: TASK_METHODS,
  delays: TASK_DELAYS,
};

/** Хук стадии `normProjects` для `createSeed({ hooks })`. */
export const normProjectsHook: SeedHook = (db) => normProjects(db);
