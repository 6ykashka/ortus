// Контракт `TaskPort` (ядро W0.11) одним набором для тестового двойника ядра и реализации W4.10:
// модули документов, чатов и обращений не должны замечать подмену двойника на настоящий порт.
import { describe, expect, it } from 'vitest';
import { createIdGen } from '../../core/ids.ts';
import type { TaskPort } from '../../core/task-port.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createTaskPort } from './task-port.ts';
import type { Project, Task, WfStatus } from './types.ts';
import { buildWf } from './workflow.ts';

type Statuses = Record<string, WfStatus[]>;
type Factory = (statuses: Statuses, seq: { seq: number }) => TaskPort;

const fleetStatuses: WfStatus[] = [
  { id: 's1', name: 'Новая', cat: 'todo' },
  { id: 's2', name: 'В работе', cat: 'progress' },
  { id: 's3', name: 'На проверке', cat: 'progress' },
  { id: 's4', name: 'Готово', cat: 'done' },
];

function dbWith(
  statuses: Statuses,
  seq: number,
): TenantDb & { projects: Project[]; tasks: Task[] } {
  return {
    tenantId: 't-alta',
    seq,
    units: [],
    modules: {},
    members: [],
    roles: [],
    assignments: [],
    projects: [
      ...Object.entries(statuses).map(([id, st]): Project => ({
        id,
        key: id.toUpperCase(),
        name: id,
        owner: '—',
        wf: { v: 1, statuses: st, transitions: [] },
      })),
      { id: 'leads', key: 'ЗАЯ', name: 'Заявки', owner: '—', flow: 'leads' },
    ],
    tasks: [],
  };
}

const fake: Factory = (statuses, h) => createFakeTaskPort({ statuses, ids: createIdGen(h) });
const real: Factory = (statuses, h) => {
  const db = dbWith(statuses, h.seq);
  return createTaskPort(() => db, createIdGen(db));
};

describe.each([
  ['двойник ядра', fake],
  ['реализация W4.10', real],
] as const)('TaskPort: %s', (_name, make) => {
  it('statusName: предпочтительное имя, иначе первый статус категории, иначе имя по умолчанию', () => {
    const port = make({ fleet: fleetStatuses }, { seq: 1 });
    expect(port.statusName('fleet', 'progress', 'На проверке')).toBe('На проверке');
    expect(port.statusName('fleet', 'progress', 'Нет такого')).toBe('В работе');
    expect(port.statusName('fleet', 'done')).toBe('Готово');
    expect(port.statusName('leads', 'done', 'Отменена')).toBe('Отменена');
    expect(port.statusName('leads', 'todo')).toBe('Новая');
    expect(port.statusName('nope', 'progress')).toBe('В работе');
  });

  it('create/get/update/comment', () => {
    const port = make({ fleet: fleetStatuses }, { seq: 100 });
    const { id } = port.create({
      project: 'fleet',
      title: 'Согласовать: Договор',
      assignee: 'Марина Котова',
    });
    expect(id).toBe('T-100');
    expect(port.get(id)).toMatchObject({
      id,
      project: 'fleet',
      title: 'Согласовать: Договор',
      status: 'Новая',
    });
    port.update(id, {
      status: 'На проверке',
      assignee: 'Дарья Зимина',
      docRoute: { doc: 'doc-1' },
    });
    port.comment(id, { by: 'Система', at: '10:30', text: 'Маршрут запущен: v1', system: true });
    expect(port.get(id)).toMatchObject({
      status: 'На проверке',
      assignee: 'Дарья Зимина',
      docRoute: { doc: 'doc-1' },
    });
    expect(port.get(id)?.comments).toEqual([
      { by: 'Система', at: '10:30', text: 'Маршрут запущен: v1', system: true },
    ]);
  });

  it('явный статус, срок, приоритет, автор и id-схема проекта', () => {
    const port = make({ fleet: fleetStatuses }, { seq: 1 });
    const a = port.create({
      project: 'fleet',
      title: 'A',
      assignee: 'X',
      status: 'В работе',
      due: '15.10',
      priority: 'high',
      authorId: 'm-kotova',
      idPrefix: 'LOG-',
      idBase: 100,
      links: [{ kind: 'chat', id: 'ch-drv', label: 'Чат' }],
      comments: [{ by: 'X', at: '09:00', text: 'Из чата' }],
    });
    expect(a.id).toBe('LOG-101');
    expect(port.get(a.id)).toMatchObject({
      status: 'В работе',
      due: '15.10',
      priority: 'high',
      authorId: 'm-kotova',
      links: [{ kind: 'chat', id: 'ch-drv', label: 'Чат' }],
      comments: [{ by: 'X', at: '09:00', text: 'Из чата' }],
    });
  });

  it('несуществующая задача — без эффекта', () => {
    const port = make({}, { seq: 1 });
    port.update('nope', { status: 'Готово' });
    port.comment('nope', { by: 'x', at: '00:00', text: 'y' });
    expect(port.get('nope')).toBeUndefined();
  });
});

describe('TaskPort поверх db.tasks и процессов проектов', () => {
  const setup = () => {
    const db = dbWith({}, 40);
    db.projects.unshift({
      id: 'fleet',
      key: 'LOG',
      name: 'Логистика · Север',
      owner: 'Марина Котова',
      wf: buildWf('approval'),
    });
    const port = createTaskPort(() => db, createIdGen(db));
    return { db, port };
  };

  it('задача — в начале db.tasks, в полной форме задачи проекта; общий счётчик организации', () => {
    const { db, port } = setup();
    db.tasks.push({
      id: 'T-1',
      title: 'старая',
      assignee: 'x',
      status: 'Новая',
      priority: 'low',
      due: '—',
      project: 'fleet',
      checklist: [],
      comments: [],
      links: [],
    });
    const { id } = port.create({
      project: 'fleet',
      title: 'Согласовать: Договор поставки',
      description: 'Маршрут документа',
      labels: ['документ'],
      assignee: 'Марина Котова',
      author: 'Марина Котова',
      authorId: 'm-kotova',
      status: port.statusName('fleet', 'progress', 'На проверке'),
      idPrefix: 'LOG-',
      idBase: 100,
    });
    expect(id).toBe('LOG-140');
    expect(db.seq).toBe(41);
    expect(db.tasks.map((t) => t.id)).toEqual(['LOG-140', 'T-1']);
    expect(db.tasks[0]).toEqual({
      id: 'LOG-140',
      title: 'Согласовать: Договор поставки',
      description: 'Маршрут документа',
      labels: ['документ'],
      assignee: 'Марина Котова',
      author: 'Марина Котова',
      authorId: 'm-kotova',
      status: 'На проверке',
      priority: 'normal',
      due: '—',
      project: 'fleet',
      checklist: [],
      comments: [],
      links: [],
      files: [],
    } satisfies Task);
  });

  it('статус процесса проекта по умолчанию — первый статус категории «К выполнению»', () => {
    const { db, port } = setup();
    const wf = db.projects[0]?.wf;
    if (wf) wf.statuses = [{ id: 'x', name: 'Входящие', cat: 'todo' }, ...wf.statuses];
    const { id } = port.create({ project: 'fleet', title: 'A', assignee: 'X' });
    expect(port.get(id)?.status).toBe('Входящие');
  });

  it('get — снимок: правка снимка не меняет задачу; docRoute: null снимает сводку маршрута', () => {
    const { db, port } = setup();
    const { id } = port.create({ project: 'fleet', title: 'A', assignee: 'X' });
    const snap = port.get(id);
    if (snap) {
      snap.title = 'изменено';
      snap.comments.push({ by: 'x', at: '00:00', text: 'x' });
    }
    expect(db.tasks[0]).toMatchObject({ title: 'A', comments: [] });
    port.update(id, { docRoute: { title: 'Договор', waiting: ['m-owner'] }, due: '20.10' });
    expect(db.tasks[0]).toMatchObject({
      docRoute: { title: 'Договор', waiting: ['m-owner'] },
      due: '20.10',
    });
    port.update(id, { docRoute: null, priority: 'urgent', assignee: undefined });
    expect(db.tasks[0]).not.toHaveProperty('docRoute');
    expect(db.tasks[0]).toMatchObject({ priority: 'urgent', assignee: 'X' });
  });

  it('без среза задач порт создаёт его при первой задаче', () => {
    const db: TenantDb = {
      tenantId: 't-new',
      seq: 1,
      units: [],
      modules: {},
      members: [],
      roles: [],
      assignments: [],
    };
    const port = createTaskPort(() => db, createIdGen(db));
    expect(port.get('T-1')).toBeUndefined();
    port.create({ project: 'p', title: 'A', assignee: 'X' });
    expect(db.tasks?.map((t) => t.status)).toEqual(['Новая']);
  });
});
