// Доступ в организации (W0.13): гранты участника (прямые и через группы), проверка `x-permissions` шлюзом,
// возможности и доступность модулей для /me/context, правило SoD «Водитель» ↔ начисления.
// Владелец (OwnerBinding) имеет все действия организации, как GrantAuthorizer cmd/api W0.09; остальные —
// действия назначений. Область назначения принимается, если её вид допускает область операции (`x-scope`):
// `tenant` — только организация; `tenant-or-org-unit` — организация или подразделение; объектные области
// файлов (`owning-object-*`) — любая область назначения (объект проверяет хендлер). Остальные виды — W1.04.
import type { components } from '@ortus/api-client';

import {
  ACTIONS,
  CORE_MODULES,
  INSTALLABLE_KEYS,
  isEarningsKey,
  moduleOfKey,
  ownerKeys,
} from './catalog.ts';
import { installedModules, rolePermissions } from './dto.ts';
import type { AssignmentRow, MemberRow, MembershipRow, Org, RoleRow, TenantRow } from './state.ts';

type S = components['schemas'];

export interface Grant {
  assignment: AssignmentRow;
  role: RoleRow;
  keys: string[];
  scope: S['Scope'];
  via: 'direct' | 'group';
  groupId?: string;
}

const active = (a: AssignmentRow, now: string): boolean =>
  a.state === 'active' &&
  (!a.validFrom || a.validFrom <= now) &&
  (!a.validUntil || now < a.validUntil);

/** Группы участника. */
export const groupsOf = (org: Org, memberId: string): string[] =>
  org.groups.filter((g) => g.memberIds.includes(memberId)).map((g) => g.id);

/** Назначения участника (прямые и через группы) с ролью и её каноническими ключами. */
export function grantsOf(org: Org, memberId: string, now: string): Grant[] {
  const groups = groupsOf(org, memberId);
  const out: Grant[] = [];
  for (const a of org.assignments) {
    const direct = a.principalType === 'member' && a.principalId === memberId;
    const viaGroup = a.principalType === 'group' && groups.includes(a.principalId);
    if ((!direct && !viaGroup) || !active(a, now)) continue;
    const role = org.roles.find((r) => r.id === a.roleId);
    if (!role) continue;
    const g: Grant = {
      assignment: a,
      role,
      keys: rolePermissions(org, role),
      scope: a.scope,
      via: direct ? 'direct' : 'group',
    };
    if (viaGroup) g.groupId = a.principalId;
    out.push(g);
  }
  return out;
}

/** Действующая функция «Водитель»: рабочий профиль или роль с функцией водителя. */
export function isDriver(org: Org, member: MemberRow, now: string): boolean {
  return (
    member.workProfiles.includes('driver') ||
    grantsOf(org, member.id, now).some((g) => g.role.workFunction === 'driver')
  );
}

/** Участник получает права на начисления через роли. */
export const hasEarnings = (org: Org, memberId: string, now: string): boolean =>
  grantsOf(org, memberId, now).some((g) => g.keys.some(isEarningsKey));

/** Контекст организации запроса (собирает шлюз, как `tenantctx.TenantContext`). */
export interface TenantAccess {
  tenant: TenantRow;
  org: Org;
  membership: MembershipRow;
  member: MemberRow | undefined;
  owner: boolean;
  readOnly: boolean;
}

/**
 * Виды областей назначения, годные для операции с x-scope: из имени области (	enant-org-unit-self →
 * организация, подразделение, «своё»); объектные области (owning-object-*, 
esponsible-*…) — любая
 * область назначения (объект проверяет хендлер); 	enant-owner* и 	enant — только организация.
 */
export function scopeKinds(opScope: string): readonly string[] | 'any' {
  if (opScope === 'tenant' || opScope.startsWith('tenant-owner')) return ['tenant'];
  if (!opScope.startsWith('tenant')) return 'any';
  const kinds = ['tenant'];
  if (opScope.includes('org-unit')) kinds.push('org_unit');
  if (opScope.includes('project')) kinds.push('project');
  if (opScope.includes('self') || opScope.includes('assigned')) kinds.push('self');
  if (opScope.includes('resource-pool')) kinds.push('resource_pool');
  return kinds;
}

/**
 * Ключи участника из назначений, которые хранит модуль, а не access API (W4.04: роли пространств и страниц «Базы
 * знаний» — Q-W4.00-knowledge-21, Q-W4.30-16 вариант б). Модуль регистрирует функцию при загрузке.
 */
export type ScopedKeys = (t: TenantAccess, opScope: string, now: string) => readonly string[];
const scopedKeys: ScopedKeys[] = [];
export function registerScopedKeys(f: ScopedKeys): void {
  if (!scopedKeys.includes(f)) scopedKeys.push(f);
}

/** Ключи действий участника, годные для операции с областью `opScope`. */
export function actionsFor(t: TenantAccess, opScope: string, now: string): Set<string> {
  if (t.owner) return new Set([...ACTIONS.keys()].filter((k) => !k.startsWith('platform.')));
  if (!t.member) return new Set();
  const kinds = scopeKinds(opScope);
  const out = new Set<string>();
  for (const g of grantsOf(t.org, t.member.id, now)) {
    if (kinds !== 'any' && !kinds.includes(g.scope.kind)) continue;
    for (const k of g.keys) out.add(k);
  }
  for (const f of scopedKeys) for (const k of f(t, opScope, now)) out.add(k);
  return out;
}

/** Решение `x-permissions` (`all` | `any`). */
export function permits(have: Set<string>, perms: readonly string[], mode: string): boolean {
  if (!perms.length) return true;
  return mode === 'any' ? perms.some((p) => have.has(p)) : perms.every((p) => have.has(p));
}

/** Возможности для /me/context: владелец — все действия подключённых модулей в организации. */
export function capabilities(t: TenantAccess, now: string): S['ScopedCapability'][] {
  if (t.owner) {
    const scope = { kind: 'tenant', resourceIds: [], includeDescendants: true } as const;
    return ownerKeys(installedModules(t.org)).map((permission) => ({
      permission,
      scope: { ...scope, resourceIds: [] },
    }));
  }
  if (!t.member) return [];
  const driver = isDriver(t.org, t.member, now);
  const out: S['ScopedCapability'][] = [];
  for (const g of grantsOf(t.org, t.member.id, now)) {
    for (const permission of g.keys) {
      if (driver && isEarningsKey(permission)) continue;
      out.push({ permission, scope: structuredClone(g.scope) });
    }
  }
  return out;
}

const ALL_MODULES = [...CORE_MODULES, ...INSTALLABLE_KEYS];

/** Доступность модулей организации для участника (`moduleAvailability` генератора W0.07). */
export function moduleAvailability(
  t: TenantAccess,
  keys: readonly string[],
): S['ModuleAvailability'][] {
  const installed = new Set(installedModules(t.org));
  return ALL_MODULES.map((m) => {
    if (!installed.has(m)) {
      return { moduleKey: m, state: 'uninstalled', accessMode: 'none', reason: 'not_installed' };
    }
    const mine = keys.filter((k) => moduleOfKey(k) === m);
    const write = mine.some((k) => ACTIONS.get(k)?.level !== 'view');
    if (t.tenant.status === 'read_only' || t.tenant.status === 'grace') {
      return {
        moduleKey: m,
        state: 'read_only',
        accessMode: mine.length ? 'read' : 'none',
        reason: 'plan_expired',
      };
    }
    const own = t.org.modules[m]?.state;
    if (own === 'read_only') {
      return {
        moduleKey: m,
        state: 'read_only',
        accessMode: mine.length ? 'read' : 'none',
        reason: 'disabled',
      };
    }
    // W2.62 (AC-12, modulesreg availability): при отключении — только завершение начатой работы.
    if (own === 'draining') {
      return {
        moduleKey: m,
        state: 'draining',
        accessMode: mine.length ? 'finish_only' : 'none',
        reason: 'draining',
      };
    }
    if (!mine.length) {
      return { moduleKey: m, state: 'active', accessMode: 'none', reason: 'permission_denied' };
    }
    return {
      moduleKey: m,
      state: 'active',
      accessMode: write ? 'write' : 'read',
      reason: 'available',
    };
  });
}
