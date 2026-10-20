// Тег Tasks сценарного сервера (W4.03, контракт 0.10.0-stage4; W4.11–W4.13): проекты, участники, процесс с версиями и
// черновиком, задачи (переходы, согласование и отказ, чек-лист, иерархия, вложения, история, комментарий),
// автоматизация и журнал. Тексты ошибок — эталона дословно (api.js 14.10:618–769, models.js:194–233); отличия —
// решения по умолчанию Q-W4.00-tasks-* (TP-03, TP-06, PD-53, PD-60).
import type { components } from '@ortus/api-client';
import { buildWf } from '@ortus/domain/modules';

import { grantsOf } from '../core/access.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import type { AssignmentRow } from '../core/state.ts';
import {
  approvalHere,
  autoFire,
  check,
  ensureRound,
  fromHere,
  historyDto,
  log,
  moveTo,
  projectDto,
  rejectCheck,
  taskDto,
  touch,
  workflowDto,
} from './engine.ts';
import {
  accessOf,
  type AutomationRow,
  canIn,
  current,
  initialWorkflow,
  membersOf,
  nameOf,
  need,
  PROJECT_ROLE_PROTOS,
  type ProjectRow,
  projectOr404,
  statusOf,
  TASK_KEYS,
  type TaskRow,
  type TasksView,
  taskOr404,
  transitionOf,
  versionOf,
  viewOf,
  type WfStatus,
  type WfTransition,
} from './state.ts';

type S = components['schemas'];

const DESCRIPTION_MAX = 5000;
const FILES_PER_TASK = 30;
const FILE_MAX_BYTES = 20 * 1048576;
const FILE_OK =
  /^(image\/|application\/pdf|text\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.oasis|zip))/;
const MAX_LEVELS = 3;

function invalid(field: string, code: string, message: string): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

const normLabels = (xs: readonly string[] | undefined): string[] =>
  [...new Set((xs ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 10);

/** Процесс шаблона эталона (buildWf: «Простой» или «С согласованием»). */
function template(kind: 'simple' | 'approval'): {
  statuses: WfStatus[];
  transitions: WfTransition[];
} {
  const wf = buildWf(kind);
  return {
    statuses: wf.statuses.map((s) => ({ id: s.id, name: s.name, category: s.cat })),
    transitions: wf.transitions.map(transitionOf),
  };
}

/** Проект с процессом с версиями (не воронка) или 409 funnel_fixed. */
function notFunnel(p: ProjectRow, text = 'Этапы воронки «Заявки» фиксированы'): void {
  if (p.flow === 'leads') fail('invalid_transition', text, { reason: 'funnel_fixed' });
}

/** Участник может назначить исполнителем: активный и видит проект (Р-16). */
function assignable(v: TasksView, p: ProjectRow, memberId: string, field: string): void {
  const m = v.member(memberId);
  const c = m ? canIn(v.ctx.s, v.t.org, p, m.id, 'tasks.read', v.now) : undefined;
  if (!m || m.status !== 'active' || !c?.ok) {
    invalid(field, 'not_in_project', 'Исполнитель не видит проект — выберите участника проекта');
  }
}

/** Родитель задачи (checkParent эталона; невидимый — 404, Q-W4.10-3). */
function checkParent(v: TasksView, t: TaskRow | null, parentId: string): TaskRow {
  const all = v.data.tasks;
  const par = all.find((x) => x.id === parentId.toLowerCase() && !x.deleted);
  if (!par) invalid('parentTaskId', 'not_found', 'Задача не найдена');
  const pp = v.project(par.projectId);
  if (!pp || pp.flow !== 'tasks' || !v.visibleTask(par)) fail('not_found', 'Задача не найдена');
  if (t && par.id === t.id) {
    invalid('parentTaskId', 'self', 'Задача не может входить в саму себя');
  }
  let up: TaskRow | undefined = par;
  let level = 1;
  while (up?.parentId) {
    if (t && up.parentId === t.id) {
      invalid('parentTaskId', 'cycle', `Получится цикл: ${par.key} уже входит в ${t.key}`);
    }
    const next: string = up.parentId;
    up = all.find((x) => x.id === next);
    level++;
    if (level > 10) break;
  }
  const below = (x: TaskRow): number =>
    1 + Math.max(0, ...all.filter((y) => y.parentId === x.id && !y.deleted).map(below));
  if (level + (t ? below(t) : 1) > MAX_LEVELS) {
    invalid('parentTaskId', 'levels', 'Не больше трёх уровней: задача → подзадача → подзадача');
  }
  if (statusOf(pp, par)?.category === 'done') {
    invalid(
      'parentTaskId',
      'done',
      `Задача ${par.key} уже завершена — сначала верните её в работу`,
    );
  }
  return par;
}

/** Право на задачу (tasks.update и др.) в её проекте или в области «своё» (исполнитель) — иначе 403. */
function needTask(v: TasksView, t: TaskRow, key: string): ProjectRow {
  const p = v.project(t.projectId) ?? fail('not_found', 'Задача не найдена');
  if (!v.canTask(t, key)) need(v, p, key);
  return p;
}

/** Проверки содержимого черновика процесса, которые эталон делает в редакторе. */
function checkDraft(d: S['TaskWorkflowDraftInput']): void {
  const seen = new Set<string>();
  for (const [i, s] of d.statuses.entries()) {
    const n = s.name.trim().toLowerCase();
    if (seen.has(n)) invalid(`statuses[${i}].name`, 'taken', `Статус «${s.name.trim()}» уже есть`);
    seen.add(n);
  }
  for (const [i, tr] of d.transitions.entries()) {
    if (!tr.name.trim()) invalid(`transitions[${i}].name`, 'required', 'Назовите переход');
    if (tr.from.length === 1 && tr.from[0] === tr.to) {
      invalid(`transitions[${i}].to`, 'same', 'Переход должен вести в другой статус');
    }
  }
}

function checkRule(
  v: TasksView,
  p: ProjectRow,
  r: Pick<AutomationRow, 'name' | 'trigger' | 'action'>,
): void {
  if (!r.name.trim()) invalid('name', 'required', 'Назовите правило');
  if (
    r.trigger.kind === 'status_entered' &&
    !current(p)?.statuses.some((s) => s.id === r.trigger.statusId)
  ) {
    invalid('trigger.statusId', 'required', 'Выберите статус для триггера');
  }
  const a = r.action;
  const ok =
    a.kind === 'assign'
      ? v.member(a.memberId)?.status === 'active'
      : a.kind === 'set_priority'
        ? !!a.priority
        : !!a.text?.trim();
  if (!ok) invalid('action', 'required', 'Заполните действие');
}

const ruleDto = (r: AutomationRow): S['TaskAutomation'] => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  trigger: { ...r.trigger },
  ...(r.condition ? { condition: { ...r.condition } } : {}),
  action: { ...r.action },
  enabled: r.enabled,
  version: r.version,
  authorMemberId: r.authorId,
  authorDisplayName: r.authorName,
  runCount: r.runCount,
  revision: r.revision,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function ruleOr404(v: TasksView, p: ProjectRow): AutomationRow {
  const id = (v.ctx.params.automationId ?? '').toLowerCase();
  const r = v.data.automations.find((x) => x.id === id && x.projectId === p.id);
  return r ?? fail('not_found', 'Правило не найдено');
}

/** Ключ проекта занят, ключ — 2–6 заглавных букв или цифр (эталон KEY_RE). */
const KEY_RE = /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$/;

/** Право создавать проекты в области: организация или подразделение, покрывающее orgUnitId (PD-53). */
function mayCreateIn(v: TasksView, unitId: string | null): boolean {
  if (v.t.owner) return true;
  if (!v.me) return false;
  return grantsOf(v.t.org, v.me, v.now).some((g) => {
    if (!g.keys.includes('tasks.projects.manage')) return false;
    if (g.scope.kind === 'tenant') return true;
    if (g.scope.kind !== 'org_unit' || unitId === null) return false;
    const under = (id: string): boolean => {
      if (g.scope.resourceIds.includes(id)) return true;
      const parent = v.t.org.units.find((u) => u.id === id)?.parentId;
      return parent ? under(parent) : false;
    };
    return under(unitId);
  });
}

export const tasksHandlers: Registry = {
  // ── Проекты ──
  listTaskProjects: (ctx) => {
    const v = viewOf(ctx);
    const items = v.data.projects.filter((p) => v.visibleProject(p)).map((p) => projectDto(v, p));
    return { body: page(items, ctx.query) };
  },

  createTaskProject: {
    messages: { key: 'Ключ — 2–6 заглавных букв или цифр, первая — буква' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const b = ctx.body as S['ProjectCreate'];
      const unit = b.orgUnitId ? b.orgUnitId.toLowerCase() : null;
      if (unit !== null && !v.t.org.units.some((u) => u.id === unit)) {
        invalid('orgUnitId', 'required', 'Выберите область проекта');
      }
      if (!mayCreateIn(v, unit)) {
        fail('forbidden_action', 'Создавать проекты может роль с правом «Задачи · Настраивать»');
      }
      const name = b.name.trim();
      if (name.length < 3) invalid('name', 'too_short', 'Название — не короче 3 символов');
      const key = b.key.toUpperCase();
      if (!KEY_RE.test(key)) {
        invalid('key', 'pattern', 'Ключ — 2–6 заглавных букв или цифр, первая — буква');
      }
      if (v.data.projects.some((p) => p.key === key)) {
        invalid('key', 'taken', `Ключ ${key} уже занят`);
      }
      let wf: { statuses: WfStatus[]; transitions: WfTransition[] };
      let copied: AutomationRow[] = [];
      if (b.workflowKey === 'copy') {
        const src = b.copyFromProjectId
          ? v.data.projects.find(
              (p) => p.id === b.copyFromProjectId?.toLowerCase() && p.flow === 'tasks',
            )
          : undefined;
        const from = src && v.visibleProject(src) ? current(src) : undefined;
        if (!src || !from) {
          invalid('copyFromProjectId', 'required', 'Выберите проект, процесс которого копировать');
        }
        wf = {
          statuses: structuredClone(from.statuses),
          transitions: structuredClone(from.transitions),
        };
        copied = v.data.automations.filter((r) => r.projectId === src.id);
      } else {
        wf = template(b.workflowKey === 'approval' ? 'approval' : 'simple');
      }
      const me = v.member(v.me);
      const id = ctx.newId();
      const p: ProjectRow = {
        id,
        proto: id,
        key,
        name,
        orgUnitId: unit,
        access: b.access ?? 'limited',
        flow: 'tasks',
        workflowKey: b.workflowKey,
        ownerId: v.me,
        ownerName: me?.displayName ?? '—',
        versions: [{ version: 1, ...wf, publishedAt: v.now, publishedBy: v.me }],
        workflowRevision: 1,
        taskSeq: 100,
        revision: 1,
        createdAt: v.now,
      };
      v.data.projects.push(p);
      for (const r of copied) {
        v.data.automations.push({
          ...structuredClone(r),
          id: ctx.newId(),
          proto: '',
          projectId: id,
          enabled: false,
          runCount: 0,
          revision: 1,
          createdAt: v.now,
          updatedAt: v.now,
        });
      }
      const pm = v.t.org.roles.find((r) => r.proto === 'r-pm');
      if (pm && v.me) {
        const row: AssignmentRow = {
          id: ctx.newId(),
          proto: '',
          principalType: 'member',
          principalId: v.me,
          roleId: pm.id,
          scope: { kind: 'project', resourceIds: [id], includeDescendants: false },
          validFrom: v.now,
          state: 'active',
        };
        v.t.org.assignments.push(row);
        v.t.org.policyVersion++;
      }
      return { status: 201, body: projectDto(viewOf(ctx), p) };
    },
  },

  getTaskProject: (ctx) => {
    const v = viewOf(ctx);
    return { body: projectDto(v, projectOr404(v)) };
  },

  updateTaskProject: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    const b = ctx.body as S['TaskProjectPatch'];
    if (b.name !== undefined) need(v, p, 'tasks.projects.manage');
    if (b.access !== undefined) {
      need(v, p, 'tasks.members.manage');
      notFunnel(p, 'У воронки «Заявки» нет уровня доступа');
    }
    ctx.revision(p.revision);
    if (b.name !== undefined) {
      const name = b.name.trim();
      if (name.length < 3) invalid('name', 'too_short', 'Название — не короче 3 символов');
      p.name = name;
    }
    if (b.access !== undefined) p.access = b.access;
    p.revision++;
    return { body: projectDto(viewOf(ctx), p) };
  },

  initTaskProjectWorkflow: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.workflow.manage');
    notFunnel(p);
    if (p.versions.length) {
      fail('invalid_transition', 'У проекта уже есть процесс', { reason: 'workflow_exists' });
    }
    const used = v.data.tasks.filter((t) => t.projectId === p.id).map((t) => t.statusId);
    const wf = initialWorkflow(used);
    p.versions.push({ version: 1, ...wf, publishedAt: v.now, publishedBy: v.me });
    p.access ??= 'limited';
    for (const t of v.data.tasks.filter((x) => x.projectId === p.id)) {
      const st = wf.statuses.find((s) => s.name === t.statusId) ?? wf.statuses[0];
      t.statusId = st?.id ?? 's1';
      t.workflowVersion = 1;
    }
    p.workflowRevision++;
    return { body: workflowDto(v, p) };
  },

  // ── Процесс ──
  getTaskWorkflow: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    if (!p.versions.length) fail('not_found', 'Процесс не настроен');
    return { body: workflowDto(v, p) };
  },

  saveTaskWorkflowDraft: {
    messages: { 'transitions[0].name': 'Назовите переход' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const p = projectOr404(v);
      need(v, p, 'tasks.workflow.manage');
      notFunnel(p);
      if (!p.versions.length) fail('not_found', 'Процесс не настроен');
      ctx.revision(p.workflowRevision);
      const b = ctx.body as S['TaskWorkflowDraftInput'];
      checkDraft(b);
      p.draft = {
        statuses: structuredClone(b.statuses),
        transitions: structuredClone(b.transitions),
        updatedAt: v.now,
        updatedBy: v.me,
      };
      p.workflowRevision++;
      return { body: workflowDto(v, p) };
    },
  },

  discardTaskWorkflowDraft: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.workflow.manage');
    notFunnel(p);
    if (!p.draft) fail('not_found', 'Черновика нет');
    ctx.revision(p.workflowRevision);
    delete p.draft;
    p.workflowRevision++;
    return { body: workflowDto(v, p) };
  },

  publishTaskWorkflow: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.workflow.manage');
    notFunnel(p);
    ctx.revision(p.workflowRevision);
    const d = p.draft;
    if (!d) return invalid('draft', 'empty', 'Изменений нет');
    const names = d.statuses.map((s) => s.name.trim().toLowerCase());
    if (names.some((x) => !x)) invalid('statuses', 'name', 'У статуса нет названия');
    if (new Set(names).size !== names.length) {
      invalid('statuses', 'duplicate', 'Названия статусов повторяются');
    }
    if (!d.statuses.some((s) => s.category === 'done')) {
      invalid('statuses', 'done', 'Нужен хотя бы один статус категории «Готово»');
    }
    const ids = new Set(d.statuses.map((s) => s.id));
    const bad = d.transitions.find(
      (t) => !t.name.trim() || !ids.has(t.to) || t.from.some((f) => f !== '*' && !ids.has(f)),
    );
    if (bad) {
      invalid(
        'transitions',
        'status',
        `Переход «${bad.name || 'без названия'}» ссылается на удалённый статус или без названия`,
      );
    }
    const gone = [
      ...new Set(
        v.data.tasks
          .filter((t) => t.projectId === p.id && !t.deleted && !ids.has(t.statusId))
          .map((t) => statusOf(p, t)?.name ?? t.statusId),
      ),
    ];
    if (gone.length) {
      invalid(
        'statuses',
        'in_use',
        `Есть задачи в статусах, которых нет в новой версии: ${gone.join(', ')}. Переведите их или верните статус`,
      );
    }
    const rule = v.data.automations.find(
      (r) =>
        r.projectId === p.id &&
        r.trigger.kind === 'status_entered' &&
        !ids.has(r.trigger.statusId ?? ''),
    );
    if (rule) {
      invalid(
        'automations',
        'status',
        `Правило «${rule.name}» ссылается на удалённый статус — измените или удалите правило`,
      );
    }
    const version = (current(p)?.version ?? 0) + 1;
    p.versions.push({
      version,
      statuses: structuredClone(d.statuses),
      transitions: structuredClone(d.transitions),
      publishedAt: v.now,
      publishedBy: v.me,
    });
    delete p.draft;
    for (const t of v.data.tasks.filter((x) => x.projectId === p.id && !x.deleted)) {
      t.workflowVersion = version;
    }
    p.workflowRevision++;
    return { body: workflowDto(v, p) };
  },

  // ── Участники ──
  listTaskProjectMembers: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    const roles = v.t.org.roles
      .filter((r) => PROJECT_ROLE_PROTOS.includes(r.proto))
      .sort((a, b) => PROJECT_ROLE_PROTOS.indexOf(a.proto) - PROJECT_ROLE_PROTOS.indexOf(b.proto))
      .map((r) => ({
        roleId: r.id,
        name: r.name,
        actions: TASK_KEYS.filter((k) => r.permissions.includes(k)),
      }));
    return { body: { items: membersOf(v, p), roles } };
  },

  setTaskProjectMemberRole: {
    messages: { roleId: 'В проекте назначаются роли проекта' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const p = projectOr404(v);
      const mine = need(v, p, 'tasks.members.manage');
      notFunnel(p, 'В воронке «Заявки» ролей проекта нет');
      const m =
        v.member((ctx.params.memberId ?? '').toLowerCase()) ??
        invalid('memberId', 'unknown', 'Выберите сотрудника');
      if (m.status === 'suspended') {
        invalid('memberId', 'suspended', `${m.displayName} заблокирован — назначить роль нельзя`);
      }
      const b = ctx.body as S['TaskProjectMemberRoleSet'];
      const role = v.t.org.roles.find(
        (r) => r.id === b.roleId.toLowerCase() && PROJECT_ROLE_PROTOS.includes(r.proto),
      );
      if (!role) return invalid('roleId', 'not_project_role', 'В проекте назначаются роли проекта');
      if (
        mine.source !== 'system' &&
        TASK_KEYS.some((k) => role.permissions.includes(k) && !mine.actions.includes(k))
      ) {
        fail('delegation_exceeds_grant', 'Можно выдать только то, что есть у вас в проекте');
      }
      const org = v.t.org;
      const cur = org.assignments.find(
        (a) =>
          a.principalType === 'member' &&
          a.principalId === m.id &&
          a.state === 'active' &&
          a.scope.kind === 'project' &&
          a.scope.resourceIds.includes(p.id),
      );
      if (cur) cur.roleId = role.id;
      else {
        org.assignments.push({
          id: ctx.newId(),
          proto: '',
          principalType: 'member',
          principalId: m.id,
          roleId: role.id,
          scope: { kind: 'project', resourceIds: [p.id], includeDescendants: false },
          validFrom: v.now,
          state: 'active',
        });
      }
      org.policyVersion++;
      const row = membersOf(viewOf(ctx), p).find((x) => x.memberId === m.id);
      return { body: row ?? fail('not_found', 'Выберите сотрудника') };
    },
  },

  removeTaskProjectMember: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.members.manage');
    const id = (ctx.params.memberId ?? '').toLowerCase();
    const m = v.member(id) ?? fail('not_found', 'Сотрудник не найден');
    if (m.id === v.me) fail('invalid_transition', 'Себя из проекта исключить нельзя');
    const org = v.t.org;
    const i = org.assignments.findIndex(
      (a) =>
        a.principalType === 'member' &&
        a.principalId === m.id &&
        a.state === 'active' &&
        a.scope.kind === 'project' &&
        a.scope.resourceIds.includes(p.id),
    );
    if (i < 0) {
      const a = accessOf(ctx.s, org, p, m.id, v.now);
      if (a) {
        fail(
          'invalid_transition',
          `Доступ ${m.displayName} — «${a.via}» — меняется только в «Пользователях и ролях»`,
        );
      }
      fail('not_found', 'Роли в проекте нет');
    }
    org.assignments.splice(i, 1);
    org.policyVersion++;
    return { status: 204 };
  },

  checkTaskProjectAccess: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    const mayCheck =
      v.t.owner ||
      v.access(p)?.actions.includes('tasks.members.manage') ||
      (!!v.me &&
        grantsOf(v.t.org, v.me, v.now).some(
          (g) => g.keys.includes('members.read') && g.scope.kind !== 'project',
        ));
    if (!mayCheck) fail('forbidden_action', 'Проверять доступ может руководитель проекта');
    const action = ctx.query.get('action') ?? '';
    if (!(TASK_KEYS as readonly string[]).includes(action)) {
      invalid('action', 'enum', 'Выберите действие');
    }
    const m =
      v.member((ctx.params.memberId ?? '').toLowerCase()) ??
      fail('not_found', 'Сотрудник не найден');
    const c = canIn(ctx.s, v.t.org, p, m.id, action, v.now);
    const out: S['TaskProjectAccessCheck'] = { memberId: m.id, action, allowed: c.ok };
    if (c.a) {
      out.roleName = c.a.roleName;
      out.via = c.a.via;
    }
    if (!c.ok) out.reason = c.why;
    return { body: out };
  },

  // ── Автоматизация ──
  listTaskAutomations: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    return { body: { items: v.data.automations.filter((r) => r.projectId === p.id).map(ruleDto) } };
  },

  createTaskAutomation: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.automation.manage');
    notFunnel(p, 'У воронки «Заявки» нет автоматизации');
    const b = ctx.body as S['TaskAutomationCreate'];
    checkRule(v, p, b);
    const r: AutomationRow = {
      id: ctx.newId(),
      proto: '',
      projectId: p.id,
      name: b.name.trim(),
      trigger: { ...b.trigger },
      action: { ...b.action },
      enabled: b.enabled ?? true,
      version: 1,
      authorId: v.me,
      authorName: nameOf(v, v.me) ?? '—',
      runCount: 0,
      revision: 1,
      createdAt: v.now,
      updatedAt: v.now,
    };
    if (b.condition?.priority) r.condition = { priority: b.condition.priority };
    v.data.automations.push(r);
    return { status: 201, body: ruleDto(r) };
  },

  updateTaskAutomation: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.automation.manage');
    const r = ruleOr404(v, p);
    ctx.revision(r.revision);
    const b = ctx.body as S['TaskAutomationPatch'];
    const next = {
      name: b.name ?? r.name,
      trigger: b.trigger ?? r.trigger,
      action: b.action ?? r.action,
    };
    const changed = b.name !== undefined || !!b.trigger || !!b.action || b.condition !== undefined;
    if (changed) checkRule(v, p, next);
    r.name = next.name.trim();
    r.trigger = { ...next.trigger };
    r.action = { ...next.action };
    if (b.condition !== undefined) {
      if (b.condition.priority) r.condition = { priority: b.condition.priority };
      else delete r.condition;
    }
    if (b.enabled !== undefined) r.enabled = b.enabled;
    if (changed) {
      r.version++;
      r.authorId = v.me;
      r.authorName = nameOf(v, v.me) ?? '—';
    }
    r.revision++;
    r.updatedAt = v.now;
    return { body: ruleDto(r) };
  },

  deleteTaskAutomation: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    need(v, p, 'tasks.automation.manage');
    const r = ruleOr404(v, p);
    ctx.revision(r.revision);
    v.data.automations.splice(v.data.automations.indexOf(r), 1);
    return { status: 204 };
  },

  listTaskAutomationRuns: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v);
    const items = v.data.runs
      .filter((r) => r.projectId === p.id)
      .slice(0, 30)
      .map((r) => {
        const task = r.taskId ? v.data.tasks.find((x) => x.id === r.taskId) : undefined;
        const out: S['TaskAutomationRun'] = {
          id: r.id,
          at: r.at,
          automationId: r.automationId,
          automationName: r.automationName,
          automationVersion: r.automationVersion,
          result: r.result,
          text: r.text,
        };
        if (task && v.visibleTask(task)) {
          out.taskId = task.id;
          out.taskKey = task.key;
        }
        return out;
      });
    return { body: { items } };
  },

  // ── Задачи ──
  listTasks: (ctx) => {
    const v = viewOf(ctx);
    const projectId = uuidParam(ctx.query, 'projectId', false);
    const parentId = uuidParam(ctx.query, 'parentTaskId', false);
    const assignee = ctx.query.get('assignee');
    if (assignee !== null && assignee !== 'me') fail('malformed_request', 'assignee — только me.');
    const awaiting = ctx.query.get('awaitingMyApproval');
    if (awaiting !== null && awaiting !== 'true' && awaiting !== 'false') {
      fail('malformed_request', 'awaitingMyApproval — true или false.');
    }
    const items = v.data.tasks
      .filter((t) => v.visibleTask(t))
      .filter((t) => !projectId || t.projectId === projectId)
      .filter((t) => !parentId || t.parentId === parentId)
      .filter((t) => assignee !== 'me' || t.assigneeId === v.me)
      .filter((t) => {
        if (awaiting !== 'true') return true;
        const p = v.project(t.projectId);
        const tr = p ? approvalHere(p, t) : undefined;
        return !!p && !!tr && p.flow === 'tasks' && check(v, p, t, tr).ok;
      })
      .map((t) => taskDto(v, t, false));
    return { body: page(items, ctx.query) };
  },

  getTask: (ctx) => {
    const v = viewOf(ctx);
    return { body: taskDto(v, taskOr404(v)) };
  },

  createTask: {
    messages: { title: 'Тема — не короче 3 символов' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const b = ctx.body as S['TaskCreate'];
      const p = v.project(b.projectId.toLowerCase());
      if (!p || !v.access(p)) fail('not_found', 'Проект не найден');
      need(v, p, 'tasks.create');
      const title = b.title.trim();
      if (title.length < 3) invalid('title', 'too_short', 'Тема — не короче 3 символов');
      const description = (b.descriptionMarkdown ?? '').trim();
      if (description.length > DESCRIPTION_MAX) {
        invalid('descriptionMarkdown', 'too_long', 'Описание — не длиннее 5000 символов');
      }
      const assignee = b.assigneeMemberId?.toLowerCase() ?? v.me;
      assignable(v, p, assignee, 'assigneeMemberId');
      const par = b.parentTaskId ? checkParent(v, null, b.parentTaskId) : undefined;
      const wf = current(p);
      const first = wf?.statuses.find((s) => s.category === 'todo') ?? wf?.statuses[0];
      p.taskSeq++;
      const t: TaskRow = {
        id: ctx.newId(),
        proto: '',
        key: `${p.key}-${p.taskSeq}`,
        projectId: p.id,
        title,
        description,
        statusId: first?.id ?? 's1',
        priority: b.priority ?? 'normal',
        labels: normLabels(b.labels),
        assigneeId: assignee,
        authorId: v.me,
        checklist: [],
        files: [],
        revision: 1,
        createdAt: v.now,
        updatedAt: v.now,
      };
      if (p.flow === 'tasks' && wf) t.workflowVersion = wf.version;
      if (b.dueAt) t.dueAt = b.dueAt;
      v.data.tasks.unshift(t);
      if (par) {
        t.parentId = par.id;
        log(v, par, 'child', `добавлена подзадача ${t.key}`);
        log(v, t, 'parent', `входит в ${par.key}`);
      }
      autoFire(v, p, t, 'created');
      ensureRound(v, p, t);
      return { status: 201, body: taskDto(v, t) };
    },
  },

  updateTask: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    const p = needTask(v, t, 'tasks.update');
    ctx.revision(t.revision);
    const b = ctx.body as S['TaskPatch'];
    if (
      b.descriptionMarkdown !== undefined &&
      b.descriptionMarkdown.trim().length > DESCRIPTION_MAX
    ) {
      invalid('descriptionMarkdown', 'too_long', 'Описание — не длиннее 5000 символов');
    }
    if (b.assigneeMemberId) assignable(v, p, b.assigneeMemberId.toLowerCase(), 'assigneeMemberId');
    if (b.title !== undefined) {
      if (b.title.trim().length < 3) invalid('title', 'too_short', 'Тема — не короче 3 символов');
      t.title = b.title.trim();
    }
    if (b.descriptionMarkdown !== undefined) t.description = b.descriptionMarkdown.trim();
    if (b.assigneeMemberId !== undefined) {
      if (b.assigneeMemberId === null) delete t.assigneeId;
      else t.assigneeId = b.assigneeMemberId.toLowerCase();
    }
    if (b.dueAt !== undefined) {
      if (b.dueAt === null) delete t.dueAt;
      else t.dueAt = b.dueAt;
    }
    if (b.priority) t.priority = b.priority;
    if (b.labels) t.labels = normLabels(b.labels);
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  transitionTask: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    const p = v.project(t.projectId) ?? fail('not_found', 'Задача не найдена');
    ctx.revision(t.revision);
    const b = ctx.body as S['TaskTransition'];
    const tr = versionOf(p, t)?.transitions.find((x) => x.key === b.transitionKey);
    if (!tr) return invalid('transitionKey', 'removed', 'Переход удалён из процесса');
    if (!fromHere(tr, t.statusId)) {
      fail('invalid_transition', 'Переход недоступен из текущего статуса', {
        reason: 'not_in_status',
      });
    }
    const c = check(v, p, t, tr);
    if (!c.ok) {
      fail(c.code ?? 'invalid_transition', c.text, c.reason ? { reason: c.reason } : {});
    }
    const txt = (b.comment ?? '').trim();
    if (tr.commentRequired && !txt) {
      invalid('comment', 'required', `Для перехода «${tr.name}» нужен комментарий`);
    }
    if (tr.approval) {
      const round = ensureRound(v, p, t) ?? fail('invalid_transition', 'Согласование не найдено');
      round.votes.push({ memberId: v.me, at: v.now });
      const got = new Set(round.votes.map((x) => x.memberId));
      const waiting = round.mode === 'all' ? round.approverIds.filter((id) => !got.has(id)) : [];
      if (waiting.length) {
        log(
          v,
          t,
          'approval_vote',
          `Согласовал(а)${txt ? `: ${txt}` : ''}. Ждём: ${waiting.map((id) => nameOf(v, id) ?? '—').join(', ')}`,
          'me',
          tr.key,
        );
        touch(v, t);
        return { body: taskDto(v, t) };
      }
    }
    moveTo(v, p, t, tr, txt);
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  rejectTaskApproval: {
    messages: { comment: 'Напишите, что доработать' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const t = taskOr404(v);
      const p = v.project(t.projectId) ?? fail('not_found', 'Задача не найдена');
      ctx.revision(t.revision);
      const key = ctx.params.transitionKey ?? '';
      const tr = versionOf(p, t)?.transitions.find((x) => x.key === key && x.approval);
      if (!tr?.approval) return fail('not_found', 'Согласование не найдено');
      if (!fromHere(tr, t.statusId)) {
        fail('invalid_transition', 'Задача не ждёт этого согласования', {
          reason: 'not_in_status',
        });
      }
      const c = rejectCheck(v, p, t, tr);
      if (!c.ok) {
        fail(c.code ?? 'invalid_transition', c.text, c.reason ? { reason: c.reason } : {});
      }
      const txt = (ctx.body as S['TaskApprovalRejection']).comment.trim();
      if (!txt) invalid('comment', 'required', 'Напишите, что доработать');
      const wf = versionOf(p, t);
      const back = wf?.statuses.find((s) => s.id === tr.approval?.rejectTo) ?? wf?.statuses[0];
      if (!back) return invalid('transitionKey', 'removed', 'Переход удалён из процесса');
      const from = statusOf(p, t)?.name ?? t.statusId;
      t.statusId = back.id;
      delete t.round;
      log(
        v,
        t,
        'approval_rejected',
        `Вернул(а) на доработку (${from} → ${back.name}): ${txt}`,
        'me',
        tr.key,
      );
      autoFire(v, p, t, 'status_entered', back.id);
      ensureRound(v, p, t);
      touch(v, t);
      return { body: taskDto(v, t) };
    },
  },

  updateTaskChecklistItem: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    needTask(v, t, 'tasks.update');
    ctx.revision(t.revision);
    const item =
      t.checklist.find((x) => x.id === ctx.params.checklistItemId) ??
      fail('not_found', 'Пункт чек-листа не найден');
    const done = (ctx.body as S['TaskChecklistItemPatch']).done;
    if (item.done !== done) {
      item.done = done;
      log(v, t, 'checklist', `${done ? 'отметил(а)' : 'снял(а) отметку'}: ${item.text}`);
    }
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  setTaskParent: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    needTask(v, t, 'tasks.update');
    ctx.revision(t.revision);
    const id = (ctx.body as S['TaskParentSet']).parentTaskId;
    const old = t.parentId ? v.data.tasks.find((x) => x.id === t.parentId) : undefined;
    if (!id) {
      if (!t.parentId) return { body: taskDto(v, t) };
      delete t.parentId;
      log(v, t, 'parent', `больше не входит в ${old?.key ?? '—'}`);
      if (old) log(v, old, 'child', `из состава исключена ${t.key}`);
      touch(v, t);
      return { body: taskDto(v, t) };
    }
    const par = checkParent(v, t, id);
    t.parentId = par.id;
    log(v, t, 'parent', `входит в ${par.key}${old ? ` (было ${old.key})` : ''}`);
    log(v, par, 'child', `добавлена подзадача ${t.key}`);
    if (old) log(v, old, 'child', `из состава исключена ${t.key}`);
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  attachTaskFiles: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    needTask(v, t, 'tasks.update');
    ctx.revision(t.revision);
    const ids = (ctx.body as S['TaskFilesAttach']).fileIds.map((x) => x.toLowerCase());
    if (t.files.length + ids.length > FILES_PER_TASK) {
      invalid('fileIds', 'too_many', 'К задаче можно прикрепить не больше 30 файлов');
    }
    const org = v.t.org;
    const add = ids.map((id, i) => {
      const f = org.files.find((x) => x.id === id);
      const u = org.uploads.find((x) => x.fileId === id);
      // Загрузку этой задачи начал тот, кто прикрепляет (иначе чужой файл стал бы «своим»), файл — один раз.
      const ok =
        f &&
        u &&
        u.state === 'completed' &&
        u.purpose === 'task_attachment' &&
        u.owner.moduleKey === 'tasks' &&
        u.owner.entityType === 'task' &&
        u.owner.entityId.toLowerCase() === t.id &&
        u.initiatedBy === v.me &&
        ids.indexOf(id) === i &&
        !t.files.some((x) => x.fileId === id);
      if (!f || !ok)
        return invalid(`fileIds[${i}]`, 'unknown', 'Файл не найден или загружен к другой задаче');
      const why =
        f.sizeBytes > FILE_MAX_BYTES
          ? 'больше 20 МБ'
          : !(f.sizeBytes > 0)
            ? 'пустой файл'
            : !FILE_OK.test(f.contentType)
              ? 'такой тип не принимаем'
              : null;
      if (why) invalid(`fileIds[${i}]`, 'rejected', `Файл «${f.fileName}» не принят: ${why}`);
      return {
        fileId: f.id,
        name: f.fileName.slice(0, 180),
        sizeBytes: f.sizeBytes,
        contentType: f.contentType,
        byId: v.me,
        byName: nameOf(v, v.me) ?? '—',
        at: v.now,
      };
    });
    t.files.push(...add);
    log(v, t, 'files', `прикрепил(а): ${add.map((f) => f.name).join(', ')}`);
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  removeTaskFile: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    const p = v.project(t.projectId) ?? fail('not_found', 'Задача не найдена');
    ctx.revision(t.revision);
    const id = (ctx.params.fileId ?? '').toLowerCase();
    const f = t.files.find((x) => x.fileId === id) ?? fail('not_found', 'Файл уже удалён');
    const own = f.byId === v.me && v.canTask(t, 'tasks.update');
    if (!own && !v.access(p)?.actions.includes('tasks.projects.manage')) {
      fail('forbidden_action', 'Удалить можно свой файл; чужие — руководитель проекта');
    }
    t.files = t.files.filter((x) => x.fileId !== id);
    log(v, t, 'files', `удалил(а) файл ${f.name}`);
    touch(v, t);
    return { body: taskDto(v, t) };
  },

  commentTask: {
    messages: { text: 'Комментарий пустой' },
    run: (ctx) => {
      const v = viewOf(ctx);
      const t = taskOr404(v);
      const text = (ctx.body as S['TaskCommentCreate']).text.trim();
      if (!text) invalid('text', 'required', 'Комментарий пустой');
      const h = log(v, t, 'comment', text);
      return { status: 201, body: historyDto(h) };
    },
  },

  listTaskHistory: (ctx) => {
    const v = viewOf(ctx);
    const t = taskOr404(v);
    const items = v.data.history
      .filter((h) => h.taskId === t.id)
      .map((h, i) => ({ h, i }))
      .sort((a, b) => b.h.at.localeCompare(a.h.at) || b.i - a.i)
      .map(({ h }) => historyDto(h));
    return { body: page(items, ctx.query) };
  },
};
