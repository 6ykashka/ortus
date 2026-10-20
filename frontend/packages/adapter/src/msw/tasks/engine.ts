// Правила «Задач и проектов» сценарного сервера (W4.03): проверка перехода (trCheck эталона, models.js:217–233) с
// разделением «нет права» (403 forbidden_action) и «не выполнено условие» (409 invalid_transition + reason,
// Q-W4.00-tasks-12), согласующие (approversOf, «Кто может» сужает круг — Q-W4.00-tasks-10), раунд согласования
// (состав «нужны все» фиксируется на входе в статус, Q-W4.00-tasks-9), автоматизация от имени автора (autoFire, глубина
// 1, журнал 30), история и DTO контракта.
import type { components } from '@ortus/api-client';

import { fail } from '../core/problem.ts';
import {
  canIn,
  current,
  type HistoryRow,
  membersOf,
  nameOf,
  PRIORITY_LABEL,
  type ProjectRow,
  type RoundRow,
  statusOf,
  type TaskRow,
  type TasksView,
  versionOf,
  WHO_KEY,
  WHO_LABEL,
  type WfTransition,
} from './state.ts';

type S = components['schemas'];

export const RUNS_KEPT = 30;

/** Переход ведёт из текущего статуса: «*» — из любого, кроме целевого. */
export function fromHere(tr: WfTransition, statusId: string): boolean {
  return tr.from.includes('*')
    ? statusId !== tr.to && !tr.from.includes(tr.to)
    : tr.from.includes(statusId);
}

const done = (p: ProjectRow, t: TaskRow): boolean => statusOf(p, t)?.category === 'done';

/** Подзадачи задачи (не удалённые). */
export const childrenOf = (v: TasksView, t: TaskRow): TaskRow[] =>
  v.data.tasks.filter((x) => x.parentId === t.id && !x.deleted);

/** «Кто может» подходит участнику. */
function fits(v: TasksView, p: ProjectRow, t: TaskRow, who: string, memberId: string): boolean {
  if (who === 'assignee') return t.assigneeId === memberId;
  if (who === 'author') return t.authorId === memberId;
  const c = canIn(v.ctx.s, v.t.org, p, memberId, WHO_KEY[who] ?? 'tasks.transition', v.now);
  return c.ok && c.a.source !== 'system';
}

export interface Check {
  ok: boolean;
  code?: 'forbidden_action' | 'invalid_transition';
  reason?: string;
  text?: string;
}

/** Чек-лист и подзадачи — общие проверки обоих видов перехода (подзадачи — только видимые, Q-W4.02-8). */
function gates(v: TasksView, p: ProjectRow, t: TaskRow, tr: WfTransition): Check {
  if (tr.checklistClosed && t.checklist.some((x) => !x.done)) {
    return {
      ok: false,
      code: 'invalid_transition',
      reason: 'checklist_open',
      text: 'Сначала закройте чек-лист',
    };
  }
  if (tr.childrenDone) {
    const open = childrenOf(v, t).filter((x) => {
      const cp = v.project(x.projectId);
      return !cp || !done(cp, x);
    });
    if (open.length) {
      const seen = open.filter((x) => v.visibleTask(x)).map((x) => x.key);
      return {
        ok: false,
        code: 'invalid_transition',
        reason: 'children_open',
        text: seen.length
          ? `Сначала завершите подзадачи: ${seen.join(', ')}`
          : 'Сначала завершите подзадачи',
      };
    }
  }
  return { ok: true };
}

/** Проверка перехода участником `memberId` (trCheck эталона) из текущего статуса. */
export function check(
  v: TasksView,
  p: ProjectRow,
  t: TaskRow,
  tr: WfTransition,
  memberId = v.me,
): Check {
  if (tr.approval) {
    const c = canIn(v.ctx.s, v.t.org, p, memberId, 'tasks.approve', v.now);
    if (!c.ok) {
      return {
        ok: false,
        code: 'forbidden_action',
        text: `Согласует роль с правом «Согласовывать»; у вас ${c.why}`,
      };
    }
    if (
      tr.who.length &&
      c.a.source !== 'system' &&
      !tr.who.some((w) => fits(v, p, t, w, memberId))
    ) {
      return {
        ok: false,
        code: 'forbidden_action',
        text: `Доступно: ${tr.who.map((w) => WHO_LABEL[w] ?? w).join(', ')}`,
      };
    }
    if (tr.notAuthor && t.authorId === memberId) {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: 'author_forbidden',
        text: 'Вы автор задачи — свою согласовать нельзя',
      };
    }
    if (t.round?.transitionKey === tr.key && t.round.votes.some((x) => x.memberId === memberId)) {
      return {
        ok: false,
        code: 'invalid_transition',
        reason: 'already_voted',
        text: 'Вы уже согласовали, ждём остальных',
      };
    }
    return gates(v, p, t, tr);
  }
  const c = canIn(v.ctx.s, v.t.org, p, memberId, 'tasks.transition', v.now);
  if (!c.ok) {
    return { ok: false, code: 'forbidden_action', text: `Менять статус нельзя: ${c.why}` };
  }
  if (tr.who.length && c.a.source !== 'system' && !tr.who.some((w) => fits(v, p, t, w, memberId))) {
    return {
      ok: false,
      code: 'forbidden_action',
      text: `Доступно: ${tr.who.map((w) => WHO_LABEL[w] ?? w).join(', ')}`,
    };
  }
  if (tr.notAuthor && t.authorId === memberId) {
    return {
      ok: false,
      code: 'invalid_transition',
      reason: 'author_forbidden',
      text: 'Автор задачи не может выполнить этот переход',
    };
  }
  return gates(v, p, t, tr);
}

/** Согласующие перехода: активные участники с «Согласовывать», без автора при «не автор», по «Кто может». */
export function approversOf(v: TasksView, p: ProjectRow, t: TaskRow, tr: WfTransition): string[] {
  return v.t.org.members
    .filter((m) => m.status === 'active')
    .filter((m) => {
      const c = canIn(v.ctx.s, v.t.org, p, m.id, 'tasks.approve', v.now);
      if (!c.ok) return false;
      if (tr.notAuthor && t.authorId === m.id) return false;
      if (tr.who.length && c.a.source !== 'system') {
        return tr.who.some((w) => fits(v, p, t, w, m.id));
      }
      return true;
    })
    .map((m) => m.id);
}

/** Переход согласованием из текущего статуса задачи. */
export function approvalHere(p: ProjectRow, t: TaskRow): WfTransition | undefined {
  return versionOf(p, t)?.transitions.find((tr) => tr.approval && fromHere(tr, t.statusId));
}

/** Раунд согласования задачи: открывается на входе в статус перехода согласованием. */
export function ensureRound(v: TasksView, p: ProjectRow, t: TaskRow): RoundRow | undefined {
  const tr = approvalHere(p, t);
  if (!tr?.approval) {
    delete t.round;
    return undefined;
  }
  if (t.round?.transitionKey !== tr.key) {
    t.round = {
      transitionKey: tr.key,
      version: t.workflowVersion ?? 1,
      mode: tr.approval.mode,
      approverIds: tr.approval.mode === 'all' ? approversOf(v, p, t, tr) : [],
      votes: [],
    };
  }
  return t.round;
}

// ---------------------------------------------------------------------------------------------
// История

export function log(
  v: TasksView,
  t: TaskRow,
  kind: HistoryRow['kind'],
  text: string,
  actor: 'me' | 'Система' | 'Процесс' | 'Автоматизация' = 'me',
  transitionKey?: string,
): HistoryRow {
  const row: HistoryRow = {
    id: v.ctx.newId(),
    taskId: t.id,
    at: v.now,
    kind,
    actorName: actor === 'me' ? (nameOf(v, v.me) ?? '—') : actor,
    text,
  };
  if (actor === 'me' && v.me) row.actorId = v.me;
  if (transitionKey) row.transitionKey = transitionKey;
  v.data.history.push(row);
  return row;
}

export const touch = (v: TasksView, t: TaskRow): void => {
  t.revision++;
  t.updatedAt = v.now;
};

// ---------------------------------------------------------------------------------------------
// Автоматизация (autoFire эталона: от имени автора, глубина 1, журнал 30)

let depth = 0;

export function autoFire(
  v: TasksView,
  p: ProjectRow,
  t: TaskRow,
  trigger: 'created' | 'status_entered',
  statusId?: string,
): void {
  if (depth) return;
  depth++;
  try {
    const rules = v.data.automations.filter(
      (r) =>
        r.projectId === p.id &&
        r.enabled &&
        r.trigger.kind === trigger &&
        (trigger !== 'status_entered' || r.trigger.statusId === statusId),
    );
    for (const r of rules) {
      const run = (result: 'ok' | 'stopped' | 'error', text: string) => {
        v.data.runs.unshift({
          id: v.ctx.newId(),
          projectId: p.id,
          at: v.now,
          automationId: r.id,
          automationName: r.name,
          automationVersion: r.version,
          result,
          text,
          taskId: t.id,
        });
        const mine = v.data.runs.filter((x) => x.projectId === p.id);
        for (const old of mine.slice(RUNS_KEPT)) v.data.runs.splice(v.data.runs.indexOf(old), 1);
        r.runCount++;
      };
      if (r.condition?.priority && t.priority !== r.condition.priority) {
        run(
          'stopped',
          `${t.key}: приоритет «${PRIORITY_LABEL[t.priority]}» — условие не выполнено`,
        );
        continue;
      }
      const c = canIn(v.ctx.s, v.t.org, p, r.authorId, 'tasks.transition', v.now);
      if (!c.ok) {
        run('error', `У автора правила ${r.authorName} нет права менять задачи: ${c.why}`);
        continue;
      }
      const a = r.action;
      if (a.kind === 'assign') {
        const m = v.member(a.memberId);
        if (!m || m.status !== 'active') {
          run('error', `Сотрудник «${m?.displayName ?? '—'}» не найден или неактивен`);
          continue;
        }
        t.assigneeId = m.id;
        run('ok', `${t.key} назначена: ${m.displayName}`);
      } else if (a.kind === 'set_priority' && a.priority) {
        t.priority = a.priority;
        run('ok', `${t.key}: приоритет «${PRIORITY_LABEL[a.priority]}»`);
      } else {
        log(v, t, 'automation', a.text ?? '', 'Автоматизация');
        run('ok', `${t.key}: добавлен комментарий`);
      }
      log(v, t, 'automation', `Правило «${r.name}» v${r.version}`, 'Автоматизация');
    }
  } finally {
    depth--;
  }
}

/** Перевод задачи по переходу (moveTo эталона): статус, история, «на автора», правила «перешла в статус». */
export function moveTo(
  v: TasksView,
  p: ProjectRow,
  t: TaskRow,
  tr: WfTransition,
  txt: string,
): void {
  const wf = versionOf(p, t);
  const to = wf?.statuses.find((s) => s.id === tr.to);
  if (!to) fail('validation_failed', 'Переход удалён из процесса');
  const from = statusOf(p, t)?.name ?? t.statusId;
  t.statusId = to.id;
  delete t.round;
  log(v, t, 'transition', `${tr.name}: ${from} → ${to.name}${txt ? `. ${txt}` : ''}`, 'me', tr.key);
  if (tr.assignAuthor && t.authorId) {
    t.assigneeId = t.authorId;
    log(v, t, 'assignment', `Назначено на автора: ${nameOf(v, t.authorId) ?? '—'}`, 'Процесс');
  }
  autoFire(v, p, t, 'status_entered', to.id);
  ensureRound(v, p, t);
}

// ---------------------------------------------------------------------------------------------
// DTO

export function projectDto(v: TasksView, p: ProjectRow): S['Project'] {
  const a = v.access(p);
  const wf = current(p);
  const open = v.data.tasks.filter(
    (t) => t.projectId === p.id && v.visibleTask(t) && statusOf(p, t)?.category !== 'done',
  ).length;
  const out: S['Project'] = {
    id: p.id,
    name: p.name,
    orgUnitId: p.orgUnitId,
    key: p.key,
    status: 'active',
    workflowKey: p.workflowKey,
    revision: p.revision,
    flow: p.flow,
    ownerMemberId: p.ownerId,
    ownerDisplayName: p.ownerName,
    counts: {
      members: membersOf(v, p).filter((m) => m.source !== 'system').length,
      open,
    },
    createdAt: p.createdAt,
  };
  if (p.access) out.access = p.access;
  if (wf && p.flow === 'tasks') {
    out.workflow = { version: wf.version, hasDraft: !!p.draft, revision: p.workflowRevision };
  }
  if (a) {
    out.myAccess = { actions: [...a.actions], roleName: a.roleName, source: a.source, via: a.via };
    if (a.roleId) out.myAccess.roleId = a.roleId;
  }
  return out;
}

export function workflowDto(v: TasksView, p: ProjectRow): S['TaskWorkflow'] {
  const wf = current(p) ?? fail('not_found', 'Процесс не настроен');
  const out: S['TaskWorkflow'] = {
    projectId: p.id,
    version: wf.version,
    statuses: structuredClone(wf.statuses),
    transitions: structuredClone(wf.transitions),
    fixed: p.flow === 'leads',
    publishedAt: wf.publishedAt,
    revision: p.workflowRevision,
  };
  if (wf.publishedBy) out.publishedByMemberId = wf.publishedBy;
  if (p.draft && v.access(p)?.actions.includes('tasks.workflow.manage')) {
    out.draft = {
      statuses: structuredClone(p.draft.statuses),
      transitions: structuredClone(p.draft.transitions),
      updatedAt: p.draft.updatedAt,
    };
    if (p.draft.updatedBy) out.draft.updatedByMemberId = p.draft.updatedBy;
  }
  return out;
}

function approvalDto(v: TasksView, p: ProjectRow, t: TaskRow): S['TaskApprovalState'] | undefined {
  const tr = approvalHere(p, t);
  const round = ensureRound(v, p, t);
  if (!tr?.approval || !round) return undefined;
  const ids =
    round.mode === 'all'
      ? round.approverIds
      : [...new Set([...approversOf(v, p, t, tr), ...round.votes.map((x) => x.memberId)])];
  const approvers = ids.map((id) => {
    const vote = round.votes.find((x) => x.memberId === id);
    const a: S['TaskApprover'] = {
      memberId: id,
      displayName: nameOf(v, id) ?? '—',
      state: vote ? 'approved' : 'waiting',
    };
    if (vote) a.decidedAt = vote.at;
    return a;
  });
  const c = check(v, p, t, tr);
  const reject = rejectCheck(v, p, t, tr);
  return {
    transitionKey: tr.key,
    transitionName: tr.name,
    mode: round.mode,
    workflowVersion: round.version,
    approvers,
    canApprove: c.ok,
    canReject: reject.ok,
  };
}

/** «Вернуть на доработку» (Q-W4.00-tasks-8): только право, «не автор» и текущий статус. */
export function rejectCheck(v: TasksView, p: ProjectRow, t: TaskRow, tr: WfTransition): Check {
  const c = check(v, p, t, tr);
  if (
    c.ok ||
    c.reason === 'already_voted' ||
    c.reason === 'checklist_open' ||
    c.reason === 'children_open'
  ) {
    return { ok: true };
  }
  return c;
}

function parentDto(v: TasksView, t: TaskRow): S['TaskParentRef'] | undefined {
  if (!t.parentId) return undefined;
  const par = v.data.tasks.find((x) => x.id === t.parentId);
  if (!par || par.deleted) {
    return { taskId: t.parentId, state: 'deleted', ...(par ? { key: par.key } : {}) };
  }
  // Невидимый родитель — без id (и в parentTaskId задачи тоже): UUID задачи, которую участник не видит, не отдаётся.
  if (!v.visibleTask(par)) return { state: 'hidden' };
  const pp = v.project(par.projectId);
  const out: S['TaskParentRef'] = {
    taskId: par.id,
    state: 'visible',
    key: par.key,
    title: par.title,
  };
  const cat = pp ? statusOf(pp, par)?.category : undefined;
  if (cat) out.statusCategory = cat;
  return out;
}

export function taskDto(v: TasksView, t: TaskRow, full = true): S['Task'] {
  const p = v.project(t.projectId) ?? fail('not_found', 'Задача не найдена');
  const st = statusOf(p, t);
  const kids = childrenOf(v, t);
  const seen = kids.filter((x) => v.visibleTask(x));
  const out: S['Task'] = {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    descriptionMarkdown: t.description,
    status: t.statusId,
    relatedObjects: [],
    customFields: [],
    revision: t.revision,
    key: t.key,
    statusName: st?.name ?? t.statusId,
    statusCategory: st?.category ?? 'progress',
    priority: t.priority,
    labels: [...t.labels],
    children: {
      total: kids.length,
      done: seen.filter((x) => {
        const cp = v.project(x.projectId);
        return !!cp && done(cp, x);
      }).length,
      hidden: kids.length - seen.length,
    },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  if (t.assigneeId) {
    out.assigneeMemberId = t.assigneeId;
    const n = nameOf(v, t.assigneeId);
    if (n) out.assigneeDisplayName = n;
  }
  if (t.dueAt) out.dueAt = t.dueAt;
  const parent = parentDto(v, t);
  if (t.parentId && parent?.state !== 'hidden') out.parentTaskId = t.parentId;
  if (t.workflowVersion) out.workflowVersion = t.workflowVersion;
  if (t.authorId) {
    out.authorMemberId = t.authorId;
    const n = nameOf(v, t.authorId);
    if (n) out.authorDisplayName = n;
  }
  if (parent) out.parent = parent;
  const approval = p.flow === 'tasks' ? approvalDto(v, p, t) : undefined;
  if (approval) out.approval = approval;
  if (!full) return out;
  out.checklist = t.checklist.map((x) => ({ ...x }));
  out.files = t.files.map((f) => ({
    fileId: f.fileId,
    name: f.name,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    uploadedByMemberId: f.byId,
    uploadedByDisplayName: f.byName,
    attachedAt: f.at,
  }));
  const wf = versionOf(p, t);
  out.availableTransitions = (wf?.transitions ?? [])
    .filter((tr) => fromHere(tr, t.statusId))
    .map((tr) => {
      const c = check(v, p, t, tr);
      const to = wf?.statuses.find((s) => s.id === tr.to);
      const o: S['TaskTransitionOption'] = {
        key: tr.key,
        name: tr.name,
        toStatusId: tr.to,
        toStatusName: to?.name ?? tr.to,
        approval: !!tr.approval,
        commentRequired: tr.commentRequired,
        allowed: c.ok,
      };
      if (!c.ok) {
        o.reason = c.reason ?? 'forbidden_action';
        if (c.text) o.reasonText = c.text;
      }
      return o;
    });
  return out;
}

export function historyDto(h: HistoryRow): S['TaskHistoryEntry'] {
  const out: S['TaskHistoryEntry'] = {
    id: h.id,
    at: h.at,
    kind: h.kind,
    actorDisplayName: h.actorName,
    text: h.text,
  };
  if (h.actorId) out.actorMemberId = h.actorId;
  if (h.transitionKey) out.transitionKey = h.transitionKey;
  return out;
}
