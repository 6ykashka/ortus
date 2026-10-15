// Группы и владельцы (W0.13, W0.08 §4.1): группы участников (состав группы с ролями проверяется как
// назначение — делегирование и SoD), владельцы организации (OwnerBinding, x-scope tenant-owner).
import type { components } from '@ortus/api-client';

import { groupDto } from '../core/dto.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { GroupRow, MembershipRow } from '../core/state.ts';
import { MINUTE, addMs } from '../core/time.ts';
import { canDelegate, roleById, SOD_TEXT, sodConflict, subtree, whereText } from './rules.ts';

type S = components['schemas'];

/** Передача владения требует свежего входа: не старше 10 минут (пример transferOwnership/session_expired). */
const RECENT_LOGIN_MS = 10 * MINUTE;

const groupOr404 = (ctx: HandlerContext): GroupRow =>
  ctx.org().org.groups.find((g) => g.id === ctx.params.groupId?.toLowerCase()) ?? fail('not_found');

function requireUniqueName(ctx: HandlerContext, name: string, except?: string): void {
  const taken = ctx
    .org()
    .org.groups.some((g) => g.id !== except && g.name.toLowerCase() === name.toLowerCase());
  if (taken) {
    fail('validation_failed', 'Группа с таким названием уже есть.', {
      violations: [
        { field: 'name', code: 'already_exists', message: 'Группа с таким названием уже есть' },
      ],
    });
  }
}

function requireUnit(ctx: HandlerContext, id: string | null | undefined): void {
  if (id && !ctx.org().org.units.some((u) => u.id === id.toLowerCase())) {
    fail('validation_failed', 'Подразделение не найдено.', {
      violations: [{ field: 'homeUnitId', code: 'unknown', message: 'Нет такого подразделения' }],
    });
  }
}

const ownersOf = (ctx: HandlerContext): MembershipRow[] =>
  ctx.s.memberships
    .filter((m) => m.tenantId === ctx.org().tenant.id && m.owner)
    .sort((a, b) => ((a.ownerSince ?? '') < (b.ownerSince ?? '') ? -1 : 1));

function ownerList(ctx: HandlerContext): S['OwnerList'] {
  const org = ctx.org().org;
  return {
    items: ownersOf(ctx).map((o) => {
      const m = org.members.find((x) => x.id === o.memberId);
      return {
        memberId: o.memberId ?? '',
        displayName: m?.displayName ?? '',
        email: m?.email ?? '',
        since: o.ownerSince ?? ctx.now(),
      };
    }),
  };
}

export const groupsHandlers: Registry = {
  listGroups: (ctx) => {
    const org = ctx.org().org;
    const filter = uuidParam(ctx.query, 'orgUnitId', false);
    const narrow = filter ? subtree(org, filter) : undefined;
    const items = org.groups
      .filter((g) => !narrow || (g.homeUnitId !== null && narrow.has(g.homeUnitId)))
      .map((g) => groupDto(org, g));
    return { body: page(items, ctx.query) };
  },

  createGroup: (ctx) => {
    const org = ctx.org().org;
    const b = ctx.body as S['GroupCreate'];
    requireUniqueName(ctx, b.name.trim());
    requireUnit(ctx, b.homeUnitId);
    const row: GroupRow = {
      id: ctx.newId(),
      proto: `g-new-${ctx.s.seq}`,
      name: b.name.trim(),
      description: b.description ?? '',
      homeUnitId: b.homeUnitId?.toLowerCase() ?? null,
      memberIds: [],
      revision: 1,
      createdAt: ctx.now(),
    };
    org.groups.push(row);
    return { status: 201, body: groupDto(org, row) };
  },

  getGroup: (ctx) => ({ body: groupDto(ctx.org().org, groupOr404(ctx)) }),

  updateGroup: (ctx) => {
    const org = ctx.org().org;
    const g = groupOr404(ctx);
    const b = ctx.body as S['GroupPatch'];
    ctx.revision(g.revision);
    if (b.name) requireUniqueName(ctx, b.name.trim(), g.id);
    if (b.homeUnitId !== undefined) requireUnit(ctx, b.homeUnitId);
    if (b.name) g.name = b.name.trim();
    if (b.description !== undefined) g.description = b.description;
    if (b.homeUnitId !== undefined) g.homeUnitId = b.homeUnitId?.toLowerCase() ?? null;
    g.revision++;
    return { body: groupDto(org, g) };
  },

  deleteGroup: (ctx) => {
    const org = ctx.org().org;
    const g = groupOr404(ctx);
    ctx.revision(g.revision);
    if (org.assignments.some((a) => a.principalType === 'group' && a.principalId === g.id)) {
      fail('invalid_transition', `У группы «${g.name}» есть назначения ролей. Сначала снимите их.`);
    }
    org.groups = org.groups.filter((x) => x.id !== g.id);
    return { status: 204 };
  },

  setGroupMembers: (ctx) => {
    const org = ctx.org().org;
    const g = groupOr404(ctx);
    const b = ctx.body as S['GroupMembersUpdate'];
    ctx.revision(g.revision);
    const ids = b.memberIds.map((x) => x.toLowerCase());
    const bad = ids.findIndex((id) => !org.members.some((m) => m.id === id));
    if (bad >= 0) {
      fail('validation_failed', 'Участник не найден.', {
        violations: [
          { field: `memberIds[${bad}]`, code: 'unknown', message: 'Нет такого участника' },
        ],
      });
    }
    const grants = org.assignments
      .filter((a) => a.principalType === 'group' && a.principalId === g.id)
      .sort((a, b2) => Number(b2.scope.kind === 'org_unit') - Number(a.scope.kind === 'org_unit'));
    const changed =
      ids.length !== g.memberIds.length || ids.some((id) => !g.memberIds.includes(id));
    if (changed) {
      for (const a of grants) {
        const role = roleById(org, a.roleId);
        if (role && !canDelegate(ctx, role, a.scope)) {
          fail(
            'delegation_exceeds_grant',
            `Группа даёт роль «${role.name}» в ${whereText(org, a.scope)}, а у вас нет права назначать её там.`,
          );
        }
      }
    }
    const added = org.members.filter((m) => ids.includes(m.id) && !g.memberIds.includes(m.id));
    const roles = grants.flatMap((a) => {
      const role = roleById(org, a.roleId);
      return role ? [{ role }] : [];
    });
    if (added.some((m) => sodConflict(org, m, ctx.now(), roles))) {
      fail('separation_of_duties_conflict', SOD_TEXT);
    }
    g.memberIds = ids;
    g.revision++;
    if (grants.length) org.policyVersion++;
    return { body: groupDto(org, g) };
  },

  listOwners: (ctx) => ({ body: ownerList(ctx) }),

  transferOwnership: (ctx) => {
    const t = ctx.org();
    const b = ctx.body as S['OwnershipTransferCreate'];
    const session = ctx.session ?? fail('session_expired');
    if (ctx.now() > addMs(session.issuedAt, RECENT_LOGIN_MS)) {
      fail('session_expired');
    }
    const target =
      t.org.members.find((m) => m.id === b.toMemberId.toLowerCase()) ?? fail('not_found');
    const membership = ctx.s.memberships.find(
      (m) => m.tenantId === t.tenant.id && m.memberId === target.id,
    );
    if (target.status !== 'active' || membership?.status !== 'active') {
      fail('invalid_transition');
    }
    if (b.confirmation.trim().toLowerCase() !== (target.email ?? '').toLowerCase()) {
      fail('validation_failed', undefined, {
        violations: [
          {
            field: 'confirmation',
            code: 'mismatch',
            message: `Введите почту ${target.email ?? ''}`,
          },
        ],
      });
    }
    if (membership.owner) fail('invalid_transition', 'Участник уже владелец.');
    membership.owner = true;
    membership.ownerSince = ctx.now();
    if (!b.keepCurrentOwner) {
      t.membership.owner = false;
      delete t.membership.ownerSince;
    }
    t.org.policyVersion++;
    return { body: ownerList(ctx) };
  },

  revokeOwnership: (ctx) => {
    const owners = ownersOf(ctx);
    const target =
      owners.find((o) => o.memberId === ctx.params.memberId?.toLowerCase()) ?? fail('not_found');
    if (owners.length === 1) fail('last_owner_required');
    target.owner = false;
    delete target.ownerSince;
    ctx.org().org.policyVersion++;
    return { status: 204 };
  },
};
