import { describe, expect, it } from 'vitest';
import type { Assignment, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { approversOf, projAccess, projCan } from './access.ts';
import type { Project, ProjectAccessLevel, Task, Transition } from './types.ts';
import { buildWf } from './workflow.ts';

const project = (access: ProjectAccessLevel, o: Partial<Project> = {}): Project => ({
  id: 'fleet',
  key: 'LOG',
  name: 'Логистика · Север',
  unit: 'f-msk-sever',
  owner: 'Марина Котова',
  access,
  wf: buildWf('approval'),
  automations: [],
  runs: [],
  ...o,
});

/** «Альта» сырого сида 14.10 + логист-менеджер региона «Москва» и менеджер на всю организацию. */
function alta(extra: Assignment[] = []): TenantDb {
  const db: TenantDb = createAlta(createPlatform());
  db.assignments.push(...extra);
  return db;
}

const regionManager: Assignment = {
  id: 'x1',
  member: 'm-petrova',
  role: 'r-manager',
  scope: { type: 'region', id: 'r-msk' },
};
const tenantManager: Assignment = {
  id: 'x2',
  member: 'm-akhmedov',
  role: 'r-manager',
  scope: { type: 'tenant' },
};

describe('projAccess: откуда доступ к проекту (models.js:194–205, TP-03)', () => {
  it('владелец бизнеса — все действия через системную роль', () => {
    expect(projAccess(alta(), project('limited'), 'm-owner')).toEqual({
      owner: true,
      verbs: ['view', 'create', 'edit', 'review', 'settings'],
      via: 'Системная роль, вся организация',
      inherited: true,
      roleName: 'Владелец бизнеса',
    });
  });

  it('роль в самом проекте — действия роли, назначение и путь через группу', () => {
    const db = alta();
    expect(projAccess(db, project('limited'), 'm-kotova')).toEqual({
      verbs: ['view', 'create', 'edit', 'review', 'settings'],
      via: 'Назначен в проекте',
      inherited: false,
      role: 'r-pm',
      roleName: 'Руководитель проекта',
      aid: 'ap1',
    });
    expect(projAccess(db, project('closed'), 'm-vasiliev')).toMatchObject({
      verbs: ['view', 'create', 'edit'],
      via: 'Назначен через группу «Водители Север»',
      role: 'r-exec',
      aid: 'ap2',
    });
    expect(projAccess(db, project('open', { id: 'leads' }), 'm-kotova')).toBeNull();
  });

  it.each([
    ['open', ['view', 'create', 'edit']],
    ['limited', ['view']],
  ] as const)('наследование из области: %s проект → %j', (access, verbs) => {
    expect(projAccess(alta([regionManager]), project(access), 'm-petrova')).toEqual({
      verbs,
      via: 'Наследуется: «Менеджер логистики» в «Москва»',
      inherited: true,
      roleName: 'Менеджер логистики',
    });
  });

  it('роль на всю организацию наследуется без названия области; проект организации — только так', () => {
    const db = alta([regionManager, tenantManager]);
    expect(projAccess(db, project('limited'), 'm-akhmedov')?.via).toBe(
      'Наследуется: «Менеджер логистики»',
    );
    const org = project('open', { unit: undefined });
    expect(projAccess(db, org, 'm-akhmedov')?.verbs).toEqual(['view', 'create', 'edit']);
    expect(projAccess(db, org, 'm-petrova')).toBeNull();
  });

  it('закрытый проект: наследования нет, и владелец без роли в проекте его не видит (TP-03)', () => {
    const db = alta([regionManager]);
    expect(projAccess(db, project('closed'), 'm-petrova')).toBeNull();
    expect(projAccess(db, project('closed'), 'm-owner')).toBeNull();
    db.assignments.push({
      id: 'x3',
      member: 'm-owner',
      role: 'r-viewer',
      scope: { type: 'project', id: 'fleet' },
    });
    expect(projAccess(db, project('closed'), 'm-owner')).toMatchObject({
      verbs: ['view'],
      roleName: 'Наблюдатель',
      inherited: false,
    });
  });

  it('роли «только своё» и роли без действий в задачах не наследуются', () => {
    const db = alta();
    expect(projAccess(db, project('open'), 'm-sokolov')).toBeNull();
    // Водитель: роль фирмы без действий в «Задачах»; в чужом проекте роли проекта нет.
    expect(projAccess(db, project('open', { id: 'other' }), 'm-vasiliev')).toBeNull();
    expect(projAccess(db, project('open'), 'm-akhmedov')).toBeNull();
  });
});

describe('projCan: может ли и почему нет (models.js:206–213)', () => {
  it.each([
    ['m-owner', 'settings', true],
    ['m-kotova', 'settings', true],
    ['m-kotelnikova', 'review', true],
    ['m-vasiliev', 'edit', true],
    ['m-vasiliev', 'review', false],
  ] as const)('%s · %s → %s', (member, verb, ok) => {
    expect(projCan(alta(), project('limited'), member, verb).ok).toBe(ok);
  });

  it.each([
    ['m-kotelnikova', 'edit', 'limited', 'роль «Согласующий» не даёт «Менять статус»'],
    ['m-morozova', 'view', 'limited', 'нет роли с правом «Задачи» в области проекта'],
    ['m-morozova', 'view', 'closed', 'закрытый проект — нужна роль в самом проекте'],
    ['m-gromov', 'view', 'open', 'сотрудник заблокирован'],
    ['m-nobody', 'view', 'open', 'сотрудник заблокирован'],
    [
      'm-petrova',
      'create',
      'limited',
      'роль «Менеджер логистики» не даёт «Создавать»: в ограниченном проекте унаследованный доступ — только чтение',
    ],
    ['m-petrova', 'review', 'open', 'роль «Менеджер логистики» не даёт «Согласовывать»'],
    ['m-vasiliev', 'export', 'limited', 'роль «Исполнитель» не даёт «export»'],
  ] as const)('%s · %s в %s проекте: «%s»', (member, verb, access, why) => {
    expect(projCan(alta([regionManager]), project(access), member, verb)).toMatchObject({
      ok: false,
      why,
    });
  });

  it('результат несёт доступ, на котором основан ответ', () => {
    const r = projCan(alta(), project('limited'), 'm-kotelnikova', 'edit');
    expect(r).toMatchObject({ a: { role: 'r-approver', aid: 'ap3' } });
    const ok = projCan(alta(), project('limited'), 'm-kotova', 'view');
    expect(ok).toMatchObject({ ok: true, a: { aid: 'ap1' } });
  });
});

describe('approversOf: кто согласует переход (models.js:216)', () => {
  const tr = (notAuthor: boolean): Transition => ({
    ...(buildWf('approval').transitions[2] as Transition),
    notAuthor,
  });
  const task = (authorId?: string): Task => ({
    id: 'T-65',
    title: 'Заменить шины',
    assignee: 'Илья Васильев',
    status: 'На проверке',
    priority: 'high',
    due: '10.10',
    project: 'fleet',
    checklist: [],
    comments: [],
    links: [],
    ...(authorId ? { authorId } : {}),
  });

  it('активные участники с правом «Согласовывать»; автор исключён, если так в переходе', () => {
    const db = alta();
    const ids = (t: Task, x: Transition) =>
      approversOf(db, project('limited'), t, x).map((m) => m.id);
    expect(ids(task(), tr(true))).toEqual(['m-owner', 'm-kotova', 'm-kotelnikova']);
    expect(ids(task('m-kotova'), tr(true))).toEqual(['m-owner', 'm-kotelnikova']);
    expect(ids(task('m-kotova'), tr(false))).toEqual(['m-owner', 'm-kotova', 'm-kotelnikova']);
  });

  it('приглашённый и заблокированный не согласуют', () => {
    const db = alta([
      {
        id: 'x4',
        member: 'm-petrova',
        role: 'r-approver',
        scope: { type: 'project', id: 'fleet' },
      },
      { id: 'x5', member: 'm-gromov', role: 'r-approver', scope: { type: 'project', id: 'fleet' } },
    ]);
    expect(approversOf(db, project('limited'), task(), tr(true)).map((m) => m.id)).toEqual([
      'm-owner',
      'm-kotova',
      'm-kotelnikova',
    ]);
  });
});
