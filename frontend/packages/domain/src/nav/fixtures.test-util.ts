// W1.20 · Фикстуры тестов навигации: ответы GET /me/context из примеров контракта (снимки MSW-сервера W0.13
// на сиде W0.12) и варианты состояний модулей D-23 (подключён, отключён с историей, не подключён).
import driverMe from '../../../../../api/openapi/examples/getMyContext/driver.json' with { type: 'json' };
import foremanMe from '../../../../../api/openapi/examples/getMyContext/foreman.json' with { type: 'json' };
import managerMe from '../../../../../api/openapi/examples/getMyContext/manager.json' with { type: 'json' };
import operatorMe from '../../../../../api/openapi/examples/getMyContext/operator.json' with { type: 'json' };
import ownerLotosMe from '../../../../../api/openapi/examples/getMyContext/owner-lotos.json' with { type: 'json' };
import ownerMe from '../../../../../api/openapi/examples/getMyContext/owner.json' with { type: 'json' };
import therapistMe from '../../../../../api/openapi/examples/getMyContext/therapist.json' with { type: 'json' };
import type { ModuleAvailabilityLike, NavTenantLike, ScopedCapabilityLike } from './types.ts';

export interface MeLike {
  displayName: string;
  platformOperator: boolean;
  tenants: (NavTenantLike & { tenantId: string; name: string })[];
}

export const ME = {
  owner: ownerMe as MeLike,
  ownerLotos: ownerLotosMe as MeLike,
  manager: managerMe as MeLike,
  driver: driverMe as MeLike,
  therapist: therapistMe as MeLike,
  foreman: foremanMe as MeLike,
  operator: operatorMe as MeLike,
} as const;

/** Первая организация ответа (у владельца, логиста, водителя — «Альта Групп»). */
export function tenantOf(me: MeLike, name = 'Альта Групп'): NavTenantLike {
  const t = me.tenants.find((x) => x.name === name);
  if (!t) throw new Error(`нет организации «${name}» в ответе ${me.displayName}`);
  return t;
}

/** Та же организация с заменой доступности модуля. */
export function withModule(
  t: NavTenantLike,
  moduleKey: string,
  patch: Partial<ModuleAvailabilityLike>,
): NavTenantLike {
  return {
    ...t,
    modules: t.modules.map((m) => (m.moduleKey === moduleKey ? { ...m, ...patch } : m)),
  };
}

/** Та же организация с дополнительными возможностями. */
export function withCapabilities(
  t: NavTenantLike,
  permissions: readonly string[],
  kind = 'org_unit',
): NavTenantLike {
  const extra: ScopedCapabilityLike[] = permissions.map((permission) => ({
    permission,
    scope: { kind, resourceIds: ['u-1'], includeDescendants: kind === 'org_unit' },
  }));
  return { ...t, capabilities: [...t.capabilities, ...extra] };
}

/** Та же организация с заменой полей состояния организации (`TenantContext.tenantState`, 0.4.0-stage1). */
export function withTenantState(
  t: NavTenantLike,
  patch: Partial<NonNullable<NavTenantLike['tenantState']>>,
): NavTenantLike {
  const base = t.tenantState ?? { status: 'active', storageWriteStatus: 'allowed' };
  return { ...t, tenantState: { ...base, ...patch } };
}

/** Та же организация без `tenantState` (стенд до W1.08 его не присылает). */
export function withoutTenantState(t: NavTenantLike): NavTenantLike {
  return { modules: t.modules, capabilities: t.capabilities };
}

export const ACTIVE = { state: 'active', accessMode: 'write', reason: 'available' } as const;
export const DISABLED = { state: 'read_only', accessMode: 'read', reason: 'disabled' } as const;
export const DISABLED_NO_ACCESS = {
  state: 'read_only',
  accessMode: 'none',
  reason: 'disabled',
} as const;
export const DENIED = { state: 'active', accessMode: 'none', reason: 'permission_denied' } as const;
export const PLAN_EXPIRED = {
  state: 'read_only',
  accessMode: 'read',
  reason: 'plan_expired',
} as const;
