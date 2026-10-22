// W4.61 · Бейджи меню оператора (navForBase :2971–2973): «Заявки на тариф» — число заявок на рассмотрении
// (`pendingCount` listPlatformSubscriptionRequests, W4.07). Ключ — под `['platform']`: команды страниц оператора
// перечитывают его вместе со своими данными. Нет права роли (403) или сбой — без бейджа.
import { unwrap } from '@ortus/api-client';
import type { NavBadges } from '@ortus/domain/nav';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../app/api.tsx';

export const PENDING_REQUESTS_KEY = ['platform', 'subscription-requests', 'pending-count'] as const;

export function usePlatformBadges(operator: boolean): NavBadges {
  const api = useApi();
  const q = useQuery({
    queryKey: PENDING_REQUESTS_KEY,
    enabled: operator,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/platform/subscription-requests', {
            params: { query: { status: 'pending', limit: 1 } },
          }),
        )
      ).pendingCount ?? 0,
  });
  return operator && q.data ? { requests: q.data } : {};
}
