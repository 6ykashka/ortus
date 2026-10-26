// W5.21 · Запросы страницы «Салон и SPA» (контракт 0.12.0-stage5, тег Spa; backend — W5.20): визиты недели и
// «учёт не завершён» (listAppointments), услуги и техкарты (listSpaServices), ресурсы и брони календаря (названия
// кабинетов, оборудования, специалистов; клиент — из названия брони, Q-W5.21-1), номенклатура, склад и остатки
// (listInventoryItems, listWarehouses, listInventoryBalances — W5.10). Команды: запись, перенос, отмена, отметка
// выполнения, завершение, создание и правка услуги — If-Match по свежему ETag, Idempotency-Key на тело.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';

type S = components['schemas'];

export const spaKey = (tenantId: string) => ['tenant', tenantId, 'spa'] as const;
const calendarKey = (tenantId: string) => ['tenant', tenantId, 'calendar'] as const;
const inventoryKey = (tenantId: string) => ['tenant', tenantId, 'inventory'] as const;
export { calendarKey, inventoryKey };

const LIMIT = 200;
const PAGES = 20;

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

/** Запрет по праву (403): раздел данных скрыт от роли — не ошибка страницы, а отсутствие данных. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Визиты окна [from, to) — по начальному моменту; сервер сам отдаёт только разрешённые (область и «своё»). */
export function useVisits(tenantId: string, win: { from: number; to: number } | null) {
  const api = useApi();
  const from = win ? iso(win.from) : '';
  const to = win ? iso(win.to) : '';
  return useQuery({
    queryKey: [...spaKey(tenantId), 'visits', from, to],
    enabled: win !== null,
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/spa/appointments', {
            params: {
              path: { tenantId },
              query: { from, to, limit: LIMIT, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

/** Визиты «выполнено, учёт не завершён» — без периода (баннер владельца, :1873). */
export function usePending(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...spaKey(tenantId), 'pending'],
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/spa/appointments', {
            params: {
              path: { tenantId },
              query: {
                status: 'performed_pending_posting',
                limit: LIMIT,
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      ),
  });
}

/** Услуги с техкартой; `null` — у роли нет права `spa.services.read` (специалист по каталогу 0.12.0). */
export function useServices(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...spaKey(tenantId), 'services'],
    retry: false,
    queryFn: () =>
      orNull(() =>
        all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/spa/services', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ),
  });
}

/** Ресурсы календаря (специалисты, кабинеты, оборудование); без права — пусто. */
export function useResources(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...calendarKey(tenantId), 'resources'],
    retry: false,
    queryFn: async () =>
      (await orNull(() =>
        all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/calendar/resources', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      )) ?? [],
  });
}

/** Брони окна (≤ 7 суток) — названия «Услуга · Клиент»; без права календаря — пусто. */
export function useBookings(tenantId: string, win: { from: number; to: number } | null) {
  const api = useApi();
  const from = win ? iso(win.from) : '';
  const to = win ? iso(win.to) : '';
  return useQuery({
    queryKey: [...calendarKey(tenantId), 'bookings', from, to],
    enabled: win !== null,
    retry: false,
    queryFn: async () =>
      (await orNull(() =>
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
      )) ?? [],
  });
}

/** Номенклатура (названия позиций техкарты и единицы); `null` — нет права склада. */
export function useItems(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'items'],
    retry: false,
    queryFn: () =>
      orNull(() =>
        all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/inventory/items', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ),
  });
}

/** Остатки по складам: позиция → «доступно» (нужны для баннера и решения владельца). */
export function useBalances(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'balances'],
    enabled,
    retry: false,
    queryFn: async () =>
      (await orNull(() =>
        all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/inventory/balances', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      )) ?? [],
  });
}

// ───────────────────────────── команды ─────────────────────────────

/**
 * Ключи идемпотентности (соглашение W2.23): то же тело — тот же `Idempotency-Key` до определённого ответа сервера,
 * другое тело — новый.
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

const staleVersion = (): ProblemError =>
  new ProblemError(412, {
    type: 'about:blank',
    title: 'Precondition Failed',
    status: 412,
    code: 'revision_mismatch',
    requestId: '',
  });

/** Свежий визит и его ETag; версия, которую видел участник, изменилась мимо экрана — 412 без отправки команды. */
async function freshVisit(
  api: ApiClient,
  tenantId: string,
  seen: S['Appointment'],
): Promise<{ etag: string }> {
  const path = { tenantId, appointmentId: seen.id };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/spa/appointments/{appointmentId}', {
    params: { path },
  });
  const fresh = await unwrap(cur);
  if (fresh.revision !== seen.revision) throw staleVersion();
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return { etag };
}

export interface Command<B> {
  api: ApiClient;
  tenantId: string;
  seen: S['Appointment'];
  body: B;
  key: string;
}

export async function recordPerformance(
  c: Command<S['AppointmentPerformance']>,
): Promise<S['Appointment']> {
  const { etag } = await freshVisit(c.api, c.tenantId, c.seen);
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/spa/appointments/{appointmentId}/performance', {
      params: {
        path: { tenantId: c.tenantId, appointmentId: c.seen.id },
        header: { 'Idempotency-Key': c.key, 'If-Match': etag },
      },
      body: c.body,
    }),
  );
}

export async function completeVisit(
  c: Command<S['AppointmentComplete']>,
): Promise<S['AppointmentCompletion']> {
  const { etag } = await freshVisit(c.api, c.tenantId, c.seen);
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/spa/appointments/{appointmentId}/completion', {
      params: {
        path: { tenantId: c.tenantId, appointmentId: c.seen.id },
        header: { 'Idempotency-Key': c.key, 'If-Match': etag },
      },
      body: c.body,
    }),
  );
}

export async function cancelVisit(c: Command<S['AppointmentCancel']>): Promise<S['Appointment']> {
  const { etag } = await freshVisit(c.api, c.tenantId, c.seen);
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/spa/appointments/{appointmentId}/cancel', {
      params: {
        path: { tenantId: c.tenantId, appointmentId: c.seen.id },
        header: { 'Idempotency-Key': c.key, 'If-Match': etag },
      },
      body: c.body,
    }),
  );
}

export async function rescheduleVisit(
  c: Command<S['AppointmentReschedule']>,
): Promise<S['Appointment']> {
  const { etag } = await freshVisit(c.api, c.tenantId, c.seen);
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/spa/appointments/{appointmentId}/reschedule', {
      params: {
        path: { tenantId: c.tenantId, appointmentId: c.seen.id },
        header: { 'Idempotency-Key': c.key, 'If-Match': etag },
      },
      body: c.body,
    }),
  );
}

export async function createVisit(
  api: ApiClient,
  tenantId: string,
  body: S['AppointmentCreate'],
  key: string,
): Promise<S['Appointment']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/spa/appointments', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

export async function createService(
  api: ApiClient,
  tenantId: string,
  body: S['SpaServiceCreate'],
  key: string,
): Promise<S['SpaService']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/spa/services', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** Правка услуги: свежая услуга и её ETag; чужая правка мимо экрана — 412 (перечитать). */
export async function updateService(
  api: ApiClient,
  tenantId: string,
  seen: S['SpaService'],
  body: S['SpaServicePatch'],
  key: string,
): Promise<S['SpaService']> {
  const path = { tenantId, serviceId: seen.id };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/spa/services/{serviceId}', {
    params: { path },
  });
  const fresh = await unwrap(cur);
  if (fresh.revision !== seen.revision) throw staleVersion();
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/spa/services/{serviceId}', {
      params: { path, header: { 'Idempotency-Key': key, 'If-Match': etag } },
      body,
    }),
  );
}

/** Склад салона для списания: первый неархивный склад (listWarehouses, W5.10). */
export async function firstWarehouse(api: ApiClient, tenantId: string): Promise<string | null> {
  const list = await unwrap(
    await api.GET('/api/v1/tenants/{tenantId}/inventory/warehouses', {
      params: { path: { tenantId }, query: { limit: LIMIT } },
    }),
  );
  return list.items.find((w) => !w.archived)?.id ?? null;
}
