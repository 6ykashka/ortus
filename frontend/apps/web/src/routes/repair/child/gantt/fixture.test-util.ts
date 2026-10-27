// W6.23 · Фикстура ответа getSchedule для тестов модели: график кв. 42 из библиотеки W6.10 (OBJ42_*), пересчитанный
// тем же расчётом в даты ответа сервера (старт 05.10.2026, праздник 04.11, по договору 27.11, прогноз 01.12, +2 дня).
import type { components } from '@ortus/api-client';
import {
  criticalIds,
  OBJ42_LINKS,
  OBJ42_LOG,
  OBJ42_PHASES,
  OBJ42_PLAN,
  OBJ42_STAGES,
  REPAIR_CALENDAR,
  schedule,
} from '@ortus/domain/schedule';

type S = components['schemas'];

export const iso = (day: number): string => {
  const { year, month, day: d } = REPAIR_CALENDAR.dateParts(day);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Ответ getSchedule: этапы s1…s10 с исполнителями эталона; `tweak` правит этапы и связи до расчёта. */
export function scheduleFixture(
  o: {
    off?: Record<string, number>;
    dur?: Record<string, number>;
    lag?: Record<string, number>;
    revision?: number;
  } = {},
): S['Schedule'] {
  const plan = {
    off: o.off ?? OBJ42_PLAN.off,
    dur: o.dur ?? OBJ42_PLAN.dur,
    lag: o.lag ?? OBJ42_PLAN.lag,
  };
  const model = { stages: OBJ42_STAGES, links: OBJ42_LINKS };
  const t = schedule(REPAIR_CALENDAR, model, plan);
  const crit = new Set(criticalIds(model, t));
  const stages: S['ScheduleStage'][] = OBJ42_STAGES.map((s) => {
    const r = t[s.id];
    if (!r) throw new Error(s.id);
    return {
      id: s.id,
      phase: OBJ42_PHASES[s.ph ?? 0] ?? '',
      name: s.name,
      startOn: iso(r.start),
      endOn: iso(r.end),
      durationWd: r.dur,
      offsetWd: plan.off[s.id] ?? 0,
      slackWd: r.fl,
      critical: crit.has(s.id) || r.fl === 0,
      status: s.id === 's1' ? 'done' : s.id === 's2' ? 'started' : 'planned',
      ...(s.who ? { executorName: s.who } : {}),
    };
  });
  const fin = t['s10'];
  return {
    projectId: 'p-42',
    stages,
    links: OBJ42_LINKS.map((l) => ({
      fromStageId: l.from,
      toStageId: l.to,
      lagDays: plan.lag[l.from + '>' + l.to] ?? l.lag,
      ...(l.note ? { note: l.note } : {}),
    })),
    baseline: { version: 1, dueOn: '2026-11-27', approvedAt: '2026-10-01T09:00:00Z' },
    forecastDueOn: iso(fin?.end ?? 0),
    delayWd: 2,
    holidays: ['2026-11-04'],
    issues: [],
    changes: OBJ42_LOG.map((e, i) => ({
      id: 'c' + i,
      at: e.at === '16.10' ? '2026-10-16T10:00:00Z' : '2026-10-01T09:00:00Z',
      authorName: e.who,
      text: e.text,
      ...(e.reason ? { reason: 'executor_busy' as const } : {}),
    })),
    revision: o.revision ?? 3,
  };
}

/** «Сегодня» эталона — 20 октября 2026, полдень по Москве. */
export const TODAY_NOW = new Date('2026-10-20T12:00:00+03:00');
