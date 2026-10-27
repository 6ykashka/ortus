// W6.23 · Модель страницы «График» (design/Ремонт и стройка.dc.html :936–1311): ответ getSchedule → календарь,
// этапы, связи и план библиотеки графика W6.10 (`@ortus/domain/schedule`). Диаграмму, перетаскивание и предпросмотр
// считает клиент по этой библиотеке, сохранение и прогноз — сервер (screens.yaml repair-schedule).
// Чистые функции без запросов и разметки.
import type { components } from '@ortus/api-client';
import {
  allIssues,
  createCalendar,
  dayCount,
  finalStageId,
  lagOf,
  type Plan,
  previewChange,
  type Preview,
  type ScheduleLink,
  type ScheduleModel,
  type ScheduleStage,
  schedule,
  scheduleSummary,
  type StageContext,
  type StageIssue,
  type Timings,
  todayIndex,
  type UpcomingWindow,
  upcomingWindows,
  type WorkCalendar,
} from '@ortus/domain/schedule';

type S = components['schemas'];

export type ChipTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
export interface Chip {
  label: string;
  tone: ChipTone;
  icon: string;
  /** Тёмный чип («Критический путь» эталона). */
  strong?: boolean;
}

export const chip = (label: string, tone: ChipTone, icon: string): Chip => ({ label, tone, icon });

/** Причины переноса: порядок и подписи эталона (GREASONS :972), значения — enum RepairScheduleReason. */
export const REASONS: readonly { value: S['RepairScheduleReason']; label: string }[] = [
  { value: 'executor_busy', label: 'Задержка подрядчика' },
  { value: 'material_delay', label: 'Поставка материалов' },
  { value: 'client_request', label: 'Решение заказчика' },
  { value: 'weather_or_drying', label: 'Технологическая пауза' },
  { value: 'other', label: 'Нет доступа на объект' },
  { value: 'scope_change', label: 'Добавили людей на этап' },
  { value: 'rework', label: 'Уточнили объём работ' },
];

export const reasonLabel = (v: string | undefined): string =>
  REASONS.find((r) => r.value === v)?.label ?? '';

export interface ScheduleView {
  api: S['Schedule'];
  cal: WorkCalendar;
  model: ScheduleModel;
  phases: string[];
  /** Действующий план (сдвиги из ответа). */
  plan: Plan;
  /** Расчёт по действующему плану и «по договору» (последний этап — на дату договора). */
  P: Timings;
  B: Timings;
  fin: string;
  /** Дни: сдача по договору и прогноз сервера. */
  due: number;
  fc: number;
  delayWd: number;
  revision: number;
  /** Записи «Материала нет на объекте» из issues сервера. */
  materials: StageIssue[];
  /** Статус этапа и исполнитель-сотрудник по ответу. */
  status: Record<string, S['ScheduleStage']['status']>;
  memberOf: Record<string, string | undefined>;
  sectionOf: Record<string, string | undefined>;
}

const DAY = 86_400_000;

/** Понедельник недели даты (UTC). */
function mondayOnOrBefore(iso: string): string {
  const t = Date.parse(iso + 'T00:00:00Z');
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * DAY).toISOString().slice(0, 10);
}

/** ISO-дата дня календаря. */
export function isoOf(cal: WorkCalendar, day: number): string {
  const { year, month, day: d } = cal.dateParts(day);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Номер дня календаря по ISO-дате. */
export const dayOf = (cal: WorkCalendar, iso: string): number => dayCount(cal.cfg.start, iso);

/** Ответ getSchedule → вид. `now` — часы браузера («сегодня» по Москве). Бросает при цикле связей. */
export function buildView(api: S['Schedule'], now: Date): ScheduleView {
  const first = api.stages.map((s) => s.startOn).sort()[0] ?? '2026-01-05';
  const start = mondayOnOrBefore(first);
  const holidays = api.holidays.map((h) => dayCount(start, h));
  const today = todayIndex(start, { now: () => now });
  const cal = createCalendar({ start, holidays, today });

  const hasOut = new Set(api.links.map((l) => l.fromStageId));
  const lastId = [...api.stages].reverse().find((s) => !hasOut.has(s.id))?.id;
  const phases: string[] = [];
  const stages: ScheduleStage[] = api.stages.map((s) => {
    if (!phases.includes(s.phase)) phases.push(s.phase);
    const out: ScheduleStage = {
      id: s.id,
      name: s.name,
      dur: s.durationWd,
      ph: phases.indexOf(s.phase),
      who: s.executorName ?? '',
    };
    if (s.id === lastId) out.ms = true;
    if (s.status !== 'planned') out.as = dayCount(start, s.startOn);
    if (s.status !== 'planned') out.acc = s.status === 'done' ? 1 : 0;
    return out;
  });
  const links: ScheduleLink[] = api.links.map((l) => ({
    from: l.fromStageId,
    to: l.toStageId,
    lag: l.lagDays,
    ...(l.note ? { note: l.note } : {}),
  }));
  const model: ScheduleModel = { stages, links };
  const plan: Plan = { off: {}, dur: {}, lag: {} };
  for (const s of api.stages) if (s.offsetWd > 0) plan.off[s.id] = s.offsetWd;

  const fin = finalStageId(model);
  const P = schedule(cal, model, plan);
  const B = schedule(cal, model, null);
  const finB = B[fin];
  const due = api.baseline ? dayCount(start, api.baseline.dueOn) : (finB?.end ?? 0);
  if (finB) B[fin] = { ...finB, start: due, end: due };
  const fc = api.forecastDueOn ? dayCount(start, api.forecastDueOn) : (P[fin]?.end ?? due);

  const materials = api.issues
    .filter((i) => i.kind === 'no_material')
    .map<StageIssue>((i) => ({
      id: i.stageId,
      icon: 'inventory_2',
      tone: 'warn',
      short: 'Материала нет на объекте',
      text: i.text,
      start: P[i.stageId]?.start ?? 0,
    }));
  return {
    api,
    cal,
    model,
    phases,
    plan,
    P,
    B,
    fin,
    due,
    fc,
    delayWd: api.delayWd,
    revision: api.revision,
    materials,
    status: Object.fromEntries(api.stages.map((s) => [s.id, s.status])),
    memberOf: Object.fromEntries(api.stages.map((s) => [s.id, s.executorMemberId])),
    sectionOf: Object.fromEntries(api.stages.map((s) => [s.id, s.estimateSectionId])),
  };
}

/** Расчёт по плану или черновику. */
export const timingsOf = (v: ScheduleView, plan: Plan): Timings => schedule(v.cal, v.model, plan);

const whoOf = (s: ScheduleStage): string => s.who ?? '';

function contextOf(v: ScheduleView, plan: Plan): StageContext {
  return { cal: v.cal, model: v.model, T: timingsOf(v, plan), whoOf, supplyOf: () => null };
}

/** Чипы шапки: «По договору …» и «Прогноз … · в срок / · +N раб. дней» (сервер: forecastDueOn, delayWd). */
export function headChips(v: ScheduleView): Chip[] {
  const { cal } = v;
  return [
    chip('По договору ' + cal.dtw(v.due), 'neutral', 'handshake'),
    v.delayWd > 0
      ? chip('Прогноз ' + cal.dtw(v.fc) + ' · +' + cal.wdn(v.delayWd), 'warn', 'event_busy')
      : chip('Прогноз ' + cal.dtw(v.fc) + ' · в срок', 'ok', 'event_available'),
  ];
}

export interface Summary {
  due: string;
  forecast: string;
  late: boolean;
  chip: Chip;
  critical: string[];
  why: string;
  recoverTitle: string;
  recover: { id: string; label: string }[];
}

/** Правая панель «Сдача объекта». */
export function summaryOf(v: ScheduleView): Summary {
  const s = scheduleSummary({
    cal: v.cal,
    model: v.model,
    base: v.B,
    plan: v.P,
    log: logOf(v),
  });
  const { cal } = v;
  return {
    due: s.due,
    forecast: s.forecast,
    late: s.late,
    chip: s.slip
      ? chip('Позже договора на ' + cal.wdn(s.slip), 'warn', 'event_busy')
      : s.early
        ? chip('Раньше договора на ' + cal.wdn(s.early), 'ok', 'event_available')
        : chip('В срок по договору', 'ok', 'event_available'),
    critical: s.critical,
    why: s.why,
    recoverTitle: s.recoverTitle,
    recover: s.recover,
  };
}

export interface LogEntry {
  id: string;
  at: string;
  who: string;
  text: string;
  reason: string;
}

const MSK = { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' } as const;

/** «История изменений»: новые сверху (как в ответе сервера). */
export function logOf(v: ScheduleView): LogEntry[] {
  return v.api.changes.map((c) => ({
    id: c.id,
    at: new Date(c.at).toLocaleDateString('ru-RU', MSK),
    who: c.authorName,
    text: c.text,
    reason: reasonLabel(c.reason),
  }));
}

/** Правки плана (черновик) → изменения API: по этапам; пауза — изменением последователя, если предшественник
 * определяет его начало в действующем плане (сервер применяет `lagDays` к связи с `bind`). */
export function changesOf(v: ScheduleView, draft: Plan): S['ScheduleStageChange'][] {
  const out = new Map<string, S['ScheduleStageChange']>();
  const of = (id: string): S['ScheduleStageChange'] => {
    let c = out.get(id);
    if (!c) {
      c = { stageId: id };
      out.set(id, c);
    }
    return c;
  };
  for (const s of v.model.stages) {
    if ((v.plan.off[s.id] ?? 0) !== (draft.off[s.id] ?? 0))
      of(s.id).offsetWd = draft.off[s.id] ?? 0;
    if ((v.plan.dur[s.id] ?? s.dur) !== (draft.dur[s.id] ?? s.dur)) {
      of(s.id).durationWd = draft.dur[s.id] ?? s.dur;
    }
  }
  for (const l of v.model.links) {
    const was = lagOf(v.plan, l);
    const now = lagOf(draft, l);
    if (was !== now && v.P[l.to]?.bind === l.from) of(l.to).lagDays = now;
  }
  return v.model.stages.flatMap((s) => {
    const c = out.get(s.id);
    return c ? [c] : [];
  });
}

/** Предпросмотр переноса: тексты баннера «Предпросмотр изменения — ещё не сохранено». */
export function previewOf(v: ScheduleView, draft: Plan, clientName = ''): Preview {
  const p = previewChange({
    cal: v.cal,
    model: v.model,
    plan: v.plan,
    draft,
    whoOf,
    clientName,
  });
  return { ...p, notify: p.notify.replace('  ', ' ') };
}

/** «Требует внимания»: нет исполнителя / занят — по плану или черновику, нет материала — из issues сервера. */
export function attentionOf(v: ScheduleView, plan: Plan): StageIssue[] {
  const T = timingsOf(v, plan);
  const mats = v.materials.map((m) => ({ ...m, start: T[m.id]?.start ?? m.start }));
  return [...allIssues(contextOf(v, plan)), ...mats].sort((a, b) => a.start - b.start);
}

/** Окна «Эта неделя / Следующая неделя / Через неделю» по плану или черновику. */
export function upcomingOf(v: ScheduleView, plan: Plan): UpcomingWindow[] {
  return upcomingWindows(contextOf(v, plan));
}
