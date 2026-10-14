// Эффективное право (models.js 14.10 `:285–306`) с правилом PD-53 (план v2 §7, B факт 6):
// грант с объектной областью (проект, пространство, страница, папка, документ, чат, касса)
// засчитывается только для этого объекта. В эталоне `M.can` без `unitId` засчитывал любой грант —
// так Котова получала `tasks.settings` во всей организации через роль проекта.
import { REASON } from '../dictionaries.ts';
import { ApiError } from '../errors/index.ts';
import type {
  CanResult,
  CoreDb,
  Grant,
  ModuleKey,
  ObjectRef,
  Reason,
  Verb,
} from '../types/index.ts';
import { grants, moduleOn } from './grants.ts';
import { isObjectScope, scopeIsObject } from './object-scoped.ts';
import { scopeCovers } from './units.ts';

export { grants, moduleOn } from './grants.ts';

function moduleGate(db: CoreDb, mod: ModuleKey): Reason | null {
  if (moduleOn(db, mod)) return null;
  return db.modules[mod]?.history ? 'module_readonly' : 'module_off';
}

const allows = (g: Grant, mod: ModuleKey, verb: Verb): boolean =>
  !!g.roleObj.all || (g.roleObj.actions[mod] ?? []).includes(verb);

/**
 * Модуль подключён → действие разрешено ролью → объект в области.
 * `unitId` — подразделение объекта; `obj` — сам объект для ролей с объектной областью (PD-53).
 */
export function can(
  db: CoreDb,
  memberId: string,
  mod: ModuleKey,
  verb: Verb,
  unitId?: string | null,
  obj?: ObjectRef,
): CanResult {
  const off = moduleGate(db, mod);
  if (off) return { ok: false, reason: off };
  const gs = grants(db, memberId).filter(
    (g) => allows(g, mod, verb) && (!isObjectScope(g.scope) || scopeIsObject(g.scope, obj)),
  );
  const [first] = gs;
  if (!first) return { ok: false, reason: 'no_permission' };
  if (unitId) {
    const g = gs.find((x) => scopeCovers(db, x.scope, unitId) || scopeIsObject(x.scope, obj));
    return g ? { ok: true, via: g } : { ok: false, reason: 'no_scope' };
  }
  return { ok: true, via: first };
}

/**
 * Есть ли у участника действие хоть где-нибудь, включая объектные роли. Для видимости раздела
 * и пунктов меню (Котова видит «Задачи» как руководитель проекта), но не для авторизации команды:
 * команда проверяется `can` с объектом.
 */
export function canAny(db: CoreDb, memberId: string, mod: ModuleKey, verb: Verb): CanResult {
  const off = moduleGate(db, mod);
  if (off) return { ok: false, reason: off };
  const g = grants(db, memberId).find((x) => allows(x, mod, verb));
  return g ? { ok: true, via: g } : { ok: false, reason: 'no_permission' };
}

/** Начисления: функция «Водитель» блокирует независимо от ролей и групп. */
export function canEarnings(
  db: CoreDb,
  memberId: string,
  unitId?: string,
): { ok: true } | { ok: false; reason: Reason } {
  const m = db.members.find((x) => x.id === memberId);
  if (!m) return { ok: false, reason: 'no_permission' };
  if (m.function === 'driver') return { ok: false, reason: 'driver_block' };
  const gs = grants(db, memberId).filter(
    (g) => !isObjectScope(g.scope) && (g.roleObj.all || g.roleObj.finance.read),
  );
  if (!gs.length) return { ok: false, reason: 'no_permission' };
  if (unitId && !gs.some((g) => scopeCovers(db, g.scope, unitId)))
    return { ok: false, reason: 'no_scope' };
  return { ok: true };
}

/** Проверка команды: грант или `ApiError(reason, REASON[reason].text)` (`assertCan` эталона). */
export function assertCan(
  db: CoreDb,
  memberId: string,
  mod: ModuleKey,
  verb: Verb,
  unitId?: string | null,
  obj?: ObjectRef,
): Grant {
  const r = can(db, memberId, mod, verb, unitId, obj);
  if (!r.ok) throw new ApiError(r.reason, REASON[r.reason].text);
  return r.via;
}
