// W4.13 · Модель вкладок проекта (эталон design-2026-10-19 «Задачи и проекты.dc.html» :439–489, models.js :181–213):
// глаголы «Что может» по действиям core.tasks, строки «Участников», кандидаты и «Проверить доступ», правки черновика
// процесса (statuses и transitions контракта TaskWorkflowDraftInput целиком), подписи переходов, текст правил и строк
// журнала автоматизации. Чистые функции — экран только рисует.
import type { components } from '@ortus/api-client';
import { PRIORITY, STATUS_CAT, VERB_LABEL, WHO_LABEL } from '@ortus/domain/modules';
import { format } from '@ortus/texts';

import { TS } from './texts.ts';

type S = components['schemas'];
export type Level = S['TaskProjectAccessLevel'];
export type Category = S['TaskStatusCategory'];
export type Priority = S['TaskPriority'];
export type Transition = S['TaskWorkflowTransition'];
export type Who = Transition['who'][number];

/** Глаголы эталона (VERB_LABEL) в порядке «Читать / Создавать / Менять статус / Согласовывать / Настраивать». */
export type Verb = 'view' | 'create' | 'edit' | 'review' | 'settings';
export const VERBS: readonly Verb[] = ['view', 'create', 'edit', 'review', 'settings'];

/** Действия каталога core.tasks, дающие глагол (tasks.md §3.1). */
const VERB_KEYS: Readonly<Record<Verb, readonly string[]>> = {
  view: ['tasks.projects.read', 'tasks.read'],
  create: ['tasks.create'],
  edit: ['tasks.transition', 'tasks.update'],
  review: ['tasks.approve'],
  settings: [
    'tasks.projects.manage',
    'tasks.members.manage',
    'tasks.workflow.manage',
    'tasks.automation.manage',
  ],
};

/** Действия каталога core.tasks (checkTaskProjectAccess.action). */
export type TaskAction =
  | 'tasks.projects.read'
  | 'tasks.projects.manage'
  | 'tasks.read'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.transition'
  | 'tasks.approve'
  | 'tasks.members.manage'
  | 'tasks.workflow.manage'
  | 'tasks.automation.manage';

/** Действие «Проверить доступ» по глаголу (checkTaskProjectAccess.action). */
export const CHECK_ACTION: Readonly<Record<Verb, TaskAction>> = {
  view: 'tasks.read',
  create: 'tasks.create',
  edit: 'tasks.transition',
  review: 'tasks.approve',
  settings: 'tasks.workflow.manage',
};

export const verbLabel = (v: Verb): string => VERB_LABEL[v] ?? v;

/** Подписи глаголов роли по её действиям; заметки функции («финансы скрыты») — в конце. */
export function verbLabels(actions: readonly string[], notes: readonly string[] = []): string[] {
  const has = (v: Verb) => VERB_KEYS[v].some((k) => actions.includes(k));
  return [...VERBS.filter(has).map(verbLabel), ...notes];
}

export const accessLabel = (l: Level): string => TS.access.levels[l];
export const accessDesc = (l: Level): string => TS.access.desc[l];
export const LEVELS: readonly Level[] = ['open', 'limited', 'closed'];

/** Инициалы аватара (ini эталона): первые буквы двух первых слов. */
export function initials(name: string): string {
  const s = String(name || '?')
    .split(' ')
    .map((x) => x[0] ?? '')
    .slice(0, 2)
    .join('');
  return s || '?';
}

export interface MemberRowVM {
  id: string;
  name: string;
  ini: string;
  roleId: string;
  roleName: string;
  via: string;
  /** Унаследованный или системный доступ — подпись «Откуда доступ» приглушена (srcFg эталона). */
  muted: boolean;
  caps: string[];
  /** Роль меняется здесь (select); иначе — замок с именем роли. */
  editable: boolean;
  canDel: boolean;
}

/** Строки таблицы «Участники» (:448–450): правка — назначение в проекте при «Настраивать», себя не исключить. */
export function memberRows(
  items: readonly S['TaskProjectMember'][],
  o: { canEdit: boolean; meId?: string | undefined },
): MemberRowVM[] {
  return items.map((m) => {
    const editable = o.canEdit && m.editable;
    return {
      id: m.memberId,
      name: m.displayName,
      ini: initials(m.displayName),
      roleId: m.roleId ?? '',
      roleName: m.roleName,
      via: m.via,
      muted: m.source === 'inherited' || m.source === 'system',
      caps: verbLabels(m.actions, m.functionNotes ?? []),
      editable,
      canDel: editable && m.memberId !== o.meId,
    };
  });
}

export interface Option {
  value: string;
  label: string;
}

const own = (m: S['TaskProjectMember']) => m.source === 'assigned' || m.source === 'group';

/**
 * Кандидаты «Сотрудник» (cands :445): не заблокированные сотрудники без своей роли в проекте; унаследованный и
 * системный доступ — можно назначить роль. Без списка сотрудников (нет members.read) — участники проекта без своей роли.
 */
export function candidates(
  people: readonly S['Member'][] | null,
  rows: readonly S['TaskProjectMember'][],
): Option[] {
  const taken = new Set(rows.filter(own).map((m) => m.memberId));
  if (!people) {
    return rows.filter((m) => !own(m)).map((m) => ({ value: m.memberId, label: m.displayName }));
  }
  return people
    .filter((m) => m.status !== 'suspended' && !taken.has(m.id))
    .map((m) => ({ value: m.id, label: m.displayName }));
}

/** Сотрудники «Проверить доступ» (all :451): не заблокированные; без списка сотрудников — участники проекта. */
export function checkPeople(
  people: readonly S['Member'][] | null,
  rows: readonly S['TaskProjectMember'][],
): Option[] {
  if (!people) return rows.map((m) => ({ value: m.memberId, label: m.displayName }));
  return people
    .filter((m) => m.status !== 'suspended')
    .map((m) => ({ value: m.id, label: m.displayName }));
}

/** Кого проверять по умолчанию (chkM :442): первый участник не по системной роли, иначе первый. */
export function defaultCheckMember(rows: readonly S['TaskProjectMember'][]): string | undefined {
  return (rows.find((m) => m.source !== 'system') ?? rows[0])?.memberId;
}

/** Роль по умолчанию (addR 'r-exec' :326): «Исполнитель» — меняет статус, без согласования и настройки. */
export function defaultRole(roles: readonly S['TaskProjectRole'][]): string | undefined {
  const exec = roles.find(
    (r) =>
      r.actions.includes('tasks.transition') &&
      !r.actions.includes('tasks.approve') &&
      !VERB_KEYS.settings.some((k) => r.actions.includes(k)),
  );
  return (exec ?? roles[0])?.roleId;
}

/** «Роли проекта» (matrix :454): глаголы роли через запятую. */
export const roleCaps = (r: S['TaskProjectRole']): string => verbLabels(r.actions).join(', ');

/** Ответ «Проверить доступ» (chkText :453). */
export function checkText(name: string, r: S['TaskProjectAccessCheck']): string {
  return r.allowed
    ? format(TS.people.can, {
        name,
        via: (r.via ?? '').toLowerCase(),
        role: r.roleName ?? '',
      })
    : format(TS.people.cannot, { name, why: r.reason ?? '' });
}

// ---------------------------------------------------------------------------------------------
// «Процесс»

export interface Draft {
  statuses: S['TaskWorkflowStatus'][];
  transitions: Transition[];
}

/** Черновик или опубликованная версия (wfDraft :344) — копия для правки. */
export function draftOf(wf: S['TaskWorkflow']): Draft {
  const src = wf.draft ?? wf;
  return structuredClone({ statuses: src.statuses, transitions: src.transitions });
}

/** Чип версии (:460). */
export function versionChip(wf: S['TaskWorkflow']): { text: string; draft: boolean } {
  const draft = !!wf.draft;
  return {
    text: format(draft ? TS.workflow.draft : TS.workflow.active, { v: wf.version }),
    draft,
  };
}

export const categoryLabel = (c: Category): string => STATUS_CAT[c][0];
export const categoryColors = (c: Category) => {
  const [, bg, fg, bd] = STATUS_CAT[c];
  return { bg, fg, bd };
};
export const CATEGORIES: readonly Category[] = ['todo', 'progress', 'done'];

export const hasStatus = (d: Draft, name: string): boolean =>
  d.statuses.some((s) => s.name.toLowerCase() === name.trim().toLowerCase());

/** Новый статус (onAddS :464): перед первым «Готово»; статус категории «Готово» — в конец. */
export function addStatus(d: Draft, name: string, category: Category, id: string): Draft {
  const out = structuredClone(d);
  const i = out.statuses.findIndex((s) => s.category === 'done');
  out.statuses.splice(category === 'done' || i < 0 ? out.statuses.length : i, 0, {
    id,
    name: name.trim(),
    category,
  });
  return out;
}

/** Удалить статус (:462): переходы в него удаляются, из «откуда» он убирается, переходы без «откуда» — тоже. */
export function removeStatus(d: Draft, id: string): Draft {
  return {
    statuses: d.statuses.filter((s) => s.id !== id),
    transitions: d.transitions
      .filter((t) => t.to !== id)
      .map((t) => ({ ...t, from: t.from.filter((f) => f !== id) }))
      .filter((t) => t.from.length > 0),
  };
}

/** Новый переход (onAddT :469): без правил. */
export function addTransition(
  d: Draft,
  t: { name: string; from: string; to: string },
  key: string,
): Draft {
  const out = structuredClone(d);
  out.transitions.push({
    key,
    name: t.name.trim(),
    from: [t.from],
    to: t.to,
    who: [],
    notAuthor: false,
    commentRequired: false,
    checklistClosed: false,
    childrenDone: false,
    assignAuthor: false,
  });
  return out;
}

export const removeTransition = (d: Draft, key: string): Draft => ({
  statuses: d.statuses,
  transitions: d.transitions.filter((t) => t.key !== key),
});

export function patchTransition(d: Draft, key: string, patch: Partial<Transition>): Draft {
  const out = structuredClone(d);
  out.transitions = out.transitions.map((t) => {
    if (t.key !== key) return t;
    const next = { ...t, ...patch };
    if ('approval' in patch && !patch.approval) delete next.approval;
    return next;
  });
  return out;
}

/** Имя статуса по id; «*» — «Любой», нет — «—» (sName :457). */
export function statusName(d: Draft, id: string): string {
  if (id === '*') return TS.workflow.anyStatus;
  return d.statuses.find((s) => s.id === id)?.name ?? '—';
}

/** «{из, …} → {в}» (path :466). */
export const pathOf = (d: Draft, t: Transition): string =>
  `${t.from.map((f) => statusName(d, f)).join(', ')} → ${statusName(d, t.to)}`;

/** «Кто может» в контракте → ключ эталона WHO_LABEL. */
const WHO_PROTO: Readonly<Record<Who, keyof typeof WHO_LABEL>> = {
  project_manager: 'r-pm',
  project_approver: 'r-approver',
  project_executor: 'r-exec',
  assignee: 'assignee',
  author: 'author',
};
export const WHO: readonly Who[] = [
  'project_manager',
  'project_approver',
  'project_executor',
  'assignee',
  'author',
];
export const whoLabel = (w: Who): string => WHO_LABEL[WHO_PROTO[w]];

/** Колонка «кто» строки перехода (whoL :458). */
export function whoOf(t: Transition): string {
  if (t.approval) return TS.workflow.whoApprovers;
  return t.who.length ? t.who.map(whoLabel).join(', ') : TS.workflow.whoAll;
}

/** Чипы правил перехода (rules :466) или «Без правил». */
export function rulesOf(t: Transition): string[] {
  const R = TS.workflow.rule;
  const out = (
    [
      t.approval && (t.approval.mode === 'all' ? R.approvalAll : R.approvalAny),
      t.notAuthor && R.notAuthor,
      t.commentRequired && R.comment,
      t.checklistClosed && R.checklist,
      t.childrenDone && R.children,
      t.assignAuthor && R.assignAuthor,
    ] as (string | false | undefined)[]
  ).filter((x): x is string => typeof x === 'string');
  return out.length ? out : [R.none];
}

/** «Кто может» — переключить чип (:471). */
export function toggleWho(t: Transition, w: Who): Pick<Transition, 'who'> {
  return { who: t.who.includes(w) ? t.who.filter((x) => x !== w) : [...t.who, w] };
}

/** «Переход выполняется согласованием» (onAppr :472): «Достаточно одного», возврат — первый статус «откуда». */
export function approvalPatch(d: Draft, t: Transition, on: boolean): Partial<Transition> {
  if (!on) return { approval: undefined };
  const back = t.from.find((f) => f !== '*') ?? d.statuses[0]?.id ?? '';
  return { approval: { mode: 'any', rejectTo: back } };
}

/** Флажки «Проверки и действия» (flags :476) — поля перехода контракта. */
export const FLAGS = [
  ['notAuthor', TS.workflow.panel.notAuthor],
  ['commentRequired', TS.workflow.panel.comment],
  ['checklistClosed', TS.workflow.panel.checklist],
  ['childrenDone', TS.workflow.panel.children],
  ['assignAuthor', TS.workflow.panel.assignAuthor],
] as const;

/** «Согласуют все с правом «Согласовывать» в проекте: …» (apprWho :475). */
export function approverNames(rows: readonly S['TaskProjectMember'][]): string {
  const names = rows
    .filter((m) => m.memberStatus !== 'suspended' && m.actions.includes('tasks.approve'))
    .map((m) => m.displayName);
  return names.join(', ') || TS.workflow.panel.nobody;
}

// ---------------------------------------------------------------------------------------------
// «Автоматизация»

export const priorityLabel = (p: Priority): string => PRIORITY[p][0];
export const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'normal', 'low'];

/** Текст правила (text :482). */
export function ruleText(
  r: S['TaskAutomation'],
  statuses: readonly S['TaskWorkflowStatus'][],
  names: ReadonlyMap<string, string>,
): string {
  const A = TS.automation;
  const what =
    r.trigger.kind === 'created'
      ? A.textCreated
      : format(A.textStatus, {
          status: statuses.find((s) => s.id === r.trigger.statusId)?.name ?? '—',
        });
  const cond = r.condition?.priority
    ? format(A.textIf, { p: priorityLabel(r.condition.priority) })
    : '';
  const a = r.action;
  const act =
    a.kind === 'assign'
      ? format(A.textAssign, { name: names.get(a.memberId ?? '') ?? '—' })
      : a.kind === 'set_priority'
        ? format(A.textPriority, { p: a.priority ? priorityLabel(a.priority) : '—' })
        : format(A.textComment, { text: a.text ?? '' });
  return `${format(A.textWhen, { what })}${cond} → ${act}`;
}

/** «От имени {автор} · v{N} · запусков: {n}» (meta :482). */
export const ruleMeta = (r: S['TaskAutomation']): string =>
  format(TS.automation.meta, { author: r.authorDisplayName, v: r.version, n: r.runCount });

const TZ = 'Europe/Moscow';
const parts = (ms: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('ru-RU', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { day: `${p.day ?? ''}.${p.month ?? ''}`, time: `${p.hour ?? ''}:${p.minute ?? ''}` };
};

/** Время записи как в эталоне: сегодня — «ЧЧ:ММ», иначе «ДД.ММ ЧЧ:ММ» (пояс организаций сида — Москва). */
export function stamp(at: string, now: number): string {
  const a = parts(Date.parse(at));
  return a.day === parts(now).day ? a.time : `${a.day} ${a.time}`;
}

export interface RunLine {
  text: string;
  meta: string;
  icon: string;
  tone: 'ok' | 'muted' | 'error';
}

/** Строка «Журнала запусков» (runs :484). */
export function runLine(x: S['TaskAutomationRun'], now: number): RunLine {
  return {
    text: x.text,
    meta: format(TS.automation.runMeta, {
      at: stamp(x.at, now),
      name: x.automationName,
      v: x.automationVersion,
    }),
    icon:
      x.result === 'ok' ? 'check_circle' : x.result === 'stopped' ? 'do_not_disturb_on' : 'error',
    tone: x.result === 'ok' ? 'ok' : x.result === 'stopped' ? 'muted' : 'error',
  };
}
