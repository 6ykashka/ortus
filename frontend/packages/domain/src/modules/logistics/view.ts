// Проекция логистики для участника (api.js 14.10:193–198). Ответ сервера формируется для
// конкретного участника: запрещённые поля не передаются вовсе. Видимость считается по ролям так,
// будто модуль включён: начатую смену можно завершить и после отключения модуля (api.js:176–182).
import { can, canEarnings } from '../../core/access/index.ts';
import type { TenantDb, Verb } from '../../core/types/index.ts';
import type { LogisticsSlices } from './types.ts';

type Fleet = Required<LogisticsSlices>;

/** Право участника на логистику в подразделении при условно включённом модуле. */
export function fleetCan(db: TenantDb, actor: string, verb: Verb, unitId: string): boolean {
  const on = { ...db, modules: { ...db.modules, logistics: { enabled: true } } };
  return can(on, actor, 'logistics', verb, unitId).ok;
}

export function logisticsView(db: TenantDb, actor: string): Fleet {
  const trips = db.trips ?? [];
  const sees = (unitId: string) => fleetCan(db, actor, 'view', unitId);
  const money = (unitId: string) => canEarnings(db, actor, unitId).ok;
  return structuredClone({
    vehicles: (db.vehicles ?? []).filter((v) => sees(v.unit)),
    trips: trips
      .filter((t) => sees(t.unit) && (fleetCan(db, actor, 'edit', t.unit) || t.driverId === actor))
      .map((t) => {
        if (money(t.unit)) return t;
        const rest = { ...t };
        delete rest.earnings;
        return rest;
      }),
    pool: db.pool ?? { drivers: [], requests: [] },
    earnings: trips.some((t) => money(t.unit)) ? (db.earnings ?? []) : [],
  });
}
