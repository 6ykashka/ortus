// Подключённость модуля и гранты участника (models.js 14.10 `:277–283`).
import { isIndustry } from '../dictionaries.ts';
import type { CoreDb, Grant, ModuleKey } from '../types/index.ts';

/** Модули ядра подключены всегда, отраслевые — по `db.modules[key].enabled`. */
export const moduleOn = (db: CoreDb, key: ModuleKey): boolean =>
  !isIndustry(key) || !!db.modules[key]?.enabled;

/** Назначения участника вместе с ролью; назначения на удалённую роль отбрасываются. */
export function grants(db: CoreDb, memberId: string): Grant[] {
  const out: Grant[] = [];
  for (const a of db.assignments) {
    if (a.member !== memberId) continue;
    const roleObj = db.roles.find((r) => r.id === a.role);
    if (roleObj) out.push({ ...a, roleObj });
  }
  return out;
}
