// Геометрия диаграммы Ганта (design/Ремонт и стройка.dc.html:1091–1190): масштаб по ширине,
// полосы этапов и разделов, связи-«ступеньки», паузы, месяцы, недели. Только числа в px и флаги
// состояния — цвета, шрифты и разметку выбирает страница.
import { finalStageId, variance } from './analysis.ts';
import type { WorkCalendar } from './calendar.ts';
import { isStageDone, lagOf } from './cpm.ts';
import type { Plan, ScheduleModel, ScheduleStage, StageTiming, Timings } from './types.ts';

export interface GanttInput {
  cal: WorkCalendar;
  model: ScheduleModel;
  /** Названия разделов (`ScheduleStage.ph` — индекс). */
  phases: readonly string[];
  /** Правки, по которым нарисованы связи: черновик, а без него — действующий план. */
  drawn: Plan;
  /** Расчёт по рисуемому плану (с черновиком), по действующему плану и по договору. */
  R: Timings;
  P: Timings;
  B: Timings;
  /** Ширина контейнера, px. */
  width: number;
  /** «Весь объект» (true) или «По дням» (false). */
  fit: boolean;
  selected: string | null;
  /** Включён «Критический путь». */
  critical: boolean;
  hasDraft: boolean;
}

export type Segment = { kind: 'full' | 'accepted' | 'pending'; pct: number };

export interface GanttPhaseRow {
  kind: 'phase';
  label: string;
  dates: string;
  left: number;
  width: number;
  y: number;
}

export interface GanttStageRow {
  kind: 'stage';
  id: string;
  name: string;
  y: number;
  left: number;
  width: number;
  ms: boolean;
  /** Левый край ромба вехи. */
  msLeft: number;
  meta: string;
  /** Отклонение конца этапа от договора, рабочих дней. */
  variance: number;
  hasVar: boolean;
  varText: string;
  done: boolean;
  started: boolean;
  canMove: boolean;
  canResize: boolean;
  /** Этап сдвинут черновиком. */
  changed: boolean;
  /** Погашен режимом «Критический путь». */
  dimmed: boolean;
  selected: boolean;
  segments: Segment[];
  baseLeft: number;
  baseWidth: number;
  baseMsLeft: number;
}

export type GanttRow = GanttPhaseRow | GanttStageRow;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GanttLink {
  from: string;
  to: string;
  segs: Rect[];
  arrow: { left: number; top: number };
  state: 'normal' | 'hot' | 'crit' | 'dim';
}

export interface GanttPause {
  from: string;
  to: string;
  left: number;
  width: number;
  top: number;
  labelTop: number;
  label: string;
  showLabel: boolean;
}

export interface GanttTick {
  day: number;
  left: number;
  width: number;
  label: string;
  title: string;
  today: boolean;
  holiday: boolean;
  workday: boolean;
}

export interface GanttLayout {
  days: number;
  dayW: number;
  nameW: number;
  innerW: number;
  narrow: boolean;
  side: boolean;
  height: number;
  rows: GanttRow[];
  links: GanttLink[];
  pauses: GanttPause[];
  months: { month: number; year: number; from: number; to: number; left: number; width: number }[];
  ticks: GanttTick[];
  todayX: number;
  holidays: { day: number; left: number; width: number }[];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const LINE = 1.5;
const PHASE_H = 30;
const ROW_H = 44;
const BAR_Y = 20;

const need = (t: Timings, id: string): StageTiming => {
  const r = t[id];
  if (!r) throw new Error('Нет расчёта этапа «' + id + '»');
  return r;
};

function rowFor(i: GanttInput, s: ScheduleStage, y: number, dayW: number): GanttStageRow {
  const { cal } = i;
  const r = need(i.R, s.id);
  const b0 = need(i.B, s.id);
  const done = isStageDone(s);
  const started = s.as != null && !done;
  const ms = !!s.ms;
  const vr = variance(cal, i.B, i.R, s.id);
  const p = need(i.P, s.id);
  const changed = i.hasDraft && (p.start !== r.start || p.end !== r.end);
  const segments: Segment[] = done
    ? [{ kind: 'full', pct: 100 }]
    : s.as != null
      ? [
          { kind: 'accepted', pct: (s.acc ?? 0) * 100 },
          { kind: 'pending', pct: (s.pen ?? 0) * 100 },
        ]
      : [];
  return {
    kind: 'stage',
    id: s.id,
    name: s.name,
    y,
    left: r1(r.start * dayW + 1),
    width: r1(Math.max(4, (r.end - r.start + 1) * dayW - 2)),
    ms,
    msLeft: r1((r.start + 0.5) * dayW - 7),
    meta: ms
      ? 'сдача ' + cal.dtw(r.start) + (vr > 0 ? ' · по договору ' + cal.dt(b0.start) : ' · в срок')
      : cal.dt(r.start) + '–' + cal.dt(r.end) + ' · ' + r.dur + ' дн',
    variance: vr,
    hasVar: !done && !ms && vr !== 0,
    varText: (vr > 0 ? '+' : '−') + Math.abs(vr) + ' дн',
    done,
    started,
    canMove: !ms && s.as == null,
    canResize: !ms && !done,
    changed,
    dimmed: i.critical && (done || r.fl > 0),
    selected: i.selected === s.id,
    segments,
    baseLeft: r1(b0.start * dayW + 1),
    baseWidth: r1(Math.max(4, (b0.end - b0.start + 1) * dayW - 2)),
    baseMsLeft: r1((b0.start + 0.5) * dayW - 5),
  };
}

export function ganttLayout(i: GanttInput): GanttLayout {
  const { cal, model } = i;
  const fin = finalStageId(model);
  const narrow = i.width < 640;
  const side = i.width >= 980;
  const last = Math.max(need(i.R, fin).end, need(i.P, fin).end, need(i.B, fin).end);
  const days = Math.max(63, Math.ceil((last + 6) / 7) * 7);
  const nameW = narrow ? 128 : 210;
  const chartW = (side ? i.width - 336 : i.width) - 2;
  const dayW = i.fit ? Math.max(7, (chartW - nameW) / days) : 26;

  const rows: GanttRow[] = [];
  const Y: Record<string, number> = {};
  let y = 0;
  i.phases.forEach((label, pi) => {
    const sts = model.stages.filter((s) => s.ph === pi);
    if (!sts.length) return;
    const a = Math.min(...sts.map((s) => need(i.R, s.id).start));
    const b = Math.max(...sts.map((s) => need(i.R, s.id).end));
    rows.push({
      kind: 'phase',
      label,
      dates: cal.dt(a) + '–' + cal.dt(b),
      left: r1(a * dayW + 1),
      width: r1(Math.max(4, (b - a + 1) * dayW - 2)),
      y,
    });
    y += PHASE_H;
    for (const s of sts) {
      Y[s.id] = y;
      rows.push(rowFor(i, s, y, dayW));
      y += ROW_H;
    }
  });

  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const longest: Record<string, number> = {};
  for (const l of model.links) {
    const v = lagOf(i.drawn, l);
    if (v > 0 && (!longest[l.from] || v > (longest[l.from] ?? 0))) longest[l.from] = v;
  }
  const links: GanttLink[] = [];
  const pauses: GanttPause[] = [];
  for (const l of model.links) {
    const a = need(i.R, l.from);
    const b = need(i.R, l.to);
    const sb = byId.get(l.to);
    const sa = byId.get(l.from);
    const v = lagOf(i.drawn, l);
    const hot = !!i.selected && (i.selected === l.from || i.selected === l.to);
    const crit =
      i.critical && a.fl === 0 && b.fl === 0 && b.bind === l.from && !(sa && isStageDone(sa));
    const xp = (a.end + 1) * dayW - 1;
    const yp = (Y[l.from] ?? 0) + BAR_Y;
    const xs = sb?.ms ? (b.start + 0.5) * dayW - 8 : b.start * dayW + 1;
    const ys = (Y[l.to] ?? 0) + BAR_Y;
    const segs: Rect[] = [];
    const H = (x1: number, x2: number, yy: number): void => {
      segs.push({
        left: r1(Math.min(x1, x2)),
        top: r1(yy - LINE / 2),
        width: r1(Math.abs(x2 - x1) + LINE / 2),
        height: r1(LINE),
      });
    };
    const V = (xx: number, y1: number, y2: number): void => {
      segs.push({
        left: r1(xx - LINE / 2),
        top: r1(Math.min(y1, y2)),
        width: r1(LINE),
        height: r1(Math.abs(y2 - y1)),
      });
    };
    if (xs - xp >= 12) {
      const xm = xp + 5;
      H(xp, xm, yp);
      V(xm, yp, ys);
      H(xm, xs - 6, ys);
    } else {
      const xm = xp + 5;
      const ym = yp + 22;
      const xb = xs - 9;
      H(xp, xm, yp);
      V(xm, yp, ym);
      H(xb, xm, ym);
      V(xb, ym, ys);
      H(xb, xs - 6, ys);
    }
    links.push({
      from: l.from,
      to: l.to,
      segs,
      arrow: { left: r1(xs - 6), top: r1(ys - 4) },
      state: hot ? 'hot' : crit ? 'crit' : i.critical ? 'dim' : 'normal',
    });
    if (v > 0) {
      const label = (l.note || 'пауза') + ' · ' + cal.dn(v);
      pauses.push({
        from: l.from,
        to: l.to,
        left: r1(xp + 1),
        width: r1(v * dayW),
        top: r1(yp - 3),
        labelTop: r1(yp - 17),
        label,
        showLabel: v === longest[l.from] && v * dayW >= label.length * 5.4,
      });
    }
  }

  const months: GanttLayout['months'] = [];
  for (let d = 0; d < days; d++) {
    const { month: mm, year: yy } = cal.dateParts(d);
    const prev = months[months.length - 1];
    if (!prev || prev.month !== mm) {
      months.push({ month: mm, year: yy, from: d, to: d, left: 0, width: 0 });
    } else prev.to = d;
  }
  for (const m of months) {
    m.left = r1(m.from * dayW);
    m.width = r1((m.to - m.from + 1) * dayW);
  }

  const today = cal.cfg.today;
  const ticks: GanttTick[] = i.fit
    ? Array.from({ length: Math.ceil(days / 7) }, (_, k) => {
        const d = k * 7;
        const w = Math.min(7, days - d) * dayW;
        return {
          day: d,
          left: r1(d * dayW),
          width: r1(w),
          label: w >= 40 ? cal.dt(d) : String(Number(cal.dt(d).slice(0, 2))),
          title: 'Неделя с ' + cal.dtw(d),
          today: false,
          holiday: false,
          workday: true,
        };
      })
    : Array.from({ length: days }, (_, d) => ({
        day: d,
        left: r1(d * dayW + 2),
        width: r1(dayW - 4),
        label: String(Number(cal.dt(d).slice(0, 2))),
        title: cal.isHoliday(d) ? cal.dayMonth(d) + ' — выходной' : cal.dtw(d),
        today: d === today,
        holiday: cal.isHoliday(d),
        workday: cal.isW(d),
      }));

  return {
    days,
    dayW,
    nameW,
    innerW: nameW + days * dayW,
    narrow,
    side,
    height: y,
    rows,
    links,
    pauses,
    months,
    ticks,
    todayX: r1((today + 0.5) * dayW - 1),
    holidays: cal.cfg.holidays.map((d) => ({ day: d, left: d * dayW, width: dayW })),
  };
}
