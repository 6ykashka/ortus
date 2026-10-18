// Экспорт-лист модуля «Задачи» (`modules/tasks/index.ts`). Интегратор подключил его одной строкой
// в `modules/index.ts` (вливание W4.10). Расширяется только добавлением.
import { describe, expect, it } from 'vitest';

const TASKS_EXPORTS = [
  // модуль и сид
  'tasksModule',
  'normProjectsHook',
  'tasksSeed',
  'normProjects',
  // справочники
  'TASK_STATUSES',
  'TASK_FLOW',
  'TASK_TONE',
  'WORKFLOWS',
  'PROJECT_ROLES',
  'VERB_LABEL',
  'WHO_LABEL',
  'WHO_VERB',
  'STATUS_CAT',
  'PRIORITY',
  'DONE_NAMES',
  // процесс, доступ, переходы
  'buildWf',
  'wfOf',
  'childrenOf',
  'isDone',
  'projectsOf',
  'projectOf',
  'tasksOf',
  'projAccess',
  'projCan',
  'approversOf',
  'trCheck',
  // вложения, иерархия, автоматизация
  'checkFiles',
  'FILE_MAX_BYTES',
  'FILES_PER_TASK',
  'checkParent',
  'createAutomation',
  'ownerIds',
  'RUNS_KEPT',
  // порт, команды, проекция
  'createTaskPort',
  'tasksCommands',
  'TASK_METHODS',
  'TASK_DELAYS',
  'tasksView',
];

// Динамический импорт точек входа под нагрузкой машины дольше 5 с по умолчанию.
const IMPORT_TIMEOUT = 60_000;

describe('экспорт-лист модуля «Задачи»', () => {
  it(
    'функции, справочники и модуль, ничего лишнего',
    async () => {
      const pkg = await import('./index.ts');
      expect(Object.keys(pkg).sort()).toEqual([...TASKS_EXPORTS].sort());
    },
    IMPORT_TIMEOUT,
  );

  it(
    'все имена модуля доступны через точку входа @ortus/domain/modules',
    async () => {
      const pilot = Object.keys(await import('../index.ts'));
      expect(TASKS_EXPORTS.filter((x) => !pilot.includes(x))).toEqual([]);
    },
    IMPORT_TIMEOUT,
  );
});
