// W2.62 (AC-06, Q-W2.32-6; W2.57 backend fleet/pool, решение Q-W2.07-1 «только рейс»): системная роль «Временный
// водитель» (api/permissions.yaml role_templates.temporary_driver). Одобрение запроса пула назначает её водителю двумя
// строками access.role_assignments (source transfer): в области self на окно перевода — рейсы, где он водитель, их
// осмотры, расходы, брони (чтение) и файлы; в области resource — машина рейса (W2.71: и предложенные ему машины), пока
// назначение scheduled или active. Продолжение начатого рейса после окна или отзыва (closing, D09) держит строку self
// без конца (GrantUntil backend — nil, пока рейс начат); надстройка пула (pool-rules temporaryAccessOpen) сужает рейс
// до продолжения. Конец назначения — строки expired. Строки досчитываются перед шлюзом (settle.ts) по состоянию
// перевода, как воркер и SettleTrip backend. Роль вручную не назначается (createAssignment — 409).
import { seedUuid } from '@ortus/domain/seed';

import { contract } from '../contract/index.ts';
import type { AssignmentRow, Org, RoleRow } from '../core/state.ts';
import { settlePool } from './pool-rules.ts';
import type { FleetData } from './state.ts';

/** Ключ шаблона роли (role_templates) и прототип строки роли в организации. */
export const TEMPORARY_DRIVER = 'temporary_driver';
export const TEMPORARY_DRIVER_NAME = 'Временный водитель';

type WithFleet = Org & { fleet?: FleetData };

/** Роль «Временный водитель» организации; создаётся при первом одобрении (как ensure backend). */
export function temporaryRole(org: Org): RoleRow {
  const found = org.roles.find((r) => r.proto === TEMPORARY_DRIVER);
  if (found) return found;
  const tpl = contract.permissions.roleTemplates[TEMPORARY_DRIVER];
  const role: RoleRow = {
    id: seedUuid(org.proto, `role-${TEMPORARY_DRIVER}`),
    proto: TEMPORARY_DRIVER,
    name: tpl?.label ?? TEMPORARY_DRIVER_NAME,
    description: tpl?.label ?? TEMPORARY_DRIVER_NAME,
    builtIn: true,
    permissions: [...(tpl?.actions ?? [])],
    revision: 1,
    workFunction: 'driver',
  };
  org.roles.push(role);
  org.policyVersion++;
  return role;
}

/** Роль — «Временный водитель» (системная, назначает только одобрение пула). */
export const isTemporaryRole = (role: RoleRow): boolean => role.proto === TEMPORARY_DRIVER;

const later = (a: string, b: string): string => (a > b ? a : b);

/** Машины, которые открывает строка resource перевода сейчас (как loanedVehicles, по одному переводу). */
function vehiclesOf(f: FleetData, x: FleetData['transfers'][number]): string[] {
  const state = x.grant?.state;
  if (state !== 'scheduled' && state !== 'active') return [];
  const out = new Set<string>();
  if (x.grant?.vehicleId) out.add(x.grant.vehicleId);
  for (const r of f.reservations) {
    if (!x.tripId || r.tripId !== x.tripId || r.offeredToMemberId !== x.driverMemberId) continue;
    if (r.state === 'held' || r.state === 'confirmed') out.add(r.vehicleId);
  }
  return [...out].sort();
}

/** Записать строку `row` назначения (новая — в конец списка); true — строка изменилась. */
function put(org: Org, row: AssignmentRow): boolean {
  const i = org.assignments.findIndex((a) => a.id === row.id);
  if (i < 0) {
    org.assignments.push(row);
    return true;
  }
  if (JSON.stringify(org.assignments[i]) === JSON.stringify(row)) return false;
  org.assignments[i] = row;
  return true;
}

/**
 * Досчитать назначения роли «Временный водитель» по переводам пула в момент `now`: строка self — окно (closing — без
 * конца), строка resource — машины рейса, пока назначение scheduled/active; конец назначения — обе expired.
 */
export function syncTemporaryGrants(org: Org, now: string): void {
  const f = (org as WithFleet).fleet;
  if (!f?.transfers.some((x) => x.grant)) return;
  settlePool(f, now);
  const role = temporaryRole(org);
  let changed = false;
  for (const x of f.transfers) {
    const g = x.grant;
    if (!g) continue;
    const ended = g.state === 'ended';
    const self: AssignmentRow = {
      id: g.assignmentId,
      proto: `transfer:${x.id}`,
      principalType: 'member',
      principalId: x.driverMemberId,
      roleId: role.id,
      scope: { kind: 'self', resourceIds: [], includeDescendants: false },
      validFrom: g.validFrom,
      ...(g.state === 'closing'
        ? {}
        : { validUntil: ended ? later(g.endedAt ?? g.validUntil, g.validFrom) : g.validUntil }),
      state: ended ? 'expired' : 'active',
    };
    changed = put(org, self) || changed;
    const cars = vehiclesOf(f, x);
    const carId = seedUuid(org.proto, `transfer-vehicle:${x.id}`);
    const prior = org.assignments.find((a) => a.id === carId);
    if (!cars.length && !prior) continue;
    const car: AssignmentRow = {
      id: carId,
      proto: `transfer:${x.id}:vehicle`,
      principalType: 'member',
      principalId: x.driverMemberId,
      roleId: role.id,
      scope: {
        kind: 'resource_pool',
        resourceIds: cars.length ? cars : (prior?.scope.resourceIds ?? []),
        includeDescendants: false,
      },
      validFrom: g.validFrom,
      validUntil: cars.length || !prior?.validUntil ? g.validUntil : prior.validUntil,
      state: cars.length ? 'active' : 'expired',
    };
    if (!cars.length && car.validUntil && now < car.validUntil)
      car.validUntil = later(now, g.validFrom);
    changed = put(org, car) || changed;
  }
  if (changed) org.policyVersion++;
}
