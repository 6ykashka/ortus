// Справочники «Задач и проектов» (models.js 14.10:164–184, 235). Подписи — дословно из эталона.
import type { StatusCat, TaskPriority } from '../../core/task-port.ts';
import type { ToneKey, Verb } from '../../core/types/index.ts';
import type { TransitionWho } from './types.ts';

/** Тон и иконка статуса на доске. */
export type StatusTone = readonly [ToneKey, string];

/** Процесс старой доски (`WORKFLOWS`): проекты без процесса и воронка «Заявки». */
export interface BoardFlow {
  statuses: readonly string[];
  flow: Readonly<Record<string, readonly string[]>>;
  tone: Readonly<Record<string, StatusTone>>;
  item: string;
  items: string;
  done: string;
}

export const TASK_STATUSES: readonly string[] = ['Новая', 'В работе', 'На проверке', 'Готово'];

export const TASK_FLOW: Readonly<Record<string, readonly string[]>> = {
  Новая: ['В работе', 'Отменена'],
  'В работе': ['На проверке', 'Новая'],
  'На проверке': ['Готово', 'В работе'],
  Готово: ['В работе'],
  Отменена: ['Новая'],
};

const UNKNOWN_TONE: StatusTone = ['info', 'pending'];

/** Тон неизвестного статуса (статусы процесса проекта) — «в работе» (`toneSafe` эталона). */
const toneSafe = (o: Record<string, StatusTone>): Readonly<Record<string, StatusTone>> =>
  new Proxy(o, {
    get: (t, k) => (typeof k !== 'string' || k in t ? t[k as string] : UNKNOWN_TONE),
  });

export const TASK_TONE: Readonly<Record<string, StatusTone>> = toneSafe({
  Новая: ['neutral', 'radio_button_unchecked'],
  'В работе': ['info', 'pending'],
  'На проверке': ['warn', 'rate_review'],
  Готово: ['ok', 'check_circle'],
  Отменена: ['neutral', 'block'],
});

export const WORKFLOWS: Readonly<Record<'tasks' | 'leads', BoardFlow>> = {
  tasks: {
    statuses: TASK_STATUSES,
    flow: TASK_FLOW,
    tone: TASK_TONE,
    item: 'задача',
    items: 'Задачи',
    done: 'Готово',
  },
  leads: {
    statuses: ['Новая', 'Замер', 'Смета', 'Договор', 'Объект'],
    flow: {
      Новая: ['Замер', 'Отказ'],
      Замер: ['Смета', 'Отказ'],
      Смета: ['Договор', 'Замер', 'Отказ'],
      Договор: ['Объект', 'Смета', 'Отказ'],
      Объект: [],
      Отказ: ['Новая'],
    },
    tone: {
      Новая: ['neutral', 'radio_button_unchecked'],
      Замер: ['info', 'straighten'],
      Смета: ['warn', 'request_quote'],
      Договор: ['warn', 'contract'],
      Объект: ['ok', 'apartment'],
      Отказ: ['neutral', 'block'],
    },
    item: 'заявка',
    items: 'Заявки',
    done: 'Объект',
  },
};

/** Роли проекта: назначаются с областью `project` (`setProjectRole`). */
export const PROJECT_ROLES: readonly string[] = ['r-pm', 'r-approver', 'r-exec', 'r-viewer'];

export const VERB_LABEL: Readonly<Partial<Record<Verb, string>>> = {
  view: 'Читать',
  create: 'Создавать',
  edit: 'Менять статус',
  review: 'Согласовывать',
  settings: 'Настраивать',
};

export const WHO_LABEL: Readonly<Record<TransitionWho, string>> = {
  'r-pm': 'руководитель проекта',
  'r-approver': 'согласующий',
  'r-exec': 'исполнитель по роли',
  assignee: 'исполнитель задачи',
  author: 'автор задачи',
};

/** Какое действие роли проекта заменяет «кто может» перехода. */
export const WHO_VERB: Readonly<Partial<Record<TransitionWho, Verb>>> = {
  'r-pm': 'settings',
  'r-approver': 'review',
  'r-exec': 'edit',
};

/** Категория статуса: подпись, фон, текст, рамка. */
export const STATUS_CAT: Readonly<Record<StatusCat, readonly [string, string, string, string]>> = {
  todo: ['К выполнению', '#ECEFEA', '#3A4844', '#B7C0B4'],
  progress: ['В работе', '#E7EEF6', '#2B5479', '#9DB7D1'],
  done: ['Готово', '#E3EFE7', '#1F6B52', '#9CC3AE'],
};

/** Приоритет: подпись, тон, иконка. */
export const PRIORITY: Readonly<Record<TaskPriority, readonly [string, ToneKey, string]>> = {
  urgent: ['Срочно', 'danger', 'priority_high'],
  high: ['Высокий', 'warn', 'keyboard_double_arrow_up'],
  normal: ['Обычный', 'neutral', 'remove'],
  low: ['Низкий', 'neutral', 'keyboard_arrow_down'],
};

/** Статусы, которые без процесса проекта считаются завершёнными (`isDone`). */
export const DONE_NAMES: readonly string[] = ['Готово', 'Объект', 'Отказ', 'Отменена'];
