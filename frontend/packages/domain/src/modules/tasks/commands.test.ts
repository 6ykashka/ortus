// Команды «Задач и проектов» (api.js 14.10:618–769, B §2.3): успех, каждая ошибка дословно,
// события владельцам, PD-53 для старых команд и TP-03 для закрытых проектов.
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../core/clock.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx } from '../../core/module.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { TASK_DELAYS, TASK_METHODS, tasksCommands, type TasksApi } from './commands.ts';
import { apiErr } from './fixture.test-util.ts';
import { normProjects, tasksSeed } from './seed.ts';
import { createTaskPort } from './task-port.ts';
import type { Automation, FileDraft, Project, Task, WorkflowDraft } from './types.ts';
import { buildWf } from './workflow.ts';

const clock = fixedClock('2026-10-01T10:30:00+03:00');
type Db = Omit<TenantDb, 'projects'> & { projects: Project[]; tasks: Task[] };

function harness(actor = 'm-owner') {
  const base = createAlta(createPlatform()) as TenantDb;
  const db = Object.assign(base, tasksSeed('t-alta')) as Db;
  normProjects(db);
  let who: string | null = actor;
  const ids = createIdGen(() => db);
  const ctx = createModuleCtx({
    getDb: () => db,
    getActor: () => who,
    clock,
    ids,
    tasks: createTaskPort(() => db, ids),
  });
  const api: TasksApi = tasksCommands(ctx);
  const task = (id: string): Task => {
    const t = db.tasks.find((x) => x.id === id);
    if (!t) throw new Error('нет задачи ' + id);
    return t;
  };
  const project = (id: string): Project => {
    const p = db.projects.find((x) => x.id === id);
    if (!p) throw new Error('нет проекта ' + id);
    return p;
  };
  return {
    db,
    api,
    task,
    project,
    as: (m: string | null) => {
      who = m;
    },
  };
}

const pdf = (o: Partial<FileDraft> = {}): FileDraft => ({
  name: 'Акт.pdf',
  size: 1000,
  type: 'application/pdf',
  ...o,
});

describe('реестр методов и задержки mock-адаптера', () => {
  it('20 методов, у каждого задержка эталона', () => {
    expect(TASK_METHODS).toEqual([
      'moveTask',
      'toggleTaskCheck',
      'commentTask',
      'createTask',
      'createProject',
      'updateProject',
      'setProjectRole',
      'initProjectWorkflow',
      'saveWorkflowDraft',
      'publishWorkflow',
      'createProjectTask',
      'runTransition',
      'rejectApproval',
      'saveAutomation',
      'toggleAutomation',
      'deleteAutomation',
      'setTaskField',
      'setTaskParent',
      'addTaskFiles',
      'removeTaskFile',
    ]);
    expect(TASK_DELAYS).toEqual({
      moveTask: 300,
      toggleTaskCheck: 200,
      commentTask: 250,
      createTask: 350,
      createProject: 350,
      updateProject: 250,
      setProjectRole: 250,
      initProjectWorkflow: 250,
      saveWorkflowDraft: 200,
      publishWorkflow: 400,
      createProjectTask: 300,
      runTransition: 300,
      rejectApproval: 300,
      saveAutomation: 250,
      toggleAutomation: 200,
      deleteAutomation: 200,
      setTaskField: 200,
      setTaskParent: 250,
      addTaskFiles: 300,
      removeTaskFile: 250,
    });
    expect(
      Object.keys(
        tasksCommands(
          createModuleCtx({
            getDb: () => harness().db,
            getActor: () => null,
            clock,
            tasks: createTaskPort(() => harness().db, createIdGen({ seq: 1 })),
          }),
        ),
      ),
    ).toEqual(TASK_METHODS);
  });
});

describe('старая доска: moveTask, toggleTaskCheck, commentTask, createTask (PD-53)', () => {
  it('moveTask: воронка «Заявки» — по переходам воронки, с системным комментарием', () => {
    const h = harness();
    h.api.moveTask('L-31', 'Замер');
    expect(h.task('L-31')).toMatchObject({ status: 'Замер' });
    expect(h.task('L-31').comments).toEqual([
      { by: 'Система', at: '10:30', text: 'Статус: Новая → Замер', system: true },
    ]);
  });

  it.each([
    [
      'm-owner',
      'T-58',
      'Готово',
      'transition',
      'Статус меняется переходами процесса проекта «Логистика · Север»',
    ],
    [
      'm-owner',
      'L-31',
      'Договор',
      'transition',
      'Переход «Новая → Договор» не предусмотрен процессом',
    ],
    ['m-kotova', 'L-31', 'Замер', 'no_permission', 'Нет права на это действие'],
    ['m-owner', 'T-404', 'Готово', 'not_found', 'Задача не найдена'],
  ] as const)('moveTask %s %s → %s: %s', (actor, id, to, code, message) => {
    const h = harness(actor);
    expect(apiErr(() => h.api.moveTask(id, to))).toMatchObject({
      code,
      ...(code === 'no_permission' ? {} : { message }),
    });
  });

  it('moveTask в «Готово» без процесса проекта — только с закрытым чек-листом', () => {
    const h = harness();
    h.db.projects.push({ id: 'old', key: 'OLD', name: 'Старый', owner: '—' });
    h.db.tasks.push({
      id: 'T-5',
      title: 'Старая',
      assignee: 'Дарья Зимина',
      status: 'На проверке',
      priority: 'normal',
      due: '—',
      project: 'old',
      checklist: [{ t: 'a', d: false }],
      comments: [],
      links: [],
    });
    expect(apiErr(() => h.api.moveTask('T-5', 'Готово'))).toEqual({
      code: 'validation',
      message: 'Нельзя завершить: в чек-листе есть невыполненные пункты',
    });
    h.api.toggleTaskCheck('T-5', 0);
    h.api.moveTask('T-5', 'Готово');
    expect(h.task('T-5').status).toBe('Готово');
  });

  it('toggleTaskCheck: роль проекта действует в своём проекте, а не во всей организации (PD-53)', () => {
    const h = harness('m-vasiliev');
    h.api.toggleTaskCheck('T-58', 1);
    expect(h.task('T-58').checklist[1]?.d).toBe(true);
    expect(apiErr(() => h.api.toggleTaskCheck('L-31', 0)).code).toBe('no_permission');
    expect(apiErr(() => h.api.toggleTaskCheck('T-58', 9))).toEqual({
      code: 'not_found',
      message: 'Пункт чек-листа не найден',
    });
  });

  it('commentTask: пустой — ошибка; автор — участник, без участника — «—»', () => {
    const h = harness('m-kotelnikova');
    h.api.commentTask('T-65', '  Счёт сверила  ');
    expect(h.task('T-65').comments.at(-1)).toEqual({
      by: 'Вера Котельникова',
      at: '10:30',
      text: 'Счёт сверила',
    });
    expect(apiErr(() => h.api.commentTask('T-65', '   '))).toEqual({
      code: 'validation',
      message: 'Комментарий пустой',
    });
    expect(apiErr(() => h.api.commentTask('L-31', 'x')).code).toBe('no_permission');
  });

  it('createTask: T-(70+seq), срок из даты формы, проект по умолчанию — первый', () => {
    const h = harness();
    const id = h.api.createTask({
      title: ' Позвонить ',
      assignee: 'Марина Котова',
      priority: 'high',
      due: '2026-10-15',
    });
    expect(id).toBe('T-170');
    expect(h.db.tasks[0]).toEqual({
      id: 'T-170',
      title: 'Позвонить',
      assignee: 'Марина Котова',
      status: 'Новая',
      priority: 'high',
      due: '15.10',
      project: 'fleet',
      checklist: [],
      comments: [],
      links: [],
    });
    const id2 = h.api.createTask({ title: 'Б', assignee: 'X', project: 'leads' });
    expect(h.task(id2)).toMatchObject({ due: '—', priority: 'normal', project: 'leads' });
    expect(apiErr(() => h.api.createTask({ title: ' ', assignee: 'X' }))).toEqual({
      code: 'validation',
      message: 'Укажите название задачи',
    });
    h.as('m-morozova');
    expect(apiErr(() => h.api.createTask({ title: 'x', assignee: 'X' })).code).toBe(
      'no_permission',
    );
  });
});

describe('createProject, updateProject, setProjectRole, initProjectWorkflow', () => {
  it('создание: процесс, доступ, автор — руководитель проекта, событие владельцам', () => {
    const h = harness();
    const id = h.api.createProject({
      name: ' Офис ',
      key: 'офис',
      unit: 'org',
      access: 'open',
      process: 'approval',
    });
    expect(id).toBe('pj-100');
    const p = h.project('pj-100');
    expect(p).toEqual({
      id: 'pj-100',
      key: 'ОФИС',
      name: 'Офис',
      owner: 'Дарья Зимина',
      access: 'open',
      wf: buildWf('approval'),
      automations: [],
      runs: [],
    });
    expect(h.db.assignments.at(-1)).toEqual({
      id: 'ap-101',
      member: 'm-owner',
      role: 'r-pm',
      scope: { type: 'project', id: 'pj-100' },
    });
    expect(h.db.events?.[0]).toMatchObject({
      id: 'e102',
      text: 'Создан проект «Офис» (ОФИС)',
      to: ['m-owner'],
    });
  });

  it('копия процесса: версия 1 без черновика, правила выключены; неизвестный доступ → «ограниченный»', () => {
    const h = harness();
    const fleet = h.project('fleet');
    if (fleet.wf) fleet.wf = { ...fleet.wf, v: 5, draft: { statuses: [], transitions: [] } };
    const id = h.api.createProject({
      name: 'Склад',
      key: 'СК1',
      unit: 'f-msk-yug',
      access: 'secret' as never,
      process: 'copy',
      copyFrom: 'fleet',
    });
    const p = h.project(id);
    expect(p).toMatchObject({ unit: 'f-msk-yug', access: 'limited' });
    expect(p.wf?.v).toBe(1);
    expect(p.wf).not.toHaveProperty('draft');
    expect(p.wf?.transitions).toEqual(buildWf('approval').transitions);
    expect(p.automations?.map((r) => [r.id, r.on])).toEqual([
      ['ar-1', false],
      ['ar-2', false],
    ]);
    expect(h.project('fleet').automations?.[0]?.on).toBe(true);
    h.api.createProject({
      name: 'Простой',
      key: 'ПР',
      unit: 'org',
      access: 'closed',
      process: 'simple',
    });
    expect(h.db.projects.at(-1)?.wf).toEqual(buildWf('simple'));
  });

  it.each([
    [{ name: 'Оф', key: 'OF' }, 'Название — не короче 3 символов'],
    [{ key: 'O' }, 'Ключ — 2–6 заглавных букв или цифр, первая — буква'],
    [{ key: '1AB' }, 'Ключ — 2–6 заглавных букв или цифр, первая — буква'],
    [{ key: 'ABCDEFG' }, 'Ключ — 2–6 заглавных букв или цифр, первая — буква'],
    [{ key: 'log' }, 'Ключ LOG уже занят'],
    [{ unit: 'f-nope' }, 'Выберите область проекта'],
    [{ process: 'copy', copyFrom: 'leads' }, 'Выберите проект, процесс которого копировать'],
  ])('createProject %j → «%s»', (patch, message) => {
    const h = harness();
    const args = {
      name: 'Новый проект',
      key: 'НОВ',
      unit: 'org',
      access: 'limited',
      process: 'simple',
      ...patch,
    };
    expect(
      apiErr(() => h.api.createProject(args as Parameters<TasksApi['createProject']>[0])),
    ).toEqual({
      code: 'validation',
      message,
    });
  });

  it('создавать проекты — право «Задачи · Настраивать» вне проектов (PD-53); trial истёк — нельзя', () => {
    const h = harness('m-kotova');
    const args = {
      name: 'Новый проект',
      key: 'НОВ',
      unit: 'org',
      access: 'limited',
      process: 'simple',
    } as const;
    expect(apiErr(() => h.api.createProject(args))).toEqual({
      code: 'forbidden',
      message: 'Создавать проекты может роль с правом «Задачи · Настраивать»',
    });
    h.as('m-owner');
    const tenant = h.db.platform?.tenants.find((x) => x.id === 't-alta');
    if (tenant) tenant.status = 'restricted';
    expect(apiErr(() => h.api.createProject(args))).toEqual({
      code: 'subscription_restricted',
      message: 'Пробный период завершён: новые операции недоступны. История доступна для чтения.',
    });
  });

  it('updateProject: доступ и название; короткое название — ничего не меняется', () => {
    const h = harness('m-kotova');
    h.api.updateProject('fleet', { access: 'open', name: ' Логистика ' });
    expect(h.project('fleet')).toMatchObject({ access: 'open', name: 'Логистика' });
    expect(apiErr(() => h.api.updateProject('fleet', { access: 'closed', name: 'Л' }))).toEqual({
      code: 'validation',
      message: 'Название — не короче 3 символов',
    });
    expect(h.project('fleet').access).toBe('open');
  });

  it.each([
    [
      'm-vasiliev',
      'fleet',
      'forbidden',
      'Нет права «Настраивать» в проекте «Логистика · Север»: роль «Исполнитель» не даёт «Настраивать»',
    ],
    ['m-owner', 'leads', 'not_found', 'Проект не найден или процесс не настроен'],
    ['m-owner', 'nope', 'not_found', 'Проект не найден или процесс не настроен'],
  ] as const)('настройки проекта: %s · %s → %s', (actor, pid, code, message) => {
    const h = harness(actor);
    expect(apiErr(() => h.api.updateProject(pid, { name: 'Новое имя' }))).toEqual({
      code,
      message,
    });
  });

  it('setProjectRole: назначить, сменить, исключить; события владельцам', () => {
    const h = harness('m-kotova');
    h.api.setProjectRole('fleet', 'm-akhmedov', 'r-viewer');
    expect(h.db.assignments.at(-1)).toEqual({
      id: 'ap-100',
      member: 'm-akhmedov',
      role: 'r-viewer',
      scope: { type: 'project', id: 'fleet' },
    });
    expect(h.db.events?.[0]?.text).toBe(
      'Тимур Ахмедов: роль «Наблюдатель» в проекте «Логистика · Север»',
    );
    h.api.setProjectRole('fleet', 'm-akhmedov', 'r-exec');
    expect(h.db.assignments.filter((a) => a.member === 'm-akhmedov').map((a) => a.role)).toEqual([
      'r-exec',
    ]);
    h.api.setProjectRole('fleet', 'm-akhmedov', null);
    expect(h.db.assignments.some((a) => a.member === 'm-akhmedov')).toBe(false);
    expect(h.db.events?.[0]).toMatchObject({
      text: 'Тимур Ахмедов исключён из проекта «Логистика · Север»',
      to: ['m-owner'],
    });
    h.api.setProjectRole('fleet', 'm-akhmedov', null);
    expect(h.db.events?.[0]?.text).toBe('Тимур Ахмедов исключён из проекта «Логистика · Север»');
  });

  it.each([
    ['m-nobody', 'r-viewer', 'Выберите сотрудника'],
    ['m-gromov', 'r-viewer', 'Кирилл Громов заблокирован — назначить роль нельзя'],
    ['m-akhmedov', 'r-manager', 'В проекте назначаются роли проекта'],
  ])('setProjectRole %s → %s: «%s»', (member, role, message) => {
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.setProjectRole('fleet', member, role))).toEqual({
      code: 'validation',
      message,
    });
  });

  it('initProjectWorkflow: проекту без процесса — простой процесс и доступ', () => {
    const h = harness();
    h.db.projects.push({ id: 'old', key: 'OLD', name: 'Старый', owner: '—' });
    h.api.initProjectWorkflow('old');
    expect(h.project('old')).toMatchObject({
      wf: buildWf('simple'),
      access: 'limited',
      automations: [],
      runs: [],
    });
    const v = h.project('fleet').wf;
    h.api.initProjectWorkflow('fleet');
    expect(h.project('fleet').wf).toBe(v);
    expect(apiErr(() => h.api.initProjectWorkflow('nope'))).toEqual({
      code: 'not_found',
      message: 'Проект не найден',
    });
    h.as('m-vasiliev');
    expect(apiErr(() => h.api.initProjectWorkflow('old')).code).toBe('forbidden');
  });
});

describe('процесс: saveWorkflowDraft и publishWorkflow', () => {
  const draftOf = (p: Project): WorkflowDraft =>
    structuredClone({ statuses: p.wf?.statuses ?? [], transitions: p.wf?.transitions ?? [] });

  it('черновик сохраняется и снимается; публикация поднимает версию, задачи остаются в статусах', () => {
    const h = harness('m-kotova');
    const d = draftOf(h.project('fleet'));
    d.statuses.push({ id: 's6', name: 'Ждёт поставки', cat: 'progress' });
    h.api.saveWorkflowDraft('fleet', d);
    expect(h.project('fleet').wf?.draft).toEqual(d);
    h.api.saveWorkflowDraft('fleet', null);
    expect(h.project('fleet').wf).not.toHaveProperty('draft');
    expect(apiErr(() => h.api.publishWorkflow('fleet'))).toEqual({
      code: 'validation',
      message: 'Изменений нет',
    });
    h.api.saveWorkflowDraft('fleet', d);
    expect(h.api.publishWorkflow('fleet')).toBe(2);
    expect(h.project('fleet').wf).toEqual({ ...d, v: 2 });
    expect(h.db.events?.[0]?.text).toBe(
      'Опубликован процесс проекта «Логистика · Север» v2. Задачи остаются в своих статусах',
    );
    expect(h.task('T-65').status).toBe('На проверке');
  });

  it.each([
    [
      (d: WorkflowDraft) => {
        (d.statuses[0] as { name: string }).name = '  ';
      },
      'У статуса нет названия',
    ],
    [
      (d: WorkflowDraft) => {
        (d.statuses[1] as { name: string }).name = ' новая ';
      },
      'Названия статусов повторяются',
    ],
    [
      (d: WorkflowDraft) => {
        d.statuses = d.statuses.map((s) => ({ ...s, cat: s.cat === 'done' ? 'progress' : s.cat }));
      },
      'Нужен хотя бы один статус категории «Готово»',
    ],
    [
      (d: WorkflowDraft) => {
        d.transitions.push({
          ...(d.transitions[0] as WorkflowDraft['transitions'][number]),
          id: 't9',
          name: 'Куда-то',
          to: 's9',
        });
      },
      'Переход «Куда-то» ссылается на удалённый статус или без названия',
    ],
    [
      (d: WorkflowDraft) => {
        d.transitions.push({
          ...(d.transitions[0] as WorkflowDraft['transitions'][number]),
          id: 't9',
          name: '',
          from: ['s1'],
        });
      },
      'Переход «без названия» ссылается на удалённый статус или без названия',
    ],
    [
      (d: WorkflowDraft) => {
        d.transitions.push({
          ...(d.transitions[0] as WorkflowDraft['transitions'][number]),
          id: 't9',
          name: 'Из удалённого',
          from: ['s8'],
        });
      },
      'Переход «Из удалённого» ссылается на удалённый статус или без названия',
    ],
    [
      (d: WorkflowDraft) => {
        d.statuses = d.statuses.filter((s) => s.id !== 's3' && s.id !== 's2');
        d.transitions = [];
      },
      'Есть задачи в статусах, которых нет в новой версии: В работе, На проверке. Переведите их или верните статус',
    ],
  ])('publishWorkflow: %#. «%s»', (mutate, message) => {
    const h = harness('m-kotova');
    const d = draftOf(h.project('fleet'));
    mutate(d);
    h.api.saveWorkflowDraft('fleet', d);
    expect(apiErr(() => h.api.publishWorkflow('fleet'))).toEqual({ code: 'validation', message });
    expect(h.project('fleet').wf?.v).toBe(1);
  });
});

describe('createProjectTask', () => {
  it('KEY-(100+seq), первый статус «К выполнению», метки, вложения, автоматизация «создана»', () => {
    const h = harness('m-vasiliev');
    const id = h.api.createProjectTask({
      project: 'fleet',
      title: '  Срочно заменить колесо ',
      description: ' Прокол на трассе ',
      labels: ['Шины', ' шины ', '', 'Ремонт'],
      files: [pdf()],
      priority: 'urgent',
      due: '02.10',
    });
    expect(id).toBe('LOG-200');
    const t = h.task(id);
    expect(t).toMatchObject({
      title: 'Срочно заменить колесо',
      description: 'Прокол на трассе',
      labels: ['шины', 'ремонт'],
      assignee: 'Марина Котова',
      author: 'Илья Васильев',
      authorId: 'm-vasiliev',
      status: 'Новая',
      priority: 'urgent',
      due: '02.10',
      project: 'fleet',
      files: [
        {
          id: 'f-101',
          name: 'Акт.pdf',
          size: 1000,
          type: 'application/pdf',
          url: null,
          by: 'Илья Васильев',
          byId: 'm-vasiliev',
          at: '10:30',
        },
      ],
    });
    // ar-1: срочная → руководителю проекта (от имени Котовой, право есть).
    expect(h.project('fleet').runs?.[0]).toMatchObject({
      res: 'ok',
      text: 'LOG-200 назначена: Марина Котова',
    });
    expect(h.db.tasks[0]?.id).toBe('LOG-200');
  });

  it('по умолчанию: исполнитель — автор, приоритет «Обычный», срок «—», не больше 10 меток', () => {
    const h = harness('m-kotova');
    const id = h.api.createProjectTask({
      project: 'fleet',
      title: 'Задача',
      labels: Array.from({ length: 12 }, (_, i) => 'm' + i),
    });
    expect(h.task(id)).toMatchObject({
      assignee: 'Марина Котова',
      priority: 'normal',
      due: '—',
      description: '',
    });
    expect(h.task(id).labels).toHaveLength(10);
    expect(h.project('fleet').runs?.[0]).toMatchObject({ res: 'stopped' });
  });

  it('подзадача: связь и системные комментарии у обеих задач', () => {
    const h = harness('m-kotova');
    const id = h.api.createProjectTask({ project: 'fleet', title: 'Антифриз', parent: 'T-66' });
    expect(h.task(id).parent).toBe('T-66');
    expect(h.task(id).comments).toEqual([
      { by: 'Марина Котова', at: '10:30', text: 'входит в T-66', system: true },
    ]);
    expect(h.task('T-66').comments.at(-1)).toEqual({
      by: 'Марина Котова',
      at: '10:30',
      text: 'добавлена подзадача ' + id,
      system: true,
    });
  });

  it.each([
    [{ title: 'Ок' }, 'validation', 'Тема — не короче 3 символов'],
    [{ description: 'x'.repeat(5001) }, 'validation', 'Описание — не длиннее 5000 символов'],
    [
      { files: [pdf({ size: 0, name: 'п.pdf' })] },
      'validation',
      'Файл «п.pdf» не принят: пустой файл',
    ],
    [{ parent: 'T-61' }, 'validation', 'Задача T-61 уже завершена — сначала верните её в работу'],
    [{ project: 'leads' }, 'not_found', 'Проект не найден или процесс не настроен'],
  ])('createProjectTask %j → %s «%s»', (patch, code, message) => {
    const h = harness('m-kotova');
    expect(
      apiErr(() => h.api.createProjectTask({ project: 'fleet', title: 'Задача', ...patch })),
    ).toEqual({ code, message });
  });

  it('согласующий создавать не может', () => {
    const h = harness('m-kotelnikova');
    expect(apiErr(() => h.api.createProjectTask({ project: 'fleet', title: 'Задача' }))).toEqual({
      code: 'forbidden',
      message:
        'Нет права «Создавать» в проекте «Логистика · Север»: роль «Согласующий» не даёт «Создавать»',
    });
  });
});

describe('runTransition и rejectApproval', () => {
  it('согласование «любой»: T-65 согласует Котельникова → «Готово», задача — на автора', () => {
    const h = harness('m-kotelnikova');
    expect(h.api.runTransition('T-65', 't3', ' ок ')).toEqual({ done: true });
    expect(h.task('T-65')).toMatchObject({
      status: 'Готово',
      approval: null,
      assignee: 'Илья Васильев',
    });
    expect(
      h
        .task('T-65')
        .comments.slice(-2)
        .map((c) => c.text),
    ).toEqual(['Согласовать: На проверке → Готово. ок', 'Назначено на автора: Илья Васильев']);
  });

  it('согласование «все»: голоса копятся, пока не согласуют все согласующие', () => {
    const h = harness('m-kotelnikova');
    const tr = h.project('fleet').wf?.transitions.find((x) => x.id === 't3');
    if (tr?.approval) tr.approval.mode = 'all';
    expect(h.api.runTransition('T-65', 't3', '')).toEqual({ done: false });
    expect(h.task('T-65').approval?.votes).toEqual([
      { tr: 't3', by: 'm-kotelnikova', name: 'Вера Котельникова', at: '10:30' },
    ]);
    expect(h.task('T-65').comments.at(-1)).toEqual({
      by: 'Вера Котельникова',
      at: '10:30',
      text: 'Согласовал(а). Ждём: Дарья Зимина, Марина Котова',
      system: true,
    });
    expect(apiErr(() => h.api.runTransition('T-65', 't3', ''))).toEqual({
      code: 'transition',
      message: 'Вы уже согласовали, ждём остальных',
    });
    h.as('m-kotova');
    expect(h.api.runTransition('T-65', 't3', 'да')).toEqual({ done: false });
    expect(h.task('T-65').comments.at(-1)?.text).toBe('Согласовал(а): да. Ждём: Дарья Зимина');
    h.as('m-owner');
    expect(h.api.runTransition('T-65', 't3', '')).toEqual({ done: true });
    expect(h.task('T-65').status).toBe('Готово');
  });

  it.each([
    ['m-vasiliev', 'T-65', 't3', '', 'transition', 'Вы автор задачи — свою согласовать нельзя'],
    ['m-kotova', 'T-65', 't1', '', 'transition', 'Переход недоступен из текущего статуса'],
    ['m-kotova', 'T-65', 't5', '', 'validation', 'Для перехода «Отменить» нужен комментарий'],
    ['m-kotova', 'T-65', 't9', '', 'validation', 'Переход удалён из процесса'],
    ['m-kotova', 'T-404', 't1', '', 'not_found', 'Задача не найдена'],
    ['m-kotova', 'L-31', 't1', '', 'not_found', 'Проект не найден или процесс не настроен'],
  ] as const)('runTransition %s %s %s → %s «%s»', (actor, id, tr, c, code, message) => {
    const h = harness(actor);
    // Васильев — автор T-65: для «Согласовать» ему нужно право «Согласовывать».
    if (actor === 'm-vasiliev') {
      h.db.assignments.push({
        id: 'x',
        member: 'm-vasiliev',
        role: 'r-approver',
        scope: { type: 'project', id: 'fleet' },
      });
      h.db.assignments = h.db.assignments.filter((a) => a.id !== 'ap2');
    }
    expect(apiErr(() => h.api.runTransition(id, tr, c))).toEqual({ code, message });
  });

  it('задача маршрута документа меняется только маршрутом', () => {
    const h = harness('m-kotova');
    h.task('T-65').docRoute = { title: 'Договор поставки', waiting: ['m-owner'] };
    expect(apiErr(() => h.api.runTransition('T-65', 't5', 'x'))).toEqual({
      code: 'transition',
      message:
        'Статус задачи меняет маршрут документа «Договор поставки»: решения — в «Документах»',
    });
    expect(apiErr(() => h.api.rejectApproval('T-65', 't3', 'x'))).toEqual({
      code: 'transition',
      message:
        'Вернуть на доработку можно в «Документах»: задача следует за маршрутом «Договор поставки»',
    });
  });

  it('«Отменить» с комментарием; «Готово» запускает правило ar-2, если оно включено', () => {
    const h = harness('m-kotova');
    h.api.runTransition('T-58', 't5', 'ТО перенесли');
    expect(h.task('T-58').status).toBe('Отменена');
    const ar2 = h.project('fleet').automations?.find((r) => r.id === 'ar-2');
    if (ar2) ar2.on = true;
    h.as('m-kotelnikova');
    h.api.runTransition('T-65', 't3', '');
    expect(h.task('T-65').comments.map((c) => c.text)).toContain(
      'Проверьте, что путевой лист сдан в бухгалтерию',
    );
    // ar-2 выполняется от имени владельца.
    expect(h.project('fleet').runs?.[0]).toMatchObject({ rule: 'ar-2', res: 'ok' });
  });

  it('rejectApproval: возврат в rejectTo с обязательным комментарием, сброс голосов', () => {
    const h = harness('m-kotelnikova');
    h.task('T-65').approval = {
      tr: 't3',
      votes: [{ tr: 't3', by: 'm-kotelnikova', name: 'Вера Котельникова', at: '10:00' }],
    };
    expect(apiErr(() => h.api.rejectApproval('T-65', 't3', '  '))).toEqual({
      code: 'validation',
      message: 'Напишите, что доработать',
    });
    h.api.rejectApproval('T-65', 't3', 'Нужен второй счёт');
    expect(h.task('T-65')).toMatchObject({ status: 'В работе', approval: null });
    expect(h.task('T-65').comments.at(-1)).toEqual({
      by: 'Вера Котельникова',
      at: '10:30',
      text: 'Вернул(а) на доработку (На проверке → В работе): Нужен второй счёт',
      system: true,
    });
  });

  it.each([
    ['m-kotelnikova', 't2', 'validation', 'Согласование не найдено'],
    ['m-kotelnikova', 't9', 'validation', 'Согласование не найдено'],
    [
      'm-vasiliev',
      't3',
      'transition',
      'Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»',
    ],
  ] as const)('rejectApproval %s %s → %s «%s»', (actor, tr, code, message) => {
    const h = harness(actor);
    expect(apiErr(() => h.api.rejectApproval('T-65', tr, 'x'))).toEqual({ code, message });
  });

  it('rejectApproval: не из «На проверке» — «Недоступно»; статус возврата удалён — первый статус', () => {
    const h = harness('m-kotelnikova');
    expect(apiErr(() => h.api.rejectApproval('T-58', 't3', 'x'))).toEqual({
      code: 'transition',
      message: 'Недоступно',
    });
    const tr = h.project('fleet').wf?.transitions.find((x) => x.id === 't3');
    if (tr?.approval) tr.approval.rejectTo = 's9';
    h.api.rejectApproval('T-65', 't3', 'x');
    expect(h.task('T-65').status).toBe('Новая');
  });
});

describe('автоматизация: saveAutomation, toggleAutomation, deleteAutomation', () => {
  const rule = (o: Partial<Automation> = {}): Partial<Automation> => ({
    name: 'Готово → комментарий',
    trigger: 'status',
    to: 's4',
    cond: null,
    action: { kind: 'comment', value: 'Спасибо' },
    ...o,
  });

  it('новое правило — ar-<seq>, v1, автор — актор; правка — версия + 1', () => {
    const h = harness('m-kotova');
    const id = h.api.saveAutomation('fleet', rule());
    expect(id).toBe('ar-100');
    expect(h.project('fleet').automations?.at(-1)).toEqual({
      ...rule(),
      id: 'ar-100',
      by: 'Марина Котова',
      byId: 'm-kotova',
      version: 1,
      on: true,
    });
    h.as('m-owner');
    expect(
      h.api.saveAutomation('fleet', { ...rule({ name: 'Новое имя', on: false }), id: 'ar-100' }),
    ).toBe('ar-100');
    expect(h.project('fleet').automations?.at(-1)).toMatchObject({
      name: 'Новое имя',
      version: 2,
      on: false,
      byId: 'm-owner',
    });
    h.api.toggleAutomation('fleet', 'ar-100', true);
    expect(h.project('fleet').automations?.at(-1)?.on).toBe(true);
    h.api.deleteAutomation('fleet', 'ar-100');
    expect(h.project('fleet').automations?.map((r) => r.id)).toEqual(['ar-1', 'ar-2']);
    expect(apiErr(() => h.api.toggleAutomation('fleet', 'ar-100', true))).toEqual({
      code: 'not_found',
      message: 'Правило не найдено',
    });
  });

  it.each([
    [rule({ name: '  ' }), 'Назовите правило'],
    [rule({ to: 's9' }), 'Выберите статус для триггера'],
    [rule({ action: { kind: 'comment', value: ' ' } }), 'Заполните действие'],
    [{ ...rule(), action: undefined }, 'Заполните действие'],
  ])('saveAutomation %j → «%s»', (r, message) => {
    const h = harness('m-kotova');
    expect(apiErr(() => h.api.saveAutomation('fleet', r))).toEqual({ code: 'validation', message });
  });

  it('правило «задача создана» без статуса', () => {
    const h = harness('m-kotova');
    expect(h.api.saveAutomation('fleet', rule({ trigger: 'created', to: null }))).toBe('ar-100');
  });
});

describe('карточка задачи: setTaskField, setTaskParent, addTaskFiles, removeTaskFile', () => {
  it('setTaskField: исполнитель, приоритет, пункт чек-листа, описание', () => {
    const h = harness('m-vasiliev');
    h.api.setTaskField('T-58', {
      assignee: 'Илья Васильев',
      priority: 'low',
      check: 1,
      description: ' ТО в среду ',
    });
    expect(h.task('T-58')).toMatchObject({
      assignee: 'Илья Васильев',
      priority: 'low',
      description: 'ТО в среду',
    });
    expect(h.task('T-58').checklist[1]?.d).toBe(true);
    expect(
      apiErr(() => h.api.setTaskField('T-58', { assignee: 'X', description: 'x'.repeat(5001) })),
    ).toEqual({
      code: 'validation',
      message: 'Описание — не длиннее 5000 символов',
    });
    expect(h.task('T-58').assignee).toBe('Илья Васильев');
    expect(apiErr(() => h.api.setTaskField('T-58', { check: 7 })).code).toBe('not_found');
    h.as('m-kotelnikova');
    expect(apiErr(() => h.api.setTaskField('T-58', { priority: 'high' })).code).toBe('forbidden');
  });

  it('setTaskParent: «входит в», смена родителя и «Убрать связь» — с комментариями у всех задач', () => {
    const h = harness('m-kotova');
    h.api.setTaskParent('T-64', 'T-66');
    expect(h.task('T-64').parent).toBe('T-66');
    expect(h.task('T-64').comments.at(-1)?.text).toBe('входит в T-66');
    expect(h.task('T-66').comments.at(-1)?.text).toBe('добавлена подзадача T-64');
    h.api.setTaskParent('T-64', 'T-63');
    expect(h.task('T-64').comments.at(-1)?.text).toBe('входит в T-63 (было T-66)');
    expect(h.task('T-66').comments.at(-1)?.text).toBe('из состава исключена T-64');
    h.api.setTaskParent('T-64', null);
    expect(h.task('T-64').parent).toBeNull();
    expect(h.task('T-64').comments.at(-1)?.text).toBe('больше не входит в T-63');
    expect(h.task('T-63').comments.at(-1)?.text).toBe('из состава исключена T-64');
    const n = h.task('T-64').comments.length;
    h.api.setTaskParent('T-64', null);
    expect(h.task('T-64').comments).toHaveLength(n);
    expect(apiErr(() => h.api.setTaskParent('T-66', 'T-65')).message).toBe(
      'Получится цикл: T-65 уже входит в T-66',
    );
  });

  it('addTaskFiles и removeTaskFile: свой файл удаляет автор, чужие — руководитель проекта', () => {
    const h = harness('m-vasiliev');
    h.api.addTaskFiles('T-58', [
      pdf({ name: 'Заказ-наряд.pdf' }),
      pdf({ name: 'Фото.jpg', type: 'image/jpeg' }),
    ]);
    expect(h.task('T-58').files?.map((f) => [f.id, f.name, f.byId])).toEqual([
      ['f-100', 'Заказ-наряд.pdf', 'm-vasiliev'],
      ['f-101', 'Фото.jpg', 'm-vasiliev'],
    ]);
    expect(h.task('T-58').comments.at(-1)?.text).toBe('прикрепил(а): Заказ-наряд.pdf, Фото.jpg');
    h.api.removeTaskFile('T-58', 'f-100');
    expect(h.task('T-58').comments.at(-1)?.text).toBe('удалил(а) файл Заказ-наряд.pdf');
    expect(apiErr(() => h.api.removeTaskFile('T-58', 'f-100'))).toEqual({
      code: 'not_found',
      message: 'Файл уже удалён',
    });
    h.task('T-65').files?.forEach((f) => (f.byId = 'm-owner'));
    expect(apiErr(() => h.api.removeTaskFile('T-65', 'f-1'))).toEqual({
      code: 'forbidden',
      message: 'Удалить можно свой файл; чужие — руководитель проекта',
    });
    h.as('m-kotova');
    h.api.removeTaskFile('T-65', 'f-1');
    expect(h.task('T-65').files).toEqual([]);
    expect(
      apiErr(() =>
        h.api.addTaskFiles(
          'T-65',
          Array.from({ length: 31 }, () => pdf()),
        ),
      ).message,
    ).toBe('К задаче можно прикрепить не больше 30 файлов');
  });
});

describe('закрытый проект (TP-03) и участник без входа', () => {
  it('владелец без роли в закрытом проекте не меняет его задачи', () => {
    const h = harness('m-owner');
    h.project('fleet').access = 'closed';
    expect(apiErr(() => h.api.setTaskField('T-58', { priority: 'low' }))).toEqual({
      code: 'forbidden',
      message:
        'Нет права «Менять статус» в проекте «Логистика · Север»: закрытый проект — нужна роль в самом проекте',
    });
    h.as('m-kotova');
    h.api.setTaskField('T-58', { priority: 'low' });
    expect(h.task('T-58').priority).toBe('low');
  });

  // Возврат 1: старые команды доски в проекте с процессом проверяют доступ проекта (TP-03, PD-60),
  // а не только `can(tasks)` ядра. Воронка «Заявки» без процесса остаётся на `can` ядра (PD-53).
  const CLOSED = 'закрытый проект — нужна роль в самом проекте';
  const READ_ONLY = 'в ограниченном проекте унаследованный доступ — только чтение';
  const boardCalls = {
    toggleTaskCheck: ['Менять статус', (api: TasksApi) => api.toggleTaskCheck('T-58', 1)],
    moveTask: ['Менять статус', (api: TasksApi) => api.moveTask('T-58', 'Готово')],
    commentTask: ['Читать', (api: TasksApi) => api.commentTask('T-58', 'Проверка доступа')],
    createTask: [
      'Создавать',
      (api: TasksApi) => api.createTask({ title: 'Лишняя', assignee: 'X', project: 'fleet' }),
    ],
  } as const;
  type BoardCall = keyof typeof boardCalls;
  /** Петрова — «Менеджер логистики» на регион «Москва»: территориальная роль над фирмой проекта. */
  const withTerritorial = (h: ReturnType<typeof harness>) => {
    h.db.assignments.push({
      id: 'a-terr',
      member: 'm-petrova',
      role: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    return h;
  };

  it.each([
    ['closed', 'm-owner', 'toggleTaskCheck', CLOSED],
    ['closed', 'm-owner', 'moveTask', CLOSED],
    ['closed', 'm-owner', 'commentTask', CLOSED],
    ['closed', 'm-owner', 'createTask', CLOSED],
    ['closed', 'm-petrova', 'toggleTaskCheck', CLOSED],
    ['closed', 'm-petrova', 'moveTask', CLOSED],
    ['closed', 'm-petrova', 'commentTask', CLOSED],
    ['closed', 'm-petrova', 'createTask', CLOSED],
    ['limited', 'm-petrova', 'toggleTaskCheck', READ_ONLY],
    ['limited', 'm-petrova', 'moveTask', READ_ONLY],
    ['limited', 'm-petrova', 'createTask', READ_ONLY],
  ] as const)(
    'старая доска, %s проект × %s: %s запрещён доступом проекта, задачи не меняются',
    (access, actor, call: BoardCall, why) => {
      const h = withTerritorial(harness(actor));
      h.project('fleet').access = access;
      const before = structuredClone(h.db.tasks);
      const [verb, run] = boardCalls[call];
      const e = apiErr(() => run(h.api));
      expect(e.code).toBe('forbidden');
      expect(e.message).toMatch(
        new RegExp('^Нет права «' + verb + '» в проекте «Логистика · Север»: .*' + why + '$'),
      );
      expect(h.db.tasks).toEqual(before);
    },
  );

  it('ограниченный проект × унаследованная роль: комментировать можно — это чтение', () => {
    const h = withTerritorial(harness('m-petrova'));
    expect(h.project('fleet').access).toBe('limited');
    h.api.commentTask('T-58', 'Вижу');
    expect(h.task('T-58').comments.at(-1)?.text).toBe('Вижу');
  });

  it('закрытый проект × роль в самом проекте: чек-лист, комментарий и задача доступны', () => {
    const h = harness('m-kotova');
    h.project('fleet').access = 'closed';
    h.api.toggleTaskCheck('T-58', 1);
    h.api.commentTask('T-58', 'Сделано');
    const id = h.api.createTask({ title: 'Новая', assignee: 'X', project: 'fleet' });
    expect(h.task('T-58').checklist[1]?.d).toBe(true);
    expect(h.task('T-58').comments.at(-1)?.text).toBe('Сделано');
    expect(h.task(id).project).toBe('fleet');
  });

  it.each([
    ['toggleTaskCheck', (api: TasksApi, id: string) => api.toggleTaskCheck(id, 0)],
    ['moveTask', (api: TasksApi, id: string) => api.moveTask(id, 'Готово')],
    ['commentTask', (api: TasksApi, id: string) => api.commentTask(id, 'x')],
  ] as const)(
    '%s без права модуля: ответ одинаков для существующей и несуществующей задачи',
    (_name, run) => {
      const h = harness('m-akhmedov');
      const absent = apiErr(() => run(h.api, 'T-404'));
      const present = apiErr(() => run(h.api, 'L-31'));
      expect(absent.code).toBe('no_permission');
      expect(absent).toEqual(present);
    },
  );

  it('без актора команды проекта запрещены', () => {
    const h = harness();
    h.as(null);
    expect(apiErr(() => h.api.setTaskField('T-58', { priority: 'low' })).message).toBe(
      'Нет права «Менять статус» в проекте «Логистика · Север»: сотрудник заблокирован',
    );
  });
});
