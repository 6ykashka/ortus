// W2.20 · Модель «Рабочего места логиста» (fleetVM :3249–3307, 03-logistics.md §5): тела контракта 0.5.0-stage2
// (Vehicle, TripPlan) → строки домена W0.12 (`compat`, `legs` — те же правила и тексты, что проверяет сервер),
// счётчики, порядок и фильтр подбора, строки машин, карточка рейса, участки, вкладки, область владельца и право на
// подразделение по возможностям /me/context. Состояние машины ↔ Vehicle.status — 03 §17.3; масса — кг ↔ т.
import type { components } from '@ortus/api-client';
import { num } from '@ortus/domain';
import {
  compat,
  legs,
  type Trip as DomainTrip,
  TRIP_STATE,
  tempLabel,
  type Vehicle as DomainVehicle,
  VEHICLE_STATE,
  type VehicleState,
} from '@ortus/domain/modules';
import type { ScopedCapabilityLike } from '@ortus/domain/nav';
import { format, logisticsManager, shell } from '@ortus/texts';

import { FLEET_TEXT } from './texts.ts';

type S = components['schemas'];
type OrgUnit = S['OrgUnit'];

const L = logisticsManager.fleet;

export type Filter = 'all' | 'fit' | 'free';
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

export interface Stats {
  free: number;
  busy: number;
  review: number;
  unavailable: number;
}

export interface Check {
  text: string;
  ok: boolean;
}

export interface Row {
  id: string;
  model: string;
  plate: string;
  icon: 'ac_unit' | 'local_shipping';
  sub: string;
  chip: Chip;
  checks: Check[];
  picked: boolean;
  /** Кнопка строки: «Назначить на рейс», «Не подходит», «Недоступна» или нет кнопки. */
  action: 'assign' | 'unfit' | 'unavailable' | null;
}

export interface Card {
  title: string;
  when: string;
  chip: Chip;
  cargo: string;
  req: string;
  driver: string;
  noDriver: boolean;
  vehicle: string;
  route: string;
}

export interface LegRow {
  n: number;
  time: string;
  name: string;
  op: string;
  vPct: string;
  wPct: string;
  vW: string;
  wW: string;
  vBar: 'ok' | 'high' | 'over';
  wBar: 'ok' | 'high' | 'over';
  after: string;
}

export interface TabRow {
  id: string;
  title: string;
  sub: string;
  selected: boolean;
}

export interface Access {
  owner: boolean;
  caps: readonly ScopedCapabilityLike[];
  units: readonly OrgUnit[];
}

const STATE: Readonly<Record<S['Vehicle']['status'], VehicleState>> = {
  available: 'free',
  reserved: 'reserved',
  in_use: 'on_route',
  blocked: 'review',
  maintenance: 'unavailable',
};

const pair = (min?: string, max?: string): [number, number] | null =>
  min !== undefined && max !== undefined ? [Number(min), Number(max)] : null;

/** Машина контракта → строка домена: т, м³, м; состояние эталона; причина и рейс брони. */
export function vehicleOf(v: S['Vehicle']): DomainVehicle {
  const out: DomainVehicle = {
    id: v.id,
    unit: v.orgUnitId,
    model: v.displayName,
    plate: v.registrationNumber,
    body: FLEET_TEXT.bodyTypes[v.bodyType],
    payloadT: Number(v.capacity.payloadKg) / 1000,
    volumeM3: Number(v.capacity.volumeM3),
    lengthM: Number(v.capacity.cargoLengthM),
    temp: pair(v.temperatureMinC, v.temperatureMaxC),
    odometer: Number(v.odometerKm),
    state: STATE[v.status],
    depot: v.depot ?? '',
    heldBy: v.heldByTripId ?? null,
  };
  if (v.statusNote) out.note = v.statusNote;
  return out;
}

const parts = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...o }).format(new Date(iso));

/** «09:00» в часовом поясе рейса. */
export const clockOf = (iso: string, tz: string): string =>
  parts(iso, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «01.10.2026» в часовом поясе рейса. */
export const dayOf = (iso: string, tz: string): string =>
  parts(iso, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Рейс контракта → строка домена: дата и окно по часовому поясу рейса, точки в т и м³. */
export function tripOf(t: S['TripPlan']): DomainTrip {
  const tz = t.plannedWindow.timeZone;
  const w = t.plannedWindow;
  return {
    id: t.id,
    unit: t.orgUnitId,
    title: t.title,
    date: dayOf(w.startsAt, tz),
    window: `${clockOf(w.startsAt, tz)}–${clockOf(w.endsAt, tz)}`,
    distanceKm: Number(t.distanceKm ?? 0),
    driverId: t.driverMemberId ?? null,
    driverName: t.driverDisplayName ?? null,
    vehicleId: t.vehicleId ?? null,
    status: t.state === 'cancelled' ? 'planned' : t.state,
    cargo: {
      weightT: Number(t.cargo.weightKg) / 1000,
      volumeM3: Number(t.cargo.volumeM3),
      lengthM: Number(t.cargo.lengthM),
      temp: pair(t.cargo.temperatureMinC, t.cargo.temperatureMaxC),
      kind: t.cargo.description,
    },
    stops: t.stops.map((s) => ({
      time: s.plannedAt ? clockOf(s.plannedAt, tz) : '',
      name: s.address,
      op: s.op,
      w: Number(s.weightKg) / 1000,
      v: Number(s.volumeM3),
    })),
    dep: null,
    ret: null,
    expenses: [],
    review: null,
    defect: null,
  };
}

/** Рейсы рабочего места: отменённых в TRIP_STATE эталона нет. */
export const visibleTrips = (trips: readonly S['TripPlan'][]): S['TripPlan'][] =>
  trips.filter((t) => t.state !== 'cancelled');

/** Счётчики области (:3256–3262): свободно, в брони или рейсе, ждут приёмки, недоступно. */
export function stats(vs: readonly DomainVehicle[]): Stats {
  const n = (...st: VehicleState[]) => vs.filter((v) => st.includes(v.state)).length;
  return {
    free: n('free'),
    busy: n('reserved', 'on_route'),
    review: n('review'),
    unavailable: n('unavailable'),
  };
}

/** Машина для загрузки (:3270): выбранная, назначенная, первая подходящая и свободная. */
export function pickOf(
  vs: readonly DomainVehicle[],
  t: S['TripPlan'],
  pick: string | null,
): DomainVehicle | null {
  const dt = tripOf(t);
  return (
    vs.find((v) => v.id === pick) ??
    vs.find((v) => v.id === t.vehicleId) ??
    vs.find((v) => compat(v, dt).ok) ??
    null
  );
}

const chipOf = (s: { label: string; tone: string; icon: string }, label = s.label): Chip => ({
  label,
  tone: s.tone as Tone,
  icon: s.icon,
});

/** Строки подбора (:3266–3302): фильтр, порядок «своя → подходит и свободна → подходит», чипы и кнопки. */
export function rows(
  vs: readonly DomainVehicle[],
  t: S['TripPlan'],
  o: {
    filter: Filter;
    pick: DomainVehicle | null;
    canEdit: boolean;
    unitLabel: (id: string) => string;
  },
): Row[] {
  const dt = tripOf(t);
  return vs
    .map((x) => ({ x, c: compat(x, dt), mine: x.heldBy === t.id }))
    .filter(({ x, c }) =>
      o.filter === 'fit' ? c.fit : o.filter === 'free' ? x.state === 'free' : true,
    )
    .sort((a, b) => +b.mine - +a.mine || +b.c.ok - +a.c.ok || +b.c.fit - +a.c.fit)
    .map(({ x, c, mine }) => {
      const st = VEHICLE_STATE[x.state];
      const chip = mine
        ? {
            label: format(L.assignedTo, { trip: t.number }),
            tone: 'info' as const,
            icon: 'event_available',
          }
        : chipOf(st, x.note ? format(L.stateNote, { state: st.label, note: x.note }) : st.label);
      const action: Row['action'] =
        c.ok && !mine && o.canEdit
          ? 'assign'
          : !mine && !c.ok
            ? c.fit
              ? 'unavailable'
              : 'unfit'
            : null;
      return {
        id: x.id,
        model: x.model,
        plate: x.plate,
        icon: x.temp ? 'ac_unit' : 'local_shipping',
        // Без стоянки (машина импорта CSV, W2.50) — без последнего «· {depot}» подписи.
        sub: format(L.vehicleSub, {
          body: x.body,
          unit: o.unitLabel(x.unit),
          depot: x.depot,
        }).replace(/ · $/, ''),
        chip,
        checks: c.checks.map((k) => ({
          text: format(L.check, {
            label: k.label,
            value: k.value,
            need: k.need && !k.ok ? k.need : 'none',
          }),
          ok: k.ok,
        })),
        picked: o.pick?.id === x.id,
        action,
      };
    });
}

/** Карточка рейса (:3281–3287). `assigned` — машина рейса из списка области. */
export function card(t: S['TripPlan'], assigned: DomainVehicle | undefined): Card {
  const d = tripOf(t);
  const st = TRIP_STATE[d.status];
  const tt = L.trip;
  return {
    title: format(L.tripTitle, { trip: t.number, title: t.title }),
    when: format(L.tripWhen, { date: d.date, window: d.window }),
    chip: chipOf(st),
    cargo: format(L.cargoValue, {
      kind: d.cargo.kind,
      mass: num(d.cargo.weightT),
      volume: num(d.cargo.volumeM3),
    }),
    req: format(tt.body, {
      length: num(d.cargo.lengthM),
      temp: d.cargo.temp ? tempLabel(d.cargo.temp) : 'none',
    }),
    driver: t.driverDisplayName ?? tt.notAssigned,
    noDriver: !t.driverMemberId,
    vehicle: assigned
      ? format(L.vehicleValue, { model: assigned.model, plate: assigned.plate })
      : t.driverMemberId
        ? tt.driverPicks
        : tt.notChosen,
    route: format(L.routeValue, { count: d.stops.length, km: num(d.distanceKm) }),
  };
}

const bar = (p: number | null): LegRow['vBar'] =>
  p !== null && p > 100 ? 'over' : p !== null && p > 90 ? 'high' : 'ok';

/** «Маршрут и загрузка по участкам» (:3274–3277): после каждой точки, проценты — от выбранной машины. */
export function legRows(t: S['TripPlan'], pick: DomainVehicle | null): LegRow[] {
  const tt = L.trip;
  return legs(tripOf(t), pick ?? undefined).map((l, i) => ({
    n: i + 1,
    time: l.time,
    name: l.name,
    op: format(l.op === 'load' ? tt.load : tt.unload, { volume: num(l.v), mass: num(l.w) }),
    vPct: `${l.vPct ?? 0}%`,
    wPct: `${l.wPct ?? 0}%`,
    vW: `${Math.min(100, l.vPct ?? 0)}%`,
    wW: `${Math.min(100, l.wPct ?? 0)}%`,
    vBar: bar(l.vPct),
    wBar: bar(l.wPct),
    after: format(tt.afterStop, { volume: num(l.vAfter), mass: num(l.wAfter) }),
  }));
}

export const legFor = (pick: DomainVehicle | null): string =>
  pick
    ? format(L.legFor, { model: pick.model, volume: num(pick.volumeM3), mass: num(pick.payloadT) })
    : L.pickVehicle;

/** Вкладки «Рейсы» (:3280). */
export const tabsOf = (trips: readonly S['TripPlan'][], sel: string): TabRow[] =>
  visibleTrips(trips).map((t) => {
    const d = tripOf(t);
    return {
      id: t.id,
      title: format(L.tripTitle, { trip: t.number, title: t.title }),
      sub: format(L.tabSub, { window: d.window, state: TRIP_STATE[d.status].label }),
      selected: t.id === sel,
    };
  });

/** Подразделение и все его потомки. */
export function subtree(units: readonly OrgUnit[], root: string): Set<string> {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Право `key` на подразделение: владелец, область организации или подразделения (с потомками). */
export function may(a: Access, key: string, unitId: string): boolean {
  if (a.owner) return true;
  return a.caps.some((c) => {
    if (c.permission !== key) return false;
    if (c.scope.kind === 'tenant') return true;
    if (c.scope.kind !== 'org_unit') return false;
    return c.scope.resourceIds.some(
      (r) => r === unitId || (c.scope.includeDescendants && subtree(a.units, r).has(unitId)),
    );
  });
}

/** Назначать машину можно рейсу `planned | assigned` с правом на его подразделение, не в режиме чтения (:3265). */
export const canEdit = (t: S['TripPlan'], o: { readOnly: boolean; may: boolean }): boolean =>
  o.may && !o.readOnly && (t.state === 'planned' || t.state === 'assigned');

/**
 * Подпись подразделения: «{регион} / {фирма}» или «Регион {регион}» (scopeLabel models.js:258). Регион — по `kind`:
 * родителя вне области org_units.read сервер и MSW отдают как `parentId: null` (Q-W2.53-5, Q-W2.56-1).
 */
function unitCrumb(units: readonly OrgUnit[], id: string): string {
  const u = units.find((x) => x.id === id);
  if (!u) return '';
  const parent = u.parentId ? units.find((x) => x.id === u.parentId) : undefined;
  if (parent) return format(shell.header.scopeFirm, { region: parent.name, firm: u.name });
  return u.kind === 'region' ? format(L.crumbRegion, { region: u.name }) : u.name;
}

/** Крошка (:3263): владелец — область селекта шапки; сотрудник — подразделение права логистики. */
export function crumb(o: {
  owner: boolean;
  scope: string;
  tenant: string;
  units: readonly OrgUnit[];
  caps: readonly ScopedCapabilityLike[];
}): string {
  const all = format(L.crumbAll, { tenant: o.tenant });
  if (o.owner) return o.scope === 'all' ? all : unitCrumb(o.units, o.scope);
  const caps = o.caps.filter((c) => c.permission.startsWith('fleet.'));
  if (caps.some((c) => c.scope.kind === 'tenant')) return all;
  const id = caps.find((c) => c.scope.kind === 'org_unit')?.scope.resourceIds[0];
  return id ? unitCrumb(o.units, id) : '';
}
