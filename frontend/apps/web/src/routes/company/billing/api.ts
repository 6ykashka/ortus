// W4.61 · Запросы «Подписки и мест» владельца (W4.07): подписка с местами, тарифная сетка для расчёта, заявки на
// тариф организации, участники (кто занимает место); заявка оператору и её отмена (Idempotency-Key).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { allPages, idem } from '../../platform/kit/api.ts';

type S = components['schemas'];

export const billingKey = (tenantId: string) => ['tenant', tenantId, 'billing'] as const;

export function useSubscription(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...billingKey(tenantId), 'subscription'] as const,
    queryFn: async (): Promise<S['Subscription']> =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/subscription', {
          params: { path: { tenantId } },
        }),
      ),
  });
}

export function usePriceBook(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...billingKey(tenantId), 'price-book'] as const,
    queryFn: async (): Promise<S['TenantPriceBook']> =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/price-book', { params: { path: { tenantId } } }),
      ),
  });
}

export function useChangeRequests(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...billingKey(tenantId), 'change-requests'] as const,
    queryFn: async (): Promise<S['SubscriptionChangeRequest'][]> =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/subscription/change-requests', {
            params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

export function useMembers(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...billingKey(tenantId), 'members'] as const,
    queryFn: async (): Promise<S['Member'][]> =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/members', {
            params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

export async function requestChange(
  api: ApiClient,
  tenantId: string,
  body: S['SubscriptionChangeRequestCreate'],
): Promise<S['SubscriptionChangeRequest']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/subscription/change-requests', {
      params: { path: { tenantId }, header: idem() },
      body,
    }),
  );
}

export async function cancelChange(
  api: ApiClient,
  tenantId: string,
  changeRequestId: string,
): Promise<S['SubscriptionChangeRequest']> {
  return unwrap(
    await api.POST(
      '/api/v1/tenants/{tenantId}/subscription/change-requests/{changeRequestId}/cancel',
      { params: { path: { tenantId, changeRequestId }, header: idem() } },
    ),
  );
}
