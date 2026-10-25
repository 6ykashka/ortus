// Анализ графика: конфликты исполнителя, «Требует внимания», предпросмотр переноса, сводка,
// состояние этапа и окна «Ближайшие 3 недели» (design/Ремонт и стройка.dc.html:1108–1121,
// 1191–1226, 1228–1286, 1664). Тексты — дословно из эталона; дату сдачи и «сегодня» задаёт календарь.
import type { WorkCalendar } from './calendar.ts';
import { isStageDone, lagOf, schedule, topoOrder } from './cpm.ts';
import type {
  Plan,
  ScheduleLogEntry,
  ScheduleModel,
  ScheduleStage,
  StageIssue,
  SupplyRef,
  Timings,
} from './types.ts';

export interface StageContext {
  cal: WorkCalendar;
  model: ScheduleModel;
  /** Расчёт плана или черновика, по которому строится экран. */
  T: Timings;
  /** Исполнитель этапа с учётом правок («Не назначен» — пустая строка). */
  whoOf(s: ScheduleStage): string;
  supplyOf(s: ScheduleStage): SupplyRef | null | undefined;
  isDone?(s: ScheduleStage): boolean;
}

const done = (c: StageContext, s: ScheduleStage): boolean => (c.isDone ?? isStageDone)(s);
const timing = (t: Timings, id: string) => {
  const r = t[id];
  if (!r) throw new Error('Нет расчёта этапа «' + id + '»');
  return r;
};

/** Последний этап графика — веха сдачи: этап без последователей, поздний по порядку. */
export function finalStageId(model: ScheduleModel): string {
  const sinks = topoOrder(model).filter((s) => !model.links.some((l) => l.from === s.id));
  const last = sinks[sinks.length - 1];
  if (!last) throw new Error('В графике нет этапов');
  return last.id;
}

/** Рабочих дней, на которые окончание в `b` позже окончания в `a` (отрицательно — раньше). */
export function variance(cal: WorkCalendar, a: Timings, b: Timings, id: string): number {
  const x = timing(a, id).end;
  const y = timing(b, id).end;
  return y >= x ? cal.wdIn(x, y) : -cal.wdIn(y, x);
}

/** Этапы одного исполнителя, чьи даты пересекаются: id → id второго этапа пары. */
export function conflictsOf(c: StageContext): Record<string, string> {
  const out: Record<string, string> = {};
  const st = c.model.stages;
  st.forEach((a, i) => {
    st.forEach((b, j) => {
      if (j <= i || a.ms || b.ms || done(c, a) || done(c, b)) return;
      const wa = c.whoOf(a);
      const ra = timing(c.T, a.id);
      const rb = timing(c.T, b.id);
      if (wa && wa === c.whoOf(b) && ra.start <= rb.end && rb.start <= ra.end) {
        out[a.id] = b.id;
        out[b.id] = a.id;
      }
    });
  });
  return out;
}

const supplyText = (sp: SupplyRef): string =>
  sp.st === 'ordered'
    ? 'в закупке ' + (sp.pur ?? '') + ', ещё не привезли'
    : sp.st === 'reserved'
      ? 'в резерве на складе, прораб ещё не забрал'
      : 'не закуплено';

/** «Требует внимания» по этапу: нет исполнителя, нет материала, исполнитель занят. */
export function stageIssues(
  c: StageContext,
  s: ScheduleStage,
  conf: Record<string, string> = conflictsOf(c),
): StageIssue[] {
  if (done(c, s) || s.ms) return [];
  const r = timing(c.T, s.id);
  const sp = c.supplyOf(s);
  const out: StageIssue[] = [];
  const add = (icon: string, tone: StageIssue['tone'], short: string, text: string): void => {
    out.push({ id: s.id, icon, tone, short, text, start: r.start });
  };
  if (!c.whoOf(s)) {
    add(
      'person_off',
      'warn',
      'Нет исполнителя',
      '«' + s.name + '»: не назначен исполнитель, начало ' + c.cal.dtw(r.start),
    );
  }
  if (sp && (sp.st === 'request' || sp.st === 'ordered' || sp.st === 'reserved')) {
    add(
      'inventory_2',
      'warn',
      'Материала нет на объекте',
      '«' +
        s.name +
        '»: ' +
        supplyText(sp) +
        ' — ' +
        sp.item +
        ', ' +
        String(sp.qty) +
        ' (заявка ' +
        sp.id +
        '), нужно к ' +
        c.cal.dt(r.start),
    );
  }
  const other = conf[s.id] ? c.model.stages.find((x) => x.id === conf[s.id]) : undefined;
  if (other) {
    add(
      'event_busy',
      'danger',
      'Исполнитель занят',
      '«' + s.name + '»: ' + c.whoOf(s) + ' в эти дни на этапе «' + other.name + '»',
    );
  }
  return out;
}

/** Все записи внимания по графику, по возрастанию даты начала. */
export function allIssues(c: StageContext): StageIssue[] {
  const conf = conflictsOf(c);
  return c.model.stages.flatMap((s) => stageIssues(c, s, conf)).sort((a, b) => a.start - b.start);
}

export interface PreviewInput {
  cal: WorkCalendar;
  model: ScheduleModel;
  /** Действующий план и черновик правок. */
  plan: Plan;
  draft: Plan;
  whoOf(s: ScheduleStage): string;
  /** Имя заказчика в дательном падеже для строки «Уведомим…». */
  clientName: string;
}

export interface Preview {
  /** «…: длительность 12 → 15 раб. дней. …»; без правок — «.». */
  lines: string;
  hasEdits: boolean;
  moved: string;
  endTxt: string;
  /** Сдача позже договора. */
  late: boolean;
  endChanged: boolean;
  notify: string;
  notifyWho: string[];
  /** Текст записи в «Историю изменений». */
  logText: string;
}

/** Баннер «Предпросмотр изменения — ещё не сохранено» (`dr` эталона). */
export function previewChange(i: PreviewInput): Preview {
  const { cal, model } = i;
  const fin = finalStageId(model);
  const P = schedule(cal, model, i.plan);
  const R = schedule(cal, model, i.draft);
  const due = timing(schedule(cal, model, null), fin).end;
  const lines: string[] = [];
  const edited = new Set<string>();
  for (const s of model.stages) {
    const d0 = i.plan.dur[s.id] ?? s.dur;
    const d1 = i.draft.dur[s.id] ?? s.dur;
    if (d0 !== d1) {
      lines.push('«' + s.name + '»: длительность ' + d0 + ' → ' + cal.wdn(d1));
      edited.add(s.id);
    }
    if ((i.plan.off[s.id] ?? 0) !== (i.draft.off[s.id] ?? 0)) {
      lines.push(
        '«' +
          s.name +
          '»: начало ' +
          cal.dt(timing(P, s.id).start) +
          ' → ' +
          cal.dt(timing(R, s.id).start),
      );
      edited.add(s.id);
    }
  }
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  for (const l of model.links) {
    const a0 = lagOf(i.plan, l);
    const a1 = lagOf(i.draft, l);
    if (a0 !== a1) {
      lines.push(
        '«' +
          (byId.get(l.from)?.name ?? l.from) +
          '» → «' +
          (byId.get(l.to)?.name ?? l.to) +
          '»: ' +
          cal.lagTxt(a0) +
          ' → ' +
          cal.lagTxt(a1),
      );
      edited.add(l.to);
    }
  }
  const moved = model.stages.filter(
    (s) =>
      !edited.has(s.id) &&
      (timing(P, s.id).start !== timing(R, s.id).start ||
        timing(P, s.id).end !== timing(R, s.id).end),
  );
  const e0 = timing(P, fin).end;
  const e1 = timing(R, fin).end;
  const late = e1 > due;
  const endTxt =
    e0 === e1
      ? 'Дата сдачи не меняется: ' + cal.dtw(e1) + '.'
      : 'Сдача: ' +
        cal.dtw(e0) +
        ' → ' +
        cal.dtw(e1) +
        (late
          ? ' — позже договора на ' + cal.wdn(cal.wdIn(due, e1)) + '.'
          : ' — в срок по договору.');
  const notifyWho = [
    ...new Set(
      model.stages
        .filter((s) => edited.has(s.id) || moved.includes(s))
        .map((s) => i.whoOf(s))
        .filter(Boolean),
    ),
  ];
  return {
    lines: lines.join('. ') + '.',
    hasEdits: lines.length > 0,
    moved: moved.length
      ? 'Сдвинутся следом: ' + moved.map((s) => s.name).join(', ') + '.'
      : 'Другие этапы не сдвигаются.',
    endTxt,
    late,
    endChanged: e0 !== e1,
    notify:
      'Уведомим: ' +
      (notifyWho.length ? notifyWho.join(', ') : 'исполнителей нет') +
      (e0 !== e1 ? '; заказчика ' + i.clientName + ' — меняется дата сдачи.' : '.'),
    notifyWho,
    logText: lines.join('. ') + (e0 !== e1 ? '. ' + endTxt.slice(0, -1) : ''),
  };
}

const lf1 = (t: string): string => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');

export interface SummaryInput {
  cal: WorkCalendar;
  model: ScheduleModel;
  /** Расчёт по договору (`schedule(…, null)`) и по действующему плану. */
  base: Timings;
  plan: Timings;
  log: readonly ScheduleLogEntry[];
  isDone?(s: ScheduleStage): boolean;
}

export interface ScheduleSummary {
  /** Сдача по договору и по прогнозу: «27.11, пт». */
  due: string;
  forecast: string;
  /** Опоздание и опережение, рабочих дней. */
  slip: number;
  early: number;
  late: boolean;
  /** Названия этапов критического пути. */
  critical: string[];
  why: string;
  recoverTitle: string;
  /** Этапы, которые можно сократить, чтобы вернуть дату договора. */
  recover: { id: string; label: string }[];
}

/** Правая панель «Сдача объекта» (`sum` эталона). */
export function scheduleSummary(i: SummaryInput): ScheduleSummary {
  const { cal, model } = i;
  const fin = finalStageId(model);
  const isDone = i.isDone ?? isStageDone;
  const due = timing(i.base, fin).end;
  const fc = timing(i.plan, fin).end;
  const slip = fc > due ? cal.wdIn(due, fc) : 0;
  const early = fc < due ? cal.wdIn(fc, due) : 0;
  const open = model.stages.filter((s) => !isDone(s));
  const last = i.log.find((e) => e.reason);
  return {
    due: cal.dtw(due),
    forecast: cal.dtw(fc),
    slip,
    early,
    late: slip > 0,
    critical: open.filter((s) => timing(i.plan, s.id).fl === 0).map((s) => s.name),
    why: last
      ? 'Последний перенос — ' +
        last.at +
        ', ' +
        last.who +
        ': ' +
        last.text +
        '. Причина: ' +
        lf1(last.reason) +
        '.'
      : '',
    recoverTitle:
      'Чтобы вернуть ' +
      cal.dt(due) +
      ', нужно отыграть ' +
      cal.wdn(slip) +
      ' на критическом пути. Сократите один из этапов:',
    recover: open
      .filter(
        (s) =>
          s.as == null && !s.ms && timing(i.plan, s.id).fl === 0 && timing(i.plan, s.id).dur >= 2,
      )
      .map((s) => ({ id: s.id, label: s.name + ' · ' + timing(i.plan, s.id).dur + ' дн' })),
  };
}

export interface ScheduleStatusInput extends SummaryInput {
  whoOf(s: ScheduleStage): string;
}

export interface ScheduleStatus {
  due: string;
  forecast: string;
  slip: number;
  slipText: string;
  why: string;
  noWho: string[];
}

/** Сводка графика для шапки CRM и «Требует решения» (`sched` из `onStatus` эталона). */
export function scheduleStatus(i: ScheduleStatusInput): ScheduleStatus {
  const { cal } = i;
  const fin = finalStageId(i.model);
  const isDone = i.isDone ?? isStageDone;
  const due = timing(i.base, fin).end;
  const fc = timing(i.plan, fin).end;
  const slip = fc > due ? cal.wdIn(due, fc) : 0;
  const last = i.log.find((e) => e.reason);
  return {
    due: cal.dt(due),
    forecast: cal.dt(fc),
    slip,
    slipText: cal.wdn(slip),
    why: slip && last ? (last.text.split(':')[0] ?? '') + ' — ' + lf1(last.reason) : '',
    noWho: i.model.stages
      .filter((s) => !s.ms && !isDone(s) && !i.whoOf(s))
      .map((s) => '«' + s.name + '» с ' + cal.dt(timing(i.plan, s.id).start)),
  };
}

export type StageStateKind =
  'closed' | 'done' | 'late-running' | 'running' | 'milestone' | 'shifted' | 'early' | 'idle';

/** Чип состояния этапа в панели (`stat` эталона); `days` — отставание или опережение. */
export function stageState(
  cal: WorkCalendar,
  s: ScheduleStage,
  base: Timings,
  plan: Timings,
  closedByAct: boolean,
): { kind: StageStateKind; days: number } {
  const vr = variance(cal, base, plan, s.id);
  if (isStageDone(s)) return { kind: closedByAct ? 'closed' : 'done', days: 0 };
  if (s.as != null)
    return vr > 0 ? { kind: 'late-running', days: vr } : { kind: 'running', days: 0 };
  if (s.ms) return { kind: 'milestone', days: vr };
  if (vr > 0) return { kind: 'shifted', days: vr };
  if (vr < 0) return { kind: 'early', days: -vr };
  return { kind: 'idle', days: 0 };
}

export interface WindowItem {
  id: string;
  name: string;
  /** «до пт 23.10», «с ср 21.10, до 03.11», «вся неделя, до 03.11». */
  when: string;
  who: string;
  /** Принято и на приёмке, %; `null` у не начатого этапа. */
  progress: { accepted: number; pending: number | null } | null;
  /** Этап-предшественник, с которым идёт параллельно. */
  parallelWith: string | null;
  issues: StageIssue[];
  /** Исполнитель и материалы готовы. */
  ready: boolean;
  critical: boolean;
  empty: false;
}

export interface UpcomingWindow {
  title: string;
  sub: string;
  from: number;
  to: number;
  items: WindowItem[];
  empty: boolean;
}

const WINDOW_TITLES = ['Эта неделя', 'Следующая неделя', 'Через неделю'] as const;

/** Окна «Эта неделя / Следующая неделя / Через неделю»: пн–пт от недели «сегодня». */
export function upcomingWindows(c: StageContext): UpcomingWindow[] {
  const { cal } = c;
  const conf = conflictsOf(c);
  const ws = cal.weekStart(cal.cfg.today);
  const wday = (d: number): string => cal.dtw(d).replace(/^(\d{2}\.\d{2}), (.+)$/, '$2 $1');
  return WINDOW_TITLES.map((title, k) => {
    const a = ws + 7 * k;
    const b = a + 4;
    const items: WindowItem[] = c.model.stages
      .filter((s) => !done(c, s) && timing(c.T, s.id).start <= b && timing(c.T, s.id).end >= a)
      .map((s) => {
        const q = timing(c.T, s.id);
        const when = s.ms
          ? wday(q.start)
          : q.start >= a && q.end <= b
            ? wday(q.start) + ' – ' + wday(q.end)
            : q.start < a && q.end <= b
              ? 'до ' + wday(q.end)
              : q.start >= a
                ? 'с ' + wday(q.start) + ', до ' + cal.dt(q.end)
                : 'вся неделя, до ' + cal.dt(q.end);
        const par = c.model.links
          .filter((l) => l.to === s.id)
          .map((l) => c.model.stages.find((x) => x.id === l.from))
          .find((p) => p && !done(c, p) && timing(c.T, p.id).end >= q.start);
        const issues = stageIssues(c, s, conf);
        return {
          id: s.id,
          name: s.name,
          when,
          who: c.whoOf(s) || 'Исполнитель не назначен',
          progress:
            s.as != null
              ? {
                  accepted: Math.round((s.acc ?? 0) * 100),
                  pending: s.pen ? Math.round(s.pen * 100) : null,
                }
              : null,
          parallelWith: par && s.as == null ? par.id : null,
          issues,
          ready: s.as == null && !issues.length,
          critical: q.fl === 0,
          empty: false as const,
        };
      });
    const hol = cal.cfg.holidays.filter((h) => h >= a && h <= b);
    return {
      title: title + ' · ' + cal.range(a, b),
      sub: hol.length ? hol.map((h) => cal.dayMonth(h)).join(', ') + ' — выходной' : '',
      from: a,
      to: b,
      items,
      empty: !items.length,
    };
  });
}
