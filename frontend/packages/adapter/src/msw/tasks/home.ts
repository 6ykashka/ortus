// W4.81 (0.11.1-stage4): задачи на «Главной» — источник «Требует решения» (tasks.task_new, tasks.task_review) и сводка
// getMyTaskSummary (карточка «Задачи» в «Сегодня в работе», бейдж меню). Зеркало Go: tasks.Service.Home (место статуса
// задачи на «Главной», tasks.md Р-27) и backend/internal/modules/home/tasks (карточка).
import type { components } from '@ortus/api-client';

import type { TenantAccess } from '../core/access.ts';
import type { HandlerContext } from '../core/registry.ts';
import { type ProjectRow, type TaskRow, versionOf, viewOf, type WfVersion } from './state.ts';

type S = components['schemas'];

/** Задач участника в «Требует решения» (homeVM :4083: mine.slice(0, 3)). */
export const HOME_LIMIT = 3;

type Place = 'new' | 'progress' | 'review' | null;

/** «На проверке»: статус «В работе», не первый в категории, из которого свой переход (не «Из любого») ведёт в «Готово». */
function isReview(v: WfVersion, id: string): boolean {
  const firstProgress = v.statuses.find((s) => s.category === 'progress');
  if (firstProgress?.id === id) return false;
  return v.transitions.some((tr) => {
    if (tr.from.includes('*') || !tr.from.includes(id)) return false;
    return v.statuses.find((s) => s.id === tr.to)?.category === 'done';
  });
}

/** Место статуса задачи на «Главной» и «первый ли это статус категории „К выполнению“». */
function placeOf(p: ProjectRow, t: TaskRow): { place: Place; first: boolean } {
  const funnel = p.flow === 'leads';
  for (const v of [versionOf(p, t), p.versions.at(-1)]) {
    const s = v?.statuses.find((x) => x.id === t.statusId);
    if (!v || !s) continue;
    if (s.category === 'todo') {
      const first = (v.statuses.find((x) => x.category === 'todo') ?? v.statuses[0])?.id;
      return { place: 'new', first: first === t.statusId };
    }
    if (s.category !== 'progress' || funnel) return { place: null, first: false };
    return { place: isReview(v, t.statusId) ? 'review' : 'progress', first: false };
  }
  return { place: null, first: false };
}

const numberOf = (key: string): number => Number(/(\d+)$/.exec(key)?.[1] ?? 0);

export interface HomeTasks {
  summary: Omit<S['TaskSummary'], 'tenantId' | 'generatedAt'>;
  cards: S['DecisionItem'][];
}

/** Задачи, которые видит участник (tasks.read), счётчики и первые три его задачи «Новая» и «На проверке». */
export function tasksHome(ctx: HandlerContext, t: TenantAccess): HomeTasks {
  const v = viewOf({ ...ctx, org: () => t }, false);
  const out: HomeTasks = { summary: { new: 0, inProgress: 0, review: 0, myNew: 0 }, cards: [] };
  const visible = v.data.tasks
    .filter((x) => v.visibleTask(x))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        numberOf(b.key) - numberOf(a.key) ||
        a.id.localeCompare(b.id),
    );
  for (const task of visible) {
    const p = v.project(task.projectId);
    if (!p) continue;
    const { place, first } = placeOf(p, task);
    if (place === 'new') out.summary.new++;
    else if (place === 'progress') out.summary.inProgress++;
    else if (place === 'review') out.summary.review++;
    if (task.assigneeId !== v.me) continue;
    if (first && p.flow !== 'leads') out.summary.myNew++;
    if ((place === 'new' || place === 'review') && out.cards.length < HOME_LIMIT) {
      const kind = place === 'new' ? 'tasks.task_new' : 'tasks.task_review';
      const params: Record<string, string> = {
        taskKey: task.key,
        title: task.title,
        projectId: p.id,
      };
      if (task.dueAt) params.dueAt = task.dueAt;
      if (task.fromForm) params.fromForm = 'true';
      if (p.flow === 'leads') params.funnel = 'true';
      out.cards.push({
        key: `${kind}:${task.id}`,
        kind,
        moduleKey: 'tasks',
        tone: task.priority === 'urgent' ? 'danger' : 'neutral',
        object: { moduleKey: 'tasks', entityType: 'task', entityId: task.id },
        params,
      });
    }
  }
  return out;
}
