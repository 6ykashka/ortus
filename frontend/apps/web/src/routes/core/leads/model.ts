// W4.13 · Модель старой доски «Заявки» (эталон design-2026-10-19 «Ортус CRM.dc.html» :1600–1705, tasksVM :4443–4504).
// Этапы воронки фиксированы (TaskWorkflow.fixed, flow leads): колонки — WORKFLOWS.leads.statuses эталона, статусы
// сервера сопоставляются по имени («Отказ» колонки не имеет, как в эталоне). Тон и иконка — WORKFLOWS.leads.tone,
// цвета — TONE оболочки (:2307). Переходы — availableTransitions задачи (сервер), подпись «Перевести» — по эталону.
import type { components } from '@ortus/api-client';
import { PRIORITY, WORKFLOWS } from '@ortus/domain/modules';
import { format } from '@ortus/texts';

import { TL } from './texts.ts';

type S = components['schemas'];
/** Задача ответа (тип ответа openapi-fetch и схемы расходятся в customFields — они доске не нужны). */
export type TaskLike = Omit<S['Task'], 'customFields' | 'relatedObjects'>;
type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

/** TONE оболочки эталона (:2307). */
const TONE: Readonly<Record<Tone, { bg: string; fg: string }>> = {
  ok: { bg: '#E3EFE7', fg: '#1F6B52' },
  info: { bg: '#E7EEF6', fg: '#2B5479' },
  warn: { bg: '#FAF1DC', fg: '#7A5214' },
  danger: { bg: '#FBEAE7', fg: '#A13A33' },
  neutral: { bg: '#ECEFEA', fg: '#4C5955' },
};

const FLOW = WORKFLOWS.leads;
const toneOf = (name: string): readonly [Tone, string] =>
  (FLOW.tone[name] as readonly [Tone, string] | undefined) ?? ['neutral', 'radio_button_unchecked'];

/** Чип этапа (ch :2309). */
export function chipOf(name: string): { label: string; icon: string; bg: string; fg: string } {
  const [tone, icon] = toneOf(name);
  return { label: name, icon, ...TONE[tone] };
}

/** Приоритет (prio :4450): нейтральный — #5C6964. */
export function prioOf(p: S['TaskPriority']): { label: string; icon: string; fg: string } {
  const [label, tone, icon] = PRIORITY[p];
  return { label, icon, fg: tone === 'neutral' ? '#5C6964' : TONE[tone as Tone].fg };
}

const TZ = 'Europe/Moscow';
const dayOf = (ms: number): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(ms);
const isoDay = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ms);

/**
 * Срок «ДД.ММ» (Р-17): срок — конец дня по Москве, т. е. полночь следующего; без срока — «—» (эталон хранит due «—»,
 * api.js createTask: «срок —» на карточке CRM:1642, «—» в поле «Срок» CRM:1673).
 */
export function dueText(dueAt: string | undefined): string {
  if (!dueAt) return '—';
  return dayOf(Date.parse(dueAt) - 1);
}

export interface CardVM {
  id: string;
  key: string;
  title: string;
  assignee: string;
  due: string;
  overdue: boolean;
  prio: ReturnType<typeof prioOf>;
  chip: ReturnType<typeof chipOf>;
}

/**
 * Карточка и строка списка (card :4453). Просрочка (overdue :4451): эталон краснит срочную незавершённую задачу со
 * сроком «сегодня» — здесь срочная незавершённая со сроком не позже сегодня.
 */
export function cardOf(t: TaskLike, now: number): CardVM {
  const done = t.statusCategory === 'done';
  const overdue =
    !done && t.priority === 'urgent' && !!t.dueAt && isoDay(Date.parse(t.dueAt) - 1) <= isoDay(now);
  return {
    id: t.id,
    key: t.key ?? t.id,
    title: t.title,
    assignee: t.assigneeDisplayName ?? '—',
    due: dueText(t.dueAt),
    overdue,
    prio: prioOf(t.priority ?? 'normal'),
    chip: chipOf(t.statusName ?? ''),
  };
}

export interface ColumnVM {
  name: string;
  icon: string;
  fg: string;
  count: string;
  empty: boolean;
  cards: TaskLike[];
}

/** Колонки доски (columns :4467): этапы воронки эталона, задачи — по статусу сервера с тем же именем. */
export function columnsOf(
  statuses: readonly S['TaskWorkflowStatus'][],
  tasks: readonly TaskLike[],
): ColumnVM[] {
  return FLOW.statuses.map((name) => {
    const st = statuses.find((s) => s.name === name);
    const cards = st ? tasks.filter((t) => t.status === st.id) : [];
    const [tone, icon] = toneOf(name);
    return {
      name,
      icon,
      fg: TONE[tone].fg,
      count: String(cards.length),
      empty: !cards.length,
      cards,
    };
  });
}

export interface MoveVM {
  key: string;
  label: string;
  to: string;
  icon: string;
  fwd: boolean;
  disabled: boolean;
}

/**
 * «Перевести» (moves :4487): переходы из текущего этапа в порядке воронки эталона (FL.flow[этап]; переходы сервера
 * вне неё — в конце, в порядке сервера); вперёд по воронке — залитая кнопка без стрелки, назад и «Отказ» —
 * «← {этап}». «Готово» при открытом чек-листе — « · сначала чек-лист». Недоступна без права или при отказе сервера
 * (allowed).
 */
export function movesOf(t: TaskLike, o: { canEdit: boolean }): MoveVM[] {
  const at = FLOW.statuses.indexOf(t.statusName ?? '');
  const unchecked = (t.checklist ?? []).some((c) => !c.done);
  const order: readonly string[] = FLOW.flow[t.statusName ?? ''] ?? [];
  const rank = (to: string) => {
    const i = order.indexOf(to);
    return i < 0 ? order.length : i;
  };
  const sorted = [...(t.availableTransitions ?? [])].sort(
    (a, b) => rank(a.toStatusName) - rank(b.toStatusName),
  );
  return sorted.map((m) => {
    const to = m.toStatusName;
    const fwd = FLOW.statuses.indexOf(to) > at;
    const blocked = to === 'Готово' && unchecked;
    const label = blocked ? format(TL.checkFirst, { to }) : to;
    return {
      key: m.key,
      label: fwd ? label : format(TL.back2, { to: label }),
      to,
      icon: toneOf(to)[1],
      fwd,
      disabled: !o.canEdit || blocked || !m.allowed,
    };
  });
}

const stampOf = (at: string, now: number): string => {
  const ms = Date.parse(at);
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
  return dayOf(ms) === dayOf(now) ? time : `${dayOf(ms)} ${time}`;
};

export interface HistoryLine {
  id: string;
  text: string;
  meta: string;
  system: boolean;
}

/**
 * «История и комментарии» (comments :4497): по порядку записи (сервер отдаёт новые первыми — список переворачивается),
 * «{кто} · {когда}», системные — приглушены.
 */
export function historyLines(items: readonly S['TaskHistoryEntry'][], now: number): HistoryLine[] {
  return [...items].reverse().map((h) => ({
    id: h.id,
    text: h.text,
    meta: `${h.actorDisplayName} · ${stampOf(h.at, now)}`,
    system: h.kind !== 'comment',
  }));
}
