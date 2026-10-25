// Общие помощники табличных тестов кассы: «Альта» сырого сида 14.10 с установленной кассой,
// дополнительные назначения и контекст команд с часами демо-«сейчас». Только для тестов.
import { ApiError } from '../../core/errors/index.ts';
import type { Assignment, Role, Scope, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { installCash } from './seed.ts';
import type { CashSlice, CashTenantDb } from './types.ts';

export const NBSP = String.fromCharCode(160);

export interface CashDb extends CashTenantDb {
  cash: CashSlice;
}

/** «Альта» с установленной кассой; `extra` — дополнительные назначения. */
export function altaCash(extra: Assignment[] = []): CashDb {
  const db = createAlta(createPlatform()) as TenantDb as CashTenantDb;
  installCash(db);
  db.assignments.push(...extra);
  return db as CashDb;
}

/** «Лотос» с установленной (мигрированной) кассой. */
export function lotosCash(): CashDb {
  const db = createLotos(createPlatform()) as TenantDb as CashTenantDb;
  installCash(db);
  return db as CashDb;
}

export const mgr = (id: string, member: string, scope: Assignment['scope']): Assignment => ({
  id,
  member,
  role: 'r-manager',
  scope,
});

export type Outcome = { code: string; message: string } | { ok: unknown };

/** Результат вызова: значение или код и текст `ApiError`. */
export function outcome(f: () => unknown): Outcome {
  try {
    return { ok: f() };
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
}

/** Код и текст `ApiError`, которую бросает `f`. */
export function apiErr(f: () => unknown): { code: string; message: string } {
  const r = outcome(f);
  if ('code' in r) return r;
  throw new Error('ошибки нет');
}

/** Платформа: статус тарифа организации (restricted — только чтение, subscription_restricted). */
export function setTenantStatus(db: CashDb, status: string): void {
  const p = (db as unknown as { platform: { tenants: { id: string; status: string }[] } }).platform;
  const t = p.tenants.find((x) => x.id === db.tenantId);
  if (!t) throw new Error('нет организации');
  t.status = status;
}

/** Роль с модулем «Касса» (действия и параметры роли) и её назначение участнику. */
export function grantCash(
  db: CashDb,
  member: string,
  verbs: NonNullable<Role['actions']['cash']>,
  scope: Scope,
  cash: Role['cash'] = {},
  id = 'r-test-' + member,
): void {
  db.roles.push({
    id,
    name: 'Тест ' + member,
    kind: 'custom',
    actions: { cash: verbs },
    cash,
    finance: { read: false, manage: false },
  });
  db.assignments.push({ id: 'at-' + id, member, role: id, scope });
}
