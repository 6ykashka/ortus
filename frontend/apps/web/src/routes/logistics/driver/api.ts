// W2.22 · Запросы и команды экрана водителя (контракт 0.5.0-stage2, тег Fleet). Ключи — под префиксом
// `['tenant', id, 'fleet']`: после любой команды перечитывается всё, что видит водитель (смена, машины, расходы,
// осмотры). Изменяющие команды — с Idempotency-Key (тот же ключ на тот же повтор, W2.24 — очередь отправки);
// `finishTripRoute`, `returnTrip`, `releaseReservation` — с If-Match свежего GET.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { pickTrip, type Plan } from './model.ts';

type S = components['schemas'];

export const fleetKey = (tenantId: string) => ['tenant', tenantId, 'fleet'] as const;
export const tripsKey = (tenantId: string) =>
  [...fleetKey(tenantId), 'trip-plans', 'mine'] as const;
export const vehiclesKey = (tenantId: string) => [...fleetKey(tenantId), 'vehicles'] as const;

const PAGE = 100;
const MAX_PAGES = 20;

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

const pageQuery = (cursor: string | undefined) => ({
  limit: PAGE,
  ...(cursor ? { cursor } : {}),
});

/** Решение менеджера ждут эти состояния: смена перечитывается сама (бриф §10 п. 14). */
const WAITING: ReadonlySet<S['TripState']> = new Set(['defect_review', 'submitted']);
export const WAIT_POLL_MS = 10_000;

/** Смена водителя: свои рейсы (водитель видит только их, D22) → `pickTrip`. */
export function useMyTrip(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: tripsKey(tenantId),
    queryFn: async (): Promise<Plan | null> => {
      const plans = await allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      );
      return pickTrip(plans) ?? null;
    },
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s && WAITING.has(s) ? WAIT_POLL_MS : false;
    },
  });
}

/** Машины области водителя (listVehicles). */
export function useVehicles(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: vehiclesKey(tenantId),
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/vehicles', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Чек-лист по версии для машины и вида осмотра. */
export function useChecklist(
  tenantId: string,
  vehicleId: string | undefined,
  kind: 'departure' | 'return',
) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'checklist', vehicleId ?? '', kind],
    enabled: !!vehicleId,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/fleet/inspection-checklist', {
          params: { path: { tenantId }, query: { vehicleId: vehicleId ?? '', kind } },
        }),
      ),
  });
}

/** Расходы рейса. */
export function useExpenses(tenantId: string, tripId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'expenses', tripId ?? ''],
    enabled: enabled && !!tripId,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses', {
            params: { path: { tenantId, tripId: tripId ?? '' }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Осмотр по id (пробег при выезде и при сдаче). */
export function useInspection(tenantId: string, id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'inspection', id ?? ''],
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/fleet/inspections/{inspectionId}', {
          params: { path: { tenantId, inspectionId: id ?? '' } },
        }),
      ),
  });
}

/** Блокирующий дефект рейса («Выезд заблокирован»). */
export function useDefect(tenantId: string, id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'defect', id ?? ''],
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}', {
          params: { path: { tenantId, defectId: id ?? '' } },
        }),
      ),
  });
}

/**
 * Ключи идемпотентности экрана: то же тело команды — тот же `Idempotency-Key` (повтор после «нет связи» сервер
 * узнаёт), другое тело — новый ключ.
 */
export function idemKeys(): (op: string, body: unknown) => string {
  const keys = new Map<string, string>();
  return (op, body) => {
    const fp = `${op}:${JSON.stringify(body ?? null)}`;
    let key = keys.get(fp);
    if (!key) {
      key = crypto.randomUUID();
      keys.set(fp, key);
    }
    return key;
  };
}

const header = (key: string) => ({ 'Idempotency-Key': key });

/** ETag свежего GET (без версии команда не отправляется — 428). */
function etagOf(r: { response: Response }): string {
  const etag = r.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return etag;
}

/** Бронь машины на рейс водителя (S2-03): окно — окно рейса. */
export async function reserve(
  api: ApiClient,
  tenantId: string,
  plan: Plan,
  vehicleId: string,
  key: string,
): Promise<S['Reservation']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/reservations', {
      params: { path: { tenantId }, header: header(key) },
      body: {
        vehicleId,
        driverMemberId: plan.driverMemberId ?? '',
        window: plan.plannedWindow,
        tripId: plan.id,
      },
    }),
  );
}

/** Снять бронь (только с `fleet.reservations.manage`, Q-W2.00-1). */
export async function release(
  api: ApiClient,
  tenantId: string,
  reservationId: string,
  key: string,
): Promise<S['Reservation']> {
  const path = { tenantId, reservationId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}', {
    params: { path },
  });
  await unwrap(cur);
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}', {
      params: { path, header: { ...header(key), 'If-Match': etagOf(cur) } },
      body: { action: 'release' },
    }),
  );
}

export async function submitInspection(
  api: ApiClient,
  tenantId: string,
  body: S['InspectionCreate'],
  key: string,
): Promise<S['Inspection']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/inspections', {
      params: { path: { tenantId }, header: header(key) },
      body,
    }),
  );
}

export async function startTrip(
  api: ApiClient,
  tenantId: string,
  body: S['TripStart'],
  key: string,
): Promise<S['Trip']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/trips', {
      params: { path: { tenantId }, header: header(key) },
      body,
    }),
  );
}

async function planEtag(api: ApiClient, tenantId: string, tripId: string): Promise<string> {
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans/{tripId}', {
    params: { path: { tenantId, tripId } },
  });
  await unwrap(cur);
  return etagOf(cur);
}

/** «Завершить рейс»: on_route → returning (If-Match свежего getTripPlan). */
export async function finishRoute(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  key: string,
): Promise<Plan> {
  const etag = await planEtag(api, tenantId, tripId);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/route-completion', {
      params: { path: { tenantId, tripId }, header: { ...header(key), 'If-Match': etag } },
    }),
  );
}

/** «Сдать машину»: осмотр при сдаче уже принят — returnTrip (If-Match свежего getTripPlan). */
export async function returnTrip(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  returnInspectionId: string,
  key: string,
): Promise<S['Trip']> {
  const etag = await planEtag(api, tenantId, tripId);
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}', {
      params: { path: { tenantId, tripId }, header: { ...header(key), 'If-Match': etag } },
      body: { action: 'return', returnInspectionId },
    }),
  );
}

export async function createExpense(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  body: S['TripExpenseCreate'],
  key: string,
): Promise<S['TripExpense']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses', {
      params: { path: { tenantId, tripId }, header: header(key) },
      body,
    }),
  );
}

/** После команды: смена, машины, расходы и осмотры водителя. */
export async function afterChange(qc: QueryClient, tenantId: string): Promise<void> {
  await qc.invalidateQueries({ queryKey: fleetKey(tenantId) });
}
