// Состояние логистики сценарного сервера (W2.00, контракт 0.5.0-stage2): проекция сида W0.12 (`logisticsSeed`)
// в строки контракта — машины, рейсы от плана до приёмки (TripPlan), брони, чек-листы, осмотры, дефекты, расходы,
// начисления, пул водителей. Состояние машины эталона ↔ Vehicle.status 0.1: free ↔ available, reserved ↔
// reserved, on_route ↔ in_use, review ↔ blocked, unavailable ↔ maintenance. Единицы контракта: кг, м, UTC.
import type { components } from '@ortus/api-client';
import {
  compat,
  DEP_CHECKS,
  logisticsSeed,
  RET_CHECKS,
  type Trip as DomainTrip,
  type Vehicle as DomainVehicle,
} from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';

import { grantsOf, isDriver, type TenantAccess } from '../core/access.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { MemberRow, Org } from '../core/state.ts';
import { temporaryAccessOpen } from './pool-rules.ts';

type S = components['schemas'];

export type VState = 'free' | 'reserved' | 'on_route' | 'review' | 'unavailable';

export interface VehicleRow {
  id: string;
  proto: string;
  orgUnitId: string;
  registrationNumber: string;
  displayName: string;
  bodyType: S['Vehicle']['bodyType'];
  capacity: S['VehicleCapacity'];
  temperatureMinC?: string;
  temperatureMaxC?: string;
  equipment: S['Vehicle']['equipment'];
  odometerKm: string;
  depot: string;
  /** Состояние карточки эталона (VEHICLE_STATE). */
  vstate: VState;
  note?: string;
  /** Рейс, за которым держится машина. */
  heldBy?: string;
  revision: number;
}

export interface TripRow {
  id: string;
  proto: string;
  number: string;
  title: string;
  orgUnitId: string;
  state: S['TripState'];
  plannedWindow: S['TimeWindow'];
  distanceKm?: string;
  cargo: S['TripCargo'];
  stops: S['TripStop'][];
  driverMemberId?: string;
  driverDisplayName?: string;
  vehicleId?: string;
  reservationId?: string;
  holdExpiresAt?: string;
  departureInspectionId?: string;
  returnInspectionId?: string;
  blockingDefectId?: string;
  reviews: S['TripReviewSummary'][];
  startedAt?: string;
  routeCompletedAt?: string;
  returnedAt?: string;
  acceptedAt?: string;
  revision: number;
  /** Начисление водителю, копейки (сид: trip.earnings); в DTO рейса не попадает (AC-05). */
  earningsMinor?: number;
}

export type InspectionRow = Omit<S['Inspection'], 'defects'>;

export interface DefectRow {
  id: string;
  vehicleId: string;
  inspectionId: string;
  tripId?: string;
  zone: string;
  description: string;
  severity: S['InspectionDefect']['severity'];
  state: S['InspectionDefect']['state'];
  reportedAt: string;
  reportedByMemberId: string;
  decision?: S['InspectionDefect']['decision'];
  decisionComment?: string;
  decidedByMemberId?: string;
  decidedAt?: string;
  revision: number;
}

/** Публикация водителя в пуле (fleet.pool_publications; W2.51) — поля DriverPoolPublication без названия фирмы. */
export interface PoolPublicationRow {
  id: string;
  proto: string;
  driverMemberId: string;
  driverDisplayName?: string;
  displayName: string;
  homeOrgUnitId: string;
  qualifications: string[];
  freeWindow: S['TimeWindow'];
  terms?: string;
  state: S['DriverPoolPublication']['state'];
  publishedByMemberId?: string;
  publishedAt: string;
  withdrawnAt?: string;
  withdrawnByMemberId?: string;
  withdrawalComment?: string;
  revision: number;
}

/** Время публикации водителей сида (08:00 по Москве; tools/gen/examples-w251.mjs). */
export const SEED_PUBLISHED_AT = '2026-10-01T05:00:00Z';

export interface FleetData {
  vehicles: VehicleRow[];
  trips: TripRow[];
  reservations: S['Reservation'][];
  checklists: S['InspectionChecklist'][];
  inspections: InspectionRow[];
  defects: DefectRow[];
  expenses: S['TripExpense'][];
  earnings: S['TripEarnings'][];
  pool: PoolPublicationRow[];
  transfers: S['DriverTransfer'][];
}

type WithFleet = Org & { fleet?: FleetData };

export const MSK = 'Europe/Moscow';
/** Срок удержания брони (LogisticsSettings.reservationTtlMinutes по умолчанию). */
export const HOLD_MINUTES = 30;
export const PHOTO_ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;

const BODY: Readonly<Record<string, S['Vehicle']['bodyType']>> = {
  Тент: 'tent',
  Фургон: 'van',
  Рефрижератор: 'refrigerated',
};
const BODY_LABEL: Readonly<Record<string, string>> = {
  tent: 'Тент',
  van: 'Фургон',
  refrigerated: 'Рефрижератор',
  box: 'Фургон',
  flatbed: 'Борт',
};
const STATUS: Readonly<Record<VState, S['Vehicle']['status']>> = {
  free: 'available',
  reserved: 'reserved',
  on_route: 'in_use',
  review: 'blocked',
  unavailable: 'maintenance',
};

const kg = (t: number): string => String(Math.round(t * 1000));

/** «01.10.2026» и «09:00» (Москва) → момент UTC. */
function mskAt(date: string, hhmm: string): string {
  const [dd, mm, yyyy] = date.split('.').map(Number) as [number, number, number];
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(yyyy, mm - 1, dd, h - 3, m)).toISOString().replace('.000Z', 'Z');
}

/** «09:00–13:00» → TimeWindow дня `date`. */
function windowOf(date: string, span: string): S['TimeWindow'] {
  const [from = '00:00', to = '00:00'] = span.split('–');
  return { startsAt: mskAt(date, from), endsAt: mskAt(date, to), timeZone: MSK };
}

function vehicleRow(proto: string, v: DomainVehicle): VehicleRow {
  const T = (id: string) => seedUuid(proto, id);
  const row: VehicleRow = {
    id: T(v.id),
    proto: v.id,
    orgUnitId: T(v.unit),
    registrationNumber: v.plate,
    displayName: v.model,
    bodyType: BODY[v.body] ?? 'van',
    // Ширины и высоты кузова в сиде прототипа нет — 2 м условно (PD-43: атрибуты вне домена).
    capacity: {
      payloadKg: kg(v.payloadT),
      volumeM3: String(v.volumeM3),
      cargoLengthM: String(v.lengthM),
      cargoWidthM: '2',
      cargoHeightM: '2',
    },
    equipment: v.temp ? ['refrigerator'] : [],
    odometerKm: String(v.odometer),
    depot: v.depot,
    vstate: v.state,
    revision: 1,
  };
  if (v.temp) {
    row.temperatureMinC = String(v.temp[0]);
    row.temperatureMaxC = String(v.temp[1]);
  }
  if (v.note) row.note = v.note;
  return row;
}

function tripRow(proto: string, t: DomainTrip): TripRow {
  const T = (id: string) => seedUuid(proto, id);
  const cargo: S['TripCargo'] = {
    description: t.cargo.kind,
    weightKg: kg(t.cargo.weightT),
    volumeM3: String(t.cargo.volumeM3),
    lengthM: String(t.cargo.lengthM),
  };
  if (t.cargo.temp) {
    cargo.temperatureMinC = String(t.cargo.temp[0]);
    cargo.temperatureMaxC = String(t.cargo.temp[1]);
  }
  const row: TripRow = {
    id: T(t.id),
    proto: t.id,
    number: t.id,
    title: t.title,
    orgUnitId: T(t.unit),
    state: t.status,
    plannedWindow: windowOf(t.date, t.window),
    distanceKm: String(t.distanceKm),
    cargo,
    stops: t.stops.map((s, i) => ({
      sequence: i + 1,
      op: s.op,
      address: s.name,
      plannedAt: mskAt(t.date, s.time),
      weightKg: kg(s.w),
      volumeM3: String(s.v),
    })),
    reviews: [],
    revision: 1,
  };
  if (t.driverId) {
    row.driverMemberId = T(t.driverId);
    if (t.driverName) row.driverDisplayName = t.driverName;
  }
  if (t.earnings !== undefined) row.earningsMinor = t.earnings * 100;
  return row;
}

const checklist = (
  proto: string,
  kind: 'departure' | 'return',
  list: readonly (readonly [string, string])[],
): S['InspectionChecklist'] => ({
  versionId: seedUuid(proto, `checklist:${kind}:1`),
  kind,
  items: list.map(([key, label]) => ({ key, label, required: true, failureBlocksRelease: false })),
  requiredPhotoRoles: [...PHOTO_ROLES],
});

type SeedPoolDriver = ReturnType<typeof logisticsSeed>['pool']['drivers'][number];

/** Публикация водителя сида: id — pool-<id прототипа> (seed-ids.yaml), опубликован в 08:00. */
function publicationOf(proto: string, d: SeedPoolDriver): PoolPublicationRow {
  return {
    id: seedUuid(proto, `pool-${d.id}`),
    proto: d.id,
    driverMemberId: seedUuid(proto, d.id),
    displayName: d.code,
    homeOrgUnitId: seedUuid(proto, d.unit),
    qualifications: d.qual.split(' · '),
    freeWindow: windowOf('01.10.2026', d.window),
    terms: d.terms,
    state: 'active',
    publishedAt: SEED_PUBLISHED_AT,
    revision: 1,
  };
}

/** Логистика организации из сида W0.12 (у организаций без автопарка — пустые списки и чек-листы). */
export function seedFleet(org: Org): void {
  const proto = org.proto;
  const seed = logisticsSeed(proto);
  const pool: PoolPublicationRow[] = seed.pool.drivers.map((d) => publicationOf(proto, d));
  (org as WithFleet).fleet = {
    vehicles: seed.vehicles.map((v) => vehicleRow(proto, v)),
    trips: seed.trips.map((t) => tripRow(proto, t)),
    reservations: [],
    checklists: [checklist(proto, 'departure', DEP_CHECKS), checklist(proto, 'return', RET_CHECKS)],
    inspections: [],
    defects: [],
    expenses: [],
    earnings: [],
    pool,
    transfers: [],
  };
}

/** Логистика организации (сид при первом обращении — для состояний, сохранённых до W2.00). */
export function fleetOf(org: Org): FleetData {
  const x = org as WithFleet;
  if (!x.fleet) seedFleet(org);
  const f = x.fleet as FleetData;
  // Состояния, сохранённые до W2.51: строки пула — без id и состояния публикации.
  if (f.pool.some((p) => !p.id)) {
    const seed = logisticsSeed(org.proto).pool.drivers;
    f.pool = f.pool.map((p) => {
      const d = seed.find((s) => s.id === p.proto);
      return p.id || !d ? p : publicationOf(org.proto, d);
    });
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// Области доступа

/** Подразделение и его потомки. */
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

/** Подразделения, где у участника есть право `key`; `all` — вся организация (владелец, область tenant). */
export function unitsFor(t: TenantAccess, key: string, now: string): Set<string> | 'all' {
  if (t.owner) return 'all';
  if (!t.member) return new Set();
  const out = new Set<string>();
  for (const g of grantsOf(t.org, t.member.id, now)) {
    if (!g.keys.includes(key)) continue;
    if (g.scope.kind === 'tenant') return 'all';
    if (g.scope.kind === 'org_unit') {
      for (const id of g.scope.resourceIds) for (const u of subtree(t.org, id)) out.add(u);
    }
  }
  return out;
}

export const covers = (units: Set<string> | 'all', unitId: string): boolean =>
  units === 'all' || units.has(unitId);

/** Участник действует как водитель (функция «Водитель»): видит только свои рейсы (D22). */
export function asDriver(t: TenantAccess, now: string): MemberRow | undefined {
  if (t.owner || !t.member) return undefined;
  return isDriver(t.org, t.member, now) ? t.member : undefined;
}

/** Рейс виден участнику с правом `key` (водитель — только свой). */
export function tripVisible(ctx: HandlerContext, trip: TripRow, key = 'fleet.trips.read'): boolean {
  const t = ctx.org();
  const driver = asDriver(t, ctx.now());
  if (driver) {
    return (
      trip.driverMemberId === driver.id &&
      temporaryAccessOpen(fleetOf(t.org), trip, driver.id, ctx.now())
    );
  }
  return covers(unitsFor(t, key, ctx.now()), trip.orgUnitId);
}

const lower = (id: string | undefined): string => (id ?? '').toLowerCase();

/** Рейс запроса (`tripId` пути) или 404. */
export function tripOr404(
  ctx: HandlerContext,
  key = 'fleet.trips.read',
  id = ctx.params.tripId,
): TripRow {
  const trip = fleetOf(ctx.org().org).trips.find((x) => x.id === lower(id));
  if (!trip || !tripVisible(ctx, trip, key)) fail('not_found', 'Рейс не найден.');
  return trip;
}

/** Рейс для команды с правом `manage`: невидимый — 404, видимый без права — 403. */
export function tripForCommand(ctx: HandlerContext, manage: string): TripRow {
  const trip = tripOr404(ctx);
  if (!tripVisible(ctx, trip, manage)) fail('forbidden_action');
  return trip;
}

/** Машина в области `fleet.vehicles.read` или 404. */
export function vehicleOr404(ctx: HandlerContext, id: string | undefined): VehicleRow {
  const t = ctx.org();
  const v = fleetOf(t.org).vehicles.find((x) => x.id === lower(id));
  if (!v || !covers(unitsFor(t, 'fleet.vehicles.read', ctx.now()), v.orgUnitId)) {
    fail('not_found', 'Машина не найдена.');
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Правила домена (compat) на строках контракта

const tempOf = (min?: string, max?: string): [number, number] | null =>
  min !== undefined && max !== undefined ? [Number(min), Number(max)] : null;

function domainVehicle(v: VehicleRow): DomainVehicle {
  const out: DomainVehicle = {
    id: v.id,
    unit: v.orgUnitId,
    model: v.displayName,
    plate: v.registrationNumber,
    body: BODY_LABEL[v.bodyType] ?? v.bodyType,
    payloadT: Number(v.capacity.payloadKg) / 1000,
    volumeM3: Number(v.capacity.volumeM3),
    lengthM: Number(v.capacity.cargoLengthM),
    temp: tempOf(v.temperatureMinC, v.temperatureMaxC),
    odometer: Number(v.odometerKm),
    state: v.vstate,
    depot: v.depot,
    heldBy: v.heldBy ?? null,
  };
  if (v.note) out.note = v.note;
  return out;
}

function domainTrip(t: TripRow): DomainTrip {
  return {
    id: t.id,
    unit: t.orgUnitId,
    title: t.title,
    date: '',
    window: '',
    distanceKm: Number(t.distanceKm ?? 0),
    driverId: t.driverMemberId ?? null,
    driverName: t.driverDisplayName ?? null,
    vehicleId: t.vehicleId ?? null,
    status: t.state === 'cancelled' ? 'planned' : t.state,
    cargo: {
      weightT: Number(t.cargo.weightKg) / 1000,
      volumeM3: Number(t.cargo.volumeM3),
      lengthM: Number(t.cargo.lengthM),
      temp: tempOf(t.cargo.temperatureMinC, t.cargo.temperatureMaxC),
      kind: t.cargo.description,
    },
    stops: [],
    dep: null,
    ret: null,
    expenses: [],
    review: null,
    defect: null,
  };
}

/** Совместимость машины с грузом рейса (models.js `compat`): причины — тексты эталона. */
export function compatOf(v: VehicleRow, t: TripRow) {
  return compat(domainVehicle(v), domainTrip(t));
}

/** Освободить машину, если она держится за рейсом `tripId`. */
export function freeVehicle(f: FleetData, vehicleId: string | undefined, tripId: string): void {
  const v = f.vehicles.find((x) => x.id === vehicleId);
  if (!v || v.heldBy !== tripId) return;
  if (v.vstate === 'reserved') v.vstate = 'free';
  delete v.heldBy;
  v.revision++;
}

/** Снять действующую бронь рейса. */
export function releaseHold(f: FleetData, trip: TripRow): void {
  const r = f.reservations.find((x) => x.id === trip.reservationId);
  if (r && r.state === 'held') {
    r.state = 'released';
    r.revision++;
  }
  delete trip.reservationId;
  delete trip.holdExpiresAt;
}

// ---------------------------------------------------------------------------------------------
// Тела контракта

export function vehicleDto(v: VehicleRow): S['Vehicle'] {
  const out: S['Vehicle'] = {
    id: v.id,
    orgUnitId: v.orgUnitId,
    registrationNumber: v.registrationNumber,
    displayName: v.displayName,
    bodyType: v.bodyType,
    capacity: { ...v.capacity },
    equipment: [...v.equipment],
    status: STATUS[v.vstate],
    odometerKm: v.odometerKm,
    revision: v.revision,
  };
  return {
    id: out.id,
    orgUnitId: out.orgUnitId,
    registrationNumber: out.registrationNumber,
    displayName: out.displayName,
    bodyType: out.bodyType,
    capacity: out.capacity,
    ...(v.temperatureMinC !== undefined ? { temperatureMinC: v.temperatureMinC } : {}),
    ...(v.temperatureMaxC !== undefined ? { temperatureMaxC: v.temperatureMaxC } : {}),
    equipment: out.equipment,
    status: out.status,
    odometerKm: out.odometerKm,
    revision: out.revision,
    ...(v.heldBy ? { heldByTripId: v.heldBy } : {}),
    ...(v.note ? { statusNote: v.note } : {}),
    depot: v.depot,
  };
}

/** TripPlan — поля в порядке схемы (так же — генератор примеров tools/gen/examples-w200.mjs). */
export function planDto(t: TripRow): S['TripPlan'] {
  const opt = <K extends keyof TripRow>(k: K) => (t[k] !== undefined ? { [k]: t[k] } : {});
  const last = t.reviews.at(-1);
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    orgUnitId: t.orgUnitId,
    state: t.state,
    plannedWindow: { ...t.plannedWindow },
    ...opt('distanceKm'),
    cargo: { ...t.cargo },
    stops: t.stops.map((s) => ({ ...s })),
    ...opt('driverMemberId'),
    ...opt('driverDisplayName'),
    ...opt('vehicleId'),
    ...opt('reservationId'),
    ...opt('holdExpiresAt'),
    ...opt('departureInspectionId'),
    ...opt('returnInspectionId'),
    ...opt('blockingDefectId'),
    ...(last ? { lastReview: structuredClone(last) } : {}),
    ...opt('startedAt'),
    ...opt('routeCompletedAt'),
    ...opt('returnedAt'),
    ...opt('acceptedAt'),
    revision: t.revision,
  } as S['TripPlan'];
}

const TRIP_STATUS: Partial<Record<S['TripState'], S['Trip']['status']>> = {
  on_route: 'in_progress',
  returning: 'in_progress',
  rework: 'in_progress',
  submitted: 'returned_pending_review',
  accepted: 'approved',
};

/** Trip 0.1 — проекция начатого рейса (после startTrip); до старта — undefined. */
export function tripDto(t: TripRow): S['Trip'] | undefined {
  const status = TRIP_STATUS[t.state];
  if (!status || !t.vehicleId || !t.driverMemberId || !t.departureInspectionId || !t.startedAt) {
    return undefined;
  }
  return {
    id: t.id,
    vehicleId: t.vehicleId,
    driverMemberId: t.driverMemberId,
    orgUnitId: t.orgUnitId,
    departureInspectionId: t.departureInspectionId,
    ...(t.returnInspectionId ? { returnInspectionId: t.returnInspectionId } : {}),
    status,
    startedAt: t.startedAt,
    ...(t.returnedAt ? { returnedAt: t.returnedAt } : {}),
    revision: t.revision,
  };
}

export function defectDto(f: FleetData, d: DefectRow): S['InspectionDefect'] {
  const v = f.vehicles.find((x) => x.id === d.vehicleId);
  const t = d.tripId ? f.trips.find((x) => x.id === d.tripId) : undefined;
  const opt = <K extends keyof DefectRow>(k: K) => (d[k] !== undefined ? { [k]: d[k] } : {});
  return {
    id: d.id,
    vehicleId: d.vehicleId,
    inspectionId: d.inspectionId,
    ...opt('tripId'),
    zone: d.zone,
    description: d.description,
    severity: d.severity,
    state: d.state,
    reportedAt: d.reportedAt,
    reportedByMemberId: d.reportedByMemberId,
    ...opt('decision'),
    ...opt('decisionComment'),
    ...opt('decidedByMemberId'),
    ...opt('decidedAt'),
    ...(t ? { tripNumber: t.number } : {}),
    ...(v ? { vehicleDisplayName: v.displayName, registrationNumber: v.registrationNumber } : {}),
    ...(t?.driverDisplayName ? { driverDisplayName: t.driverDisplayName } : {}),
    revision: d.revision,
  } as S['InspectionDefect'];
}

export function inspectionDto(f: FleetData, i: InspectionRow): S['Inspection'] {
  return {
    ...structuredClone(i),
    defects: f.defects.filter((d) => d.inspectionId === i.id).map((d) => defectDto(f, d)),
  };
}

// ---------------------------------------------------------------------------------------------
// Входящие (адресаты — аккаунты участников)

/** Аккаунты владельцев и участников с правом `key` на подразделение (адресаты уведомлений менеджеру). */
export function accountsWith(ctx: HandlerContext, key: string, unitId: string): string[] {
  const t = ctx.org();
  const now = ctx.now();
  const out = new Set<string>();
  for (const m of ctx.s.memberships) {
    if (m.tenantId !== t.tenant.id || m.status !== 'active') continue;
    const member = t.org.members.find((x) => x.id === m.memberId);
    const access: TenantAccess = { ...t, membership: m, member, owner: m.owner };
    if (m.owner || covers(unitsFor(access, key, now), unitId)) out.add(m.accountId);
  }
  return [...out];
}

export function notify(
  ctx: HandlerContext,
  accountIds: readonly string[],
  n: { kind: string; severity: 'info' | 'warning' | 'critical'; title: string; tripId?: string },
): void {
  const org = ctx.org().org;
  for (const accountId of accountIds) {
    org.notifications.push({
      accountId,
      id: ctx.newId(),
      kind: n.kind,
      severity: n.severity,
      title: n.title,
      ...(n.tripId
        ? { object: { moduleKey: 'fleet', entityType: 'trip', entityId: n.tripId } }
        : {}),
      createdAt: ctx.now(),
      readAt: null,
    });
  }
}

/** Аккаунт участника (водителя рейса) для уведомления. */
export const accountOf = (org: Org, memberId: string | undefined): string[] => {
  const m = org.members.find((x) => x.id === memberId);
  return m?.userId ? [m.userId] : [];
};
