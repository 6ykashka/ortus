// Снимок идентификаторов сида (PD-19): отсортированные id по коллекциям платформы и организаций,
// UUID v5 по правилу PD-30 и карта номеров рейсов для `core.counters`. Go-сид (`backend/cmd/seed`)
// сверяет с этим файлом свои id; сортировка — по кодовым единицам (как `sort.Strings` в Go).
import { NAMESPACE_URL, seedUuid } from './uuid.ts';
import type { OrgId, PilotDb, SeedState } from './types.ts';

export interface TenantIds {
  units: string[];
  members: string[];
  groups: string[];
  roles: string[];
  assignments: string[];
  vehicles: string[];
  trips: string[];
  poolDrivers: string[];
  resources: string[];
  bookings: string[];
}

export interface SeedSnapshot {
  uuid: { version: 5; namespace: string; name: string };
  seq: Record<OrgId, number>;
  /** Номер рейса прототипа («Р-208») → значение счётчика `core.counters` (PD-30). */
  counters: Record<OrgId, Record<string, number>>;
  platform: { tenants: string[]; accounts: string[]; operators: string[]; requests: string[] };
  tenants: Record<OrgId, TenantIds>;
  /** Область UUID → id прототипа → UUID v5 (`platform`, `t-alta`, `t-lotos`). */
  uuids: Record<string, Record<string, string>>;
}

const ORGS: readonly OrgId[] = ['t-alta', 't-lotos'];

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id).sort();

const uuidMap = (scope: string, list: readonly string[]): Record<string, string> =>
  Object.fromEntries([...list].sort().map((id) => [id, seedUuid(scope, id)]));

function tenantIds(db: PilotDb): TenantIds {
  return {
    units: ids(db.units),
    members: ids(db.members),
    groups: ids(db.groups),
    roles: ids(db.roles),
    assignments: ids(db.assignments),
    vehicles: ids(db.vehicles),
    trips: ids(db.trips),
    poolDrivers: ids(db.pool.drivers),
    resources: ids(db.calendar.resources),
    bookings: ids(db.calendar.bookings),
  };
}

/** Число из номера рейса: «Р-208» → 208. */
const tripCounters = (db: PilotDb): Record<string, number> =>
  Object.fromEntries(db.trips.map((t) => [t.id, Number(t.id.replace(/\D/g, ''))]));

export function buildSnapshot(seed: SeedState): SeedSnapshot {
  const P = seed.platform;
  const per = <T>(f: (db: PilotDb) => T): Record<OrgId, T> =>
    Object.fromEntries(ORGS.map((o) => [o, f(seed.dbs[o])])) as Record<OrgId, T>;
  const platform = {
    tenants: ids(P.tenants),
    accounts: ids(P.accounts),
    operators: ids(P.operators),
    requests: ids(P.requests),
  };
  return {
    uuid: { version: 5, namespace: NAMESPACE_URL, name: 'ortus:<scope>:<prototype-id>' },
    seq: per((db) => db.seq),
    counters: per(tripCounters),
    platform,
    tenants: per(tenantIds),
    uuids: {
      platform: uuidMap('platform', [
        ...platform.tenants,
        ...platform.accounts,
        ...platform.operators,
      ]),
      ...Object.fromEntries(
        ORGS.map((o) => {
          const db = seed.dbs[o];
          return [o, uuidMap(o, [...ids(db.units), ...ids(db.members)])];
        }),
      ),
    },
  };
}
