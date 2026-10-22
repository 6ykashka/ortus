// W4.61 · Запросы «Использования»: getPlatformUsage (W4.07) и конец пробного периода организаций с сигналом
// «пробный период закончился» — из их подписки (getPlatformSubscription): в сигнале контракта даты нет.
import { type components, unwrap } from '@ortus/api-client';
import { useQueries, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { PLATFORM_KEY } from '../kit/api.ts';

type Usage = components['schemas']['PlatformUsage'];

export const USAGE_KEY = [...PLATFORM_KEY, 'usage'] as const;

export function useUsage() {
  const api = useApi();
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: async (): Promise<Usage> => unwrap(await api.GET('/api/v1/platform/usage')),
  });
}

/** Конец пробного периода по организации: подписки организаций с сигналом trial_expired. */
export function useTrialEnds(usage: Usage | undefined): ReadonlyMap<string, string> {
  const api = useApi();
  const ids = [
    ...new Set(
      (usage?.signals ?? []).filter((s) => s.kind === 'trial_expired').map((s) => s.tenantId),
    ),
  ];
  return useQueries({
    queries: ids.map((tenantId) => ({
      queryKey: [...PLATFORM_KEY, 'subscription', tenantId, 'body'] as const,
      queryFn: async () =>
        unwrap(
          await api.GET('/api/v1/platform/tenants/{tenantId}/subscription', {
            params: { path: { tenantId } },
          }),
        ),
    })),
    combine: (results) =>
      new Map(
        results.flatMap((r, i): [string, string][] => {
          const end = r.data?.trialEndsAt;
          return end ? [[ids[i] ?? '', end]] : [];
        }),
      ),
  });
}
