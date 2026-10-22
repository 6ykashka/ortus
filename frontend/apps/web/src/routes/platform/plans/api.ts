// W4.61 · Запросы «Тарифной сетки»: версии с отменёнными (номер следующей версии занят и отменённой, Q-W4.07-12),
// публикация с даты и отмена запланированной версии (W4.07; Idempotency-Key).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { allPages, idem, PLATFORM_KEY } from '../kit/api.ts';

type Version = components['schemas']['PriceBookVersion'];
type Create = components['schemas']['PriceBookVersionCreate'];

export const VERSIONS_KEY = [...PLATFORM_KEY, 'price-book', 'versions'] as const;

export function useVersions() {
  const api = useApi();
  return useQuery({
    queryKey: VERSIONS_KEY,
    queryFn: async (): Promise<Version[]> =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/platform/price-book/versions', {
            params: {
              query: { includeCancelled: true, limit: 200, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

export async function publishVersion(api: ApiClient, body: Create): Promise<Version> {
  return unwrap(
    await api.POST('/api/v1/platform/price-book/versions', { params: { header: idem() }, body }),
  );
}

export async function cancelVersion(api: ApiClient, version: number): Promise<Version> {
  return unwrap(
    await api.POST('/api/v1/platform/price-book/versions/{version}/cancel', {
      params: { path: { version }, header: idem() },
    }),
  );
}
