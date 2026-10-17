// W2.20 · Запросы и команды рабочего места логиста (контракт 0.5.0-stage2, тег Fleet): рейсы listTripPlans и
// машины listVehicles (все страницы курсора), водители listMembers (профиль «Водитель», для планирования),
// назначение машины assignTripVehicle (If-Match свежего getTripPlan, Idempotency-Key), планирование
// createTripPlan (Idempotency-Key: то же тело — тот же ключ). После команды перечитывается префикс логистики
// организации `['tenant', id, 'fleet']` (рейсы, машины и экраны соседних WS под тем же префиксом).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';

type S = components['schemas'];

export const fleetKey = (tenantId: string) => ['tenant', tenantId, 'fleet'] as const;
const tripsKey = (tenantId: string) => [...fleetKey(tenantId), 'trip-plans'] as const;
const vehiclesKey = (tenantId: string) => [...fleetKey(tenantId), 'vehicles'] as const;
const driversKey = (tenantId: string) => ['tenant', tenantId, 'members', 'drivers'] as const;

const PAGE = 200;
const MAX_PAGES = 50;

async function allPages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = await load(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

const query = (cursor: string | undefined) => ({ limit: PAGE, ...(cursor ? { cursor } : {}) });

/** Рейсы от плана до приёмки (TripPlan), видимые участнику. */
export function useTripPlans(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: tripsKey(tenantId),
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
            params: { path: { tenantId }, query: query(cursor) },
          }),
        ),
      ),
  });
}

/** Машины области `fleet.vehicles.read`. */
export function useVehicles(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: vehiclesKey(tenantId),
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/vehicles', {
            params: { path: { tenantId }, query: query(cursor) },
          }),
        ),
      ),
  });
}

/** Участники для выбора водителя; без `members.read` или при сбое — пусто (водителя назначат позже). */
export function useMembers(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: driversKey(tenantId),
    enabled,
    queryFn: async (): Promise<S['Member'][]> => {
      try {
        return await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: query(cursor) },
            }),
          ),
        );
      } catch {
        return [];
      }
    },
  });
}

/** Ключи идемпотентности формы: то же тело — тот же `Idempotency-Key` (повтор после «нет связи»). */
export function idemKeys(): (body: unknown) => string {
  const keys = new Map<string, string>();
  return (body) => {
    const fp = JSON.stringify(body);
    let key = keys.get(fp);
    if (!key) {
      key = crypto.randomUUID();
      keys.set(fp, key);
    }
    return key;
  };
}

/** «Назначить на рейс»: ETag свежего getTripPlan → PUT …/vehicle с If-Match (без версии — 428). */
export async function assignVehicle(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  vehicleId: string,
): Promise<S['TripPlan']> {
  const path = { tenantId, tripId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans/{tripId}', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/vehicle', {
      params: {
        path,
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etag },
      },
      body: { vehicleId },
    }),
  );
}

export async function createPlan(
  api: ApiClient,
  tenantId: string,
  body: S['TripPlanCreate'],
  key: string,
): Promise<S['TripPlan']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** После команды или конфликта: рейсы и машины логистики организации. */
export async function afterChange(qc: QueryClient, tenantId: string): Promise<void> {
  await qc.invalidateQueries({ queryKey: fleetKey(tenantId) });
}
