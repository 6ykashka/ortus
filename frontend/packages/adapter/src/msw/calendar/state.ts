// Календарь ресурсов сценарного сервера (W4.06, контракт 0.7.0-stage4; W4.40, W4.41): ресурсы и брони организации
// из сида домена (calendarSeed — extra-data.js 14.10, «Лотос» без утечки «Альты»), видимость по правам участника и
// причины запрета переноса эталона (calVM :4140). День эталона — 01.10.2026 по Москве, рабочий день 08:00–20:00.
import type { components } from '@ortus/api-client';
import { type Booking, calendarSeed, type Resource } from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import { grantsOf, type TenantAccess } from '../core/access.ts';
import { HOUR, MINUTE } from '../core/time.ts';
import type { Org } from '../core/state.ts';
import { covers, fleetOf, tripVisible, unitsFor } from '../fleet/state.ts';
import type { HandlerContext } from '../core/registry.ts';

type S = components['schemas'];

export type ResourceKind = S['CalendarResource']['kind'];

export interface ResourceRow {
  id: string;
  proto: string;
  kind: ResourceKind;
  name: string;
  orgUnitId: string;
  object?: S['ObjectRef'];
  timeZone: string;
  workday: S['CalendarWorkday'];
  active: boolean;
}

export interface BookingRow {
  id: string;
  proto: string;
  orgUnitId: string;
  title: string;
  window: S['TimeWindow'];
  resourceIds: string[];
  sourceKind: S['Booking']['sourceKind'] & string;
  relatedObject?: S['ObjectRef'];
  prepMinutes: number;
  cleanupMinutes: number;
  status: S['Booking']['status'];
  revision: number;
}

export interface CalendarData {
  resources: ResourceRow[];
  bookings: BookingRow[];
}

type WithCalendar = Org & { calendar?: CalendarData };

export const MSK = 'Europe/Moscow';
/** Смещение Москвы (без перехода на летнее время) — пояс всех ресурсов сида. */
const MSK_OFFSET = 3 * HOUR;
/** День эталона (Москва): брони сида — часы от его полуночи. */
const SEED_DAY = Date.UTC(2026, 9, 1) - MSK_OFFSET;
/** Рабочий день ресурса по умолчанию — сетка эталона 08:00–20:00 (calVM X(t)). */
export const WORKDAY: S['CalendarWorkday'] = { start: '08:00', end: '20:00' };

/** Порядок видов ресурсов в списке — порядок сида эталона. */
export const KIND_ORDER: readonly ResourceKind[] = ['vehicle', 'member', 'room', 'equipment'];

const KIND: Readonly<Record<Resource['kind'], ResourceKind>> = {
  vehicle: 'vehicle',
  staff: 'member',
  room: 'room',
  equipment: 'equipment',
};

/** Сотрудники-ресурсы сида → участники организации. */
const MEMBER_OF: Readonly<Record<string, string>> = {
  'res-iv': 'm-vasiliev',
  'res-am': 'm-morozova',
};

/** Раздел «spa» сида → подразделение организации (у «Альты» отдельного салона нет — Москва). */
const SPA_UNIT: Readonly<Record<string, string>> = {
  't-alta': 'r-msk',
  't-lotos': 'f-lotos-arb',
};

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const at = (hours: number): string => iso(SEED_DAY + Math.round(hours * 60) * MINUTE);

function resourceRow(proto: string, r: Resource): ResourceRow {
  const T = (id: string) => seedUuid(proto, id);
  const unit = r.unit === 'spa' ? (SPA_UNIT[proto] ?? r.unit) : r.unit;
  const row: ResourceRow = {
    id: T(r.id),
    proto: r.id,
    kind: KIND[r.kind],
    name: r.name,
    orgUnitId: T(unit),
    timeZone: MSK,
    workday: { ...WORKDAY },
    active: true,
  };
  const member = MEMBER_OF[r.id];
  if (r.kind === 'vehicle' && r.ref) {
    row.object = { moduleKey: 'fleet', entityType: 'vehicle', entityId: T(r.ref) };
  } else if (member) {
    row.object = { moduleKey: 'core', entityType: 'member', entityId: T(member) };
  }
  return row;
}

function bookingRow(proto: string, b: Booking, resources: readonly ResourceRow[]): BookingRow {
  const T = (id: string) => seedUuid(proto, id);
  const ids = b.res.map(T);
  const first = resources.find((r) => r.id === ids[0]);
  const row: BookingRow = {
    id: T(b.id),
    proto: b.id,
    orgUnitId: first?.orgUnitId ?? '',
    title: b.title,
    window: { startsAt: at(b.start), endsAt: at(b.end), timeZone: MSK },
    resourceIds: ids,
    sourceKind: !b.source
      ? 'break'
      : b.source.kind === 'vehicle'
        ? 'maintenance'
        : b.source.kind === 'trip'
          ? 'trip'
          : 'appointment',
    prepMinutes: Math.round((b.prep ?? 0) * 60),
    cleanupMinutes: Math.round((b.clean ?? 0) * 60),
    status: 'confirmed',
    revision: 1,
  };
  if (b.source) {
    const [moduleKey, entityType] =
      b.source.kind === 'trip'
        ? ['fleet', 'trip']
        : b.source.kind === 'vehicle'
          ? ['fleet', 'vehicle']
          : ['spa', 'appointment'];
    row.relatedObject = { moduleKey, entityType, entityId: T(b.source.id) };
  }
  return row;
}

/** Календарь организации из сида домена («Лотос» — ресурсы салона без утечки «Альты», PD-27). */
export function seedCalendar(org: Org): CalendarData {
  const seed = calendarSeed(org.proto, { prototypeLeaks: false });
  const resources = seed.resources.map((r) => resourceRow(org.proto, r));
  return {
    resources,
    bookings: seed.bookings.map((b) => bookingRow(org.proto, b, resources)),
  };
}

/** Календарь организации (сид при первом обращении — и для состояний, сохранённых до W4.06). */
export function calendarOf(org: Org): CalendarData {
  const x = org as WithCalendar;
  x.calendar ??= seedCalendar(org);
  return x.calendar;
}

// ---------------------------------------------------------------------------------------------
// Время

/** Занятость брони: окно с подготовкой и уборкой (busySpan эталона), мс. */
export const occupiedOf = (
  b: Pick<BookingRow, 'window' | 'prepMinutes' | 'cleanupMinutes'>,
): [number, number] => [
  Date.parse(b.window.startsAt) - b.prepMinutes * MINUTE,
  Date.parse(b.window.endsAt) + b.cleanupMinutes * MINUTE,
];

export const occupiedWindow = (b: BookingRow): S['TimeWindow'] => {
  const [a, z] = occupiedOf(b);
  return { startsAt: iso(a), endsAt: iso(z), timeZone: b.window.timeZone };
};

/** Начало московских суток момента `ms`. */
export const mskDayStart = (ms: number): number =>
  Math.floor((ms + MSK_OFFSET) / (24 * HOUR)) * 24 * HOUR - MSK_OFFSET;

const hhmm = (s: string): number => {
  const [h = 0, m = 0] = s.split(':').map(Number);
  return (h * 60 + m) * MINUTE;
};

/** Рабочий день ресурса в сутках `dayStart` (мс): [начало, конец). */
export const workdayOf = (r: ResourceRow, dayStart: number): [number, number] => [
  dayStart + hhmm(r.workday.start),
  dayStart + hhmm(r.workday.end),
];

export { iso };

// ---------------------------------------------------------------------------------------------
// Видимость

function subtree(org: Org, unitId: string): Set<string> {
  const out = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of org.units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}
export { subtree };

/** Право `key` участника в области «своё». */
const selfGrant = (t: TenantAccess, key: string, now: string): boolean =>
  !t.owner &&
  !!t.member &&
  grantsOf(t.org, t.member.id, now).some((g) => g.keys.includes(key) && g.scope.kind === 'self');

/** Ключ в любой области (владелец — все ключи). */
const anyGrant = (t: TenantAccess, key: string, now: string): boolean =>
  t.owner || (!!t.member && grantsOf(t.org, t.member.id, now).some((g) => g.keys.includes(key)));

/**
 * Свои ресурсы участника (ресурс-сотрудник — он сам) и ресурсы, забронированные вместе с ними в подтверждённых
 * бронях, не закончившихся до текущих суток: отменённая и прошлая бронь «своё» не расширяют.
 */
function ownResources(t: TenantAccess, cal: CalendarData, now: string): Set<string> {
  const me = t.member?.id;
  const today = mskDayStart(Date.parse(now));
  const own = new Set(
    cal.resources
      .filter((r) => me && r.object?.entityType === 'member' && r.object.entityId === me)
      .map((r) => r.id),
  );
  const out = new Set(own);
  for (const b of cal.bookings) {
    if (b.status !== 'confirmed' || occupiedOf(b)[1] <= today) continue;
    if (b.resourceIds.some((id) => own.has(id))) for (const id of b.resourceIds) out.add(id);
  }
  return out;
}

export interface CalendarView {
  t: TenantAccess;
  cal: CalendarData;
  /** Видимые ресурсы (id). */
  resources: Set<string>;
  canRead(b: BookingRow): boolean;
  lockOf(b: BookingRow): S['Booking']['rescheduleLock'];
}

/**
 * Календарь глазами участника (описание listCalendarResources и listCalendarBookings): ресурсы подразделений
 * в области calendar.bookings.read (self — свои и забронированные вместе с ними); машины — при подключённой
 * «Логистике» и с fleet.vehicles.read над их фирмой; бронь модуля — если участник читает её объект. В
 * Booking.resources — только видимые ресурсы; бронь со скрытым ресурсом получает запрет переноса permission.
 */
export function viewOf(ctx: HandlerContext): CalendarView {
  const t = ctx.org();
  const now = ctx.now();
  const cal = calendarOf(t.org);
  const fleetOn = t.org.modules.fleet?.state === 'active';
  const spaOn = t.org.modules.spa?.state === 'active';
  const read = unitsFor(t, 'calendar.bookings.read', now);
  const own = selfGrant(t, 'calendar.bookings.read', now) ? ownResources(t, cal, now) : new Set();
  const vehicles = unitsFor(t, 'fleet.vehicles.read', now);
  const resources = new Set(
    cal.resources
      .filter((r) => covers(read, r.orgUnitId) || own.has(r.id))
      .filter((r) => r.kind !== 'vehicle' || (fleetOn && covers(vehicles, r.orgUnitId)))
      .map((r) => r.id),
  );
  const manage = unitsFor(t, 'calendar.bookings.manage', now);
  const ownManage = selfGrant(t, 'calendar.bookings.manage', now)
    ? ownResources(t, cal, now)
    : new Set<string>();
  const canRead = (b: BookingRow): boolean => {
    if (!b.resourceIds.some((id) => resources.has(id))) return false;
    const o = b.relatedObject;
    if (b.sourceKind === 'trip') {
      if (!fleetOn || !o) return false;
      const trip = fleetOf(t.org).trips.find((x) => x.id === o.entityId);
      return !!trip && tripVisible(ctx, trip);
    }
    if (b.sourceKind === 'maintenance') {
      return b.resourceIds.every((id) => resources.has(id));
    }
    if (b.sourceKind === 'appointment') return spaOn && anyGrant(t, 'spa.appointments.read', now);
    return true;
  };
  const lockOf = (b: BookingRow): S['Booking']['rescheduleLock'] => {
    const may =
      covers(manage, b.orgUnitId) ||
      (ownManage.size > 0 && b.resourceIds.some((id) => ownManage.has(id)));
    // Ресурс брони, скрытый от участника, — тоже permission: календарь не двигает того, чего не показывает.
    if (!may || b.resourceIds.some((id) => !resources.has(id))) return 'permission';
    if (b.sourceKind === 'trip') return 'source_module';
    if (b.sourceKind === 'maintenance') return 'vehicle_card';
    if (b.sourceKind === 'break') return 'specialist_schedule';
    return undefined;
  };
  return { t, cal, resources, canRead, lockOf };
}

/** Тексты запрета переноса эталона (calVM lockText). */
export const LOCK_TEXT: Readonly<Record<string, string>> = {
  permission: 'Нет права «Изменять» в календаре.',
  source_module:
    'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
  specialist_schedule: 'Перерыв меняется в графике специалиста.',
  vehicle_card: 'Недоступность машины задаётся в карточке машины.',
};

export const resourceDto = (r: ResourceRow): S['CalendarResource'] => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  orgUnitId: r.orgUnitId,
  ...(r.object ? { object: { ...r.object } } : {}),
  timeZone: r.timeZone,
  workday: { ...r.workday },
  active: r.active,
});

export function bookingDto(v: CalendarView, b: BookingRow): S['Booking'] {
  const kindOf = (id: string): ResourceKind =>
    v.cal.resources.find((r) => r.id === id)?.kind ?? 'room';
  const lock = v.lockOf(b);
  return {
    id: b.id,
    orgUnitId: b.orgUnitId,
    title: b.title,
    window: { ...b.window },
    resources: b.resourceIds
      .filter((id) => v.resources.has(id))
      .map((id) => ({ kind: kindOf(id), resourceId: id })),
    ...(b.relatedObject ? { relatedObject: { ...b.relatedObject } } : {}),
    status: b.status,
    revision: b.revision,
    prepMinutes: b.prepMinutes,
    cleanupMinutes: b.cleanupMinutes,
    occupied: occupiedWindow(b),
    sourceKind: b.sourceKind,
    ...(lock ? { rescheduleLock: lock } : {}),
  };
}
