// W4.41 · Модель «Календаря» (calVM эталона :4140–4180 над контрактом 0.7.0-stage4, W4.06): фильтр «Тип ресурса»
// (только присутствующие виды), строки ресурсов в порядке сервера, сетка рабочего дня (08:00–20:00 эталона),
// блоки броней — X(start), W(start, end) и буфер занятости (busySpan: подготовка и уборка), тон по виду источника,
// мета и источник брони, текст запрета переноса (rescheduleLock), варианты начала шагом 15 минут, окно переноса
// (длительность и ресурсы брони сохраняются — Q-W4.06-14) и запрос свободных слотов (freeSlots эталона).
import type { components } from '@ortus/api-client';
import { calendar as T, format } from '@ortus/texts';

import { clock, dayStart, localDate } from './time.ts';

type S = components['schemas'];
type Resource = S['CalendarResource'];
type Booking = S['Booking'];

export type Kind = Resource['kind'];
export type KindFilter = 'all' | Kind;
export type Tone = 'ok' | 'info' | 'danger' | 'neutral';

/** Сетка: часы от местной полуночи. */
export interface Grid {
  start: number;
  end: number;
}
/** Рабочий день: минуты от местной полуночи. */
export interface Workday {
  start: number;
  end: number;
}
export interface Block {
  id: string;
  title: string;
  aria: string;
  /** Проценты ширины полосы. */
  left: number;
  width: number;
  bufLeft: number;
  bufWidth: number;
  tone: Tone;
  selected: boolean;
}
export interface BlockOptions {
  /** Местная полночь суток полосы (мс). */
  dayStart: number;
  grid: Grid;
  tz: string;
  selected?: string;
  aria?: (b: Booking, from: string, to: string) => string;
}
export interface Source {
  label: string;
  page: 'spa' | 'fleet';
  trip?: string;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Порядок видов — KIND эталона (:4142) и порядок сервера. */
export const KIND_ORDER: readonly Kind[] = ['vehicle', 'member', 'room', 'equipment'];
export const KIND_ICON: Readonly<Record<Kind, string>> = {
  vehicle: 'local_shipping',
  member: 'badge',
  room: 'meeting_room',
  equipment: 'chair',
};

/** «Все ресурсы» и виды, у которых есть ресурсы (:4151). */
export function kindFilters(
  resources: readonly Resource[],
  selected: KindFilter,
): { key: KindFilter; label: string; pressed: boolean }[] {
  const kinds = KIND_ORDER.filter((k) => resources.some((r) => r.kind === k));
  return [
    { key: 'all' as const, label: T.all },
    ...kinds.map((k) => ({ key: k, label: T.kinds[k] })),
  ].map((f) => ({ ...f, pressed: f.key === selected }));
}

/** Строки выбранного вида (:4145) с иконкой вида. */
export function rowsOf(
  resources: readonly Resource[],
  f: KindFilter,
): (Resource & { icon: string })[] {
  return resources
    .filter((r) => f === 'all' || r.kind === f)
    .map((r) => ({ ...r, icon: KIND_ICON[r.kind] }));
}

const minutesOf = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Сетка — рабочие дни ресурсов (CAL-05); без ресурсов — 08:00–20:00 эталона. */
export function gridOf(resources: readonly Resource[]): Grid {
  if (!resources.length) return { start: 8, end: 20 };
  const start = Math.min(...resources.map((r) => minutesOf(r.workday.start)));
  const end = Math.max(...resources.map((r) => minutesOf(r.workday.end)));
  return { start: Math.floor(start / 60), end: Math.ceil(end / 60) };
}

/** Подписи часов через два (:4152). */
export function hourMarks(g: Grid): { label: string; left: number }[] {
  const out: { label: string; left: number }[] = [];
  for (let h = g.start; h <= g.end; h += 2) {
    out.push({ label: format(T.hour, { h }), left: pct(h, g) });
  }
  return out;
}

/** X(t) эталона: положение часа в полосе, %. */
const pct = (t: number, g: Grid): number =>
  ((Math.max(g.start, Math.min(g.end, t)) - g.start) / (g.end - g.start)) * 100;
/** W(a, b) эталона: ширина отрезка в полосе, %. */
const span = (a: number, b: number, g: Grid): number =>
  Math.max(0, ((Math.min(g.end, b) - Math.max(g.start, a)) / (g.end - g.start)) * 100);

const ms = (iso: string): number => Date.parse(iso);

/** Тон блока по виду источника (:4154): визит — ok, рейс — info, ТО — danger, без источника — neutral. */
export function toneOf(b: Booking): Tone {
  if (b.sourceKind === 'appointment') return 'ok';
  if (b.sourceKind === 'trip') return 'info';
  if (b.sourceKind === 'maintenance') return 'danger';
  return 'neutral';
}

/** Занятость брони — `occupied` сервера или окно с подготовкой и уборкой (busySpan). */
const occupied = (b: Booking): [number, number] =>
  b.occupied
    ? [ms(b.occupied.startsAt), ms(b.occupied.endsAt)]
    : [
        ms(b.window.startsAt) - (b.prepMinutes ?? 0) * MINUTE,
        ms(b.window.endsAt) + (b.cleanupMinutes ?? 0) * MINUTE,
      ];

/** Блоки броней ресурса в сутках полосы (:4153–4156). */
export function blocksOf(
  resourceId: string,
  bookings: readonly Booking[],
  o: BlockOptions,
): Block[] {
  const to = o.dayStart + DAY;
  const h = (t: number) => (t - o.dayStart) / HOUR;
  return bookings
    .filter((b) => b.resources.some((r) => r.resourceId === resourceId))
    .filter((b) => {
      const [a, z] = occupied(b);
      return a < to && z > o.dayStart;
    })
    .map((b) => {
      const s = ms(b.window.startsAt);
      const e = ms(b.window.endsAt);
      const [a, z] = occupied(b);
      const from = clock(s, o.tz);
      const till = clock(e, o.tz);
      return {
        id: b.id,
        title: b.title,
        aria: o.aria
          ? o.aria(b, from, till)
          : format(T.blockAria, { title: b.title, from, to: till }),
        left: pct(h(s), o.grid),
        width: span(h(s), h(e), o.grid),
        bufLeft: pct(h(a), o.grid),
        bufWidth: span(h(a), h(z), o.grid),
        tone: toneOf(b),
        selected: b.id === o.selected,
      };
    });
}

/** Мета брони (:4168): «ЧЧ:ММ–ЧЧ:ММ · подготовка N мин · уборка N мин · ресурсы». */
export function metaOf(b: Booking, names: ReadonlyMap<string, string>, tz: string): string {
  const parts = [
    format(T.metaTime, {
      from: clock(ms(b.window.startsAt), tz),
      to: clock(ms(b.window.endsAt), tz),
    }),
  ];
  if (b.prepMinutes) parts.push(format(T.metaPrep, { n: b.prepMinutes }));
  if (b.cleanupMinutes) parts.push(format(T.metaClean, { n: b.cleanupMinutes }));
  const res = b.resources.flatMap((r) => names.get(r.resourceId) ?? []);
  if (res.length) parts.push(res.join(', '));
  return parts.join(' · ');
}

/**
 * Кнопка источника (:4166, :4170): визит — «Салон и SPA», рейс — «Рабочее место логиста» с рейсом, машина —
 * «Рабочее место логиста» (параметра машины у маршрута нет, как «Данные» Q-W2.26-3). Без объекта — нет кнопки.
 */
export function sourceOf(b: Booking): Source | null {
  const o = b.relatedObject;
  if (!o) return null;
  if (b.sourceKind === 'appointment') return { label: T.source.appointment, page: 'spa' };
  if (b.sourceKind === 'trip') return { label: T.source.trip, page: 'fleet', trip: o.entityId };
  if (b.sourceKind === 'maintenance') return { label: T.source.maintenance, page: 'fleet' };
  return null;
}

const LOCK: Readonly<Record<NonNullable<Booking['rescheduleLock']>, string>> = {
  permission: T.lock.permission,
  source_module: T.lock.sourceModule,
  specialist_schedule: T.lock.specialistSchedule,
  vehicle_card: T.lock.vehicleCard,
};

/** Текст запрета переноса (lockText :4172); перенос разрешён — null. */
export const lockTextOf = (b: Booking): string | null =>
  b.rescheduleLock ? LOCK[b.rescheduleLock] : null;

/** Рабочий день брони — пересечение рабочих дней её ресурсов (08:00–20:00 по умолчанию). */
export function workdayOf(b: Booking, resources: readonly Resource[]): Workday {
  const own = resources.filter((r) => b.resources.some((x) => x.resourceId === r.id));
  if (!own.length) return { start: 8 * 60, end: 20 * 60 };
  return {
    start: Math.max(...own.map((r) => minutesOf(r.workday.start))),
    end: Math.min(...own.map((r) => minutesOf(r.workday.end))),
  };
}

const hhmm = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** «Перенести начало на» (:4163): от начала рабочего дня до конца минус 15 минут, шаг 15 минут. */
export function timeOptions(w: Workday): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = w.start; m < w.end; m += 15) out.push({ value: hhmm(m), label: hhmm(m) });
  return out;
}

/** Текущее начало брони — значение выбора по умолчанию (:4164). */
export const startValue = (b: Booking, tz: string): string => clock(ms(b.window.startsAt), tz);

/** Местная полночь суток начала брони. */
export const bookingDay = (b: Booking, tz: string): number =>
  dayStart(localDate(ms(b.window.startsAt), tz), tz);

/** Новое окно брони с началом `value` в сутках `day`; длительность и пояс — брони. */
export function moveWindow(b: Booking, day: number, value: string): S['TimeWindow'] {
  const start = day + minutesOf(value) * MINUTE;
  const dur = ms(b.window.endsAt) - ms(b.window.startsAt);
  return { startsAt: iso(start), endsAt: iso(start + dur), timeZone: b.window.timeZone };
}

const iso = (t: number): string => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Свободные слоты переноса (freeSlots эталона, описание findCalendarAvailability W4.06): ресурсы брони — по одному
 * в группе, без самой брони, её длительность, подготовка и уборка, рабочий день, шаг 15 минут, 3 слота.
 */
export function slotsQuery(b: Booking, day: number, w: Workday): S['AvailabilityQuery'] {
  return {
    orgUnitId: b.orgUnitId,
    window: {
      startsAt: iso(day + w.start * MINUTE),
      endsAt: iso(day + w.end * MINUTE),
      timeZone: b.window.timeZone,
    },
    durationMinutes: Math.round((ms(b.window.endsAt) - ms(b.window.startsAt)) / MINUTE),
    stepMinutes: 15,
    requirements: b.resources.map((r) => ({
      kind: r.kind,
      resourceIds: [r.resourceId],
      requiredCount: 1,
    })),
    excludeBookingId: b.id,
    prepMinutes: b.prepMinutes ?? 0,
    cleanupMinutes: b.cleanupMinutes ?? 0,
    maxSlots: 3,
  };
}
