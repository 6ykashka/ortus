// W6.23 · Представление графика для разметки: этапы диаграммы `@ortus/ui` Gantt, чипы и данные панели этапа
// (design/Ремонт и стройка.dc.html :1123–1286). Считает по плану или по черновику (`plan`), «по договору» — `v.B`.
import type { GanttStage } from '@ortus/ui';
import {
  conflictsOf,
  isStageDone,
  lagOf,
  minDuration,
  type Plan,
  type ScheduleStage,
  stageIssues,
  stageState,
  variance,
} from '@ortus/domain/schedule';

import { type Chip, chip, isoOf, type ScheduleView, timingsOf } from './model.ts';

export const CRIT: Chip = { ...chip('Критический путь', 'neutral', 'priority_high'), strong: true };

const tone = (t: 'warn' | 'danger'): 'warn' | 'danger' => t;

export interface StageViewOpts {
  /** Есть несохранённый черновик: сдвинутые им этапы помечаются. */
  draft: boolean;
  canShift: boolean;
}

/** Этапы диаграммы по плану или черновику. */
export function ganttStagesOf(v: ScheduleView, plan: Plan, o: StageViewOpts): GanttStage[] {
  const { cal, model } = v;
  const R = timingsOf(v, plan);
  const conf = conflictsOf({
    cal,
    model,
    T: R,
    whoOf: (s) => s.who ?? '',
    supplyOf: () => null,
  });
  return model.stages.map((s) => {
    const r = R[s.id];
    const p = v.P[s.id];
    const b = v.B[s.id];
    if (!r || !p || !b) throw new Error('Нет расчёта этапа «' + s.id + '»');
    const done = isStageDone(s);
    const ms = Boolean(s.ms);
    const vr = variance(cal, v.B, R, s.id);
    const issues = [
      ...stageIssues(
        { cal, model, T: R, whoOf: (x) => x.who ?? '', supplyOf: () => null },
        s,
        conf,
      ),
      ...v.materials.filter((m) => m.id === s.id),
    ];
    const paused = model.links
      .filter((l) => l.from === s.id && lagOf(plan, l) > 0)
      .map((l) => {
        const lag = lagOf(plan, l);
        return {
          start: isoOf(cal, r.end + 1),
          end: isoOf(cal, r.end + lag),
          label: (l.note || 'пауза') + ' · ' + cal.dn(lag),
        };
      });
    const out: GanttStage = {
      id: s.id,
      title: s.name,
      start: isoOf(cal, r.start),
      end: isoOf(cal, r.end),
      kind: done ? 'accepted' : 'plan',
      baseline: { start: isoOf(cal, b.start), end: isoOf(cal, b.end) },
      phase: v.phases[s.ph ?? 0] ?? '',
      critical: !done && r.fl === 0,
      meta: ms
        ? 'сдача ' + cal.dtw(r.start) + (vr > 0 ? ' · по договору ' + cal.dt(b.start) : ' · в срок')
        : cal.dt(r.start) + '–' + cal.dt(r.end) + ' · ' + r.dur + ' дн',
      canMove: o.canShift && !ms && s.as == null,
      canResize: o.canShift && !ms && !done,
      changed: o.draft && (p.start !== r.start || p.end !== r.end),
    };
    if (ms) out.milestone = true;
    if (paused.length) out.paused = paused;
    if (!done && !ms && vr !== 0) {
      out.variance = {
        text: (vr > 0 ? '+' : '−') + Math.abs(vr) + ' дн',
        tone: vr > 0 ? 'warn' : 'ok',
      };
    }
    if (issues.length) {
      out.marks = issues.map((i) => ({ icon: i.icon, label: i.text, tone: tone(i.tone) }));
    }
    return out;
  });
}

/** Чип состояния этапа в панели (`stat` эталона). */
export function stateChip(v: ScheduleView, s: ScheduleStage, plan: Plan): Chip {
  const R = timingsOf(v, plan);
  const { kind, days } = stageState(v.cal, s, v.B, R, false);
  const wdn = (n: number): string => v.cal.wdn(n);
  switch (kind) {
    case 'closed':
      return chip('Закрыто актом', 'ok', 'verified');
    case 'done':
      return chip('Выполнено и принято', 'ok', 'check_circle');
    case 'late-running':
      return chip('Отстаёт на ' + wdn(days), 'warn', 'running_with_errors');
    case 'running':
      return chip('В работе', 'info', 'progress_activity');
    case 'milestone':
      return chip('Веха', 'neutral', 'flag');
    case 'shifted':
      return chip('Сдвинут на ' + wdn(days), 'warn', 'schedule');
    case 'early':
      return chip('Раньше плана на ' + wdn(days), 'ok', 'fast_forward');
    default:
      return chip('Не начат', 'neutral', 'radio_button_unchecked');
  }
}

export interface PredRow {
  from: string;
  name: string;
  lag: string;
  value: number;
  canEdit: boolean;
  minusOff: boolean;
  plusOff: boolean;
  fromId: string;
  toId: string;
}

export interface StagePanel {
  stage: ScheduleStage;
  name: string;
  chips: Chip[];
  ms: boolean;
  done: boolean;
  started: boolean;
  dates: string;
  durText: string;
  baseText: string;
  varChip: Chip;
  progText: string;
  canStart: boolean;
  startText: string;
  startMinusOff: boolean;
  startHint: string;
  fixed: string;
  canDur: boolean;
  durVal: string;
  durMinusOff: boolean;
  durHint: string;
  preds: PredRow[];
  succs: { id: string; name: string }[];
  who: string;
  hasWho: boolean;
  conflict: string;
  whoNote: string;
  needText: string;
  materials: string[];
  hasEstimate: boolean;
  min: number;
}

/** Данные панели этапа по плану или черновику. */
export function stagePanelOf(v: ScheduleView, plan: Plan, id: string): StagePanel | null {
  const { cal, model } = v;
  const today = cal.cfg.today;
  const X = model.stages.find((s) => s.id === id);
  if (!X) return null;
  const R = timingsOf(v, plan);
  const r = R[id];
  const b = v.B[id];
  if (!r || !b) return null;
  const done = isStageDone(X);
  const started = X.as != null && !done;
  const ms = Boolean(X.ms);
  const curDur = plan.dur[id] ?? X.dur;
  const curOff = plan.off[id] ?? 0;
  const min = minDuration(cal, X, today);
  const vr = variance(cal, v.B, R, id);
  const bindL = model.links.find((l) => l.from === r.bind && l.to === id);
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const startHint =
    curOff === 0 && bindL
      ? 'Раньше нельзя: этап ждёт «' +
        (byId.get(bindL.from)?.name ?? '') +
        '»' +
        (lagOf(plan, bindL) !== 0 ? ', ' + cal.lagTxt(lagOf(plan, bindL)) : '') +
        '.'
      : curOff > 0
        ? 'Отложен на ' + cal.wdn(curOff) + ' после готовности предыдущих этапов.'
        : '';
  const preds = model.links.filter((l) => l.to === id);
  const conf = conflictsOf({ cal, model, T: R, whoOf: (s) => s.who ?? '', supplyOf: () => null });
  const other = conf[id] ? byId.get(conf[id]) : undefined;
  const orow = other ? R[other.id] : undefined;
  return {
    stage: X,
    name: X.name,
    chips: [
      stateChip(v, X, plan),
      ...(done
        ? []
        : [r.fl === 0 ? CRIT : chip('Запас ' + cal.wdn(r.fl), 'ok', 'hourglass_empty')]),
    ],
    ms,
    done,
    started,
    dates: ms ? cal.dtw(r.start) : cal.dtw(r.start) + ' → ' + cal.dtw(r.end),
    durText: ms ? 'Веха графика' : cal.wdn(r.dur),
    baseText: 'По договору: ' + (ms ? cal.dtw(b.start) : cal.dt(b.start) + ' → ' + cal.dt(b.end)),
    varChip:
      vr > 0
        ? chip('+' + cal.wdn(vr), 'warn', 'schedule')
        : vr < 0
          ? chip('−' + cal.wdn(-vr), 'ok', 'fast_forward')
          : chip('по плану', 'ok', 'check'),
    progText: done
      ? 'Выполнено и принято.'
      : started
        ? 'По плану на сегодня ' +
          Math.round((cal.wdIn((X.as ?? 0) - 1, today) / Math.max(1, r.dur)) * 100) +
          '%.'
        : '',
    canStart: !done && !started && !ms,
    startText: cal.dtw(r.start),
    startMinusOff: curOff === 0,
    startHint,
    fixed: started ? 'Начало ' + cal.dtw(r.start) + ' — фактическое, его не сдвинуть.' : '',
    canDur: !done && !ms,
    durVal: cal.wdn(curDur),
    durMinusOff: curDur <= min,
    durHint: started
      ? 'Этап идёт: закончить можно не раньше ' + cal.dtw(cal.addW(X.as ?? 0, min)) + '.'
      : '',
    preds: preds.map((l) => {
      const lag = lagOf(plan, l);
      return {
        from: byId.get(l.from)?.name ?? '',
        name: byId.get(l.from)?.name ?? '',
        lag:
          cal.lagTxt(lag) +
          (l.note ? ' · ' + l.note : '') +
          (preds.length > 1 && r.bind === l.from ? ' · определяет начало' : ''),
        value: lag,
        // Сервер применяет паузу к связи, определяющей начало этапа в сохранённом графике.
        canEdit: !done && !started && v.P[id]?.bind === l.from,
        minusOff: lag <= -5,
        plusOff: lag >= 30,
        fromId: l.from,
        toId: l.to,
      };
    }),
    succs: model.links
      .filter((l) => l.from === id)
      .map((l) => ({ id: l.to, name: byId.get(l.to)?.name ?? '' })),
    who: X.who ?? '',
    hasWho: !ms && !done,
    conflict:
      other && orow
        ? (X.who ?? '') +
          ' в эти дни на этапе «' +
          other.name +
          '» (' +
          cal.dt(orow.start) +
          '–' +
          cal.dt(orow.end) +
          ').'
        : '',
    whoNote: X.who ? 'Исполнитель получит уведомление при переносе этапа.' : '',
    needText: X.who ? '' : 'Назначьте исполнителя до ' + cal.dtw(r.start) + '.',
    materials: v.materials.filter((m) => m.id === id).map((m) => m.text),
    hasEstimate: Boolean(v.sectionOf[id]),
    min,
  };
}
