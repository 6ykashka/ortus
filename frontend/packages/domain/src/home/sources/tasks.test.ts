// W4.81 · Источник «Требует решения» модуля «Задачи» (homeVM :4081–4084; DoR tasks.md «Главная», Р-20): мои задачи
// «Новая» и «На проверке» — иконка и чип по статусу, «{номер} · {тема}», «Срок {ДД.ММ}» и « · создана из ответа формы»,
// «Открыть» → карточка задачи (`/tasks?task=`), заявка воронки — «Заявки» `?project=&task=`. Параметры — по описанию
// DecisionItem.kind контракта 0.11.1-stage4 и примерам getMyDecisionQueue/{ok,manager}.
import { describe, expect, it } from 'vitest';

import type { DecisionItemLike } from '../types.ts';
import { source as tasks } from './tasks.ts';

const CTX = { timeZone: 'Europe/Moscow' };
const T64 = 'a51ba39b-9199-51cc-8acf-0bf66df47df6';
const LOG = '1380e888-13ac-5357-9a6f-a592a20e8220';
const LEADS = '7d2b1f0c-0000-5000-8000-000000000001';

function cardOf(it: Omit<DecisionItemLike, 'key' | 'moduleKey'>) {
  const build = tasks.kinds[it.kind];
  if (!build) throw new Error(`нет провайдера ${it.kind}`);
  return build({ ...it, key: `${it.kind}:x`, moduleKey: 'tasks' }, CTX);
}

const ref = (id: string) => ({ moduleKey: 'tasks', entityType: 'task', entityId: id });

describe('источник «Задачи» (tasks)', () => {
  it('модуль tasks, этап 4, два вида', () => {
    expect(tasks.id).toBe('tasks');
    expect(tasks.moduleKey).toBe('tasks');
    expect(tasks.stage).toBe(4);
    expect(Object.keys(tasks.kinds)).toEqual(['tasks.task_new', 'tasks.task_review']);
  });

  it('«Новая»: task_alt · «Задача» · «T-64 · Найти водителя…» · «Срок 01.10» · «Открыть» → «Задачи» ?task=', () => {
    expect(
      cardOf({
        kind: 'tasks.task_new',
        tone: 'danger',
        object: ref(T64),
        params: {
          taskKey: 'T-64',
          title: 'Найти водителя на рейс Р-211',
          projectId: LOG,
          dueAt: '2026-10-01T21:00:00Z',
        },
      }),
    ).toEqual({
      icon: 'task_alt',
      tag: { key: 'queue.chips.task' },
      title: { key: 'queue.task', args: { key: 'T-64', title: 'Найти водителя на рейс Р-211' } },
      text: { key: 'queue.taskDue', args: { due: '01.10', form: 'no' } },
      action: {
        label: { key: 'queue.actions.open' },
        target: { page: 'tasks', search: { task: T64 } },
      },
    });
  });

  it('«На проверке»: rate_review · чип «На проверке»; задача правила формы — « · создана из ответа формы»', () => {
    const c = cardOf({
      kind: 'tasks.task_review',
      tone: 'neutral',
      object: ref(T64),
      params: {
        taskKey: 'LOG-101',
        title: 'Проверить осмотр Р-196',
        projectId: LOG,
        fromForm: 'true',
      },
    });
    expect(c.icon).toBe('rate_review');
    expect(c.tag).toEqual({ key: 'queue.chips.taskReview' });
    expect(c.title).toEqual({
      key: 'queue.task',
      args: { key: 'LOG-101', title: 'Проверить осмотр Р-196' },
    });
    // Срока нет — «—», как `due: '—'` сида эталона.
    expect(c.text).toEqual({ key: 'queue.taskDue', args: { due: '—', form: 'yes' } });
  });

  it('заявка воронки: «Открыть» → «Заявки» ?project=&task= (старая доска, W4.13)', () => {
    const c = cardOf({
      kind: 'tasks.task_new',
      tone: 'neutral',
      object: ref(T64),
      params: {
        taskKey: 'L-31',
        title: 'Квартира 64 м², Химки',
        projectId: LEADS,
        dueAt: '2026-10-03T21:00:00Z',
        funnel: 'true',
      },
    });
    expect(c.text).toEqual({ key: 'queue.taskDue', args: { due: '03.10', form: 'no' } });
    expect(c.action).toEqual({
      label: { key: 'queue.actions.open' },
      target: { page: 'leads', search: { project: LEADS, task: T64 } },
    });
  });
});
