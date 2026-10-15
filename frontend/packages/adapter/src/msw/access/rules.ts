// Правила доступа тега Access (W0.13): область видимости по подразделениям, делегирование («назначает только
// то, что имеет сам»), SoD «Водитель» ↔ начисления (x-separation-of-duties контракта), последний владелец.
import type { components } from '@ortus/api-client';

import { grantsOf, isDriver, type TenantAccess } from '../core/access.ts';
import { isEarningsKey } from '../core/catalog.ts';
import { rolePermissions } from '../core/dto.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { AssignmentRow, MemberRow, Org, RoleRow } from '../core/state.ts';

type S = components['schemas'];

export const SOD_TEXT = 'Функция «Водитель» несовместима с правом на начисления (правило MVP).';

/** Подразделение и все его потомки. */
export function subtree(org: Org, unitId: string): Set<string> {
  const out = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of org.units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Подразделения, где у участника запроса есть право `key`; `all` — вся организация. */
export function unitsWith(ctx: HandlerContext, key: string): Set<string> | 'all' {
  const t = ctx.org();
  if (t.owner) return 'all';
  if (!t.member) return new Set();
  const out = new Set<string>();
  for (const g of grantsOf(t.org, t.member.id, ctx.now())) {
    if (!g.keys.includes(key)) continue;
    if (g.scope.kind === 'tenant') return 'all';
    if (g.scope.kind === 'org_unit') {
      for (const id of g.scope.resourceIds) for (const u of subtree(t.org, id)) out.add(u);
    }
  }
  return out;
}

/** Участник виден в области `units`. */
export const memberIn = (m: MemberRow, units: Set<string> | 'all'): boolean =>
  units === 'all' || m.orgUnitIds.some((u) => units.has(u));

/** Участник организации запроса по id или 404 (с учётом области права `key`). */
export function memberById(ctx: HandlerContext, id: string, key = 'members.read'): MemberRow {
  const org = ctx.org().org;
  const m = org.members.find((x) => x.id === id.toLowerCase());
  if (!m || !memberIn(m, unitsWith(ctx, key))) fail('not_found');
  return m;
}

export const roleById = (org: Org, id: string): RoleRow | undefined =>
  org.roles.find((r) => r.id === id.toLowerCase());

/** Где действует назначение — для текстов: «фирме «Север Логистик»», «организации», «проекте». */
export function whereText(org: Org, scope: S['Scope']): string {
  if (scope.kind === 'org_unit') {
    const u = org.units.find((x) => x.id === scope.resourceIds[0]);
    if (!u) return 'подразделении';
    return `${u.kind === 'region' ? 'регионе' : 'фирме'} «${u.name}»`;
  }
  const where: Record<string, string> = {
    tenant: 'организации',
    project: 'проекте',
    self: 'своих объектах',
  };
  return where[scope.kind] ?? 'области';
}

/**
 * Может ли участник запроса назначать роль `role` в области `scope`: владелец — всегда; иначе нужно право
 * `roles.assign` в организации или в подразделении области и все права роли (делегирует только своё).
 */
export function canDelegate(ctx: HandlerContext, role: RoleRow, scope: S['Scope']): boolean {
  const t: TenantAccess = ctx.org();
  if (t.owner) return true;
  if (!t.member) return false;
  const grants = grantsOf(t.org, t.member.id, ctx.now());
  const assignUnits = unitsWith(ctx, 'roles.assign');
  const inScope =
    assignUnits === 'all' ||
    (scope.kind === 'org_unit' && scope.resourceIds.every((id) => assignUnits.has(id)));
  const mine = new Set(grants.flatMap((g) => g.keys));
  return inScope && rolePermissions(t.org, role).every((k) => mine.has(k));
}

/** Назначения, которые получит участник после изменения (прямые и через группы) — для SoD. */
export function sodConflict(
  org: Org,
  member: MemberRow,
  now: string,
  extra: { role: RoleRow }[] = [],
  profiles: MemberRow['workProfiles'] = member.workProfiles,
): boolean {
  const grants = grantsOf(org, member.id, now).map((g) => g.role);
  const roles = [...grants, ...extra.map((x) => x.role)];
  const driver = profiles.includes('driver') || roles.some((r) => r.workFunction === 'driver');
  const earnings = roles.some((r) => rolePermissions(org, r).some(isEarningsKey));
  return driver && earnings;
}

/** Набор ролей сам по себе нарушает SoD: функция «Водитель» и начисления вместе. */
export const rolesConflict = (org: Org, roles: readonly RoleRow[]): boolean =>
  roles.some((r) => r.workFunction === 'driver') &&
  roles.some((r) => rolePermissions(org, r).some(isEarningsKey));

/** Участники, которых затрагивает назначение (участник или состав группы). */
export function principalsOf(
  org: Org,
  a: Pick<AssignmentRow, 'principalType' | 'principalId'>,
): MemberRow[] {
  if (a.principalType === 'member') return org.members.filter((m) => m.id === a.principalId);
  const g = org.groups.find((x) => x.id === a.principalId);
  return org.members.filter((m) => g?.memberIds.includes(m.id));
}

export { isDriver };
