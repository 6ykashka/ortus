// Сроки обращения (service.js 19.10:90–121 `slaOf`, `slaHead`; 243–253 `resume`, `slaFor`).
import { plural } from '../../core/format.ts';
import {
  addWorkMinutes,
  DAY_MS,
  offsetMs,
  MINUTE_MS,
  workBetween,
  type WorkCalendar,
} from './calendar.ts';
import { dueText, dur, span } from './format.ts';
import type {
  LegalTarget,
  RequestType,
  Sla,
  SlaHeadInfo,
  SlaItem,
  SlaKey,
  Target,
} from './types.ts';

export const isOpen = (r: { status: string }): boolean =>
  r.status !== 'resolved' && r.status !== 'closed';

/** Цели нового обращения по типу направления; `at` — время создания. */
export function slaFor(
  cal: WorkCalendar,
  ty: Pick<RequestType, 'first' | 'resolve' | 'legal'>,
  at: number,
): Sla {
  return {
    first: ty.first
      ? { goal: ty.first, due: addWorkMinutes(at, ty.first, cal), stopped: null }
      : null,
    resolve: ty.resolve
      ? { goal: ty.resolve, due: addWorkMinutes(at, ty.resolve, cal), stopped: null }
      : null,
    legal: ty.legal ? { days: ty.legal, due: at + ty.legal * DAY_MS, stopped: null } : null,
  };
}

/** Снимает паузу «ждём клиента»: первый ответ и решение сдвигаются на простой в рабочих минутах. */
export function resumeTimers(
  r: { pausedAt?: number | null; sla: Sla },
  cal: WorkCalendar,
  now: number,
): void {
  if (!r.pausedAt) return;
  const mins = workBetween(r.pausedAt, now, cal);
  for (const k of ['first', 'resolve'] as const) {
    const x = r.sla[k];
    if (x && !x.stopped) x.due = addWorkMinutes(x.due, mins, cal);
  }
  r.pausedAt = null;
}

const LABEL: Record<SlaKey, string> = {
  first: 'Первый ответ',
  resolve: 'Решение',
  legal: 'Ответ по закону',
};

interface SlaRequest {
  status: string;
  at: number;
  sla: Sla;
}

/** Сроки обращения для экрана: первый ответ, решение, срок по закону. */
export function slaOf(r: SlaRequest, d: { cal: WorkCalendar }, now: number): SlaItem[] {
  const out: SlaItem[] = [];
  const paused = r.status === 'wait';
  const off = offsetMs(d.cal);
  const one = (key: SlaKey, x: Target | LegalTarget | null): void => {
    if (!x) return;
    const label = LABEL[key];
    const legal = key === 'legal';
    if (x.stopped) {
      out.push({
        key,
        label,
        state: 'done',
        text:
          key === 'first'
            ? 'ответ за ' + dur(workBetween(r.at, x.stopped, d.cal), d.cal)
            : 'выполнено',
        until: x.stopped > x.due ? 'с нарушением срока' : 'в срок',
      });
      return;
    }
    if (paused && !legal) {
      out.push({ key, label, state: 'pause', text: 'на паузе', until: 'ждём клиента' });
      return;
    }
    if (now > x.due) {
      const over = (now - x.due) / MINUTE_MS;
      out.push({
        key,
        label,
        state: 'late',
        text: 'просрочен на ' + span(over),
        until: 'был до ' + dueText(x.due, now, off),
        over,
      });
      return;
    }
    const left = legal
      ? Math.max(0, Math.ceil((x.due - now) / DAY_MS))
      : workBetween(now, x.due, d.cal);
    const goal = 'goal' in x ? x.goal : 0;
    const risk = legal ? left <= 2 : left <= Math.max(20, goal * 0.25);
    out.push({
      key,
      label,
      state: risk ? 'risk' : legal ? 'legal' : 'norm',
      text:
        'осталось ' + (legal ? left + ' ' + plural(left, 'день', 'дня', 'дней') : dur(left, d.cal)),
      until: 'до ' + dueText(x.due, now, off),
      left: legal ? left * 1440 : left,
    });
  };
  one('first', r.sla.first);
  one('resolve', r.sla.resolve);
  one('legal', r.sla.legal);
  return out;
}

/** Главный срок для строки очереди; `rank` — порядок сортировки (меньше — срочнее). */
export function slaHead(
  r: SlaRequest & { outcome?: string | null; resolvedAt?: number | null },
  d: { cal: WorkCalendar },
  now: number,
): SlaHeadInfo {
  if (!isOpen(r)) {
    return {
      state: 'done',
      label: 'Готово',
      text: r.outcome || 'решено',
      until: '',
      rank: 2e12 - (r.resolvedAt || 0) / 1e3,
    };
  }
  const all = slaOf(r, d, now);
  if (!all.length)
    return { state: 'none', label: 'Срок', text: 'без срока', until: '', rank: 1e12 };
  const late = all
    .filter((x) => x.state === 'late')
    .sort((a, b) => (b.over as number) - (a.over as number))[0];
  if (late) return { ...late, rank: -(late.over as number) };
  const act = all.filter((x) => x.state === 'risk' || x.state === 'norm' || x.state === 'legal');
  if (r.status === 'wait' || !act.length) {
    const lg = all.find((x) => x.key === 'legal' && x.state !== 'done');
    return {
      state: 'pause',
      label: 'Пауза',
      text: 'ждём клиента',
      until: lg ? 'по закону ' + lg.until : 'срок стоит',
      rank: 9e11,
    };
  }
  const f =
    act.find((x) => x.key === 'first') ??
    (act.slice().sort((a, b) => (a.left as number) - (b.left as number))[0] as SlaItem);
  return { ...f, rank: f.left as number };
}
