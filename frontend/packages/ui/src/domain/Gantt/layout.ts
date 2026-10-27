// Геометрия диаграммы в px по ISO-датам пропсов (аналог lib/schedule/gantt.ts домена, но без домена: @ortus/ui его
// не знает). Масштаб по ширине, полосы этапов и разделов, «ступеньки» связей, паузы, месяцы и шкала.
import type { GanttProps, GanttStage } from '../../types';
import { dayNum, dayOfMonth, ddmm, ddmmWd, monthName, monthOf, weekdayOf } from './dates';

export const PHASE_H = 30;
export const ROW_H = 44;
const BAR_Y = 20;
const LINE = 1.5;

const r1 = (v: number): number => Math.round(v * 10) / 10;

export interface StageRowGeo {
  kind: 'stage';
  stage: GanttStage;
  y: number;
  s: number;
  e: number;
  left: number;
  width: number;
  msLeft: number;
  baseLeft: number;
  baseWidth: number;
  baseMsLeft: number;
  hasBase: boolean;
}

export interface PhaseRowGeo {
  kind: 'phase';
  label: string;
  dates: string;
  y: number;
  left: number;
  width: number;
}

export type RowGeo = StageRowGeo | PhaseRowGeo;

export interface LinkGeo {
  key: string;
  d: string;
  arrow: string;
  state: 'normal' | 'hot' | 'crit' | 'dim';
  width: number;
}

export interface PauseGeo {
  key: string;
  left: number;
  width: number;
  top: number;
  labelTop: number;
  label: string;
  fits: boolean;
}

export interface Tick {
  day: number;
  left: number;
  width: number;
  label: string;
  title: string;
  today: boolean;
  workday: boolean;
  weekend: boolean;
  holiday: boolean;
}

export interface GanttGeo {
  /** Номер дня первой колонки (понедельник). */
  d0: number;
  days: number;
  dayW: number;
  nameW: number;
  tlW: number;
  innerW: number;
  narrow: boolean;
  height: number;
  rows: RowGeo[];
  links: LinkGeo[];
  pauses: PauseGeo[];
  months: { key: string; label: string; left: number; width: number }[];
  ticks: Tick[];
  todayX: number;
  todayIdx: number;
  /** Колонки выходных и праздников (индексы дней от `d0`). */
  weekendDays: number[];
  holidayDays: number[];
}

export function ganttGeo(p: GanttProps, width: number, holidays: Set<number>): GanttGeo {
  const today = dayNum(p.today);
  const starts = p.stages.flatMap((s) => [
    dayNum(s.start),
    ...(s.baseline ? [dayNum(s.baseline.start)] : []),
  ]);
  const ends = p.stages.flatMap((s) => [
    dayNum(s.end),
    ...(s.baseline ? [dayNum(s.baseline.end)] : []),
    ...(s.paused ?? []).map((x) => dayNum(x.end)),
  ]);
  const first = Math.min(today, ...starts);
  const d0 = first - ((weekdayOf(first) + 6) % 7);
  const last = Math.max(today, ...ends);
  const days = Math.max(63, Math.ceil((last - d0 + 6) / 7) * 7);
  const narrow = width < 640;
  const nameW = narrow ? 128 : 210;
  const chartW = width - 2;
  const dayW = p.zoom === 'fit' ? Math.max(7, (chartW - nameW) / days) : 26;
  const tlW = r1(days * dayW);

  const rows: RowGeo[] = [];
  const Y = new Map<string, number>();
  const geo = new Map<string, StageRowGeo>();
  let y = 0;
  const phases: (string | undefined)[] = [];
  for (const s of p.stages) if (!phases.includes(s.phase)) phases.push(s.phase);
  for (const ph of phases) {
    const sts = p.stages.filter((s) => s.phase === ph);
    if (ph) {
      const a = Math.min(...sts.map((s) => dayNum(s.start)));
      const b = Math.max(...sts.map((s) => dayNum(s.end)));
      rows.push({
        kind: 'phase',
        label: ph,
        dates: ddmm(a) + '–' + ddmm(b),
        y,
        left: r1((a - d0) * dayW + 1),
        width: r1(Math.max(4, (b - a + 1) * dayW - 2)),
      });
      y += PHASE_H;
    }
    for (const s of sts) {
      const a = dayNum(s.start) - d0;
      const b = dayNum(s.end) - d0;
      const ba = s.baseline ? dayNum(s.baseline.start) - d0 : a;
      const bb = s.baseline ? dayNum(s.baseline.end) - d0 : b;
      const row: StageRowGeo = {
        kind: 'stage',
        stage: s,
        y,
        s: a,
        e: b,
        left: r1(a * dayW + 1),
        width: r1(Math.max(4, (b - a + 1) * dayW - 2)),
        msLeft: r1((a + 0.5) * dayW - 7),
        baseLeft: r1(ba * dayW + 1),
        baseWidth: r1(Math.max(4, (bb - ba + 1) * dayW - 2)),
        baseMsLeft: r1((ba + 0.5) * dayW - 5),
        hasBase: Boolean(s.baseline),
      };
      rows.push(row);
      Y.set(s.id, y);
      geo.set(s.id, row);
      y += ROW_H;
    }
  }

  const links: LinkGeo[] = [];
  const num = (v: number): string => String(r1(v));
  for (const l of p.links) {
    const a = geo.get(l.from);
    const b = geo.get(l.to);
    if (!a || !b) continue;
    const hot = !!p.selected && (p.selected === l.from || p.selected === l.to);
    const crit = !!p.criticalMode && !!a.stage.critical && !!b.stage.critical;
    const xp = (a.e + 1) * dayW - 1;
    const yp = a.y + BAR_Y;
    const xs = b.stage.milestone ? (b.s + 0.5) * dayW - 8 : b.s * dayW + 1;
    const ys = b.y + BAR_Y;
    const xm = xp + 5;
    const d =
      xs - xp >= 12
        ? `M${num(xp)} ${num(yp)}H${num(xm)}V${num(ys)}H${num(xs - 6)}`
        : `M${num(xp)} ${num(yp)}H${num(xm)}V${num(yp + 22)}H${num(xs - 9)}V${num(ys)}H${num(xs - 6)}`;
    links.push({
      key: l.from + '>' + l.to,
      d,
      arrow: `${num(xs - 6)} ${num(ys - 4)},${num(xs)} ${num(ys)},${num(xs - 6)} ${num(ys + 4)}`,
      state: hot ? 'hot' : crit ? 'crit' : p.criticalMode ? 'dim' : 'normal',
      width: hot ? 2 : LINE,
    });
  }

  const pauses: PauseGeo[] = [];
  for (const s of p.stages) {
    const yy = (Y.get(s.id) ?? 0) + BAR_Y;
    for (const [i, x] of (s.paused ?? []).entries()) {
      const a = dayNum(x.start) - d0;
      const b = dayNum(x.end) - d0;
      const w = (b - a + 1) * dayW;
      const label = x.label ?? '';
      pauses.push({
        key: s.id + ':' + i,
        left: r1(a * dayW),
        width: r1(w),
        top: r1(yy - 3),
        labelTop: r1(yy - 17),
        label,
        fits: w >= label.length * 5.4,
      });
    }
  }

  const months: GanttGeo['months'] = [];
  const spans: { month: number; year: number; from: number; to: number }[] = [];
  for (let d = 0; d < days; d++) {
    const m = monthOf(d0 + d);
    const prev = spans[spans.length - 1];
    if (!prev || prev.month !== m.month || prev.year !== m.year) {
      spans.push({ ...m, from: d, to: d });
    } else prev.to = d;
  }
  for (const [i, m] of spans.entries()) {
    const w = (m.to - m.from + 1) * dayW;
    months.push({
      key: m.year + '-' + m.month,
      // Год — только у первого месяца шкалы и у января (эталон :1186: «Октябрь 2026», дальше без года).
      label: monthName(m.month, m.year, w < 90, i === 0 || m.month === 0),
      left: r1(m.from * dayW),
      width: r1(w),
    });
  }

  const todayIdx = today - d0;
  const ticks: Tick[] =
    p.zoom === 'fit'
      ? Array.from({ length: Math.ceil(days / 7) }, (_, k) => {
          const d = k * 7;
          const w = Math.min(7, days - d) * dayW;
          return {
            day: d,
            left: r1(d * dayW),
            width: r1(w),
            label: w >= 40 ? ddmm(d0 + d) : String(dayOfMonth(d0 + d)),
            title: 'Неделя с ' + ddmmWd(d0 + d),
            today: false,
            workday: true,
            weekend: false,
            holiday: false,
          };
        })
      : Array.from({ length: days }, (_, d) => {
          const n = d0 + d;
          const hol = holidays.has(n);
          const weekend = p.calendar.weekends.includes(weekdayOf(n));
          return {
            day: d,
            left: r1(d * dayW + 2),
            width: r1(dayW - 4),
            label: String(dayOfMonth(n)),
            title: hol ? ddmm(n) + ' — выходной' : ddmmWd(n),
            today: d === todayIdx,
            workday: !hol && !weekend,
            weekend,
            holiday: hol,
          };
        });

  const weekendDays: number[] = [];
  const holidayDays: number[] = [];
  for (let d = 0; d < days; d++) {
    const n = d0 + d;
    if (holidays.has(n)) holidayDays.push(d);
    else if (p.calendar.weekends.includes(weekdayOf(n))) weekendDays.push(d);
  }

  return {
    d0,
    days,
    dayW,
    nameW,
    tlW,
    innerW: r1(nameW + tlW),
    narrow,
    height: y,
    rows,
    links,
    pauses,
    months,
    ticks,
    todayX: r1((todayIdx + 0.5) * dayW - 1),
    todayIdx,
    weekendDays,
    holidayDays,
  };
}
