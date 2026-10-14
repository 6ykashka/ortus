// Оргструктура и территориальные области (models.js 14.10 `:242–257`).
import type { CoreDb, Scope, Unit } from '../types/index.ts';

export const unit = (db: CoreDb, id: string | undefined): Unit | undefined =>
  db.units.find((u) => u.id === id);

export function unitLabel(db: CoreDb, id: string): string {
  const u = unit(db, id);
  if (!u) return '—';
  if (u.type === 'region') return u.name;
  const parent = unit(db, u.parent);
  return parent ? parent.name + ' / ' + u.name : u.name;
}

export const firmsOf = (db: CoreDb, regionId?: string): Unit[] =>
  db.units.filter((u) => u.type === 'firm' && (!regionId || u.parent === regionId));

/** Покрывает ли территориальная область подразделение. Объектные области и `self` — нет. */
export function scopeCovers(
  db: CoreDb,
  scope: Scope | undefined,
  unitId: string | undefined,
): boolean {
  if (!scope) return false;
  if (scope.type === 'tenant') return true;
  const u = unit(db, unitId);
  if (!u) return false;
  if (scope.type === 'region') return u.id === scope.id || u.parent === scope.id;
  if (scope.type === 'firm') return u.id === scope.id;
  return false;
}
