// Паритет модуля «Задачи» с эталоном 14.10 (`design/ortus/models.js`, `mock-data.js`, `api.js`):
// одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
//
// Намеренные расхождения (бриф W4.10 §10) проверяются здесь же явно:
// - TP-03: владелец без роли в закрытом проекте доступа не получает (эталон — системная роль),
//   в том числе через старые команды доски (`toggleTaskCheck`, `commentTask`, `createTask`);
// - PD-53: `createProject` по роли проекта (Котова) запрещён;
// - видимость закрытого проекта по унаследованной роли (эталон `projVisible`) — нет;
// - `initProjectWorkflow` проекта без процесса выполняется (в эталоне `pj()` отказывает всегда).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assignment, TenantDb, Verb } from '../../core/types/index.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx, type DomainModule } from '../../core/module.ts';
import { demoClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { importReference, referenceModels } from '../../seed/reference.ts';
import { createPilotModules } from '../index.ts';
import { approversOf, projAccess, projCan } from './access.ts';
import { tasksCommands, type TasksApi } from './commands.ts';
import * as D from './dictionaries.ts';
import { normProjectsHook, tasksModule } from './module.ts';
import { tasksSeed } from './seed.ts';
import { createTaskPort } from './task-port.ts';
import { trCheck } from './transitions.ts';
import type { Project, ProjectAccessLevel, Task, Transition } from './types.ts';
import { tasksView } from './view.ts';
import { buildWf, childrenOf, isDone, wfOf } from './workflow.ts';

type Fn = (...a: unknown[]) => unknown;
type RefModels = Record<string, unknown> & {
  buildWf: Fn;
  projAccess: Fn;
  projCan: Fn;
  trCheck: Fn;
  approversOf: Fn;
  childrenOf: Fn;
  isDone: Fn;
  wfOf: Fn;
};
interface RefMockData {
  seed(): Record<string, unknown> & { platform: unknown };
  seedLotos(platform: unknown): Record<string, unknown>;
}
type RefApi = Record<string, (...a: unknown[]) => Promise<{ data: unknown }>> & {
  setActor(memberId: string | null, tenantId?: string): void;
  load(ms?: number): Promise<RefView>;
};
interface RefView {
  seq: number;
  projects: Project[];
  tasks: Task[];
  assignments: Assignment[];
  events: { id: string; text: string; to: string[] }[];
}

// Табличные прогоны (десятки тысяч сравнений) и импорт эталона под нагрузкой машины — дольше 5 с.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let M: RefModels;
let MD: RefMockData;
const call = <T>(f: Fn, ...args: unknown[]): T => f(...args) as T;

/** JSON без времени (`at` — `new Date()` эталона против часов домена) и с `unit: null` → без поля. */
function norm(x: unknown): unknown {
  return JSON.parse(
    JSON.stringify(x, (k, v: unknown) =>
      k === 'at' || (k === 'unit' && v === null) ? undefined : v,
    ),
  ) as unknown;
}

beforeAll(async () => {
  M = await referenceModels<RefModels>();
  MD = await importReference<RefMockData>('mock-data.js');
});

type Db = Omit<TenantDb, 'projects'> & { projects: Project[]; tasks: Task[] };

const seeded = (): Db =>
  createSeed({
    modules: [...createPilotModules(), tasksModule as DomainModule],
    hooks: { ...FUTURE_STAGE_HOOKS, normProjects: normProjectsHook },
  }).dbs['t-alta'] as unknown as Db;

describe('справочники и процесс = models.js', () => {
  it.each([
    'TASK_STATUSES',
    'TASK_FLOW',
    'TASK_TONE',
    'WORKFLOWS',
    'PROJECT_ROLES',
    'VERB_LABEL',
    'WHO_LABEL',
    'STATUS_CAT',
    'PRIORITY',
  ] as const)('%s', (name) => {
    expect(D[name]).toEqual(M[name]);
  });

  it('тон неизвестного статуса одинаковый', () => {
    const ref = M['TASK_TONE'] as Record<string, unknown>;
    expect(D.TASK_TONE['Статус проекта']).toEqual(ref['Статус проекта']);
  });

  it.each(['simple', 'approval', 'другой'])('buildWf(%s)', (kind) => {
    expect(buildWf(kind)).toEqual(call(M.buildWf, kind));
  });

  it('wfOf, childrenOf, isDone по всем задачам сида', () => {
    const db = seeded();
    for (const t of db.tasks) {
      expect(wfOf(db, t)).toEqual(call(M.wfOf, db, t));
      expect(childrenOf(db, t)).toEqual(call(M.childrenOf, db, t));
      expect(isDone(db, t)).toBe(call(M.isDone, db, t));
      for (const status of ['Готово', 'Отменена', 'Объект', 'Отказ', 'Новая', 'Свой']) {
        expect(isDone(db, { ...t, status })).toBe(call(M.isDone, db, { ...t, status }));
      }
    }
  });
});

const VERBS: Verb[] = ['view', 'create', 'edit', 'review', 'settings', 'export'];
const EXTRA: Assignment[] = [
  { id: 'x1', member: 'm-petrova', role: 'r-manager', scope: { type: 'region', id: 'r-msk' } },
  { id: 'x2', member: 'm-akhmedov', role: 'r-manager', scope: { type: 'tenant' } },
  { id: 'x3', member: 'm-ilyin', role: 'r-manager', scope: { type: 'firm', id: 'f-msk-yug' } },
  { id: 'x4', member: 'm-sokolov', role: 'r-viewer', scope: { type: 'project', id: 'leads' } },
  { id: 'x5', member: 'm-morozova', role: 'r-foreman', scope: { type: 'region', id: 'r-spb' } },
];

function variants(db: Db): Project[] {
  const out: Project[] = [];
  for (const base of db.projects)
    for (const access of ['open', 'limited', 'closed', undefined] as (
      ProjectAccessLevel | undefined
    )[])
      for (const unit of ['f-msk-sever', 'f-msk-yug', 'r-msk', 'r-spb', undefined]) {
        const p: Project = { ...base, unit };
        if (access) p.access = access;
        else delete p.access;
        out.push(p);
      }
  return out;
}

const isOwner = (db: Db, m: string): boolean =>
  db.assignments.some((a) => a.member === m && a.role === 'r-owner');
const ownRole = (db: Db, m: string, p: Project): boolean =>
  db.assignments.some((a) => a.member === m && a.scope.type === 'project' && a.scope.id === p.id);
/** TP-03: единственное расхождение доступа — владелец без роли в закрытом проекте. */
const tp03 = (db: Db, m: string, p: Project): boolean =>
  p.access === 'closed' && isOwner(db, m) && !ownRole(db, m, p);

describe('projAccess, projCan, approversOf = models.js (кроме TP-03)', () => {
  it('участники × проекты (доступ × подразделение) × действия', () => {
    const db = seeded();
    db.assignments.push(...EXTRA);
    let n = 0;
    let diverged = 0;
    for (const p of variants(db))
      for (const m of [...db.members.map((x) => x.id), 'm-nobody']) {
        const ref = call<unknown>(M.projAccess, db, p, m);
        if (tp03(db, m, p)) {
          diverged++;
          expect(ref).toMatchObject({ owner: true });
          expect(projAccess(db, p, m)).toBeNull();
          expect(projCan(db, p, m, 'view')).toEqual({
            ok: false,
            why: 'закрытый проект — нужна роль в самом проекте',
          });
          continue;
        }
        expect(projAccess(db, p, m)).toEqual(ref);
        for (const verb of VERBS) {
          expect(projCan(db, p, m, verb)).toEqual(call(M.projCan, db, p, m, verb));
          n++;
        }
      }
    expect(n).toBeGreaterThan(2000);
    expect(diverged).toBe(10);
  });

  it('approversOf: задачи × переходы × проекты', () => {
    const db = seeded();
    db.assignments.push(...EXTRA);
    for (const p of variants(db).filter((x) => x.access !== 'closed'))
      for (const t of db.tasks)
        for (const tr of buildWf('approval').transitions) {
          const mine = approversOf(db, p, t, tr).map((x) => x.id);
          const ref = call<{ id: string }[]>(M.approversOf, db, p, t, tr).map((x) => x.id);
          expect(mine).toEqual(ref);
        }
  });
});

describe('trCheck = models.js', () => {
  it('участники × задачи (статус × чек-лист × голоса × автор) × переходы обоих процессов', () => {
    const db = seeded();
    db.assignments.push(...EXTRA);
    const projects = [
      { ...db.projects[0], wf: buildWf('approval') } as Project,
      { ...db.projects[0], wf: buildWf('simple'), access: 'open' } as Project,
    ];
    const extraTr: Transition[] = [
      { ...(buildWf('simple').transitions[1] as Transition), id: 'tx1', who: ['assignee'] },
      {
        ...(buildWf('simple').transitions[1] as Transition),
        id: 'tx2',
        who: ['author', 'r-approver'],
        notAuthor: true,
      },
      {
        ...(buildWf('simple').transitions[1] as Transition),
        id: 'tx3',
        who: ['r-exec'],
        children: true,
      },
    ];
    let n = 0;
    for (const p of projects)
      for (const base of db.tasks.filter((t) => t.project === 'fleet'))
        for (const status of ['Новая', 'В работе', 'На проверке', 'Готово', 'Отменена', 'Свой'])
          for (const open of [false, true])
            for (const voted of [null, 'm-kotelnikova', 'm-owner']) {
              const t: Task = {
                ...base,
                status,
                checklist: open
                  ? [{ t: 'a', d: false }]
                  : base.checklist.map((c) => ({ ...c, d: true })),
                approval: voted
                  ? { tr: 't3', votes: [{ tr: 't3', by: voted, name: '', at: '' }] }
                  : null,
              };
              for (const tr of [...(p.wf?.transitions ?? []), ...extraTr])
                for (const m of [
                  'm-owner',
                  'm-kotova',
                  'm-vasiliev',
                  'm-kotelnikova',
                  'm-petrova',
                  'm-morozova',
                  'm-gromov',
                ]) {
                  expect(trCheck(db, p, t, m, tr)).toEqual(call(M.trCheck, db, p, t, m, tr));
                  n++;
                }
            }
    expect(n).toBeGreaterThan(10000);
  });
});

describe('сид = mock-data.js и normProjects эталона', () => {
  let A: RefApi;
  beforeAll(async () => {
    const api = await importReference<{ createMockAdapter(): RefApi }>('api.js');
    A = api.createMockAdapter();
  });

  it('сырые проекты и задачи «Альты» и «Лотоса»', () => {
    const alta = MD.seed();
    expect(norm(tasksSeed('t-alta'))).toEqual(
      norm({ projects: alta['projects'], tasks: alta['tasks'] }),
    );
    const lotos = MD.seedLotos(alta.platform);
    expect(norm(tasksSeed('t-lotos'))).toEqual(
      norm({ projects: lotos['projects'], tasks: lotos['tasks'] }),
    );
  });

  it('после normProjects: проекты и задачи = БД адаптера эталона (без проекта модуля документов)', async () => {
    A.setActor('m-owner', 't-alta');
    const v = await A.load(0);
    const db = seeded();
    expect(norm(db.projects)).toEqual(norm(v.projects.filter((p) => p.id !== 'pj-docs')));
    expect(norm(db.tasks)).toEqual(norm(v.tasks));
  });

  it.each([
    'm-owner',
    'm-kotova',
    'm-vasiliev',
    'm-kotelnikova',
    'm-sokolov',
    'm-morozova',
    'm-akhmedov',
    'm-gromov',
  ])('проекция %s = view() эталона', async (actor) => {
    A.setActor(actor, 't-alta');
    const v = await A.load(0);
    const mine = tasksView(seeded(), actor);
    expect(norm(mine.projects)).toEqual(norm(v.projects.filter((p) => p.id !== 'pj-docs')));
    expect(norm(mine.tasks)).toEqual(norm(v.tasks));
  });

  it('расхождение видимости (PD-60): закрытый проект по унаследованной роли не виден', () => {
    const db = seeded();
    db.assignments.push(EXTRA[0] as Assignment);
    const fleet = db.projects[0];
    if (fleet) fleet.access = 'closed';
    expect(tasksView(db, 'm-petrova').projects.map((p) => p.id)).toEqual(['leads']);
  });
});

describe('команды = createMockAdapter эталона на одном сценарии', () => {
  let A: RefApi;
  let db: Db;
  let actor = 'm-owner';
  let api: TasksApi;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const ref = await importReference<{ createMockAdapter(): RefApi }>('api.js');
    A = ref.createMockAdapter();
    db = seeded();
    A.setActor('m-owner', 't-alta');
    db.seq = (await run(A.load(0))).seq;
    const ids = createIdGen(() => db);
    const ctx = createModuleCtx({
      getDb: () => db as TenantDb,
      getActor: () => actor,
      clock: demoClock,
      ids,
      tasks: createTaskPort(() => db as TenantDb, ids),
    });
    api = tasksCommands(ctx);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  async function run<T>(p: Promise<T>): Promise<T> {
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  }

  type Outcome = { data: unknown } | { code: string; message: string };
  async function both(
    who: string,
    method: keyof TasksApi,
    ...args: unknown[]
  ): Promise<[Outcome, Outcome]> {
    actor = who;
    A.setActor(who, 't-alta');
    let mine: Outcome;
    try {
      mine = {
        data: (api[method] as (...a: unknown[]) => unknown)(...structuredClone(args)) ?? null,
      };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      mine = { code: e.code, message: e.message };
    }
    let theirs: Outcome;
    try {
      const fn = A[method];
      if (!fn) throw new Error('нет метода ' + method);
      theirs = { data: (await run(fn(...structuredClone(args)))).data ?? null };
    } catch (e) {
      const x = e as { code?: string; message: string };
      if (!x.code) throw e;
      theirs = { code: x.code, message: x.message };
    }
    return [mine, theirs];
  }
  const same = async (who: string, method: keyof TasksApi, ...args: unknown[]) => {
    const [mine, theirs] = await both(who, method, ...args);
    expect(mine).toEqual(theirs);
    return mine;
  };

  const pdf = { name: 'Акт.pdf', size: 1000, type: 'application/pdf' };

  it('сценарий: согласование, создание, иерархия, автоматизация, процесс, вложения, старая доска', async () => {
    const events0 = new Set((await run(A.load(0))).events.map((e) => e.id));
    await same('m-kotelnikova', 'runTransition', 'T-65', 't3', 'Счёт проверен');
    const created = await same('m-kotova', 'createProjectTask', {
      project: 'fleet',
      title: '  Срочно заменить колесо ',
      description: 'Прокол',
      labels: ['Шины', ' шины ', 'Ремонт'],
      files: [pdf],
      priority: 'urgent',
      due: '02.10',
    });
    const newId = (created as { data: string }).data;
    await same('m-kotova', 'createProjectTask', {
      project: 'fleet',
      title: 'Антифриз',
      parent: 'T-66',
    });
    await same('m-kotova', 'setTaskParent', newId, 'T-66');
    await same('m-kotova', 'setTaskParent', newId, null);
    await same('m-kotova', 'runTransition', newId, 't1', '');
    await same('m-kotova', 'runTransition', newId, 't2', '');
    await same('m-kotelnikova', 'rejectApproval', newId, 't3', 'Нужен счёт');
    await same('m-kotova', 'saveAutomation', 'fleet', {
      name: 'Готово → комментарий',
      trigger: 'status',
      to: 's4',
      cond: null,
      action: { kind: 'comment', value: 'Спасибо' },
    });
    await same('m-kotova', 'toggleAutomation', 'fleet', 'ar-2', true);
    await same('m-kotova', 'runTransition', 'T-58', 't5', 'ТО перенесли');
    await same('m-owner', 'createProject', {
      name: 'Офис',
      key: 'оф',
      unit: 'org',
      access: 'open',
      process: 'copy',
      copyFrom: 'fleet',
    });
    const pj = db.projects.at(-1)?.id ?? '';
    await same('m-owner', 'setProjectRole', pj, 'm-akhmedov', 'r-viewer');
    await same('m-owner', 'setProjectRole', pj, 'm-akhmedov', 'r-exec');
    await same('m-owner', 'updateProject', pj, { name: 'Офис и склад', access: 'limited' });
    const fleet = db.projects[0];
    const draft = structuredClone({
      statuses: fleet?.wf?.statuses ?? [],
      transitions: fleet?.wf?.transitions ?? [],
    });
    draft.statuses.push({ id: 's6', name: 'Ждёт поставки', cat: 'progress' });
    await same('m-kotova', 'saveWorkflowDraft', 'fleet', draft);
    await same('m-kotova', 'publishWorkflow', 'fleet');
    await same('m-vasiliev', 'addTaskFiles', 'T-58', [
      pdf,
      { ...pdf, name: 'Фото.jpg', type: 'image/jpeg' },
    ]);
    const fid = db.tasks.find((t) => t.id === 'T-58')?.files?.[0]?.id ?? '';
    await same('m-vasiliev', 'removeTaskFile', 'T-58', fid);
    await same('m-kotova', 'removeTaskFile', 'T-65', 'f-1');
    await same('m-vasiliev', 'setTaskField', 'T-64', {
      assignee: 'Илья Васильев',
      priority: 'low',
      description: ' Найден ',
    });
    await same('m-vasiliev', 'toggleTaskCheck', 'T-58', 1);
    await same('m-owner', 'moveTask', 'L-31', 'Замер');
    await same('m-owner', 'commentTask', 'L-31', ' Замер в среду ');
    await same('m-owner', 'toggleTaskCheck', 'L-31', 0);
    await same('m-owner', 'createTask', {
      title: 'Позвонить',
      assignee: 'Марина Котова',
      priority: 'high',
      due: '2026-10-15',
      project: 'leads',
    });
    await same('m-kotova', 'deleteAutomation', 'fleet', 'ar-2');
    await same('m-owner', 'saveWorkflowDraft', 'fleet', null);

    A.setActor('m-owner', 't-alta');
    const v = await run(A.load(0));
    expect(norm(db.projects)).toEqual(norm(v.projects.filter((p) => p.id !== 'pj-docs')));
    expect(norm(db.tasks)).toEqual(norm(v.tasks));
    const projectRoles = (xs: Assignment[]) =>
      xs.filter((a) => a.scope.type === 'project' && a.id.startsWith('ap'));
    expect(projectRoles(db.assignments)).toEqual(projectRoles(v.assignments));
    expect(db.seq).toBe(v.seq);
    expect(norm(db.events)).toEqual(norm(v.events.filter((e) => !events0.has(e.id))));
  });

  it.each([
    ['m-kotova', 'createProjectTask', [{ project: 'fleet', title: 'Ок' }]],
    [
      'm-kotova',
      'createProjectTask',
      [{ project: 'fleet', title: 'Задача', description: 'x'.repeat(5001) }],
    ],
    [
      'm-kotova',
      'createProjectTask',
      [{ project: 'fleet', title: 'Задача', files: [{ ...pdf, size: 0 }] }],
    ],
    ['m-kotova', 'createProjectTask', [{ project: 'fleet', title: 'Задача', parent: 'T-61' }]],
    ['m-kotova', 'createProjectTask', [{ project: 'fleet', title: 'Задача', parent: 'T-999' }]],
    ['m-kotelnikova', 'createProjectTask', [{ project: 'fleet', title: 'Задача' }]],
    ['m-kotova', 'createProjectTask', [{ project: 'leads', title: 'Задача' }]],
    ['m-kotova', 'publishWorkflow', ['fleet']],
    ['m-kotova', 'runTransition', ['T-63', 't5', '']],
    ['m-kotova', 'runTransition', ['T-63', 't9', '']],
    ['m-vasiliev', 'runTransition', ['T-63', 't5', 'x']],
    ['m-kotova', 'rejectApproval', ['T-63', 't2', 'x']],
    ['m-kotova', 'setTaskParent', ['T-66', 'T-65']],
    ['m-kotova', 'setTaskParent', ['T-63', 'T-63']],
    ['m-vasiliev', 'updateProject', ['fleet', { name: 'Новое имя' }]],
    ['m-kotova', 'updateProject', ['fleet', { name: 'Л' }]],
    ['m-kotova', 'setProjectRole', ['fleet', 'm-gromov', 'r-viewer']],
    ['m-kotova', 'setProjectRole', ['fleet', 'm-akhmedov', 'r-manager']],
    [
      'm-kotova',
      'saveAutomation',
      ['fleet', { name: ' ', trigger: 'created', action: { kind: 'comment', value: 'x' } }],
    ],
    [
      'm-kotova',
      'saveAutomation',
      [
        'fleet',
        { name: 'x', trigger: 'status', to: 's9', action: { kind: 'comment', value: 'x' } },
      ],
    ],
    ['m-kotova', 'addTaskFiles', ['T-63', [{ ...pdf, type: 'application/x-msdownload' }]]],
    // Без права модуля ответ не зависит от существования задачи — как `assertCan` эталона до поиска.
    ['m-morozova', 'moveTask', ['T-404', 'Готово']],
    ['m-morozova', 'toggleTaskCheck', ['T-404', 0]],
    ['m-morozova', 'commentTask', ['T-404', 'x']],
    ['m-morozova', 'createTask', [{ title: 'x', assignee: 'X' }]],
    ['m-owner', 'moveTask', ['T-63', 'Готово']],
    ['m-owner', 'moveTask', ['L-27', 'Новая']],
    ['m-owner', 'commentTask', ['L-27', '  ']],
    ['m-owner', 'createTask', [{ title: ' ', assignee: 'X' }]],
    [
      'm-owner',
      'createProject',
      [{ name: 'Оф', key: 'ОФ', unit: 'org', access: 'open', process: 'simple' }],
    ],
    [
      'm-owner',
      'createProject',
      [{ name: 'Офис', key: 'LOG', unit: 'org', access: 'open', process: 'simple' }],
    ],
    [
      'm-owner',
      'createProject',
      [{ name: 'Офис', key: 'Q', unit: 'org', access: 'open', process: 'simple' }],
    ],
    [
      'm-owner',
      'createProject',
      [{ name: 'Офис', key: 'QQ', unit: 'f-x', access: 'open', process: 'simple' }],
    ],
    [
      'm-owner',
      'createProject',
      [
        {
          name: 'Офис',
          key: 'QQ',
          unit: 'org',
          access: 'open',
          process: 'copy',
          copyFrom: 'leads',
        },
      ],
    ],
  ] as const)('ошибка %s · %s %j — та же, что у эталона', async (who, method, args) => {
    const [mine, theirs] = await both(who, method, ...args);
    expect(mine).toHaveProperty('code');
    expect(mine).toEqual(theirs);
  });

  it('PD-53: эталон даёт Котовой создать проект через роль проекта, домен — нет', async () => {
    const args = {
      name: 'Свой проект',
      key: 'СВОЙ',
      unit: 'org',
      access: 'open',
      process: 'simple',
    };
    const [mine, theirs] = await both('m-kotova', 'createProject', args);
    expect(theirs).toHaveProperty('data');
    expect(mine).toEqual({
      code: 'forbidden',
      message: 'Создавать проекты может роль с правом «Задачи · Настраивать»',
    });
  });

  it('TP-03 для старой доски: эталон даёт владельцу без роли менять закрытый проект, домен — нет', async () => {
    await same('m-owner', 'updateProject', 'fleet', { access: 'closed' });
    const closed = 'в проекте «Логистика · Север»: закрытый проект — нужна роль в самом проекте';
    for (const [method, args, verb] of [
      ['toggleTaskCheck', ['T-58', 2], 'Менять статус'],
      ['commentTask', ['T-58', 'Проверка'], 'Читать'],
      ['createTask', [{ title: 'Лишняя', assignee: 'X', project: 'fleet' }], 'Создавать'],
    ] as const) {
      const [mine, theirs] = await both('m-owner', method, ...args);
      expect(theirs).toHaveProperty('data');
      expect(mine).toEqual({ code: 'forbidden', message: 'Нет права «' + verb + '» ' + closed });
    }
    // Роль в самом проекте открывает закрытый проект и в домене: руководитель возвращает доступ.
    await same('m-kotova', 'updateProject', 'fleet', { access: 'limited' });
  });

  it('initProjectWorkflow: в эталоне проект без процесса не находится, в домене — получает процесс', async () => {
    db.projects.push({ id: 'old', key: 'OLD', name: 'Старый', owner: '—' });
    const [mine, theirs] = await both('m-owner', 'initProjectWorkflow', 'old');
    expect(theirs).toEqual({
      code: 'not_found',
      message: 'Проект не найден или процесс не настроен',
    });
    expect(mine).toEqual({ data: null });
    expect(db.projects.at(-1)?.wf).toEqual(buildWf('simple'));
  });
});
