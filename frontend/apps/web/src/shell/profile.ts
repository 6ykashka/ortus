// W1.20 · Строки поповера «Профиль» (:136–145, shellVM :3047–3048): раздел «Назначения» по ролям участника.
// Названий ролей и подразделений в /me/context нет (Q-W1.20-5): владельцу — «Владелец бизнеса · Вся
// организация», участнику без роли организации — «Ролей нет — доступ к модулям не выдан».
import type { ScopedCapabilityLike } from '@ortus/domain/nav';

/** Области назначения роли организации (Scope.kind); `project` и `resource_pool` — членство в объекте. */
const ROLE_SCOPES = new Set(['tenant', 'org_unit', 'self']);

/**
 * Есть назначение роли организации (эталон: `grants` участника, :3048). Возможности проектной роли или
 * пула не считаются: логист с задачами проекта — «Ролей нет — доступ к модулям не выдан».
 */
export function hasOrgRoles(caps: readonly ScopedCapabilityLike[]): boolean {
  return caps.some((c) => ROLE_SCOPES.has(c.scope.kind));
}
