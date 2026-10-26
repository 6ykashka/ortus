// W4.61 · Бейджи меню оператора (navForBase :2971–2973): «Заявки на тариф» — число заявок на рассмотрении
// (`pendingCount` listPlatformSubscriptionRequests, W4.07). Ключ — под `['platform']`: команды страниц оператора
// перечитывают его вместе со своими данными. Нет права роли (403) или сбой — без бейджа.
import { unwrap } from '@ortus/api-client';
import { tasksBadges } from '@ortus/domain/home';
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

/** Ключ сводки задач — под ключом задач организации: команды «Задач» перечитывают его вместе со своими данными. */
export const taskSummaryKey = (tenantId: string) =>
  ['tenant', tenantId, 'tasks', 'home-summary'] as const;

/**
 * W4.81 · Сводка задач участника (getMyTaskSummary, контракт 0.11.1-stage4): карточка «Задачи» «Главной» и бейдж пункта
 * меню «Задачи» (мои задачи в первом статусе «К выполнению», Р-27). Нет права или сбой — без карточки и бейджа.
 */
export function useTaskSummary(tenantId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: taskSummaryKey(tenantId ?? ''),
    enabled: tenantId !== null,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/me/task-summary', {
          params: { query: { tenantId: tenantId ?? '' } },
        }),
      ),
  });
}

/** Бейджи меню организации: «Задачи» (W4.81). */
export function useTenantBadges(tenantId: string | null): NavBadges {
  return tasksBadges(useTaskSummary(tenantId).data);
}
