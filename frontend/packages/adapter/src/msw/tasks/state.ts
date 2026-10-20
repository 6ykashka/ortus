// «Задачи и проекты» сценарного сервера (W4.03, контракт 0.10.0-stage4; W4.11–W4.13): проекты, процесс с версиями и
// черновиком, задачи, история, раунды согласования и автоматизация организации из сида домена W4.10 (tasksSeed и
// normProjects — mock-data.js, api.js:23–36 эталона 14.10). Доступ к проекту — projAccess эталона с TP-03 (закрытый
// проект — только по роли в нём, владельцу тоже): роль проекта (область project), роль области по уровню доступа
// (открытый — все действия, ограниченный — чтение, закрытый — ничего), владелец — системная роль. «Лотос» получает
// процесс v1 сидом (Q-W4.00-tasks-3, TP-06: статусы 1:1, переходы «все во все»).
import type { components } from '@ortus/api-client';
import {
  normProjects,
  type Project as DomainProject,
  type Task as DomainTask,
  tasksSeed,
  type Transition as DomainTransition,
  WORKFLOWS,
} from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import { grantsOf, isDriver, type TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { MemberRow, Org, ScenarioState } from '../core/state.ts';
import { iso, mskStamp } from '../core/time.ts';

type S = components['schemas'];

export type Level = S['TaskProjectAccessLevel'];
export type Category = S['TaskStatusCategory'];
export type Priority = S['TaskPriority'];
export type WfStatus = S['TaskWorkflowStatus'];
export type WfTransition = S['TaskWorkflowTransition'];

export interface WfVersion {
  version: number;
  statuses: WfStatus[];
  transitions: WfTransition[];
  publishedAt: string;
  publishedBy?: string;
}

export interface WfDraft {
  statuses: WfStatus[];
  transitions: WfTransition[];
  updatedAt: string;
  updatedBy?: string;
}

export interface ProjectRow {
  id: string;
  proto: string;
  key: string;
  name: string;
  orgUnitId: string | null;
  access?: Level;
  flow: 'tasks' | 'leads';
  workflowKey: string;
  ownerId: string;
  ownerName: string;
  versions: WfVersion[];
  draft?: WfDraft;
  workflowRevision: number;
  taskSeq: number;
  revision: number;
  createdAt: string;
}

export interface FileLink {
  fileId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  byId: string;
  byName: string;
  at: string;
}

export interface RoundRow {
  transitionKey: string;
  version: number;
  mode: 'any' | 'all';
  /** Состав «нужны все» — на вход в статус (Q-W4.00-tasks-9); у «достаточно одного» — пуст (считается на лету). */
  approverIds: string[];
  votes: { memberId: string; at: string }[];
}

export interface TaskRow {
  id: string;
  proto: string;
  key: string;
  projectId: string;
  title: string;
  description: string;
  statusId: string;
  workflowVersion?: number;
  priority: Priority;
  labels: string[];
  assigneeId?: string;
  authorId?: string;
  dueAt?: string;
  parentId?: string;
  checklist: S['TaskChecklistItem'][];
  files: FileLink[];
  round?: RoundRow;
  deleted?: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryRow {
  id: string;
  taskId: string;
  at: string;
  kind: S['TaskHistoryEntry']['kind'];
  actorId?: string;
  actorName: string;
  text: string;
  transitionKey?: string;
}

export interface AutomationRow {
  id: string;
  proto: string;
  projectId: string;
  name: string;
  trigger: S['TaskAutomationTrigger'];
  condition?: S['TaskAutomationCondition'];
  action: S['TaskAutomationAction'];
  enabled: boolean;
  version: number;
  authorId: string;
  authorName: string;
  runCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunRow {
  id: string;
  projectId: string;
  at: string;
  automationId: string;
  automationName: string;
  automationVersion: number;
  result: 'ok' | 'stopped' | 'error';
  text: string;
  taskId?: string;
}

export interface TasksData {
  projects: ProjectRow[];
  tasks: TaskRow[];
  history: HistoryRow[];
  automations: AutomationRow[];
  runs: RunRow[];
}

type WithTasks = Org & { tasksData?: TasksData };

/** Действия core.tasks в порядке каталога. */
export const TASK_KEYS = [
  'tasks.projects.read',
  'tasks.projects.manage',
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'tasks.transition',
  'tasks.approve',
  'tasks.members.manage',
  'tasks.workflow.manage',
  'tasks.automation.manage',
] as const;
const READ_KEYS = ['tasks.projects.read', 'tasks.read'];
const isTaskKey = (k: string): boolean => (TASK_KEYS as readonly string[]).includes(k);

/** Глагол эталона (VERB_LABEL) действия каталога — для текста «роль «X» не даёт «Y»». */
export const VERB_OF: Readonly<Record<string, string>> = {
  'tasks.projects.read': 'Читать',
  'tasks.read': 'Читать',
  'tasks.create': 'Создавать',
  'tasks.update': 'Менять статус',
  'tasks.transition': 'Менять статус',
  'tasks.approve': 'Согласовывать',
  'tasks.projects.manage': 'Настраивать',
  'tasks.members.manage': 'Настраивать',
  'tasks.workflow.manage': 'Настраивать',
  'tasks.automation.manage': 'Настраивать',
};

/** Роли проекта сида (Q-W4.00-tasks-17): прототип `PROJECT_ROLES`. */
export const PROJECT_ROLE_PROTOS = ['r-pm', 'r-approver', 'r-exec', 'r-viewer'];

/** «Кто может» эталона → контракт. */
const WHO: Readonly<Record<string, WfTransition['who'][number]>> = {
  'r-pm': 'project_manager',
  'r-approver': 'project_approver',
  'r-exec': 'project_executor',
  assignee: 'assignee',
  author: 'author',
};

/** «Кто может» → действие роли проекта, которое его заменяет (WHO_VERB эталона). */
export const WHO_KEY: Readonly<Record<string, string>> = {
  project_manager: 'tasks.workflow.manage',
  project_approver: 'tasks.approve',
  project_executor: 'tasks.transition',
};

export const WHO_LABEL: Readonly<Record<string, string>> = {
  project_manager: 'руководитель проекта',
  project_approver: 'согласующий',
  project_executor: 'исполнитель по роли',
  assignee: 'исполнитель задачи',
  author: 'автор задачи',
};

export const PRIORITY_LABEL: Readonly<Record<string, string>> = {
  urgent: 'Срочно',
  high: 'Высокий',
  normal: 'Обычный',
  low: 'Низкий',
};

export const LEVEL_LABEL: Readonly<Record<string, string>> = {
  open: 'Открытый',
  limited: 'Ограниченный',
  closed: 'Закрытый',
};

/** Сид — «сейчас» 01.10.2026 10:30 по Москве; версии процесса сида опубликованы 01.09. */
const SEED_PUBLISHED = '2026-09-01T06:00:00Z';
const SEED_CREATED = '2026-09-01T06:00:00Z';

const MSK_DAY = (dd: number, mm: number, h = 0, m = 0): string =>
  iso(new Date(Date.UTC(2026, mm - 1, dd, h - 3, m)));

/** «ДД.ММ» срока эталона → конец дня по Москве 2026 года. */
export function dueOf(due: string): string | undefined {
  const m = /^(\d{2})\.(\d{2})$/.exec(due);
  if (!m) return undefined;
  return MSK_DAY(Number(m[1]) + 1, Number(m[2]));
}

/** Время комментария эталона: «27.09 10:12» или «09:30» (сегодня, 01.10). */
function stampOf(at: string): string {
  return mskStamp(at) ?? mskStamp(`01.10 ${at}`) ?? SEED_CREATED;
}

/** Процесс v1 по TP-06 (Q-W4.00-tasks-3): статусы 1:1 по текущим и стандартным, переходы «все во все» без правил. */
export function initialWorkflow(statusNames: readonly string[]): {
  statuses: WfStatus[];
  transitions: WfTransition[];
} {
  const names = ['Новая', 'В работе', 'На проверке', 'Готово'];
  for (const n of statusNames) if (!names.includes(n)) names.push(n);
  const category = (n: string): Category =>
    n === 'Новая'
      ? 'todo'
      : ['Готово', 'Отменена', 'Объект', 'Отказ'].includes(n)
        ? 'done'
        : 'progress';
  const statuses = names.map((name, i) => ({ id: `s${i + 1}`, name, category: category(name) }));
  return {
    statuses,
    transitions: statuses.map((st) => ({
      key: `to-${st.id}`,
      name: st.name,
      from: ['*'],
      to: st.id,
      who: [],
      notAuthor: false,
      commentRequired: false,
      checklistClosed: false,
      childrenDone: false,
      assignAuthor: false,
    })),
  };
}

/** Переход эталона → контракт. */
export function transitionOf(tr: DomainTransition): WfTransition {
  const out: WfTransition = {
    key: tr.id,
    name: tr.name,
    from: [...tr.from],
    to: tr.to,
    who: tr.who.map((w) => WHO[w] ?? 'assignee'),
    notAuthor: tr.notAuthor,
    commentRequired: tr.comment,
    checklistClosed: tr.checklist,
    childrenDone: Boolean(tr.children),
    assignAuthor: tr.assignAuthor,
  };
  if (tr.approval) out.approval = { mode: tr.approval.mode, rejectTo: tr.approval.rejectTo };
  return out;
}

/** Этапы воронки «Заявки» (WORKFLOWS.leads): переход — по имени этапа назначения. */
const FUNNEL_IDS: Readonly<Record<string, string>> = {
  Новая: 'new',
  Замер: 'measure',
  Смета: 'estimate',
  Договор: 'contract',
  Объект: 'object',
  Отказ: 'rejected',
};

export function funnelWorkflow(): { statuses: WfStatus[]; transitions: WfTransition[] } {
  const f = WORKFLOWS.leads;
  const names = [...f.statuses, ...Object.keys(f.flow).filter((n) => !f.statuses.includes(n))];
  const statuses: WfStatus[] = names.map((name) => ({
    id: FUNNEL_IDS[name] ?? 'stage',
    name,
    category:
      name === 'Новая' ? 'todo' : name === 'Объект' || name === 'Отказ' ? 'done' : 'progress',
  }));
  const transitions: WfTransition[] = statuses.map((to) => ({
    key: `to-${to.id}`,
    name: to.name,
    from: statuses.filter((s) => (f.flow[s.name] ?? []).includes(to.name)).map((s) => s.id),
    to: to.id,
    who: [],
    notAuthor: false,
    commentRequired: false,
    checklistClosed: false,
    childrenDone: false,
    assignAuthor: false,
  }));
  return { statuses, transitions: transitions.filter((t) => t.from.length > 0) };
}

// ---------------------------------------------------------------------------------------------
// Сид

function memberByName(org: Org, name: string | undefined): MemberRow | undefined {
  return name ? org.members.find((m) => m.displayName === name) : undefined;
}

function seedTasks(org: Org): TasksData {
  const proto = org.proto;
  const T = (id: string) => seedUuid(proto, id);
  const raw = tasksSeed(proto);
  if (proto === 't-alta') normProjects(raw);
  const data: TasksData = { projects: [], tasks: [], history: [], automations: [], runs: [] };
  for (const p of raw.projects as DomainProject[]) {
    const owner = memberByName(org, p.owner);
    const leads = p.flow === 'leads';
    const used = raw.tasks.filter((t) => t.project === p.id).map((t) => t.status);
    const wf = leads
      ? funnelWorkflow()
      : p.wf
        ? {
            statuses: p.wf.statuses.map((s) => ({ id: s.id, name: s.name, category: s.cat })),
            transitions: p.wf.transitions.map(transitionOf),
          }
        : initialWorkflow(used);
    const row: ProjectRow = {
      id: T(p.id),
      proto: p.id,
      key: p.key,
      name: p.name,
      orgUnitId: p.unit ? T(p.unit) : null,
      flow: leads ? 'leads' : 'tasks',
      workflowKey: leads ? 'leads' : p.wf ? (p.id === 'fleet' ? 'approval' : 'simple') : 'initial',
      ownerId: owner?.id ?? '',
      ownerName: p.owner,
      versions: [{ version: 1, ...wf, publishedAt: SEED_PUBLISHED }],
      workflowRevision: 1,
      taskSeq: 100,
      revision: 1,
      createdAt: SEED_CREATED,
    };
    if (!leads) row.access = p.access ?? 'limited';
    data.projects.push(row);
    for (const a of p.automations ?? []) {
      const author = org.members.find((m) => m.proto === a.byId);
      const action: S['TaskAutomationAction'] =
        a.action.kind === 'assign'
          ? { kind: 'assign', memberId: memberByName(org, a.action.value)?.id ?? '' }
          : a.action.kind === 'priority'
            ? { kind: 'set_priority', priority: a.action.value as Priority }
            : { kind: 'comment', text: a.action.value };
      const rule: AutomationRow = {
        id: T(a.id),
        proto: a.id,
        projectId: row.id,
        name: a.name,
        trigger:
          a.trigger === 'status' && a.to
            ? { kind: 'status_entered', statusId: a.to }
            : { kind: 'created' },
        action,
        enabled: a.on,
        version: a.version,
        authorId: author?.id ?? '',
        authorName: a.by,
        runCount: (p.runs ?? []).filter((r) => r.rule === a.id).length,
        revision: 1,
        createdAt: SEED_CREATED,
        updatedAt: SEED_CREATED,
      };
      if (a.cond?.priority) rule.condition = { priority: a.cond.priority };
      data.automations.push(rule);
    }
    (p.runs ?? []).forEach((r, i) => {
      const run: RunRow = {
        id: T(`run:${p.id}:${i + 1}`),
        projectId: row.id,
        at: stampOf(r.at),
        automationId: T(r.rule),
        automationName: r.name,
        automationVersion: r.rv,
        result: r.res,
        text: r.text,
      };
      if (raw.tasks.some((t) => t.id === r.task)) run.taskId = T(r.task);
      data.runs.push(run);
    });
  }
  for (const t of raw.tasks as DomainTask[]) {
    const p = data.projects.find((x) => x.proto === t.project);
    if (!p) continue;
    const wf = current(p);
    const st = wf?.statuses.find((s) => s.name === t.status);
    const author = t.authorId ? org.members.find((m) => m.proto === t.authorId) : undefined;
    const row: TaskRow = {
      id: T(t.id),
      proto: t.id,
      key: t.id,
      projectId: p.id,
      title: t.title,
      description: t.description ?? '',
      statusId: st?.id ?? wf?.statuses[0]?.id ?? 's1',
      priority: t.priority,
      labels: [...(t.labels ?? [])],
      checklist: t.checklist.map((c, i) => ({ id: `ch-${i + 1}`, text: c.t, done: c.d })),
      files: (t.files ?? []).map((f) => {
        const by = org.members.find((m) => m.proto === f.byId);
        return {
          fileId: T(`file:${t.id}:${f.id}`),
          name: f.name,
          sizeBytes: f.size,
          contentType: f.type,
          byId: by?.id ?? '',
          byName: f.by,
          at: stampOf(f.at),
        };
      }),
      revision: 1,
      createdAt: SEED_CREATED,
      updatedAt: SEED_CREATED,
    };
    if (p.flow === 'tasks') row.workflowVersion = 1;
    const assignee = memberByName(org, t.assignee);
    if (assignee) row.assigneeId = assignee.id;
    if (author) row.authorId = author.id;
    const due = dueOf(t.due);
    if (due) row.dueAt = due;
    if (t.parent) row.parentId = T(t.parent);
    data.tasks.push(row);
    t.comments.forEach((c, i) => {
      const by = memberByName(org, c.by);
      const h: HistoryRow = {
        id: T(`hist:${t.id}:${i + 1}`),
        taskId: row.id,
        at: stampOf(c.at),
        kind: c.system ? 'transition' : 'comment',
        actorName: c.by,
        text: c.text,
      };
      if (by) h.actorId = by.id;
      data.history.push(h);
    });
  }
  return data;
}

/** Задачи организации (сид при первом обращении — и для состояний, сохранённых до W4.03). */
export function tasksDataOf(org: Org): TasksData {
  const x = org as WithTasks;
  if (!x.tasksData) {
    x.tasksData = seedTasks(org);
    seedFiles(org, x.tasksData);
  }
  return x.tasksData;
}

/** Файлы вложений сида — в файлах организации (core.files: purpose task_attachment, владелец tasks/task). */
function seedFiles(org: Org, data: TasksData): void {
  for (const t of data.tasks) {
    for (const f of t.files) {
      if (org.files.some((x) => x.id === f.fileId)) continue;
      org.files.push({
        id: f.fileId,
        fileName: f.name,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        sha256: 'a'.repeat(64),
        status: 'ready',
        createdAt: f.at,
      });
      org.uploads.push({
        uploadId: seedUuid(org.proto, `upload:${f.fileId}`),
        fileId: f.fileId,
        state: 'completed',
        purpose: 'task_attachment',
        owner: { moduleKey: 'tasks', entityType: 'task', entityId: t.id },
        sizeBytes: f.sizeBytes,
        reservedBytes: 0,
        ticketExpiresAt: f.at,
        sessionExpiresAt: f.at,
        fileStatus: 'ready',
        createdAt: f.at,
        requiredSha256: 'a'.repeat(64),
        contentType: f.contentType,
        completedAt: f.at,
      });
    }
  }
}

/** Опубликованная версия процесса проекта. */
export const current = (p: ProjectRow): WfVersion | undefined => p.versions.at(-1);

/** Версия процесса задачи (воронка — её единственная). */
export const versionOf = (p: ProjectRow, t: TaskRow): WfVersion | undefined =>
  p.versions.find((v) => v.version === (t.workflowVersion ?? 1)) ?? current(p);

export const statusOf = (p: ProjectRow, t: TaskRow): WfStatus | undefined =>
  versionOf(p, t)?.statuses.find((s) => s.id === t.statusId) ??
  current(p)?.statuses.find((s) => s.id === t.statusId);

// ---------------------------------------------------------------------------------------------
// Доступ проекта (projAccess эталона, TP-03)

export interface Access {
  actions: string[];
  roleName: string;
  roleId?: string;
  source: 'assigned' | 'group' | 'inherited' | 'system';
  via: string;
  assignmentId?: string;
}

function subtree(org: Org, unitId: string): Set<string> {
  const out = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of org.units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Владелец организации (OwnerBinding) — участник `memberId`. */
export function isOwner(s: ScenarioState, org: Org, memberId: string): boolean {
  return s.memberships.some(
    (m) => m.tenantId === org.tenantId && m.memberId === memberId && m.owner,
  );
}

/** Доступ участника к проекту или null (как projAccess эталона с TP-03). */
export function accessOf(
  s: ScenarioState,
  org: Org,
  p: ProjectRow,
  memberId: string,
  now: string,
): Access | null {
  const gs = grantsOf(org, memberId, now);
  const system = isOwner(s, org, memberId) || gs.some((g) => g.role.all);
  if (p.access !== 'closed' && system) {
    return {
      actions: [...TASK_KEYS],
      roleName: 'Владелец бизнеса',
      source: 'system',
      via: 'Системная роль, вся организация',
    };
  }
  const own = gs.find((g) => g.scope.kind === 'project' && g.scope.resourceIds.includes(p.id));
  if (own) {
    const group = own.groupId ? org.groups.find((g) => g.id === own.groupId) : undefined;
    return {
      actions: TASK_KEYS.filter((k) => own.keys.includes(k)),
      roleName: own.role.name,
      roleId: own.role.id,
      source: group ? 'group' : 'assigned',
      via: group ? `Назначен через группу «${group.name}»` : 'Назначен в проекте',
      assignmentId: own.assignment.id,
    };
  }
  if (p.access === 'closed') return null;
  const inh = gs.filter(
    (g) =>
      (g.scope.kind === 'tenant' ||
        (g.scope.kind === 'org_unit' &&
          p.orgUnitId !== null &&
          g.scope.resourceIds.some((u) => subtree(org, u).has(p.orgUnitId ?? '')))) &&
      g.keys.some(isTaskKey),
  );
  const [first] = inh;
  if (!first) return null;
  const all = TASK_KEYS.filter((k) => inh.some((g) => g.keys.includes(k)));
  const unit =
    first.scope.kind === 'org_unit'
      ? org.units.find((u) => u.id === first.scope.resourceIds[0])
      : undefined;
  return {
    actions:
      p.access === 'open' || p.flow === 'leads' ? all : all.filter((k) => READ_KEYS.includes(k)),
    roleName: first.role.name,
    roleId: first.role.id,
    source: 'inherited',
    via: `Наследуется: «${first.role.name}»${unit ? ` в «${unit.name}»` : ''}`,
  };
}

/** Право участника на действие в проекте (projCan эталона): ok или причина дословно. */
export function canIn(
  s: ScenarioState,
  org: Org,
  p: ProjectRow,
  memberId: string,
  key: string,
  now: string,
): { ok: true; a: Access } | { ok: false; why: string; a?: Access } {
  const m = org.members.find((x) => x.id === memberId);
  if (!m || m.status === 'suspended') return { ok: false, why: 'сотрудник заблокирован' };
  const a = accessOf(s, org, p, memberId, now);
  if (!a) {
    return {
      ok: false,
      why:
        p.access === 'closed'
          ? 'закрытый проект — нужна роль в самом проекте'
          : 'нет роли с правом «Задачи» в области проекта',
    };
  }
  if (a.actions.includes(key)) return { ok: true, a };
  return {
    ok: false,
    a,
    why:
      `роль «${a.roleName}» не даёт «${VERB_OF[key] ?? key}»` +
      (a.source === 'inherited' && p.access === 'limited'
        ? ': в ограниченном проекте унаследованный доступ — только чтение'
        : ''),
  };
}

// ---------------------------------------------------------------------------------------------
// Вид участника

export interface TasksView {
  ctx: HandlerContext;
  t: TenantAccess;
  data: TasksData;
  me: string;
  now: string;
  access(p: ProjectRow): Access | null;
  can(p: ProjectRow, key: string): ReturnType<typeof canIn>;
  canTask(t: TaskRow, key: string): boolean;
  project(id: string): ProjectRow | undefined;
  visibleProject(p: ProjectRow): boolean;
  visibleTask(t: TaskRow): boolean;
  member(id: string | undefined): MemberRow | undefined;
}

/** Есть ли у участника грант `key` в области «своё» (x-scope …-self: задача, где он исполнитель). */
function selfGrant(t: TenantAccess, key: string, now: string): boolean {
  return (
    !!t.member &&
    grantsOf(t.org, t.member.id, now).some((g) => g.scope.kind === 'self' && g.keys.includes(key))
  );
}

export function viewOf(ctx: HandlerContext): TasksView {
  const t = ctx.org();
  const now = ctx.now();
  const data = tasksDataOf(t.org);
  const me = t.member?.id ?? '';
  const cache = new Map<string, Access | null>();
  const access = (p: ProjectRow): Access | null => {
    if (!cache.has(p.id)) cache.set(p.id, me ? accessOf(ctx.s, t.org, p, me, now) : null);
    return cache.get(p.id) ?? null;
  };
  const project = (id: string) => data.projects.find((p) => p.id === id);
  const v: TasksView = {
    ctx,
    t,
    data,
    me,
    now,
    access,
    can: (p, key) => canIn(ctx.s, t.org, p, me, key, now),
    canTask: (task, key) => {
      const p = project(task.projectId);
      if (!p) return false;
      if (access(p)?.actions.includes(key)) return true;
      return task.assigneeId === me && selfGrant(t, key, now);
    },
    project,
    visibleProject: (p) => {
      const a = access(p);
      return !!a && a.actions.includes('tasks.projects.read');
    },
    visibleTask: (task) => !task.deleted && v.canTask(task, 'tasks.read'),
    member: (id) => (id ? t.org.members.find((m) => m.id === id) : undefined),
  };
  return v;
}

/** Проект пути (`projectId`), видимый участнику, или 404. */
export function projectOr404(v: TasksView): ProjectRow {
  const id = (v.ctx.params.projectId ?? '').toLowerCase();
  const p = v.project(id);
  if (!p || !v.access(p)) return fail('not_found', 'Проект не найден');
  return p;
}

/** Задача пути (`taskId`), видимая участнику, или 404 (Q-W4.10-3). */
export function taskOr404(v: TasksView): TaskRow {
  const id = (v.ctx.params.taskId ?? '').toLowerCase();
  const t = v.data.tasks.find((x) => x.id === id);
  if (!t || !v.visibleTask(t)) return fail('not_found', 'Задача не найдена');
  return t;
}

/** Действие в проекте или 403 с текстом эталона «Нет права «Y» в проекте «X»: причина». */
export function need(v: TasksView, p: ProjectRow, key: string): Access {
  const c = v.can(p, key);
  if (!c.ok) {
    fail('forbidden_action', `Нет права «${VERB_OF[key] ?? key}» в проекте «${p.name}»: ${c.why}`);
  }
  return c.a;
}

/** Участники с доступом к проекту (строки «Участников»), владелец организации — системная роль. */
export function membersOf(v: TasksView, p: ProjectRow): S['TaskProjectMember'][] {
  const out: S['TaskProjectMember'][] = [];
  for (const m of v.t.org.members) {
    // Эталон «Участников» и «Людей» — только не заблокированные («Задачи и проекты.dc.html»:360, :441).
    if (m.status !== 'active') continue;
    const a = accessOf(v.ctx.s, v.t.org, p, m.id, v.now);
    if (!a) continue;
    const row: S['TaskProjectMember'] = {
      memberId: m.id,
      displayName: m.displayName,
      memberStatus: 'active',
      roleName: a.roleName,
      source: a.source,
      via: a.via,
      actions: [...a.actions],
      editable: a.source === 'assigned',
    };
    if (a.roleId) row.roleId = a.roleId;
    if (a.assignmentId) row.assignmentId = a.assignmentId;
    if (isDriver(v.t.org, m, v.now)) row.functionNotes = ['финансы скрыты'];
    out.push(row);
  }
  return out;
}

export const nameOf = (v: TasksView, id: string | undefined): string | undefined =>
  v.member(id)?.displayName;
