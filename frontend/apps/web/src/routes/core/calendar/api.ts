// W4.41 · Запросы «Календаря» (контракт 0.7.0-stage4, тег Calendar; W4.06, backend — W4.40): ресурсы
// listCalendarResources (порядок сервера), брони окна listCalendarBookings (`from`/`to` — сутки или неделя), бронь
// getCalendarBooking (ETag перед переносом, ссылка `?booking=`), перенос updateCalendarBooking (If-Match,
// Idempotency-Key; текущие ресурсы брони — Q-W4.06-14), свободные слоты findCalendarAvailability.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const calendarKey = (tenantId: string) => ['tenant', tenantId, 'calendar'] as const;

/** Предел страницы контракта (`Limit`). */
const LIMIT = 200;
/** Страниц на один список (ресурсов и броней в окне — единицы и десятки). */
const PAGES = 20;

/** Все страницы списка по курсору. */
async function all<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const p = await page(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

/** Ресурсы календаря участника в порядке сервера (вид, затем имя). */
export function useResources(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...calendarKey(tenantId), 'resources'],
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/calendar/resources', {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/**
 * Брони окна [from, to) (мс); окно появляется после ресурсов (пояс). Брони прошлого окна не подставляются в новое
 * (возврат 1): до ответа — скелетон, а не строки ресурсов без броней, будто они свободны.
 */
export function useBookings(tenantId: string, win: { from: number; to: number } | null) {
  const api = useApi();
  const from = win ? new Date(win.from).toISOString() : '';
  const to = win ? new Date(win.to).toISOString() : '';
  return useQuery({
    queryKey: [...calendarKey(tenantId), 'bookings', from, to],
    enabled: win !== null,
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/calendar/bookings', {
            params: {
              path: { tenantId },
              query: { from, to, limit: LIMIT, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

/** Бронь по id (ссылка `?booking=` на бронь вне окна). */
export function useBooking(tenantId: string, bookingId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...calendarKey(tenantId), 'booking', bookingId],
    enabled: enabled && !!bookingId,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/calendar/bookings/{bookingId}', {
          params: { path: { tenantId, bookingId: bookingId ?? '' } },
        }),
      ),
  });
}

/**
 * Ключи идемпотентности панели (соглашение W2.23, Q-W2.22-9): та же команда с тем же телом — тот же
 * `Idempotency-Key` до определённого ответа сервера (повтор после «нет связи» сервер узнаёт), другое тело — новый.
 */
export function idemKeys(): { key: (body: unknown) => string; settle: (body: unknown) => void } {
  const keys = new Map<string, string>();
  const fp = (body: unknown) => JSON.stringify(body ?? null);
  return {
    key: (body) => {
      let k = keys.get(fp(body));
      if (!k) {
        k = crypto.randomUUID();
        keys.set(fp(body), k);
      }
      return k;
    },
    settle: (body) => void keys.delete(fp(body)),
  };
}

/** Тело переноса: бронь и версия, которые видел участник, и новое окно (отпечаток ключа идемпотентности). */
export const rescheduleBody = (seen: S['Booking'], window: S['TimeWindow']) => ({
  bookingId: seen.id,
  revision: seen.revision,
  window,
});

/** Версия изменилась мимо экрана — 412 с кодом реестра (тот же тост и перечитывание, что у ответа сервера). */
const staleVersion = (): ProblemError =>
  new ProblemError(412, {
    type: 'about:blank',
    title: 'Precondition Failed',
    status: 412,
    code: 'revision_mismatch',
    requestId: '',
  });

/**
 * «Проверить и перенести» (moveBooking эталона): свежая бронь и её ETag → PATCH `reschedule` с новым окном и текущими
 * ресурсами брони. Сервер атомарно проверяет все ресурсы с подготовкой и уборкой (409 resources_unavailable).
 * If-Match защищает версию, которую видел участник (возврат 1): бронь изменили после показа (другая `revision`) —
 * команда не уходит, 412 `revision_mismatch`; окно и его длительность посчитаны от той же версии.
 */
export async function reschedule(
  api: ApiClient,
  tenantId: string,
  seen: S['Booking'],
  window: S['TimeWindow'],
  idempotencyKey: string,
): Promise<S['Booking']> {
  const path = { tenantId, bookingId: seen.id };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/calendar/bookings/{bookingId}', {
    params: { path },
  });
  const fresh = await unwrap(cur);
  if (fresh.revision !== seen.revision) throw staleVersion();
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/calendar/bookings/{bookingId}', {
      params: { path, header: { 'Idempotency-Key': idempotencyKey, 'If-Match': etag } },
      body: { action: 'reschedule', window, resources: fresh.resources },
    }),
  );
}

/** «Свободные слоты для всех ресурсов» (freeSlots эталона). */
export async function freeSlots(
  api: ApiClient,
  tenantId: string,
  query: S['AvailabilityQuery'],
): Promise<S['AvailabilitySlot'][]> {
  const r = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/calendar/availability', {
      params: { path: { tenantId } },
      body: query,
    }),
  );
  return r.slots;
}
