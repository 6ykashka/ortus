// W2.21 · Запросы и команда «Начислений водителям» (тег Earnings, контракт 0.5.0-stage2): listTripEarnings по
// подразделению (`orgUnitId` — только сужение области), имена сотрудников listMembers (кто изменил; без права — пусто),
// правка setTripEarnings с If-Match свежего getTripEarnings и Idempotency-Key.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import { allPages, fleetKey, pageQuery } from '../review/api.ts';

type S = components['schemas'];

export function useEarnings(tenantId: string, unit: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'earnings', unit],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/earnings', {
            params: {
              path: { tenantId },
              query: { ...pageQuery(cursor), ...(unit ? { orgUnitId: unit } : {}) },
            },
          }),
        ),
      ),
  });
}

/** Имена сотрудников по id; без members.read или при сбое — пустая карта. */
export function useMemberNames(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'members', 'names'],
    enabled,
    queryFn: async () => {
      try {
        const list = await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: pageQuery(cursor) },
            }),
          ),
        );
        return new Map(list.map((m) => [m.id, m.displayName]));
      } catch {
        return new Map<string, string>();
      }
    },
  });
}

export async function setEarnings(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  body: S['EarningsUpdate'],
): Promise<S['TripEarnings']> {
  const path = { tenantId, tripId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/earnings', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/earnings', {
      params: { path, header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etag } },
      body,
    }),
  );
}
