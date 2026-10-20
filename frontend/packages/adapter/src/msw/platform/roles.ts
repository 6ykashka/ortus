// Права операторов платформы по роли (возврат 2 W4.07): design/docs/17-users-and-billing.md «Права» и «Роли»,
// описание PlatformOperator.role контракта 0.8.0-stage4, Go — backend/internal/control/tenants/operators/rules.go
// (grants). Шлюз mock проверяет x-permissions операций /platform/** по роли оператора до хендлера: другой роли —
// 403 forbidden_action, как у tenant-операций.
import { permits } from '../core/access.ts';

const ALL = ['owner', 'admin', 'billing', 'support'] as const;

/** Роли, которым дано право платформы (api/permissions.yaml, раздел platform). */
export const PLATFORM_GRANTS: Readonly<Record<string, readonly string[]>> = {
  'platform.tenants.read': ALL,
  'platform.users.read': ALL,
  'platform.tenants.create': ['owner', 'admin'],
  'platform.tenants.manage': ['owner', 'admin'],
  'platform.pricing.manage': ['owner', 'admin'],
  'platform.users.manage': ['owner', 'admin', 'support'],
  'platform.billing.read': ['owner', 'admin', 'billing'],
  'platform.billing.manage': ['owner', 'admin', 'billing'],
  'platform.operators.manage': ['owner'],
};

/** Права платформы роли оператора. */
export function platformActions(role: string): Set<string> {
  return new Set(
    Object.entries(PLATFORM_GRANTS)
      .filter(([, roles]) => roles.includes(role))
      .map(([permission]) => permission),
  );
}

/** Роль оператора даёт права операции (x-permissions, x-permissions-mode). */
export function operatorPermits(
  role: string,
  permissions: readonly string[],
  mode: string,
): boolean {
  return permits(platformActions(role), permissions, mode);
}
