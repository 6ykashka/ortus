// «Почему доступно» (W0.13, W0.08 §4.1, PD-53): шаги x-authorization-order контракта для участника и права —
// членство, состояние организации, подключение модуля, тариф, SoD, право по назначениям. Роль с объектной
// областью (проект) без объекта права не даёт (PD-53).
// W4.02 (0.7.0-stage4): объект — только пара `x-explain-objects` контракта (иначе 422, как cmd/api); запрос с
// подразделением или объектом проверяет `permission` (у участника есть роль с правом), затем `resource-scope` (роль
// достаёт до подразделения или объекта) — шаги и тексты access/explain cmd/api.
import type { components } from '@ortus/api-client';

import { operation } from '../contract/index.ts';
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
type Kind = S['Scope']['kind'];

const PERMISSION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PD53 =
  'Право есть только в роли на проект: без задачи этого проекта оно не действует (PD-53).';

/** Тексты шагов запроса с подразделением или объектом — access/explain cmd/api (W1.06, W4.02). */
const TEXT = {
  objectParams: 'Объект задают вместе: objectModule, objectType и objectId.',
  objectKind: 'Объяснение для объектов этого вида появится вместе с модулем.',
  noRole: 'Ни одна роль сотрудника не разрешает это действие.',
  objectOnly: 'Право есть только в роли на объект: без этого объекта оно не действует (PD-53).',
  otherObject: 'Право есть только в роли на другой объект.',
  outOfScope: 'Право есть, но объект находится вне области назначения.',
} as const;

/** Вид области каталога (`scope_kind`) → `Scope.kind` контракта: отличаются только unit и resource. */
const API_KIND: Readonly<Record<string, Kind>> = { unit: 'org_unit', resource: 'resource_pool' };

/** Виды областей, которые не называют объект: остальные — объектные (PD-53). */
const NOT_OBJECT: ReadonlySet<Kind> = new Set<Kind>(['tenant', 'org_unit', 'self', 'relation']);

/** Объект запроса: `Scope.kind` его области по `x-explain-objects` explainAccess и id. */
function objectOf(q: URLSearchParams): { ref: S['ObjectRef']; kind: Kind } | undefined {
  const objectId = uuidParam(q, 'objectId', false);
  const objectModule = q.get('objectModule');
  const objectType = q.get('objectType');
  const set = [objectModule, objectType, objectId].filter((x) => x !== null && x !== undefined);
  if (set.length === 0) return undefined;
  if (set.length !== 3 || !objectModule || !objectType || !objectId) {
    fail('validation_failed', TEXT.objectParams);
  }
  const pair = (operation('explainAccess').explainObjects ?? []).find(
    (o) => o.objectModule === objectModule && o.objectType === objectType,
  );
  if (!pair) fail('validation_failed', TEXT.objectKind);
  return {
    ref: { moduleKey: objectModule, entityType: objectType, entityId: objectId },
    kind: API_KIND[pair.scopeKind] ?? (pair.scopeKind as Kind),
  };
}

/** Причина отказа шага resource-scope по несовпадениям ролей — reason() access/explain cmd/api. */
function scopeReason(traces: S['AccessGrantTrace'][]): string {
  let project = true;
  let object = true;
  let other = false;
  for (const t of traces) {
    if (t.mismatch === 'object_scope_without_object') {
      project = project && t.scope.kind === 'project';
    } else if (t.mismatch === 'other_object') {
      other = true;
      object = false;
      project = false;
    } else {
      object = false;
      project = false;
    }
  }
  if (project) return PD53;
  if (object) return TEXT.objectOnly;
  if (other) return TEXT.otherObject;
  return TEXT.outOfScope;
}

export const explainHandlers: Registry = {
  explainAccess: (ctx) => {
    const t = ctx.org();
    const org = t.org;
    const memberId = uuidParam(ctx.query, 'memberId') ?? '';
    const permission = ctx.query.get('permission') ?? '';
    if (!PERMISSION.test(permission)) fail('malformed_request', 'Нужен параметр permission.');
    const orgUnitId = uuidParam(ctx.query, 'orgUnitId', false);
    const object = objectOf(ctx.query);
    const scoped = Boolean(orgUnitId || object);
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
      const mismatch = (m: NonNullable<S['AccessGrantTrace']['mismatch']>) => {
        tr.matches = false;
        tr.mismatch = m;
      };
      if (!NOT_OBJECT.has(g.scope.kind)) {
        // Объектная роль — только объект того же вида и id (PD-53).
        if (!object || object.kind !== g.scope.kind) mismatch('object_scope_without_object');
        else if (!g.scope.resourceIds.includes(object.ref.entityId)) mismatch('other_object');
      } else if (g.scope.kind === 'org_unit' && scoped) {
        const covered =
          orgUnitId !== undefined &&
          g.scope.resourceIds.some((id) => subtree(org, id).has(orgUnitId));
        if (!covered) mismatch('out_of_scope');
      } else if ((g.scope.kind === 'self' || g.scope.kind === 'relation') && scoped) {
        // «Своё» и связь с записью — не подразделение и не объект запроса.
        mismatch('out_of_scope');
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
    const matched = traces.some((x) => x.matches);
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
    ];
    if (!scoped) {
      results.push([
        'permission',
        matched
          ? undefined
          : traces.length && traces.every((x) => x.mismatch === 'object_scope_without_object')
            ? PD53
            : traces.length
              ? 'Право есть, но не в этой области.'
              : 'Ни одна роль участника не даёт этого права.',
        'forbidden_action',
      ]);
    } else if (!traces.length) {
      results.push(['permission', TEXT.noRole, 'forbidden_action']);
    } else {
      // Запрос с подразделением или объектом: роль с правом есть — шаг permission пройден, решает resource-scope.
      results.push(['permission', undefined, 'forbidden_action']);
      results.push([
        'resource-scope',
        matched ? undefined : scopeReason(traces),
        'forbidden_action',
      ]);
    }
    const failed = results.find(([, detail]) => detail !== undefined);
    const body: S['AccessExplanation'] = {
      memberId: member.id,
      permission,
      ...(orgUnitId ? { orgUnitId } : {}),
      ...(object ? { object: object.ref } : {}),
      allowed: !failed,
      decisiveCheck: failed?.[0] ?? 'permission',
      ...(failed ? { denyCode: failed[2] } : {}),
      checks: results.map(([check, detail]) =>
        detail === undefined ? { check, passed: true } : { check, passed: false, detail },
      ),
      grants: traces,
      hiddenGrants: false,
      policyVersion: `${SEED_NOW}.${org.policyVersion}`,
    };
    return { body };
  },
};
