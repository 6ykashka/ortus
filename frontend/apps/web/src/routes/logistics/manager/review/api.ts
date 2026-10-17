// W2.21 · Запросы и команды «Приёмки смен» (контракт 0.5.0-stage2, теги Fleet, Earnings, Files): рейсы
// listTripPlans и машины listVehicles (все страницы курсора; ключи — общий префикс логистики организации
// `['tenant', id, 'fleet']`, как у W2.20), осмотры getInspection, расходы listTripExpenses, дефект
// getInspectionDefect, начисление getTripEarnings (нет начисления — null), ссылки на фото getFileDownload.
// Команды — reviewTrip и decideInspectionDefect с If-Match свежего GET и Idempotency-Key. После команды
// перечитывается весь префикс логистики (машина освобождается, рейс меняет состояние, очередь дефектов).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';

type S = components['schemas'];

export const fleetKey = (tenantId: string) => ['tenant', tenantId, 'fleet'] as const;
const tripsKey = (tenantId: string) => [...fleetKey(tenantId), 'trip-plans'] as const;
const vehiclesKey = (tenantId: string) => [...fleetKey(tenantId), 'vehicles'] as const;

const PAGE = 200;
const MAX_PAGES = 50;
/** Ссылка на скачивание живёт 5 минут (контракт getFileDownload) — берём свежую раньше. */
const DOWNLOAD_STALE_MS = 4 * 60 * 1000;

export async function allPages<T>(
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

export const pageQuery = (cursor: string | undefined) => ({
  limit: PAGE,
  ...(cursor ? { cursor } : {}),
});

/** Рейсы от плана до приёмки (TripPlan), видимые участнику. */
export function useTripPlans(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: tripsKey(tenantId),
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
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
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Осмотр рейса (выезд или сдача); без id — запроса нет. */
export function useInspection(tenantId: string, inspectionId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'inspections', inspectionId ?? ''],
    enabled: !!inspectionId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/fleet/inspections/{inspectionId}', {
          params: { path: { tenantId, inspectionId: inspectionId ?? '' } },
        }),
      ),
  });
}

export function useExpenses(tenantId: string, tripId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'trips', tripId, 'expenses'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses', {
            params: { path: { tenantId, tripId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Блокирующий дефект рейса (`TripPlan.blockingDefectId`). */
export function useDefect(tenantId: string, defectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'defects', 'one', defectId ?? ''],
    enabled: !!defectId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}', {
          params: { path: { tenantId, defectId: defectId ?? '' } },
        }),
      ),
  });
}

/**
 * Начисление водителю за рейс (S2-12): только с `fleet.earnings.read`; 404 (начисления ещё нет — его создаёт
 * приёмка) и 403 — блока нет (null), а не ошибка экрана.
 */
export function useTripEarnings(tenantId: string, tripId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'trips', tripId, 'earnings'],
    enabled,
    queryFn: async (): Promise<S['TripEarnings'] | null> => {
      try {
        return await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/earnings', {
            params: { path: { tenantId, tripId } },
          }),
        );
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 404 || e.status === 403)) return null;
        throw e;
      }
    },
  });
}

/** Ссылка на фото осмотра; ошибка — null (миниатюра «нет ссылки», экран не падает). */
export function useDownload(tenantId: string, fileId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'files', fileId ?? '', 'download'],
    enabled: !!fileId,
    staleTime: DOWNLOAD_STALE_MS,
    queryFn: async (): Promise<string | null> => {
      try {
        const t = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}/download', {
            params: { path: { tenantId, fileId: fileId ?? '' } },
          }),
        );
        return t.downloadUrl;
      } catch {
        return null;
      }
    },
  });
}

/** ETag свежего GET или 428 (без версии команда не отправляется). */
function etagOf(r: { response: Response }): string {
  const etag = r.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return etag;
}

/** «Принять смену» / «Вернуть на доработку»: ETag свежего getTripPlan → POST …/review. */
export async function reviewTrip(
  api: ApiClient,
  tenantId: string,
  tripId: string,
  body: S['TripReview'],
): Promise<S['Trip']> {
  const path = { tenantId, tripId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans/{tripId}', {
    params: { path },
  });
  await unwrap(cur);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/review', {
      params: {
        path,
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etagOf(cur) },
      },
      body,
    }),
  );
}

/** Решение по блокирующему дефекту (S2-17): ETag свежего getInspectionDefect → POST …/decision. */
export async function decideDefect(
  api: ApiClient,
  tenantId: string,
  defectId: string,
  body: S['DefectDecision'],
): Promise<S['InspectionDefect']> {
  const path = { tenantId, defectId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}', {
    params: { path },
  });
  await unwrap(cur);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}/decision', {
      params: {
        path,
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etagOf(cur) },
      },
      body,
    }),
  );
}

/** После команды или конфликта: вся логистика организации и входящие (уведомления о решении). */
export async function afterChange(qc: QueryClient, tenantId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: fleetKey(tenantId) }),
    qc.invalidateQueries({ queryKey: ['me', 'notifications'] }),
  ]);
}
