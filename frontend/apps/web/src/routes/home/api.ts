// W2.25 · Запросы «Главной» (контракт 0.5.0-stage2): очередь getMyDecisionQueue (тег Home; лимит 50 — VM домена
// показывает 8 и знает обо всех карточках для «Начала работы»), рейсы listTripPlans и машины listVehicles
// («Сегодня в работе», «Рейсы сегодня»), входящие listMyNotifications («Последние события», 5 последних),
// участники listMembers (шаг «Пригласить сотрудников»). Ошибки вспомогательных блоков «тихие»: блок скрывается.
import { unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';

const key = (tenantId: string, ...rest: string[]) => ['tenant', tenantId, 'home', ...rest] as const;

/** «Требует решения» участника в организации. */
export function useDecisionQueue(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: key(tenantId, 'decisions'),
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/me/decisions', { params: { query: { tenantId, limit: 50 } } })),
  });
}

/** Рейсы организации в области участника (fleet.trips.read). */
export function useTripPlans(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: key(tenantId, 'trip-plans'),
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
            params: { path: { tenantId }, query: { limit: 100 } },
          }),
        )
      ).items,
  });
}

/** Машины в области участника (fleet.vehicles.read). */
export function useVehicles(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: key(tenantId, 'vehicles'),
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/vehicles', {
            params: { path: { tenantId }, query: { limit: 100 } },
          }),
        )
      ).items,
  });
}

/** Последние события участника — входящие организации. */
export function useRecentEvents(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: key(tenantId, 'events'),
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/me/notifications', {
            params: { query: { tenantId, filter: 'all', limit: 5 } },
          }),
        )
      ).items,
  });
}

/** Есть ли в организации кто-то, кроме владельца (members.read). */
export function useHasStaff(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: key(tenantId, 'has-staff'),
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/members', {
            params: { path: { tenantId }, query: { limit: 2 } },
          }),
        )
      ).items.length > 1,
  });
}
