// W1.30 · Помощники стенд-e2e: команды API из браузерной сессии (cookie, CSRF, Idempotency-Key — `call`
// оболочки), структура организации, подписка оператора с возвратом, уникальные адреса приглашённых.
// Сид стенда общий для всех строк и трёх проектов прогона (e2e-stand: workers 1): всё, что строка меняет в
// общем состоянии (места, подписка, назначения), она возвращает сама.
import { expect, type Page } from '@playwright/test';

import { call, type Reply } from '../shell.helpers.ts';
import type { Undo } from './fixtures.ts';

export interface OrgUnit {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'region' | 'company' | 'branch' | 'team';
  revision: number;
}

/** Метка строки: проект и время — адреса и названия не пересекаются между проектами и прогонами. */
export function runLabel(project: string): string {
  const short = project.replace(/^(\w)\w*-(\d+)$/, '$1$2');
  return `${short}${Date.now().toString(36).slice(-5)}`;
}

/** Ответ с ожидаемым статусом, иначе ошибка с телом Problem. */
export function expectStatus(r: Reply, status: number, what: string): Reply {
  expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBe(status);
  return r;
}

/** Создать подразделение (createOrgUnit) из сессии владельца. */
export async function createUnit(
  page: Page,
  tenant: string,
  unit: { parentId: string | null; name: string; kind: OrgUnit['kind'] },
): Promise<OrgUnit> {
  const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/org-units`, { body: unit });
  return expectStatus(r, 201, `createOrgUnit ${unit.name}`).body as OrgUnit;
}

/** Подразделения организации (listOrgUnits). */
export async function listUnits(page: Page, tenant: string): Promise<OrgUnit[]> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/org-units?limit=200`),
    200,
    'listOrgUnits',
  );
  return (r.body as { items: OrgUnit[] }).items;
}

export interface Member {
  id: string;
  displayName: string;
  email?: string;
  status: 'invited' | 'active' | 'suspended';
  orgUnitIds?: string[];
  revision: number;
}

/** Участники организации (listMembers) в области вошедшего. */
export async function listMembers(page: Page, tenant: string): Promise<Reply> {
  return call(page, 'GET', `/api/v1/tenants/${tenant}/members?limit=200`);
}

/** Участник по адресу (владелец). */
export async function memberByEmail(page: Page, tenant: string, email: string): Promise<Member> {
  const r = expectStatus(await listMembers(page, tenant), 200, 'listMembers');
  const m = (r.body as { items: Member[] }).items.find((x) => x.email === email);
  if (!m) throw new Error(`нет участника ${email}`);
  return m;
}

/** Приостановить участника (updateMember status=suspended): место тарифа освобождается. */
export async function suspendMember(page: Page, tenant: string, member: Member): Promise<void> {
  const r = await call(page, 'PATCH', `/api/v1/tenants/${tenant}/members/${member.id}`, {
    body: { status: 'suspended' },
    ifMatch: `"${member.revision}"`,
  });
  expectStatus(r, 200, `suspend ${member.displayName}`);
}

export interface Entitlement {
  key: string;
  sourceType: 'plan' | 'addon' | 'trial' | 'manual';
  sourceRef: string;
  value: number;
  validUntil?: string;
}

export interface Subscription {
  planKey: string;
  status: 'trialing' | 'active' | 'past_due' | 'grace' | 'read_only' | 'cancelled';
  trialEndsAt?: string;
  periodEndsAt?: string;
  graceEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  entitlements: Entitlement[];
  revision: number;
}

/** Подписка организации глазами оператора (getPlatformSubscription) и её ETag. */
export async function platformSubscription(
  operator: Page,
  tenant: string,
): Promise<{ sub: Subscription; etag: string }> {
  const r = expectStatus(
    await call(operator, 'GET', `/api/v1/platform/tenants/${tenant}/subscription`),
    200,
    'getPlatformSubscription',
  );
  return { sub: r.body as Subscription, etag: r.headers.etag ?? '' };
}

/** Тело updatePlatformSubscription из подписки: план, статус, срок своего статуса, ручные права. */
function updateBody(s: Subscription, reason: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    planKey: s.planKey,
    status: s.status,
    cancelAtPeriodEnd: false,
    manualEntitlements: s.entitlements.filter((e) => e.sourceType === 'manual'),
    reason,
  };
  if (s.status === 'trialing' && s.trialEndsAt) body.trialEndsAt = s.trialEndsAt;
  if (s.status === 'active' && s.periodEndsAt) body.periodEndsAt = s.periodEndsAt;
  if (s.status === 'grace' && s.graceEndsAt) body.graceEndsAt = s.graceEndsAt;
  return body;
}

/** Правка подписки оператором (If-Match — свежий ETag). */
export async function putSubscription(
  operator: Page,
  tenant: string,
  next: Subscription,
  reason: string,
): Promise<Subscription> {
  const { etag } = await platformSubscription(operator, tenant);
  const r = await call(operator, 'PUT', `/api/v1/platform/tenants/${tenant}/subscription`, {
    body: updateBody(next, reason),
    ifMatch: etag,
  });
  return expectStatus(r, 200, `updatePlatformSubscription ${next.status}`).body as Subscription;
}

/**
 * Временная правка подписки: `change` получает текущую подписку и возвращает новую. Возврат (статус, срок, план и
 * ручные права как были) регистрируется в `undo` — выполнится и после падения теста; результат — «вернуть сейчас».
 */
export async function changeSubscription(
  operator: Page,
  tenant: string,
  change: (cur: Subscription) => Subscription,
  undo: Undo,
): Promise<() => Promise<void>> {
  const { sub: before } = await platformSubscription(operator, tenant);
  const restore = undo(`подписка ${tenant}`, () =>
    putSubscription(operator, tenant, before, 'W1.30: возврат подписки после стенд-e2e'),
  );
  await putSubscription(operator, tenant, change(before), 'W1.30: стенд-e2e выхода этапа 1');
  return restore;
}

/** Ручное право «места» на сутки: лимит плана + `extra` (оператор, причина обязательна). */
export function withExtraSeats(cur: Subscription, extra: number): Subscription {
  const plan = cur.entitlements.find((e) => e.key === 'seats');
  const validUntil = new Date(Date.now() + 86_400_000).toISOString();
  return {
    ...cur,
    entitlements: [
      ...cur.entitlements.filter((e) => !(e.key === 'seats' && e.sourceType === 'manual')),
      {
        key: 'seats',
        sourceType: 'manual',
        sourceRef: 'W1.30 e2e',
        value: (plan?.value ?? 0) + extra,
        validUntil,
      },
    ],
  };
}

export interface Assignment {
  id: string;
  principalId: string;
  roleId: string;
}

/** Id роли по названию (listRoles). */
export async function roleId(page: Page, tenant: string, name: string): Promise<string> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/roles?limit=200`),
    200,
    'listRoles',
  );
  const role = (r.body as { items: { id: string; name: string }[] }).items.find(
    (x) => x.name === name,
  );
  if (!role) throw new Error(`нет роли «${name}»`);
  return role.id;
}

/** Назначить роль участнику в области подразделения с поддеревом (createAssignment). */
export async function assign(
  page: Page,
  tenant: string,
  o: { memberId: string; roleId: string; unitId: string },
): Promise<Assignment> {
  const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/assignments`, {
    body: {
      principalType: 'member',
      principalId: o.memberId,
      roleId: o.roleId,
      scope: { kind: 'org_unit', resourceIds: [o.unitId], includeDescendants: true },
    },
  });
  return expectStatus(r, 201, 'createAssignment').body as Assignment;
}

/** Снять назначение (revokeAssignment); уже снятое — 404, это тоже итог уборки. */
export async function revoke(page: Page, tenant: string, id: string): Promise<number> {
  const r = await call(page, 'DELETE', `/api/v1/tenants/${tenant}/assignments/${id}`);
  if (r.status !== 204 && r.status !== 404) expectStatus(r, 204, 'revokeAssignment');
  return r.status;
}

/** Назначения участника (listAssignments владельца). */
export async function assignmentsOf(
  page: Page,
  tenant: string,
  memberId: string,
): Promise<Assignment[]> {
  const r = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/assignments?limit=200`),
    200,
    'listAssignments',
  );
  return (r.body as { items: Assignment[] }).items.filter((a) => a.principalId === memberId);
}
