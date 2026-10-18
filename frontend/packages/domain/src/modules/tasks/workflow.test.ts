import { describe, expect, it } from 'vitest';
import type { CoreDb } from '../../core/types/index.ts';
import type { Project, Task } from './types.ts';
import { buildWf, childrenOf, isDone, wfOf } from './workflow.ts';
import { WORKFLOWS } from './dictionaries.ts';

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id,
  title: id,
  assignee: 'Марина Котова',
  status: 'Новая',
  priority: 'normal',
  due: '—',
  project: 'fleet',
  checklist: [],
  comments: [],
  links: [],
  ...o,
});

const db = (projects: Project[], tasks: Task[]): CoreDb & { tasks: Task[] } => ({
  tenantId: 't-alta',
  seq: 1,
  units: [],
  modules: {},
  members: [],
  roles: [],
  assignments: [],
  projects,
  tasks,
});

describe('buildWf: процесс проекта (models.js:185–193)', () => {
  const statuses = [
    { id: 's1', name: 'Новая', cat: 'todo' },
    { id: 's2', name: 'В работе', cat: 'progress' },
    { id: 's3', name: 'На проверке', cat: 'progress' },
    { id: 's4', name: 'Готово', cat: 'done' },
    { id: 's5', name: 'Отменена', cat: 'done' },
  ];
  const base = {
    who: [],
    notAuthor: false,
    approval: null,
    comment: false,
    checklist: false,
    assignAuthor: false,
  };

  it('простой: «Принять» и «Вернуть на доработку» — руководителю проекта', () => {
    expect(buildWf('simple')).toEqual({
      v: 1,
      statuses,
      transitions: [
        { ...base, id: 't1', name: 'Взять в работу', from: ['s1'], to: 's2' },
        { ...base, id: 't2', name: 'На проверку', from: ['s2'], to: 's3' },
        {
          ...base,
          id: 't3',
          name: 'Принять',
          from: ['s3'],
          to: 's4',
          who: ['r-pm'],
          checklist: true,
          children: true,
        },
        {
          ...base,
          id: 't4',
          name: 'Вернуть на доработку',
          from: ['s3'],
          to: 's2',
          who: ['r-pm'],
          comment: true,
        },
        {
          ...base,
          id: 't5',
          name: 'Отменить',
          from: ['*'],
          to: 's5',
          who: ['r-pm'],
          comment: true,
        },
      ],
    });
  });

  it('с согласованием: «Согласовать» — не автор, любой согласующий, отказ → «В работе»', () => {
    const wf = buildWf('approval');
    expect(wf.transitions.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't5']);
    expect(wf.transitions[2]).toEqual({
      ...base,
      id: 't3',
      name: 'Согласовать',
      from: ['s3'],
      to: 's4',
      notAuthor: true,
      approval: { mode: 'any', rejectTo: 's2' },
      checklist: true,
      children: true,
      assignAuthor: true,
    });
  });

  it('каждый вызов — новый объект', () => {
    const [first] = buildWf('simple').statuses;
    if (first) first.name = 'X';
    expect(buildWf('simple').statuses[0]?.name).toBe('Новая');
  });
});

describe('wfOf, childrenOf, isDone (models.js:178, 214–215)', () => {
  const fleet: Project = {
    id: 'fleet',
    key: 'LOG',
    name: 'Логистика · Север',
    owner: 'x',
    wf: buildWf('approval'),
  };
  const leads: Project = { id: 'leads', key: 'ЗАЯ', name: 'Заявки', owner: 'x', flow: 'leads' };

  it('процесс старой доски: «Заявки» — воронка, остальные — задачи', () => {
    const d = db([fleet, leads], []);
    expect(wfOf(d, task('L-1', { project: 'leads' }))).toBe(WORKFLOWS.leads);
    expect(wfOf(d, task('T-1'))).toBe(WORKFLOWS.tasks);
    expect(wfOf(d, task('T-2', { project: 'nope' }))).toBe(WORKFLOWS.tasks);
    expect(wfOf({ ...d, projects: undefined }, task('T-3'))).toBe(WORKFLOWS.tasks);
  });

  it('пустой flow в данных — процесс задач, как `flow || "tasks"` эталона', () => {
    const broken = { ...leads, id: 'broken', flow: '' as unknown as 'leads' };
    expect(wfOf(db([broken], []), task('B-1', { project: 'broken' }))).toBe(WORKFLOWS.tasks);
  });

  it('подзадачи — по полю parent', () => {
    const root = task('T-66');
    const lone = task('T-1');
    const tasks = [root, task('T-65', { parent: 'T-66' }), task('T-58', { parent: 'T-66' }), lone];
    expect(childrenOf({ tasks }, root).map((t) => t.id)).toEqual(['T-65', 'T-58']);
    expect(childrenOf({ tasks }, lone)).toEqual([]);
    expect(childrenOf({}, root)).toEqual([]);
  });

  it.each([
    ['fleet', 'Готово', true],
    ['fleet', 'Отменена', true],
    ['fleet', 'На проверке', false],
    // Статуса нет в процессе проекта — по списку «завершённых» имён, как в эталоне.
    ['fleet', 'Объект', true],
    ['leads', 'Объект', true],
    ['leads', 'Отказ', true],
    ['leads', 'Смета', false],
    ['nope', 'Готово', true],
    ['nope', 'Новая', false],
  ])('isDone: проект %s, статус «%s» → %s', (project, status, done) => {
    const d = db([fleet, leads], []);
    expect(isDone(d, task('T-1', { project, status }))).toBe(done);
  });
});
