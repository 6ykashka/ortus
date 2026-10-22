// W2.23 · Запросы и команды «Ресурсного пула» (контракт 0.6.0-stage2, тег Fleet, W2.51): каталог listAvailableDrivers
// на окно рейса запроса, запросы listDriverTransfers (исходящие — чипы карточек, входящие — блок фирмы-источника), все
// страницы курсора; ключи — под префиксом логистики организации `['tenant', id, 'fleet']` (рейсы listTripPlans — общий
// ключ W2.20/W2.21). Команды: requestDriverTransfer (Idempotency-Key: то же тело — тот же ключ до окончательного ответа,
// повтор после «нет связи»; после 2xx и окончательной 4xx — новый) и decideDriverTransfer (If-Match свежего
// getDriverTransfer). После команды перечитывается префикс логистики и входящие.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import { allPages, fleetKey, pageQuery } from '../review/api.ts';

export { afterChange, useTripPlans } from '../review/api.ts';

type S = components['schemas'];

const poolKey = (tenantId: string) => [...fleetKey(tenantId), 'pool'] as const;

/**
 * Каталог пула на окно рейса (AUTH-06: только минимум сведений); без окна — запроса нет. W2.73 (S2-20 правило 2):
 * с `tripId` — обычная машина водителя с совместимостью и занятостью на окно рейса (`usualVehicle.fit`).
 */
export function useCatalog(tenantId: string, window: S['TimeWindow'] | null, tripId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: [
      ...poolKey(tenantId),
      'catalog',
      window?.startsAt ?? '',
      window?.endsAt ?? '',
      tripId ?? '',
    ],
    enabled: !!window,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/driver-pool', {
            params: {
              path: { tenantId },
              query: {
                availableFrom: window?.startsAt ?? '',
                availableUntil: window?.endsAt ?? '',
                ...(tripId ? { tripId } : {}),
                ...pageQuery(cursor),
              },
            },
          }),
        ),
      ),
  });
}

/** W2.73 · Машины области `fleet.vehicles.read` — подбор «Ставим нашу машину» (1a) и «Машины рейса» (1f). */
export function useVehicles(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...poolKey(tenantId), 'vehicles'],
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

/**
 * W2.73 · Публикации фирмы водителя (listDriverPoolPublications): имя своего водителя во входящем запросе 1b
 * («Олег Тарасов · Водитель #104») — `driverDisplayName` отдаётся только фирме водителя.
 */
export function usePublications(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...poolKey(tenantId), 'publications'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/driver-pool/publications', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** W2.73 · «Оставить …» логиста (1f, 1g): chooseReservation брони машины фирмы рейса, Idempotency-Key. */
export async function keepReservation(
  api: ApiClient,
  tenantId: string,
  reservationId: string,
): Promise<S['ReservationChoice']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}/choose', {
      params: {
        path: { tenantId, reservationId },
        header: { 'Idempotency-Key': crypto.randomUUID() },
      },
    }),
  );
}

/** Запросы водителей: исходящие (фирмы, где смотрящий запрашивает) или входящие (где отпускает). */
export function useTransfers(
  tenantId: string,
  direction: 'incoming' | 'outgoing',
  status: readonly S['DriverTransfer']['status'][],
  enabled = true,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...poolKey(tenantId), 'transfers', direction, ...status],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/driver-transfer-requests', {
            params: {
              path: { tenantId },
              query: { direction, status: [...status], ...pageQuery(cursor) },
            },
          }),
        ),
      ),
  });
}

/** «Отправить запрос» (saveRequest :2817–2820): POST …/driver-transfer-requests с ключом идемпотентности формы. */
export async function requestDriver(
  api: ApiClient,
  tenantId: string,
  body: S['DriverTransferCreate'],
  key: string,
): Promise<S['DriverTransfer']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/driver-transfer-requests', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** «Одобрить» / «Отклонить» фирмы-источника: ETag свежего getDriverTransfer → POST …/decision. */
export async function decideTransfer(
  api: ApiClient,
  tenantId: string,
  requestId: string,
  body: S['DriverTransferDecision'],
): Promise<S['DriverTransfer']> {
  const path = { tenantId, requestId };
  const cur = await api.GET(
    '/api/v1/tenants/{tenantId}/fleet/driver-transfer-requests/{requestId}',
    {
      params: { path },
    },
  );
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.POST(
      '/api/v1/tenants/{tenantId}/fleet/driver-transfer-requests/{requestId}/decision',
      {
        params: {
          path,
          header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etag },
        },
        body,
      },
    ),
  );
}

/** Ключи идемпотентности диалога: `of` — ключ тела, `settle` — ответ сервера на команду с этим телом. */
export interface IdemKeys {
  of: (body: unknown) => string;
  settle: (body: unknown, error?: unknown) => void;
}

/** Повторяемые конфликты реестра ошибок (api/errors.yaml `retryable`), если в ответе нет поля `retryable`. */
const RETRY_CODES: ReadonlySet<string> = new Set([
  'reservation_overlap',
  'resources_unavailable',
  'idempotency_in_progress',
]);

/**
 * Ответ, после которого команду повторяют с тем же ключом: backend его не сохраняет (`retryable` idem.go) — «нет
 * связи» (ответа нет), 5xx, 429 и повторяемые 409. Остальные ответы окончательны: backend хранит их под ключом.
 */
export function sameKeyAfter(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (!(e instanceof ProblemError)) return false;
  return (
    e.status >= 500 || e.status === 429 || e.problem?.retryable === true || RETRY_CODES.has(e.code)
  );
}

/**
 * Ключи идемпотентности диалога: то же тело до окончательного ответа — тот же `Idempotency-Key` (повтор после «нет
 * связи» не создаёт второй запрос); после 2xx и окончательной ошибки ключ тела сбрасывается — повторный запрос того же
 * водителя на тот же рейс (после «Отклонить») идёт с новым ключом, а не получает сохранённый ответ первого.
 */
export function idemKeys(): IdemKeys {
  const keys = new Map<string, string>();
  const fp = (body: unknown): string => JSON.stringify(body);
  return {
    of: (body) => {
      let key = keys.get(fp(body));
      if (!key) {
        key = crypto.randomUUID();
        keys.set(fp(body), key);
      }
      return key;
    },
    settle: (body, error) => {
      if (error === undefined || !sameKeyAfter(error)) keys.delete(fp(body));
    },
  };
}
