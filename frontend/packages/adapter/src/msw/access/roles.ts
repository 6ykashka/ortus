// Роли и назначения (W0.13): listRoles, createRole, getRole, updateRole, deleteRole, listAssignments,
// createAssignment, revokeAssignment. Права роли — канонические ключи каталога (`api/permissions.yaml`);
// SoD «Водитель» ↔ начисления, делегирование, последний владелец — правила контракта (x-separation-of-duties).
import type { components } from '@ortus/api-client';

import { ACTIONS, isEarningsKey } from '../core/catalog.ts';
import { assignmentDto, roleDto } from '../core/dto.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { AssignmentRow, RoleRow } from '../core/state.ts';
import { canDelegate, principalsOf, roleById, SOD_TEXT, sodConflict } from './rules.ts';

type S = components['schemas'];

const ROLE_SOD_TEXT = 'Роль с функцией «Водитель» не может содержать начисления';

const roleOr404 = (ctx: HandlerContext): RoleRow =>
  roleById(ctx.org().org, ctx.params.roleId ?? '') ?? fail('not_found');

/** Права роли — ключи каталога организации (без platform.*). */
function requirePermissions(keys: readonly string[]): void {
  const bad = keys.findIndex((k) => !ACTIONS.has(k) || k.startsWith('platform.'));
  if (bad >= 0) {
    fail('validation_failed', 'В роли право, которого нет в каталоге.', {
      violations: [{ field: `permissions[${bad}]`, code: 'unknown', message: 'Нет такого права' }],
    });
  }
}

function requireUniqueName(ctx: HandlerContext, name: string, except?: string): void {
  const taken = ctx
    .org()
    .org.roles.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());
  if (taken) {
    fail('validation_failed', 'Роль с таким названием уже есть.', {
      violations: [
        { field: 'name', code: 'already_exists', message: 'Роль с таким названием уже есть' },
      ],
    });
  }
}

/**
 * Виды областей, которые знает оценщик (W1.04): организация, подразделение, «своё», проект, ресурсный пул. Виды
 * этапов 4–7 контракта 0.7.0-stage4 (space, page, folder, doc, account, chat, relation, repair_project) назначаются
 * только после регистрации вида (W4.01, W5.00, W6.00, W7.00) — до неё 422, как cmd/api (ADR-0014 п. 3, W4.02).
 */
const ASSIGNABLE: ReadonlySet<string> = new Set([
  'tenant',
  'org_unit',
  'self',
  'project',
  'resource_pool',
]);

/** Скоуп назначения проверен: подразделения существуют, у организации и «своего» нет ресурсов. */
function requireScope(ctx: HandlerContext, scope: S['Scope']): void {
  if (!ASSIGNABLE.has(scope.kind)) {
    fail('validation_failed', 'Такая область назначения на этом этапе недоступна.');
  }
  const units = new Set(ctx.org().org.units.map((u) => u.id));
  const bad =
    (scope.kind === 'org_unit' &&
      (!scope.resourceIds.length || scope.resourceIds.some((id) => !units.has(id)))) ||
    ((scope.kind === 'tenant' || scope.kind === 'self') && scope.resourceIds.length > 0) ||
    ((scope.kind === 'project' || scope.kind === 'resource_pool') && !scope.resourceIds.length);
  if (bad) {
    fail('validation_failed', 'Проверьте область назначения.', {
      violations: [{ field: 'scope', code: 'invalid', message: 'Недопустимая область' }],
    });
  }
}

export const rolesHandlers: Registry = {
  listRoles: (ctx) => {
    const org = ctx.org().org;
    return {
      body: page(
        org.roles.map((r) => roleDto(org, r)),
        ctx.query,
      ),
    };
  },

  createRole: {
    messages: { name: 'Укажите название роли' },
    run: (ctx) => {
      const org = ctx.org().org;
      const b = ctx.body as S['RoleCreate'];
      requirePermissions(b.permissions);
      requireUniqueName(ctx, b.name.trim());
      const row: RoleRow = {
        id: ctx.newId(),
        proto: `r-new-${ctx.s.seq}`,
        name: b.name.trim(),
        description: b.description ?? '',
        builtIn: false,
        permissions: [...b.permissions],
        revision: 1,
      };
      org.roles.push(row);
      org.policyVersion++;
      return { status: 201, body: roleDto(org, row) };
    },
  },

  getRole: (ctx) => ({ body: roleDto(ctx.org().org, roleOr404(ctx)) }),

  updateRole: (ctx) => {
    const org = ctx.org().org;
    const role = roleOr404(ctx);
    const b = ctx.body as S['RolePatch'];
    ctx.revision(role.revision);
    if (role.builtIn) fail('invalid_transition', 'Системную роль нельзя изменить.');
    if (b.name) requireUniqueName(ctx, b.name.trim(), role.id);
    if (b.permissions) {
      requirePermissions(b.permissions);
      const earnings = b.permissions.some(isEarningsKey);
      if (earnings && role.workFunction === 'driver') {
        fail('separation_of_duties_conflict', ROLE_SOD_TEXT);
      }
      const next: RoleRow = { ...role, permissions: [...b.permissions] };
      const holders = org.assignments
        .filter((a) => a.roleId === role.id)
        .flatMap((a) => principalsOf(org, a));
      const roles = org.roles.map((r) => (r.id === role.id ? next : r));
      const conflict = holders.some((m) => sodConflict({ ...org, roles }, m, ctx.now()));
      if (conflict) fail('separation_of_duties_conflict', SOD_TEXT);
      role.permissions = next.permissions;
      org.policyVersion++;
    }
    if (b.name) role.name = b.name.trim();
    if (b.description !== undefined) role.description = b.description;
    role.revision++;
    return { body: roleDto(org, role) };
  },

  deleteRole: (ctx) => {
    const org = ctx.org().org;
    const role = roleOr404(ctx);
    ctx.revision(role.revision);
    if (role.builtIn) fail('invalid_transition', 'Системную роль нельзя удалить.');
    if (org.assignments.some((a) => a.roleId === role.id)) {
      fail(
        'invalid_transition',
        'Роль назначена участникам или группам. Сначала снимите назначения.',
      );
    }
    org.roles = org.roles.filter((r) => r.id !== role.id);
    org.policyVersion++;
    return { status: 204 };
  },

  listAssignments: (ctx) => ({
    body: page(ctx.org().org.assignments.map(assignmentDto), ctx.query),
  }),

  createAssignment: (ctx) => {
    const org = ctx.org().org;
    const b = ctx.body as S['AssignmentCreate'];
    const principalId = b.principalId.toLowerCase();
    const exists =
      b.principalType === 'member'
        ? org.members.some((m) => m.id === principalId)
        : org.groups.some((g) => g.id === principalId);
    if (!exists) {
      fail('validation_failed', 'Участник или группа не найдены.', {
        violations: [
          { field: 'principalId', code: 'unknown', message: 'Нет такого участника или группы' },
        ],
      });
    }
    const role =
      roleById(org, b.roleId) ??
      fail('validation_failed', 'Роль не найдена.', {
        violations: [{ field: 'roleId', code: 'unknown', message: 'Нет такой роли' }],
      });
    requireScope(ctx, b.scope);
    if (!canDelegate(ctx, role, b.scope)) {
      fail(
        'delegation_exceeds_grant',
        `Роль «${role.name}» шире ваших прав: назначать можно только то, что есть у вас.`,
      );
    }
    const affected = principalsOf(org, { principalType: b.principalType, principalId });
    if (affected.some((m) => sodConflict(org, m, ctx.now(), [{ role }]))) {
      fail('separation_of_duties_conflict', SOD_TEXT);
    }
    const row: AssignmentRow = {
      id: ctx.newId(),
      proto: `a-new-${ctx.s.seq}`,
      principalType: b.principalType,
      principalId,
      roleId: role.id,
      scope: structuredClone(b.scope),
      validFrom: b.validFrom ?? ctx.now(),
      state: 'active',
    };
    if (b.validUntil) row.validUntil = b.validUntil;
    org.assignments.push(row);
    org.policyVersion++;
    return { status: 201, body: assignmentDto(row) };
  },

  revokeAssignment: (ctx) => {
    const t = ctx.org();
    const org = t.org;
    const a =
      org.assignments.find((x) => x.id === ctx.params.assignmentId?.toLowerCase()) ??
      fail('not_found');
    const role = roleById(org, a.roleId);
    if (role && !canDelegate(ctx, role, a.scope)) {
      fail('delegation_exceeds_grant', 'Снять можно только назначение, которое вы вправе выдать.');
    }
    if (role?.all) {
      const owners = ctx.s.memberships.filter((m) => m.tenantId === t.tenant.id && m.owner);
      const others = org.assignments.filter(
        (x) =>
          x.id !== a.id &&
          roleById(org, x.roleId)?.all &&
          owners.some((o) => principalsOf(org, x).some((m) => m.id === o.memberId)),
      );
      if (
        !others.length &&
        owners.some((o) => principalsOf(org, a).some((m) => m.id === o.memberId))
      ) {
        fail('last_owner_required', 'Нельзя снять роль с последнего владельца');
      }
    }
    org.assignments = org.assignments.filter((x) => x.id !== a.id);
    org.policyVersion++;
    return { status: 204 };
  },
};
