// Участники и приглашения (W0.13): listMembers, inviteMember, getMember, updateMember. Видимость — по области
// права members.read (организация или подразделения назначения); место занимает активный и приглашённый.
import type { components } from '@ortus/api-client';

import { memberDto, seatsLimit } from '../core/dto.ts';
import { inviteMember } from '../core/people.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { seatsUsed } from '../core/state.ts';
import {
  canDelegate,
  memberById,
  memberIn,
  roleById,
  rolesConflict,
  SOD_TEXT,
  sodConflict,
  subtree,
  unitsWith,
} from './rules.ts';

type S = components['schemas'];

/** Текст отказа по местам (примеры acceptInvitation, commitPeopleImport). */
export const seatsText = (used: number, limit: number): string =>
  `Свободных мест нет: занято ${used} из ${limit}. Отзовите приглашение или запросите расширение тарифа.`;

/** Проверка мест перед тем, как занять ещё `more`. */
export function requireSeats(ctx: HandlerContext, more: number): void {
  const t = ctx.org();
  const used = seatsUsed(t.org);
  const limit = seatsLimit(t.tenant);
  if (used + more > limit) fail('seats_exhausted', seatsText(used, limit));
}

/** Все подразделения существуют, иначе 422 по полю. */
export function requireUnits(ctx: HandlerContext, ids: readonly string[], field: string): void {
  const units = new Set(ctx.org().org.units.map((u) => u.id));
  const bad = ids.findIndex((id) => !units.has(id.toLowerCase()));
  if (bad >= 0) {
    fail('validation_failed', 'Подразделение не найдено.', {
      violations: [
        { field: `${field}[${bad}]`, code: 'unknown', message: 'Нет такого подразделения' },
      ],
    });
  }
}

const isLastOwner = (ctx: HandlerContext, memberId: string): boolean => {
  const owners = ctx.s.memberships.filter((m) => m.tenantId === ctx.org().tenant.id && m.owner);
  return owners.length === 1 && owners[0]?.memberId === memberId;
};

export const membersHandlers: Registry = {
  listMembers: (ctx) => {
    const org = ctx.org().org;
    const units = unitsWith(ctx, 'members.read');
    const filter = uuidParam(ctx.query, 'orgUnitId', false);
    const narrow = filter ? subtree(org, filter) : undefined;
    const items = org.members
      .filter((m) => memberIn(m, units) && (!narrow || memberIn(m, narrow)))
      .map(memberDto);
    return { body: page(items, ctx.query) };
  },

  inviteMember: (ctx) => {
    const t = ctx.org();
    const b = ctx.body as S['InvitationCreate'];
    const email = b.email.trim();
    if (t.org.members.some((m) => m.email?.toLowerCase() === email.toLowerCase())) {
      fail('validation_failed', undefined, {
        violations: [
          { field: 'email', code: 'already_exists', message: 'Участник с таким адресом уже есть' },
        ],
      });
    }
    requireUnits(ctx, b.orgUnitIds, 'orgUnitIds');
    const roles = b.roleAssignments.map((ra, i) => {
      const role =
        roleById(t.org, ra.roleId) ??
        fail('validation_failed', 'Роль не найдена.', {
          violations: [
            { field: `roleAssignments[${i}].roleId`, code: 'unknown', message: 'Нет такой роли' },
          ],
        });
      if (!canDelegate(ctx, role, ra.scope)) {
        fail('delegation_exceeds_grant', `Роль «${role.name}» шире ваших прав.`);
      }
      return { role, scope: ra.scope };
    });
    if (
      rolesConflict(
        t.org,
        roles.map((r) => r.role),
      )
    )
      fail('separation_of_duties_conflict', SOD_TEXT);
    requireSeats(ctx, 1);
    const { member, invitation } = inviteMember(ctx.s, t.tenant, t.org, {
      email,
      displayName: b.displayName,
      orgUnitIds: b.orgUnitIds.map((x) => x.toLowerCase()),
    });
    for (const { role, scope } of roles) {
      t.org.assignments.push({
        id: ctx.newId(),
        proto: `a-new-${ctx.s.seq}`,
        principalType: 'member',
        principalId: member.id,
        roleId: role.id,
        scope: structuredClone(scope),
        validFrom: ctx.now(),
        state: 'active',
      });
    }
    if (roles.length) t.org.policyVersion++;
    if (!invitation) throw new Error('приглашение не создано');
    return {
      status: 201,
      body: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    };
  },

  getMember: (ctx) => ({ body: memberDto(memberById(ctx, ctx.params.memberId ?? '')) }),

  updateMember: (ctx) => {
    const t = ctx.org();
    const m = memberById(ctx, ctx.params.memberId ?? '', 'members.manage');
    const b = ctx.body as S['MemberPatch'];
    ctx.revision(m.revision);
    const membership = ctx.s.memberships.find(
      (x) => x.tenantId === t.tenant.id && x.memberId === m.id,
    );
    if (b.status && b.status !== m.status) {
      if (m.status === 'invited') {
        fail('invalid_transition', 'Участник ещё не принял приглашение.');
      }
      if (b.status === 'suspended' && isLastOwner(ctx, m.id)) {
        fail('last_owner_required', 'Нельзя приостановить последнего владельца');
      }
      if (b.status === 'active') requireSeats(ctx, 1);
    }
    if (b.orgUnitIds) requireUnits(ctx, b.orgUnitIds, 'orgUnitIds');
    if (b.workProfiles && sodConflict(t.org, m, ctx.now(), [], b.workProfiles)) {
      fail('separation_of_duties_conflict', SOD_TEXT);
    }
    if (b.status) {
      m.status = b.status;
      if (membership && membership.status !== 'ended') membership.status = b.status;
    }
    if (b.orgUnitIds) m.orgUnitIds = b.orgUnitIds.map((x) => x.toLowerCase());
    if (b.workProfiles) {
      m.workProfiles = [...b.workProfiles];
      t.org.policyVersion++;
    }
    m.revision++;
    return { body: memberDto(m) };
  },
};
