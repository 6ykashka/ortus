// W1.20 · Контекст навигации из TenantContext /me/context: рабочее место, доступность модулей, возможности.
// Эталон рисует меню по персонажу (navForBase :2950–3003); реализация выводит рабочее место из возможностей:
// владелец — право управлять модулями (x-scope tenant-owner), водитель — самообслуживание рейса, прораб —
// отметки работ, массажист — записи SPA в области «своё»; остальные — офисные сотрудники.
import type {
  Audience,
  ModuleState,
  NavContext,
  NavManifest,
  NavTenantLike,
  ScopedCapabilityLike,
} from './types.ts';

const has = (caps: readonly ScopedCapabilityLike[], permission: string): boolean =>
  caps.some((c) => c.permission === permission);

export function audienceOf(tenant: NavTenantLike | null, operator: boolean): Audience {
  if (!tenant) return operator ? 'operator' : 'office';
  const caps = tenant.capabilities;
  if (has(caps, 'modules.manage')) return 'owner';
  if (has(caps, 'fleet.trips.start')) return 'driver';
  if (has(caps, 'repairs.work_logs.submit')) return 'foreman';
  if (caps.some((c) => c.permission.startsWith('spa.appointments.') && c.scope.kind === 'self')) {
    return 'practitioner';
  }
  return 'office';
}

/** Статусы организации, при которых новые операции закрыты (эталон restricted/suspended :3088, PD-35). */
const RESTRICTED = new Set(['grace', 'read_only', 'suspended']);

function tenantReadOnly(tenant: NavTenantLike | null): boolean {
  if (!tenant) return false;
  if (tenant.tenantState) return RESTRICTED.has(tenant.tenantState.status);
  return tenant.modules.some((m) => m.reason === 'plan_expired');
}

/** `tenant` — выбранная организация; `null` — контур оператора (или участник без организации). */
export function navContext(tenant: NavTenantLike | null, operator: boolean): NavContext {
  const modules = new Map((tenant?.modules ?? []).map((m) => [m.moduleKey, m]));
  const state = tenant?.tenantState;
  return {
    audience: audienceOf(tenant, operator),
    area: tenant ? 'tenant' : 'platform',
    modules,
    capabilities: tenant?.capabilities ?? [],
    tenantReadOnly: tenantReadOnly(tenant),
    storageBlocked: state ? state.storageWriteStatus === 'blocked' : null,
  };
}

/**
 * Состояние модуля по D-23: `on` — подключён (в том числе «только чтение» организации), `ro` — отключён
 * с историей, `off` — не подключён или полностью выключен. Модуль без доступности: ядро и модули будущих
 * этапов — `on`, отраслевые — `off` (стенд до W1.08 присылает `modules: []`, Q-W0.09-7).
 */
export function moduleState(ctx: NavContext, m: NavManifest): ModuleState {
  if (m.moduleKey === null || m.availability === 'future') return 'on';
  const a = ctx.modules.get(m.moduleKey);
  if (!a) return m.kind === 'industry' || ctx.modules.size > 0 ? 'off' : 'on';
  switch (a.state) {
    case 'active':
    case 'draining':
      return 'on';
    case 'read_only':
      return a.reason === 'disabled' ? 'ro' : 'on';
    default:
      return 'off';
  }
}

/** Право «любое из» в любой области, в том числе объектной (Q-W0.11-1); владельцу — всё. */
export function canAny(ctx: NavContext, permissions: readonly string[]): boolean {
  if (permissions.length === 0 || ctx.audience === 'owner') return true;
  return ctx.capabilities.some((c) => permissions.includes(c.permission));
}
