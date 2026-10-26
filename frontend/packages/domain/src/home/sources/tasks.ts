// W4.81 · Источник «Требует решения» модуля «Задачи» (homeVM :4081–4084; DoR tasks.md «Главная», Р-20): мои задачи
// «Новая» (tasks.task_new) и «На проверке» (tasks.task_review) — первые три, срочная — danger (тон даёт сервер). Иконка и
// чип — по статусу, заголовок «{номер} · {тема}», текст «Срок {ДД.ММ}» и « · создана из ответа формы» у задачи правила
// формы; «Открыть» — карточка задачи (`/tasks?task=`, Р-20), у заявки воронки — старая доска «Заявки» (W4.13). Права и
// видимость проверяет сервер (контракт 0.11.1-stage4).
import { HOME_TIME_ZONE } from '../time.ts';
import type { CardOf, DecisionItemLike, HomeSource, HomeTarget } from '../types.ts';

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', {
  timeZone: HOME_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
});

/**
 * Срок «ДД.ММ» (как доска задач, Р-17): срок — конец дня по Москве (начало следующих суток), поэтому показывается дата
 * момента на миллисекунду раньше; срока нет — «—», как `due: '—'` сида эталона.
 */
function due(dueAt: string | undefined): string {
  const ms = Date.parse(dueAt ?? '');
  return Number.isNaN(ms) ? '—' : DAY_MONTH.format(new Date(ms - 1));
}

const p = (item: DecisionItemLike, name: string): string => item.params[name] ?? '';

/** Карточка задачи или заявки воронки. */
function target(item: DecisionItemLike): HomeTarget {
  const task = item.object?.entityId ?? '';
  return p(item, 'funnel') === 'true'
    ? { page: 'leads', search: { project: p(item, 'projectId'), task } }
    : { page: 'tasks', search: { task } };
}

const card =
  (review: boolean): CardOf =>
  (item) => ({
    icon: review ? 'rate_review' : 'task_alt',
    tag: { key: review ? 'queue.chips.taskReview' : 'queue.chips.task' },
    title: { key: 'queue.task', args: { key: p(item, 'taskKey'), title: p(item, 'title') } },
    text: {
      key: 'queue.taskDue',
      args: { due: due(item.params.dueAt), form: p(item, 'fromForm') === 'true' ? 'yes' : 'no' },
    },
    action: { label: { key: 'queue.actions.open' }, target: target(item) },
  });

export const source: HomeSource = {
  id: 'tasks',
  moduleKey: 'tasks',
  stage: 4,
  kinds: {
    'tasks.task_new': card(false),
    'tasks.task_review': card(true),
  },
};
