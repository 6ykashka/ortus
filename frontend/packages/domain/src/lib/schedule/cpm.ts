// Расчёт графика (design/Ремонт и стройка.dc.html:973–997): прямой проход — раннее начало по
// связям «окончание → начало» с паузой или опережением, обратный — позднее окончание и запас
// (`fl`); `bind` — предшественник, определяющий начало. Критический путь — этапы без запаса.
// Правки плана (`gEdit`, перетаскивание) — чистые функции над копией плана.
import type { WorkCalendar } from './calendar.ts';
import type {
  Plan,
  ScheduleLink,
  ScheduleModel,
  ScheduleStage,
  StageTiming,
  Timings,
} from './types.ts';

export const EMPTY_PLAN = (): Plan => ({ off: {}, dur: {}, lag: {} });

export const linkKey = (l: Pick<ScheduleLink, 'from' | 'to'>): string => l.from + '>' + l.to;

/** Пауза по связи с учётом правки плана (`lagOf`). */
export const lagOf = (plan: Plan | null, l: ScheduleLink): number => plan?.lag[linkKey(l)] ?? l.lag;

/** Этап выполнен и принят целиком (`isDone` эталона). */
export const isStageDone = (s: ScheduleStage): boolean => (s.acc ?? 0) >= 1;

/**
 * Этапы в порядке, допустимом для прохода: предшественники раньше последователей. Если вход уже
 * упорядочен, порядок не меняется. Неизвестный этап в связи и цикл — ошибка.
 */
export function topoOrder(model: ScheduleModel): ScheduleStage[] {
  const ids = new Set(model.stages.map((s) => s.id));
  for (const l of model.links) {
    for (const id of [l.from, l.to]) {
      if (!ids.has(id)) throw new Error('Связь «' + linkKey(l) + '»: этап «' + id + '» не найден');
    }
  }
  const placed = new Set<string>();
  const out: ScheduleStage[] = [];
  const rest = [...model.stages];
  while (rest.length) {
    const i = rest.findIndex((s) => model.links.every((l) => l.to !== s.id || placed.has(l.from)));
    if (i < 0) throw new Error('В графике цикл связей между этапами');
    const [s] = rest.splice(i, 1);
    if (s) {
      placed.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** Расчёт всех этапов по плану; `plan = null` — базовый план (по договору). */
export function schedule(cal: WorkCalendar, model: ScheduleModel, plan: Plan | null): Timings {
  const order = topoOrder(model);
  const R: Record<string, StageTiming> = {};
  for (const st of order) {
    let es = 0;
    let bind: string | null = null;
    for (const l of model.links) {
      if (l.to !== st.id) continue;
      const prev = R[l.from];
      if (!prev) continue;
      const v = cal.fw(prev.end + 1 + lagOf(plan, l));
      if (bind === null || v > es) {
        es = v;
        bind = l.from;
      }
    }
    es = cal.fw(es);
    const dur = st.ms ? 1 : (plan?.dur[st.id] ?? st.dur);
    const start = plan && st.as != null ? st.as : cal.shW(es, plan ? (plan.off[st.id] ?? 0) : 0);
    R[st.id] = {
      es,
      bind,
      dur,
      start,
      end: st.ms ? start : cal.addW(start, dur),
      lf: 0,
      ls: 0,
      fl: 0,
    };
  }
  const sinks = order.filter((s) => !model.links.some((l) => l.from === s.id));
  const fin = Math.max(...sinks.map((s) => R[s.id]?.end ?? 0));
  for (const st of [...order].reverse()) {
    const r = R[st.id];
    if (!r) continue;
    const outs = model.links.filter((l) => l.from === st.id);
    r.lf = outs.length
      ? Math.min(...outs.map((l) => cal.pw((R[l.to]?.ls ?? 0) - 1 - lagOf(plan, l))))
      : fin;
    r.ls = st.ms ? r.lf : cal.subW(r.lf, r.dur);
    r.fl = cal.wdIn(r.end, r.lf);
  }
  return R;
}

/** Критический путь: невыполненные этапы без запаса, в порядке этапов модели. */
export function criticalIds(
  model: ScheduleModel,
  t: Timings,
  isDone: (s: ScheduleStage) => boolean = isStageDone,
): string[] {
  return model.stages.filter((s) => !isDone(s) && t[s.id]?.fl === 0).map((s) => s.id);
}

const sorted = (o: Record<string, number>, keep: (k: string, v: number) => boolean) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([k, v]) => keep(k, v))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );

/** Убирает из плана значения по умолчанию и сортирует ключи (`gnorm`). */
export function normalizePlan(model: ScheduleModel, plan: Plan): Plan {
  const stage = new Map(model.stages.map((s) => [s.id, s]));
  const link = new Map(model.links.map((l) => [linkKey(l), l]));
  return {
    off: sorted(plan.off, (_k, v) => v > 0),
    dur: sorted(plan.dur, (k, v) => v !== stage.get(k)?.dur),
    lag: sorted(plan.lag, (k, v) => v !== link.get(k)?.lag),
  };
}

export const planEquals = (model: ScheduleModel, a: Plan, b: Plan): boolean =>
  JSON.stringify(normalizePlan(model, a)) === JSON.stringify(normalizePlan(model, b));

/** Черновик после правки: нормализован; совпал с действующим планом — `null` (`gEdit`). */
export function draftAfter(model: ScheduleModel, plan: Plan, draft: Plan): Plan | null {
  return planEquals(model, draft, plan) ? null : normalizePlan(model, draft);
}

const copy = (p: Plan): Plan => structuredClone(p);

/** Начало этапа ±n рабочих дней после готовности предшественников. */
export function bumpOffset(plan: Plan, id: string, delta: number): Plan {
  const q = copy(plan);
  q.off[id] = Math.max(0, (q.off[id] ?? 0) + delta);
  return q;
}

/** Минимальная длительность: у идущего этапа — уже прошедшие рабочие дни, иначе 1. */
export function minDuration(cal: WorkCalendar, stage: ScheduleStage, today: number): number {
  return stage.as != null && !isStageDone(stage) ? cal.wdIn(stage.as - 1, today) + 1 : 1;
}

export function bumpDuration(plan: Plan, stage: ScheduleStage, min: number, delta: number): Plan {
  const q = copy(plan);
  q.dur[stage.id] = Math.max(min, (q.dur[stage.id] ?? stage.dur) + delta);
  return q;
}

export const LAG_MIN = -5;
export const LAG_MAX = 30;

export function bumpLag(plan: Plan, link: ScheduleLink, delta: number): Plan {
  const q = copy(plan);
  q.lag[linkKey(link)] = Math.min(LAG_MAX, Math.max(LAG_MIN, lagOf(q, link) + delta));
  return q;
}

/** Перетаскивание полосы: начало сдвигается на `dx` дней, но не раньше раннего начала. */
export function dragMove(
  cal: WorkCalendar,
  plan: Plan,
  id: string,
  t: StageTiming,
  dx: number,
): Plan {
  const q = copy(plan);
  q.off[id] = cal.wdIn(t.es, Math.max(cal.fw(t.start + dx), t.es));
  return q;
}

/** Минимальное окончание при растягивании: у идущего этапа — не раньше завтрашнего рабочего дня. */
export function dragMinEnd(
  cal: WorkCalendar,
  started: boolean,
  start: number,
  today: number,
): number {
  return started ? Math.max(start, cal.fw(today + 1)) : start;
}

/** Перетаскивание правого края: окончание на `dx` дней, не раньше `minEnd`. */
export function dragResize(
  cal: WorkCalendar,
  plan: Plan,
  id: string,
  t: StageTiming,
  dx: number,
  minEnd: number,
): Plan {
  const q = copy(plan);
  q.dur[id] = cal.wdIn(t.start - 1, Math.max(cal.pw(t.end + dx), minEnd));
  return q;
}
