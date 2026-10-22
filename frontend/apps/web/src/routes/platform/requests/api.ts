// W4.61 · Запросы «Заявок на тариф»: очередь всех организаций (listPlatformSubscriptionRequests, новые сверху) и
// решение оператора (decidePlatformSubscriptionRequest, Idempotency-Key). Ключ — под `['platform']`: команды
// перечитывают и очередь, и бейдж меню (src/shell/badges.ts), и «Использование».
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { allPages, idem, PLATFORM_KEY } from '../kit/api.ts';

type Req = components['schemas']['SubscriptionChangeRequest'];

export const REQUESTS_KEY = [...PLATFORM_KEY, 'subscription-requests', 'all'] as const;

export function useRequests() {
  const api = useApi();
  return useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: async (): Promise<Req[]> =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/platform/subscription-requests', {
            params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

export async function decide(
  api: ApiClient,
  id: string,
  decision: 'approve' | 'reject',
  note: string,
): Promise<Req> {
  const text = note.trim();
  return unwrap(
    await api.POST('/api/v1/platform/subscription-requests/{changeRequestId}/decision', {
      params: { path: { changeRequestId: id }, header: idem() },
      body: text ? { decision, note: text } : { decision },
    }),
  );
}
