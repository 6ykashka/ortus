// «Почему доступно» (W0.13, W0.08 §4.1, PD-53): шаги x-authorization-order контракта для участника и права —
// членство, состояние организации, подключение модуля, тариф, SoD, право по назначениям. Роль с объектной
// областью (проект) без объекта права не даёт (PD-53).
import type { components } from '@ortus/api-client';

import { grantsOf, isDriver } from '../core/access.ts';
import {
  ACTIONS,
  INSTALLABLE_KEYS,
  type InstallableKey,
  isEarningsKey,
  moduleLabel,
  moduleOfKey,
} from '../core/catalog.ts';
import { rolePermissions } from '../core/dto.ts';
import { uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { SEED_NOW } from '../core/state.ts';
import { SOD_TEXT, subtree } from './rules.ts';

type S = components['schemas'];
type Step = S['AccessCheck']['check'];

const PERMISSION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PD53 =
  'Право есть только в роли на проект: без задачи этого проекта оно не действует (PD-53).';

export const explainHandlers: Registry = {
  explainAccess: (ctx) => {
    const t = ctx.org();
    const org = t.org;
    const memberId = uuidParam(ctx.query, 'memberId') ?? '';
    const permission = ctx.query.get('permission') ?? '';
    if (!PERMISSION.test(permission)) fail('malformed_request', 'Нужен параметр permission.');
    const orgUnitId = uuidParam(ctx.query, 'orgUnitId', false);
    const objectId = uuidParam(ctx.query, 'objectId', false);
    const objectModule = ctx.query.get('objectModule');
    const objectType = ctx.query.get('objectType');
    const member = org.members.find((m) => m.id === memberId) ?? fail('not_found');
    const action =
      ACTIONS.get(permission) ??
      fail('validation_failed', 'Права нет в каталоге.', {
        violations: [{ field: 'permission', code: 'unknown', message: 'Нет такого права' }],
      });
    const now = ctx.now();
    const membership = ctx.s.memberships.find(
      (m) => m.tenantId === t.tenant.id && m.memberId === member.id,
    );

    const traces: S['AccessGrantTrace'][] = [];
    const grants = grantsOf(org, member.id, now).filter((g) => g.keys.includes(permission));
    for (const g of grants) {
      const tr: S['AccessGrantTrace'] = {
        assignmentId: g.assignment.id,
        roleId: g.role.id,
        roleName: g.role.name,
        via: g.via,
        scope: structuredClone(g.scope),
        matches: true,
      };
      if (g.groupId) tr.groupId = g.groupId;
      if (g.assignment.validUntil) tr.validUntil = g.assignment.validUntil;
      if (g.scope.kind === 'project' || g.scope.kind === 'resource_pool') {
        if (!objectId) {
          tr.matches = false;
          tr.mismatch = 'object_scope_without_object';
        } else if (!g.scope.resourceIds.includes(objectId)) {
          tr.matches = false;
          tr.mismatch = 'other_object';
        }
      } else if (g.scope.kind === 'org_unit' && orgUnitId) {
        const covered = g.scope.resourceIds.some((id) => subtree(org, id).has(orgUnitId));
        if (!covered) {
          tr.matches = false;
          tr.mismatch = 'out_of_scope';
        }
      }
      traces.push(tr);
    }
    const ownerAll = org.roles.find((r) => r.all);
    if (t.membership && membership?.owner && !grants.some((g) => g.role.all) && ownerAll) {
      if (rolePermissions(org, ownerAll).includes(permission)) {
        traces.push({
          roleId: ownerAll.id,
          roleName: ownerAll.name,
          via: 'owner',
          scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
          matches: true,
        });
      }
    }

    const mod = moduleOfKey(permission);
    const installable = (INSTALLABLE_KEYS as string[]).includes(mod);
    const results: [Step, string | undefined, S['ProblemCode']][] = [
      [
        'tenant-membership-and-binding',
        member.status === 'active' ? undefined : 'Участник не активен в организации.',
        'not_found',
      ],
      [
        'tenant-state',
        t.tenant.status === 'suspended'
          ? 'Организация приостановлена.'
          : (t.tenant.status === 'read_only' || t.tenant.status === 'grace') &&
              action.level !== 'view'
            ? 'Организация в режиме только чтения.'
            : undefined,
        t.tenant.status === 'suspended' ? 'tenant_suspended' : 'tenant_read_only',
      ],
      [
        'module-installation',
        installable && org.modules[mod]?.state !== 'active'
          ? `Модуль «${moduleLabel(mod as InstallableKey)}» не подключён.`
          : undefined,
        'module_not_installed',
      ],
      ['plan-entitlement', undefined, 'feature_requires_plan'],
      [
        'separation-of-duties',
        isEarningsKey(permission) && isDriver(org, member, now) ? SOD_TEXT : undefined,
        'function_blocked',
      ],
      [
        'permission',
        traces.some((x) => x.matches)
          ? undefined
          : traces.length && traces.every((x) => x.mismatch === 'object_scope_without_object')
            ? PD53
            : traces.length
              ? 'Право есть, но не в этой области.'
              : 'Ни одна роль участника не даёт этого права.',
        'forbidden_action',
      ],
    ];
    const failed = results.find(([, detail]) => detail !== undefined);
    const body: S['AccessExplanation'] = {
      memberId: member.id,
      permission,
      allowed: !failed,
      decisiveCheck: failed?.[0] ?? 'permission',
      checks: results.map(([check, detail]) =>
        detail === undefined ? { check, passed: true } : { check, passed: false, detail },
      ),
      grants: traces,
      hiddenGrants: false,
      policyVersion: `${SEED_NOW}.${org.policyVersion}`,
    };
    if (failed) body.denyCode = failed[2];
    if (orgUnitId) body.orgUnitId = orgUnitId;
    if (objectId && objectModule && objectType) {
      body.object = { moduleKey: objectModule, entityType: objectType, entityId: objectId };
    }
    return { body };
  },
};
