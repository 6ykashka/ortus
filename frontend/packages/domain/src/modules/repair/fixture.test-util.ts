// Общие помощники табличных тестов «Ремонта и стройки»: «Альта» сырого сида 14.10 со срезом
// ремонта и включённым модулем. Только для тестов.
import { fixedClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx, type ModuleCtx } from '../../core/module.ts';
import type { Role, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { repairSeed } from './seed.ts';
import type { RepairSlice } from './types.ts';

/** БД «Альты» с обязательным срезом ремонта. */
export type RepairDb = TenantDb & { repair: RepairSlice };

/** Роль офиса: ведёт объекты, принимает объёмы, видит деньги (шаблон «Сметчик» без смет). */
export const OFFICE_ROLE: Role = {
  id: 'r-repair-office',
  name: 'Менеджер ремонта',
  kind: 'template',
  actions: { repair: ['view', 'create', 'edit', 'review'] },
  finance: { read: true, manage: false },
};

export const clock = fixedClock('2026-10-01T10:30:00+03:00');

/** «Альта»: ремонт включён; `m-morozova` — офис, `m-petrova` — чужой прораб (роль без объектов). */
export function altaRepairDb(): RepairDb {
  const db = createAlta(createPlatform()) as TenantDb;
  Object.assign(db, { repair: repairSeed('t-alta') });
  db.modules.repair = { enabled: true };
  db.roles.push(OFFICE_ROLE);
  db.assignments.push(
    { id: 'ap-office', member: 'm-morozova', role: 'r-repair-office', scope: { type: 'tenant' } },
    { id: 'ap-fm2', member: 'm-petrova', role: 'r-foreman', scope: { type: 'self' } },
  );
  return db as RepairDb;
}

export function harness<T>(
  build: (ctx: ModuleCtx) => T,
  actor = 'm-sokolov',
  db: RepairDb = altaRepairDb(),
) {
  let who: string | null = actor;
  const ids = createIdGen(() => db);
  const ctx = createModuleCtx({
    getDb: () => db,
    getActor: () => who,
    clock,
    ids,
    tasks: {} as ModuleCtx['tasks'],
  });
  return {
    db,
    ctx,
    api: build(ctx),
    as: (m: string | null) => {
      who = m;
    },
  };
}

/** Код и текст `ApiError`, которую бросает `f`. */
export function apiErr(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('ошибки нет');
}

export function restrictTenant(db: TenantDb): void {
  const t = db.platform?.tenants.find((x) => x.id === db.tenantId);
  if (!t) throw new Error('нет организации');
  t.status = 'restricted';
}
