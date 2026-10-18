import { describe, expect, it } from 'vitest';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { normProjects, tasksSeed } from './seed.ts';
import type { Project, Task } from './types.ts';
import { tasksView } from './view.ts';

function alta() {
  const db = Object.assign(createAlta(createPlatform()) as TenantDb, tasksSeed('t-alta')) as Omit<
    TenantDb,
    'projects'
  > & { projects: Project[]; tasks: Task[] };
  normProjects(db);
  return db;
}
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const FLEET = ['T-66', 'T-65', 'T-61', 'T-58', 'T-63', 'T-64'];

describe('tasksView: проекты и задачи для участника (api.js:202–205)', () => {
  it('владелец — все проекты и задачи', () => {
    const v = tasksView(alta(), 'm-owner');
    expect(ids(v.projects)).toEqual(['fleet', 'leads']);
    expect(v.tasks).toHaveLength(11);
  });

  it('руководитель проекта — свой проект и его задачи', () => {
    const v = tasksView(alta(), 'm-kotova');
    expect(ids(v.projects)).toEqual(['fleet']);
    expect(ids(v.tasks)).toEqual(FLEET);
  });

  it('без доступа к проекту — только задачи, где участник исполнитель', () => {
    expect(tasksView(alta(), 'm-sokolov')).toEqual({
      projects: [],
      tasks: [expect.objectContaining({ id: 'L-29' }), expect.objectContaining({ id: 'L-18' })],
    });
    expect(tasksView(alta(), 'm-morozova')).toEqual({ projects: [], tasks: [] });
    expect(tasksView(alta(), 'm-nobody')).toEqual({ projects: [], tasks: [] });
  });

  it('роль области — проекты области по наследованию', () => {
    const db = alta();
    db.assignments.push({
      id: 'x',
      member: 'm-petrova',
      role: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    expect(ids(tasksView(db, 'm-petrova').projects)).toEqual(['fleet', 'leads']);
  });

  it('задача маршрута документа видна автору и тем, кого ждёт маршрут', () => {
    const db = alta();
    const l27 = db.tasks.find((t) => t.id === 'L-27');
    if (l27) {
      l27.docRoute = { title: 'Смета', waiting: ['m-kotova'] };
      l27.authorId = 'm-morozova';
    }
    expect(ids(tasksView(db, 'm-kotova').tasks)).toEqual([
      ...FLEET.slice(0, 4),
      'T-63',
      'L-27',
      'T-64',
    ]);
    expect(ids(tasksView(db, 'm-morozova').tasks)).toEqual(['L-27']);
    if (l27) l27.docRoute = { title: 'Смета' };
    expect(ids(tasksView(db, 'm-kotova').tasks)).toEqual(FLEET);
  });

  it('закрытый проект: владелец без роли его не видит (TP-03), но видит свои задачи', () => {
    const db = alta();
    const fleet = db.projects.find((p) => p.id === 'fleet');
    if (fleet) fleet.access = 'closed';
    const v = tasksView(db, 'm-owner');
    expect(ids(v.projects)).toEqual(['leads']);
    expect(ids(v.tasks)).toEqual(['T-63', 'L-31', 'L-29', 'L-27', 'L-24', 'L-18']);
    expect(ids(tasksView(db, 'm-kotova').projects)).toEqual(['fleet']);
  });

  it('проекция — копия: правка не меняет БД', () => {
    const db = alta();
    const {
      projects: [p0],
      tasks: [t0],
    } = tasksView(db, 'm-owner');
    if (p0) p0.name = 'x';
    if (t0) t0.title = 'x';
    expect(db.projects[0]?.name).toBe('Логистика · Север');
    expect(db.tasks[0]?.title).toBe('Подготовить парк к зиме');
  });
});
