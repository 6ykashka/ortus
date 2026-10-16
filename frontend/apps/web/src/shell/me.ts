// W1.20 · Запросы оболочки: GET /me/context (ключ общий с каркасом W0.09) и счётчик входящих
// (getMyNotificationSummary; панель — W1.22, после «Прочитать все» она инвалидирует этот ключ).
import { type MeContext, type TenantContext, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../app/api.tsx';

export const ME_CONTEXT_KEY = ['me', 'context'] as const;
/** Префикс ключей входящих (счётчик и списки): подсказка notifications.changed перечитывает их все (W1.49). */
export const NOTIFICATIONS_KEY = ['me', 'notifications'] as const;
export const NOTIFICATION_SUMMARY_KEY = [...NOTIFICATIONS_KEY, 'summary'] as const;

export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: ME_CONTEXT_KEY,
    // Права меняются событиями (инвалидация после команд, канал PD-58 — W1.07), а не по времени:
    // повторный запрос при каждом монтировании маршрута не нужен.
    staleTime: 30_000,
    queryFn: async (): Promise<MeContext> => unwrap(await api.GET('/api/v1/me/context')),
  });
}

/** Порядок показа организаций — `Intl.Collator('ru')` (Q-W0.09-10): API сортирует по `collate "C"`. */
const collator = new Intl.Collator('ru');
export const sortTenants = (tenants: readonly TenantContext[]): TenantContext[] =>
  [...tenants].sort((a, b) => collator.compare(a.name, b.name));

/** Организации, в которые можно войти: активное членство. */
export const activeTenants = (me: MeContext): TenantContext[] =>
  sortTenants(me.tenants.filter((t) => t.membershipStatus === 'active'));

/** Организация по умолчанию: последняя выбранная (S1-07), иначе первая по порядку показа. */
export function startTenant(me: MeContext): TenantContext | undefined {
  const list = activeTenants(me);
  return list.find((t) => t.tenantId === me.lastTenantId) ?? list[0];
}
