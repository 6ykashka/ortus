// W4.12 · Модель «Задач и проектов» — чистые функции по логике эталона design-2026-10-19 «Задачи и проекты.dc.html»:
// строки проектов (:360–362), ключ по названию (autoKey :524), шапка проекта (:378), колонки и карточки доски
// (:411–413, cardRel :499), срок «ДД.ММ» (:408, Р-17), размер и проверка файла (fsize :515, pickFiles :517–521, fileVM
// :516), кандидаты связей (parentOpts :494–498, relVM :512), время истории и голосов.
import type { components } from '@ortus/api-client';
import { format, tasks as T } from '@ortus/texts';

type S = components['schemas'];

export type AccessKind = 'open' | 'limited' | 'closed' | 'funnel';

export interface ProjectRowVM {
  id: string;
  key: string;
  name: string;
  sub: string;
  unit: string;
  access: AccessKind;
  accessLabel: string;
  accessIcon: string;
  people: string;
  open: string;
  funnel: boolean;
}

export interface CardVM {
  id: string;
  key: string;
  title: string;
  rel: string | null;
  appr: string | null;
  priority: S['TaskPriority'];
  priorityLabel: string;
  due: string;
  initials: string;
  who: string;
}

export interface ColumnVM {
  id: string;
  name: string;
  category: S['TaskStatusCategory'];
  count: number;
  cards: CardVM[];
}

export interface Option {
  value: string;
  label: string;
}

export type FileReason = 'tooMany' | 'tooBig' | 'empty' | 'type';

/** Пояс организаций сида и эталона: срок и время истории — по Москве. */
const MSK = 'Europe/Moscow';
const DASH = '—';

/** Иконки уровней доступа (ACC :323) и воронки (:360). */
const ACCESS_ICON: Readonly<Record<AccessKind, string>> = {
  open: 'public',
  limited: 'visibility',
  closed: 'lock',
  funnel: 'filter_alt',
};

/** Имя области проекта: подразделение или «Вся организация» (uName :350). */
export function unitName(id: string | null, units: ReadonlyMap<string, string>): string {
  if (!id) return T.projects.wholeOrg;
  return units.get(id) ?? DASH;
}
/**
 * Имя области проекта для шапки и столбца «Область»: listOrgUnits (право org_units.read), иначе `orgUnitName` ответа
 * проекта, иначе «—». В контракте 0.10 у Project только orgUnitId: логист и водитель без org_units.read видят «—»
 * (эталон — uName(p.unit), ЗП:378); поле `orgUnitName` — вопрос стюарду (Q-W4.12-10), страница его уже читает.
 */
export function projectUnit(p: S['Project'], units: ReadonlyMap<string, string>): string {
  if (!p.orgUnitId) return T.projects.wholeOrg;
  const own = (p as S['Project'] & { orgUnitName?: string }).orgUnitName;
  return units.get(p.orgUnitId) ?? (own || DASH);
}

const accessOf = (p: S['Project']): AccessKind =>
  p.flow === 'leads' ? 'funnel' : (p.access ?? 'limited');

/** Строки таблицы «Проекты» (:360–362). */
export function projectRows(
  projects: readonly S['Project'][],
  units: ReadonlyMap<string, string>,
): ProjectRowVM[] {
  return projects.map((p) => {
    const access = accessOf(p);
    const owner = p.ownerDisplayName ?? DASH;
    const sub =
      access === 'funnel'
        ? format(T.projects.subFunnel, { owner })
        : p.workflow
          ? format(T.projects.sub, { owner, v: p.workflow.version })
          : format(T.projects.subNoWf, { owner });
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      sub,
      unit: projectUnit(p, units),
      access,
      accessLabel: access === 'funnel' ? T.projects.funnel : T.access[access],
      accessIcon: ACCESS_ICON[access],
      people: access !== 'funnel' && p.workflow ? String(p.counts?.members ?? 0) : DASH,
      open: String(p.counts?.open ?? 0),
      funnel: access === 'funnel',
    };
  });
}

/** Подзаголовок шапки проекта: «{область} · {уровень} проект · процесс v{N}» (:378). */
export function projectSub(p: S['Project'], unit: string): string {
  const level = T.access[p.access ?? 'limited'].toLowerCase();
  return p.workflow
    ? format(T.project.sub, { unit, access: level, v: p.workflow.version })
    : format(T.project.subNoWf, { unit, access: level });
}

/** Ключ проекта по названию (autoKey :524): инициалы слов или три первые буквы, не длиннее 4. */
export function autoKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return key.slice(0, 4);
}

/** Первый статус категории «К выполнению» (:397). */
export const firstTodo = (
  statuses: readonly S['TaskWorkflowStatus'][],
): S['TaskWorkflowStatus'] | undefined =>
  statuses.find((s) => s.category === 'todo') ?? statuses[0];

/** Инициалы (ini :320): первые буквы двух слов. */
export const initials = (name: string | undefined): string =>
  String(name || '?')
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

/** Связь на карточке доски (cardRel :499): «↳ {родитель}» или «☰ {готово}/{всего}». */
function relOf(t: S['Task']): string | null {
  if (t.parentTaskId && t.parent?.key) return `↳ ${t.parent.key}`;
  const kids = t.children;
  if (kids && kids.total > 0) return `☰ ${kids.done}/${kids.total}`;
  return null;
}

/** Карточка доски (:413). */
export function cardOf(t: S['Task']): CardVM {
  const priority = t.priority ?? 'normal';
  let appr: string | null = null;
  if (t.docRoute) appr = T.board.docRoute;
  else if (t.approval) appr = t.approval.canApprove ? T.board.waitsMe : T.board.inApproval;
  return {
    id: t.id,
    key: t.key ?? '',
    title: t.title,
    rel: relOf(t),
    appr,
    priority,
    priorityLabel: T.priority[priority],
    due: dueLabel(t.dueAt),
    initials: initials(t.assigneeDisplayName),
    who: t.assigneeDisplayName ?? '',
  };
}

/** Колонки доски — статусы опубликованной версии по порядку процесса (:411). */
export function columnsOf(
  statuses: readonly S['TaskWorkflowStatus'][],
  tasks: readonly S['Task'][],
): ColumnVM[] {
  return statuses.map((st) => {
    const cards = tasks.filter((t) => t.status === st.id).map(cardOf);
    return { id: st.id, name: st.name, category: st.category, count: cards.length, cards };
  });
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
});
const HOUR_MIN = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Срок «ДД.ММ» (:408, Р-17). Срок формы — конец дня по Москве (начало следующих суток), поэтому показывается дата
 * момента на миллисекунду раньше.
 */
export function dueLabel(dueAt: string | undefined): string {
  if (!dueAt) return '';
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) return '';
  return DAY_MONTH.format(new Date(ms - 1));
}

/** Дата поля «Срок» (ГГГГ-ММ-ДД) → конец этого дня по Москве (UTC+3, без перехода времени). */
export function dueAtOf(date: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, -3);
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** Метки «Через запятую» (:408): без пробелов по краям и пустых; регистр приводит сервер. */
export const labelsOf = (input: string): string[] =>
  input
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Размер файла (fsize :515). */
export function fileSize(bytes: number): string {
  if (bytes < 1048576) return format(T.size.kb, { n: Math.max(1, Math.round(bytes / 1024)) });
  return format(T.size.mb, { n: (bytes / 1048576).toFixed(1).replace('.', ',') });
}

/** Принимаемые типы (pickFiles :518). */
const FILE_OK =
  /^(image\/|application\/pdf|text\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.oasis|zip))/;
export const FILES_PER_TASK = 30;
export const FILE_MAX_BYTES = 20 * 1048576;

/** Причина, по которой файл не прикрепится (pickFiles :520); `index` — сколько файлов уже есть до него. */
export function fileReason(f: { size: number; type: string }, index: number): FileReason | null {
  if (index >= FILES_PER_TASK) return 'tooMany';
  if (f.size > FILE_MAX_BYTES) return 'tooBig';
  if (!f.size) return 'empty';
  if (!FILE_OK.test(f.type || '')) return 'type';
  return null;
}

/** Иконка файла (fileVM :516). */
export function fileIcon(type: string): string {
  if (/pdf/.test(type)) return 'picture_as_pdf';
  if (/^image\//.test(type)) return 'image';
  if (/sheet|excel/.test(type)) return 'table_chart';
  return 'description';
}

/** Все потомки задачи по parentTaskId. */
function descendants(all: readonly S['Task'][], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string): void => {
    for (const x of all) {
      if (x.parentTaskId === pid && !out.has(x.id)) {
        out.add(x.id);
        walk(x.id);
      }
    }
  };
  walk(id);
  return out;
}

const optionOf = (t: S['Task']): Option => ({
  value: t.id,
  label: format(T.newTask.parentOption, { key: t.key ?? '', title: t.title.slice(0, 60) }),
});

/**
 * «Входит в задачу» (parentOpts :494–498): видимые незавершённые задачи, кроме самой задачи и её потомков. Видимость
 * задач даёт listTasks участника (задачи проектов с доступом и свои).
 */
export function parentOptions(all: readonly S['Task'][], task: S['Task'] | null): Option[] {
  const desc = task ? descendants(all, task.id) : new Set<string>();
  return all
    .filter((x) => (!task || x.id !== task.id) && !desc.has(x.id) && x.statusCategory !== 'done')
    .map(optionOf);
}

/** «Добавить существующую…» (relVM :512): кандидаты «Входит в» без предков и без задач, у которых есть родитель. */
export function childOptions(all: readonly S['Task'][], task: S['Task']): Option[] {
  const byId = new Map(all.map((x) => [x.id, x]));
  const anc = new Set<string>();
  let up: S['Task'] | undefined = task;
  while (up?.parentTaskId && !anc.has(up.parentTaskId)) {
    anc.add(up.parentTaskId);
    up = byId.get(up.parentTaskId);
  }
  return parentOptions(all, task).filter(
    (o) => !anc.has(o.value) && !byId.get(o.value)?.parentTaskId,
  );
}

/** Время строки истории, файла и голоса: сегодня — «ЧЧ:ММ», другой день — «ДД.ММ ЧЧ:ММ» (по Москве). */
export function clockOf(at: string, now: number): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const time = HOUR_MIN.format(d);
  return DAY_MONTH.format(d) === DAY_MONTH.format(new Date(now))
    ? time
    : `${DAY_MONTH.format(d)} ${time}`;
}
