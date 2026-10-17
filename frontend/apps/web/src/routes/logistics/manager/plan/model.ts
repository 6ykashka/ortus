// W2.20 · Модель формы «Планирование рейса» (S2-13, no-reference — design-requests `logistics-plan`): черновик формы
// → TripPlanCreate контракта 0.5.0-stage2 (масса — т на экране, кг в контракте; точные Quantity и Decimal; время —
// в часовом поясе организации → UTC), проверки до отправки, загрузка по участкам (`legs` домена — масса и объём
// раздельно; выгрузка не больше, чем в кузове после предыдущей точки, как проверяет сервер: 14-stage2-dor §3 п. 7),
// ошибки 422 сервера по полям (violations[].field → поле формы).
import type { components } from '@ortus/api-client';
import { num } from '@ortus/domain';
import { legs, type Trip as DomainTrip } from '@ortus/domain/modules';
import { format, logisticsManager } from '@ortus/texts';

import { PLAN_TEXT as T } from './texts.ts';

type S = components['schemas'];

export interface StopDraft {
  op: 'load' | 'unload';
  address: string;
  time: string;
  mass: string;
  volume: string;
}

export interface PlanDraft {
  title: string;
  unitId: string;
  /** YYYY-MM-DD */
  date: string;
  from: string;
  to: string;
  cargo: string;
  mass: string;
  volume: string;
  length: string;
  temp: boolean;
  tempMin: string;
  tempMax: string;
  distance: string;
  driverId: string;
  stops: StopDraft[];
}

/** Ошибки по полям: `title`, `to`, `stops[1].mass` … */
export type PlanErrors = Partial<Record<string, string>>;

export interface DraftLeg {
  n: number;
  name: string;
  op: string;
  after: string;
}

const stop = (op: StopDraft['op']): StopDraft => ({
  op,
  address: '',
  time: '',
  mass: '',
  volume: '',
});

export const emptyDraft = (o: { unitId: string; date: string }): PlanDraft => ({
  title: '',
  unitId: o.unitId,
  date: o.date,
  from: '',
  to: '',
  cargo: '',
  mass: '',
  volume: '',
  length: '',
  temp: false,
  tempMin: '',
  tempMax: '',
  distance: '',
  driverId: '',
  stops: [stop('load'), stop('unload')],
});

export const addStop = (d: PlanDraft): PlanDraft => ({ ...d, stops: [...d.stops, stop('unload')] });

export const removeStop = (d: PlanDraft, i: number): PlanDraft => ({
  ...d,
  stops: d.stops.filter((_, k) => k !== i),
});

/** «0,8» / « 1 250 » / «+6» → число; пусто и не число — NaN. */
export const parseNum = (s: string): number => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const positive = (s: string): boolean => parseNum(s) > 0;
const nonNegative = (s: string): boolean => parseNum(s) >= 0;
const num0 = (s: string): number => (Number.isFinite(parseNum(s)) ? parseNum(s) : 0);

/** Точка наполовину заполнена — для участков недостающее считается нулём. */
function legsOf(d: PlanDraft) {
  const trip = {
    stops: d.stops.map((s) => ({
      time: s.time,
      name: s.address,
      op: s.op,
      w: num0(s.mass),
      v: num0(s.volume),
    })),
  } as Pick<DomainTrip, 'stops'> as DomainTrip;
  return legs(trip);
}

/** Ошибки до отправки; пустой объект — форму можно отправлять. */
export function validate(d: PlanDraft): PlanErrors {
  const e: PlanErrors = {};
  const E = T.errors;
  if (!d.title.trim()) e.title = E.title;
  if (!d.unitId) e.unit = E.unit;
  if (!d.date) e.date = E.date;
  if (!TIME.test(d.from)) e.from = E.time;
  if (!TIME.test(d.to)) e.to = E.time;
  else if (TIME.test(d.from) && d.to <= d.from) e.to = E.range;
  if (!d.cargo.trim()) e.cargo = E.cargo;
  for (const k of ['mass', 'volume', 'length'] as const) if (!positive(d[k])) e[k] = E.positive;
  if (d.temp) {
    const lo = parseNum(d.tempMin);
    const hi = parseNum(d.tempMax);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) e.tempMin = E.temp;
    else if (lo > hi) e.tempMax = E.tempRange;
  }
  if (d.distance.trim() && !nonNegative(d.distance)) e.distance = E.nonNegative;
  d.stops.forEach((s, i) => {
    const at = (f: string) => `stops[${i}].${f}`;
    if (!s.address.trim()) e[at('address')] = E.address;
    if (s.time && !TIME.test(s.time)) e[at('time')] = E.time;
    if (!nonNegative(s.mass)) e[at('mass')] = E.nonNegative;
    if (!nonNegative(s.volume)) e[at('volume')] = E.nonNegative;
  });
  // Загрузка по участкам (масса и объём раздельно): после выгрузки в кузове не может стать меньше нуля.
  let w = 0;
  let v = 0;
  d.stops.forEach((s, i) => {
    const sign = s.op === 'load' ? 1 : -1;
    w = Math.round((w + sign * num0(s.mass)) * 1e6) / 1e6;
    v = Math.round((v + sign * num0(s.volume)) * 1e6) / 1e6;
    if (w < 0) e[`stops[${i}].mass`] ??= E.overload;
    if (v < 0) e[`stops[${i}].volume`] ??= E.overload;
  });
  return e;
}

/** «Загрузка по участкам» формы: операция точки и что в кузове после неё (без машины — без процентов). */
export function draftLegs(d: PlanDraft): DraftLeg[] {
  const tt = logisticsManager.fleet.trip;
  return legsOf(d).map((l, i) => ({
    n: i + 1,
    name: l.name,
    op: format(l.op === 'load' ? tt.load : tt.unload, { volume: num(l.v), mass: num(l.w) }),
    after: format(tt.afterStop, { volume: num(l.vAfter), mass: num(l.wAfter) }),
  }));
}

/** Смещение часового пояса `tz` в момент `utc`, мс. */
function offsetMs(utc: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utc))
      .map((x) => [x.type, x.value]),
  );
  const n = (k: string): number => Number(p[k] ?? 0);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - utc;
}

/** «2026-10-01» + «18:00» в часовом поясе `tz` → «2026-10-01T15:00:00Z». */
export function zonedIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  // Два шага: смещение в момент «наивного» UTC, затем — в найденный момент (переход на летнее время).
  const at = guess - offsetMs(guess - offsetMs(guess, tz), tz);
  return new Date(at).toISOString().replace('.000Z', 'Z');
}

/** Точное десятичное без экспоненты и хвостовых нулей (до 6 знаков) — формат Quantity и Decimal. */
const exact = (n: number): string => String(Number(n.toFixed(6)));
const kg = (t: string): string => String(Math.round(parseNum(t) * 1000));

/** Тело createTripPlan из проверенного черновика. */
export function toCreate(d: PlanDraft, tz: string): S['TripPlanCreate'] {
  const cargo: S['TripCargo'] = {
    description: d.cargo.trim(),
    weightKg: kg(d.mass),
    volumeM3: exact(parseNum(d.volume)),
    lengthM: exact(parseNum(d.length)),
  };
  if (d.temp) {
    cargo.temperatureMinC = exact(parseNum(d.tempMin));
    cargo.temperatureMaxC = exact(parseNum(d.tempMax));
  }
  const body: S['TripPlanCreate'] = {
    orgUnitId: d.unitId,
    title: d.title.trim(),
    plannedWindow: {
      startsAt: zonedIso(d.date, d.from, tz),
      endsAt: zonedIso(d.date, d.to, tz),
      timeZone: tz,
    },
    ...(d.distance.trim() ? { distanceKm: exact(parseNum(d.distance)) } : {}),
    cargo,
    stops: d.stops.map((s, i) => ({
      sequence: i + 1,
      op: s.op,
      address: s.address.trim(),
      ...(s.time ? { plannedAt: zonedIso(d.date, s.time, tz) } : {}),
      weightKg: kg(s.mass),
      volumeM3: exact(parseNum(s.volume)),
    })),
  };
  if (d.driverId) body.driverMemberId = d.driverId;
  return body;
}

const FIELD: Readonly<Record<string, string>> = {
  title: 'title',
  orgUnitId: 'unit',
  plannedWindow: 'to',
  'plannedWindow.startsAt': 'from',
  'plannedWindow.endsAt': 'to',
  distanceKm: 'distance',
  driverMemberId: 'driverId',
  'cargo.description': 'cargo',
  'cargo.weightKg': 'mass',
  'cargo.volumeM3': 'volume',
  'cargo.lengthM': 'length',
  'cargo.temperatureMinC': 'tempMin',
  'cargo.temperatureMaxC': 'tempMax',
};
const STOP_FIELD: Readonly<Record<string, string>> = {
  weightKg: 'mass',
  volumeM3: 'volume',
  address: 'address',
  plannedAt: 'time',
  op: 'op',
};

/** Ошибки 422 сервера → поля формы; неизвестное поле — под ключом `form`. */
export function serverErrors(violations: readonly S['ProblemViolation'][]): PlanErrors {
  const e: PlanErrors = {};
  for (const v of violations) {
    const m = /^stops\[(\d+)\]\.(\w+)$/.exec(v.field ?? '');
    const key = m
      ? `stops[${m[1]}].${STOP_FIELD[m[2] ?? ''] ?? 'address'}`
      : (FIELD[v.field ?? ''] ?? 'form');
    e[key] ??= v.message;
  }
  return e;
}

/** Водители для рейса: действующие участники с профилем «Водитель», по алфавиту. */
export const driverOptions = (
  members: readonly S['Member'][],
): { value: string; label: string }[] =>
  members
    .filter((m) => m.status === 'active' && m.workProfiles.includes('driver'))
    .map((m) => ({ value: m.id, label: m.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

/** Сегодняшняя дата в часовом поясе организации, YYYY-MM-DD. */
export function todayIn(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
