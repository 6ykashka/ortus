// «Салон и SPA» сценарного сервера (W5.21 на контракте 0.12.0-stage5; backend — W5.20, склад — W5.10): услуги с
// техкартой, визиты и номенклатура салона на сиде эталона (design/ortus/extra-data.js 14.10, снимок 19.10): масло 250 мл и
// крем 12 г, визиты ap-1…ap-3 на календарных бронях b-a1…b-a3. Цены услуг эталон не задаёт — значения демо
// (Q-W5.21-7). Визит держит снимок услуги на момент записи (длительность, буферы, цена, техкарта).
// Остаток номенклатуры — в складе сценарного сервера (msw/inventory, W5.11; сид — отсюда): списание по техкарте один раз,
// нехватка — 409 без частичных списаний (контракт; эталон списывал часть). Права по области: подразделение (tenant, org_unit) и «своё».
import type { components } from '@ortus/api-client';
import { calendarSeed } from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import {
  type BookingRow,
  calendarOf,
  iso,
  MSK,
  mskDayStart,
  type ResourceRow,
  workdayOf,
} from '../calendar/state.ts';
import { grantsOf, type TenantAccess } from '../core/access.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { Org } from '../core/state.ts';
import { covers, unitsFor } from '../fleet/state.ts';

type S = components['schemas'];

export type Unit = 'ml' | 'g' | 'piece';
export type ApptStatus = S['Appointment']['status'];

export interface ItemRow {
  id: string;
  proto: string;
  orgUnitId: string;
  name: string;
  sku: string;
  baseUnit: Unit;
  /** Сид остатка в базовой единице; текущий остаток держит склад (msw/inventory), здесь не обновляется. */
  onHand: number;
  revision: number;
}

export interface RecipeLine {
  itemId: string;
  quantity: string;
  unit: Unit;
}

export interface ServiceRow {
  id: string;
  proto: string;
  orgUnitId: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Копейки. */
  price: number;
  requiredEquipmentIds: string[];
  recipe: RecipeLine[];
  revision: number;
}

export interface ApptRow {
  id: string;
  proto: string;
  orgUnitId: string;
  serviceId: string;
  /** Снимок услуги на момент записи (ревизия, буферы, цена, техкарта). */
  serviceRevision: number;
  recipe: RecipeLine[];
  price: number;
  clientId: string;
  /** Подпись клиента для названия календарной брони (контракт хранит только `clientId`). */
  clientName: string;
  practitionerMemberId: string;
  roomId: string;
  equipmentIds: string[];
  bookingId: string;
  status: ApptStatus;
  revision: number;
  performedAt: string | null;
  finalPrice: number | null;
  /** Фактический расход (после `overrides`). */
  movementIds: string[];
}

export interface SpaData {
  items: ItemRow[];
  services: ServiceRow[];
  appointments: ApptRow[];
  seq: number;
}

type WithSpa = Org & { spa?: SpaData };

/** Рабочие ключи салона. */
export const SPA_KEYS = {
  servicesRead: 'spa.services.read',
  servicesManage: 'spa.services.manage',
  read: 'spa.appointments.read',
  create: 'spa.appointments.create',
  perform: 'spa.appointments.perform',
  complete: 'spa.appointments.complete',
  override: 'inventory.consumption.override',
} as const;

const T = (proto: string, id: string): string => seedUuid(proto, id);

/** Услуги салона (extra-data.js: техкарты — масло 30/40/20 мл, крем 20 г; буферы визитов). Цены — демо (Q-W5.21-7). */
const SERVICES = [
  {
    id: 'svc-classic',
    name: 'Классический массаж',
    min: 60,
    before: 0,
    after: 15,
    price: 320000,
    equipment: [] as string[],
    recipe: [['oil', 30]],
  },
  {
    id: 'svc-ritual',
    name: 'SPA-ритуал',
    min: 90,
    before: 15,
    after: 15,
    price: 650000,
    equipment: ['res-table'],
    recipe: [
      ['oil', 40],
      ['cream', 20],
    ],
  },
  {
    id: 'svc-back',
    name: 'Массаж спины',
    min: 45,
    before: 0,
    after: 15,
    price: 200000,
    equipment: [] as string[],
    recipe: [['oil', 20]],
  },
] as const;

/** Визиты эталона → услуга, клиент. */
const VISITS: Readonly<Record<string, { service: string; client: string }>> = {
  'ap-1': { service: 'svc-classic', client: 'Мария К.' },
  'ap-2': { service: 'svc-ritual', client: 'Ольга Р.' },
  'ap-3': { service: 'svc-back', client: 'Екатерина Л.' },
};

const money = (minor: number): S['Money'] => ({ amountMinor: minor, currency: 'RUB' });

/** Услуги, номенклатура и визиты «Альты» и «Лотоса» на календарных бронях сида. */
export function seedSpa(org: Org): SpaData {
  const cal = calendarOf(org);
  const seed = calendarSeed(org.proto, { prototypeLeaks: false });
  const room = cal.resources.find((r) => r.kind === 'room');
  const unit = room?.orgUnitId ?? org.units[0]?.id ?? '';
  const id = (x: string): string => T(org.proto, x);
  const items: ItemRow[] = [
    {
      id: id('inv-oil'),
      proto: 'oil',
      orgUnitId: unit,
      name: 'Масло массажное',
      sku: 'OIL-250',
      baseUnit: 'ml',
      onHand: 250,
      revision: 1,
    },
    {
      id: id('inv-cream'),
      proto: 'cream',
      orgUnitId: unit,
      name: 'Крем восстанавливающий',
      sku: 'CRM-12',
      baseUnit: 'g',
      onHand: 12,
      revision: 1,
    },
  ];
  const itemOf = (p: string): ItemRow => items.find((i) => i.proto === p) as ItemRow;
  const services: ServiceRow[] = SERVICES.map((s) => ({
    id: id(s.id),
    proto: s.id,
    orgUnitId: unit,
    name: s.name,
    durationMinutes: s.min,
    bufferBeforeMinutes: s.before,
    bufferAfterMinutes: s.after,
    price: s.price,
    requiredEquipmentIds: s.equipment.map(id),
    recipe: s.recipe.map(([p, q]) => ({
      itemId: itemOf(p).id,
      quantity: String(q),
      unit: itemOf(p).baseUnit,
    })),
    revision: 1,
  }));
  const appointments: ApptRow[] = [];
  for (const b of seed.bookings) {
    if (b.source?.kind !== 'appointment') continue;
    const visit = VISITS[b.source.id];
    const booking = cal.bookings.find((x) => x.id === id(b.id));
    const svc = services.find((s) => s.proto === visit?.service);
    if (!visit || !booking || !svc) continue;
    const practitioner = cal.resources.find(
      (r) => r.kind === 'member' && booking.resourceIds.includes(r.id),
    );
    const roomId = booking.resourceIds.find(
      (rid) => cal.resources.find((r) => r.id === rid)?.kind === 'room',
    );
    if (!practitioner?.object || !roomId) continue;
    appointments.push({
      id: id(b.source.id),
      proto: b.source.id,
      orgUnitId: booking.orgUnitId,
      serviceId: svc.id,
      serviceRevision: svc.revision,
      recipe: svc.recipe.map((l) => ({ ...l })),
      price: svc.price,
      clientId: id(`cl-${b.source.id}`),
      clientName: visit.client,
      practitionerMemberId: practitioner.object.entityId,
      roomId,
      equipmentIds: booking.resourceIds.filter(
        (rid) => cal.resources.find((r) => r.id === rid)?.kind === 'equipment',
      ),
      bookingId: booking.id,
      status: 'confirmed',
      revision: 1,
      performedAt: null,
      finalPrice: null,
      movementIds: [],
    });
  }
  return { items, services, appointments, seq: 0 };
}

/** Салон организации (сид при первом обращении). */
export function spaOf(org: Org): SpaData {
  const x = org as WithSpa;
  x.spa ??= seedSpa(org);
  return x.spa;
}

/** Право `key` в области «своё». */
const selfGrant = (t: TenantAccess, key: string, now: string): boolean =>
  !t.owner &&
  !!t.member &&
  grantsOf(t.org, t.member.id, now).some((g) => g.keys.includes(key) && g.scope.kind === 'self');

export interface SpaView {
  t: TenantAccess;
  data: SpaData;
  now: string;
  /** Подразделения с правом `key` (организация — `all`). */
  units(key: string): Set<string> | 'all';
  /** Участник читает визиты только свои (область «своё»), без подразделений. */
  selfOnly(key: string): boolean;
  /** Визит виден: подразделение в области права или это визит специалиста в области «своё». */
  visible(a: ApptRow, key?: string): boolean;
  /** Право по визиту (подразделение или «своё» у своего специалиста). */
  can(a: ApptRow, key: string): boolean;
}

export function viewOf(ctx: HandlerContext): SpaView {
  const t = ctx.org();
  const now = ctx.now();
  const data = spaOf(t.org);
  const units = (key: string): Set<string> | 'all' => unitsFor(t, key, now);
  const can = (a: ApptRow, key: string): boolean =>
    covers(units(key), a.orgUnitId) ||
    (selfGrant(t, key, now) && !!t.member && a.practitionerMemberId === t.member.id);
  return {
    t,
    data,
    now,
    units,
    selfOnly: (key) => {
      const u = units(key);
      return u !== 'all' && u.size === 0 && selfGrant(t, key, now);
    },
    visible: (a, key = SPA_KEYS.read) => can(a, key),
    can,
  };
}

// ---------------------------------------------------------------------------------------------
// Представление

const qty = (n: number): string => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));

export const serviceDto = (s: ServiceRow): S['SpaService'] => ({
  id: s.id,
  orgUnitId: s.orgUnitId,
  name: s.name,
  durationMinutes: s.durationMinutes,
  bufferBeforeMinutes: s.bufferBeforeMinutes,
  bufferAfterMinutes: s.bufferAfterMinutes,
  price: money(s.price),
  requiredEquipmentIds: [...s.requiredEquipmentIds],
  recipe: s.recipe.map((l) => ({ ...l })),
  revision: s.revision,
});

export const itemDto = (i: ItemRow): S['InventoryItem'] => ({
  id: i.id,
  orgUnitId: i.orgUnitId,
  name: i.name,
  sku: i.sku,
  baseUnit: i.baseUnit,
  trackLots: false,
  revision: i.revision,
});

export function appointmentDto(v: SpaView, a: ApptRow): S['Appointment'] {
  const b = calendarOf(v.t.org).bookings.find((x) => x.id === a.bookingId);
  return {
    id: a.id,
    orgUnitId: a.orgUnitId,
    serviceId: a.serviceId,
    serviceRevision: a.serviceRevision,
    clientId: a.clientId,
    practitionerMemberId: a.practitionerMemberId,
    roomId: a.roomId,
    equipmentIds: [...a.equipmentIds],
    window: b ? { ...b.window } : { startsAt: iso(0), endsAt: iso(0), timeZone: MSK },
    bookingId: a.bookingId,
    status: a.status,
    revision: a.revision,
    ...(a.performedAt ? { performedAt: a.performedAt } : {}),
    ...(a.finalPrice !== null ? { finalPrice: money(a.finalPrice) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Время и ресурсы

export const bookingOf = (v: SpaView, a: ApptRow): BookingRow | undefined =>
  calendarOf(v.t.org).bookings.find((x) => x.id === a.bookingId);

/** Ресурс-специалист участника (календарь: ресурс с объектом `member`). */
export const practitionerResource = (v: SpaView, memberId: string): ResourceRow | undefined =>
  calendarOf(v.t.org).resources.find(
    (r) => r.kind === 'member' && r.object?.entityId === memberId && r.active,
  );

export const bookingTitle = (service: string, client: string): string => `${service} · ${client}`;

/** Начало и конец рабочего дня всех ресурсов (сутки начала визита). */
export function inWorkday(rs: readonly ResourceRow[], occ: [number, number], day: number): boolean {
  return rs.every((r) => {
    const [a, z] = workdayOf(r, day);
    return occ[0] >= a && occ[1] <= z;
  });
}

export const dayOf = (startMs: number): number => mskDayStart(startMs);
export const toQty = qty;

export const UNIT_RU: Readonly<Record<Unit, string>> = { ml: 'мл', g: 'г', piece: 'шт' };

/** Склад салона (wh-spa): сид общего склада сценарного сервера (msw/inventory). */
export const warehouseOf = (org: Org): S['Warehouse'] => ({
  id: T(org.proto, 'wh-spa'),
  orgUnitId: spaOf(org).items[0]?.orgUnitId ?? '',
  name: 'Склад салона',
  archived: false,
  revision: 1,
});
