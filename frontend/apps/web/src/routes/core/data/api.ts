// W2.26 · Запросы «Данных» (контракт 0.6.0-stage2, тег Data; W2.51, backend W2.08): каталог наборов listDatasets,
// строки queryDataset страницами по курсору (курсор привязан к фильтру, поиску и сортировке — новая выборка
// начинается без курсора), число строк вкладки (`includeCount`, `limit` 1), рейс расхода по номеру (listTripPlans).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { orderJobs, type PageViewQuery } from './jobs.ts';
import { querySort, type Sort } from './model.ts';

type S = components['schemas'];

export const dataKey = (tenantId: string) => ['tenant', tenantId, 'data'] as const;

/** Строк на страницу таблицы. */
export const PAGE = 50;

const QUERY = '/api/v1/tenants/{tenantId}/datasets/{datasetId}/query' as const;

/** Наборы, видимые участнику, — порядок сервера (как вкладки эталона). */
export function useDatasets(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...dataKey(tenantId), 'catalog'],
    queryFn: async (): Promise<S['Dataset'][]> =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/datasets', { params: { path: { tenantId } } }),
        )
      ).items,
  });
}

/** Счётчики вкладок: строки области набора без фильтра (`visibleCount`, предел сервера 10 000). */
export function useCounts(tenantId: string, sets: readonly S['Dataset'][]) {
  const api = useApi();
  return useQueries({
    queries: sets.map((ds) => ({
      queryKey: [...dataKey(tenantId), 'count', ds.id, ds.permissionVersion],
      enabled: ds.fields.length > 0,
      queryFn: async () => {
        const r = await unwrap(
          await api.POST(QUERY, {
            params: { path: { tenantId, datasetId: ds.id } },
            body: {
              select: [ds.fields[0]?.key ?? ''],
              filters: [],
              sort: [],
              limit: 1,
              includeCount: true,
            },
          }),
        );
        return { n: r.visibleCount ?? r.rows.length, capped: r.visibleCountCapped === true };
      },
    })),
  });
}

/** Строки набора: все видимые поля, поиск «По любому видимому полю», сортировка; число строк — с первой страницей. */
export function useRows(tenantId: string, ds: S['Dataset'], search: string, sort: Sort | null) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...dataKey(tenantId), 'rows', ds.id, ds.permissionVersion, search, sort],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: S['DatasetQueryResult']) => last.nextCursor ?? undefined,
    // Ввод фильтра и смена сортировки не стирают таблицу до ответа (набор тот же — колонки те же).
    placeholderData: (prev) => prev,
    // Ответ — схема контракта (у пустого значения генератор ответа делает value необязательным).
    queryFn: async ({ pageParam }): Promise<S['DatasetQueryResult']> =>
      (await unwrap(
        await api.POST(QUERY, {
          params: { path: { tenantId, datasetId: ds.id } },
          body: {
            select: ds.fields.map((f) => f.key),
            filters: [],
            sort: querySort(sort),
            limit: PAGE,
            includeCount: !pageParam,
            ...(search ? { search } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
      )) as S['DatasetQueryResult'],
  });
}

// W4.50 · Сохранённые виды и выгрузка заданием (контракт 0.7.0-stage4 W4.06, тег Data).

const VIEWS = '/api/v1/tenants/{tenantId}/datasets/{datasetId}/views' as const;
const JOBS = '/api/v1/tenants/{tenantId}/data/export-jobs' as const;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
/**
 * If-Match по ревизии строки (в списках видов и журнала нет ETag строки): «"rev-N"» — так его называет MSW W4.06, сервер
 * W4.50 принимает и «"rev-N"», и «"N"» (Q-W1.08-9, Q-W2.41-1).
 */
const tag = (revision: number) => `"rev-${String(revision)}"`;

export const viewsKey = (tenantId: string, datasetId: string) =>
  [...dataKey(tenantId), 'views', datasetId] as const;
export const jobsKey = (tenantId: string) => [...dataKey(tenantId), 'export-jobs'] as const;

/** Виды набора, которые видит участник: свои личные и общие (порядок сервера — по имени). */
export function useViews(tenantId: string, datasetId: string) {
  const api = useApi();
  return useQuery({
    queryKey: viewsKey(tenantId, datasetId),
    queryFn: async (): Promise<S['DatasetView'][]> =>
      // Ответ — схема контракта (у пустого значения генератор ответа делает value необязательным).
      (await unwrap(await api.GET(VIEWS, { params: { path: { tenantId, datasetId } } })))
        .items as S['DatasetView'][],
  });
}

/** Новый личный вид (createDatasetView). */
export async function createView(
  api: ApiClient,
  tenantId: string,
  datasetId: string,
  name: string,
  query: PageViewQuery,
): Promise<S['DatasetView']> {
  return (await unwrap(
    await api.POST(VIEWS, {
      params: { path: { tenantId, datasetId }, header: idem() },
      body: { name, visibility: 'personal', query },
    }),
  )) as S['DatasetView'];
}

/** Новый запрос своего вида (updateDatasetView, If-Match по ревизии). */
export async function updateView(
  api: ApiClient,
  tenantId: string,
  v: S['DatasetView'],
  query: PageViewQuery,
): Promise<S['DatasetView']> {
  return (await unwrap(
    await api.PATCH(`${VIEWS}/{viewId}` as const, {
      params: {
        path: { tenantId, datasetId: v.datasetId, viewId: v.id },
        header: { ...idem(), 'If-Match': tag(v.revision) },
      },
      body: { query },
    }),
  )) as S['DatasetView'];
}

/** Журнал «Выгрузки»: последние задания участника (владелец — всех); опрос, пока есть очередь. */
export const JOURNAL = 10;
export const POLL_MS = 2000;

/**
 * enabled — участник может выгружать (listDatasetExportJobs требует data.export: без права журнал не запрашивается).
 * Порядок «новые сверху» держит страница (orderJobs): при одинаковом моменте новое задание — над прежними.
 */
export function useJobs(tenantId: string, enabled: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: jobsKey(tenantId),
    enabled,
    queryFn: async (): Promise<S['DatasetExportJob'][]> => {
      const items = (
        await unwrap(
          await api.GET(JOBS, { params: { path: { tenantId }, query: { limit: JOURNAL } } }),
        )
      ).items as S['DatasetExportJob'][];
      return orderJobs(items, qc.getQueryData<S['DatasetExportJob'][]>(jobsKey(tenantId)) ?? []);
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j) => j.state === 'queued' || j.state === 'running')
        ? POLL_MS
        : false,
  });
}

/** Профиль участника (автор заданий) — по аккаунту в списке участников; без права на список — неизвестен. */
export function useOwnPerson(tenantId: string, userId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...dataKey(tenantId), 'own-person', userId],
    enabled,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const p = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/members', {
            params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        );
        const hit = p.items.find((m) => m.userId === userId);
        if (hit) return hit.id;
        if (!p.nextCursor) return null;
        cursor = p.nextCursor;
      }
      return null;
    },
  });
}

/** Выгрузка заданием (createDatasetExportJob): спецификация выборки таблицы; 202 — задание в очереди. */
export async function createJob(
  api: ApiClient,
  tenantId: string,
  datasetId: string,
  body: PageViewQuery & { select: string[]; viewId?: string },
): Promise<S['DatasetExportJob']> {
  return (await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/datasets/{datasetId}/export-jobs', {
      params: { path: { tenantId, datasetId }, header: idem() },
      body,
    }),
  )) as S['DatasetExportJob'];
}

/** Отмена очереди или отзыв готовой (revokeDatasetExportJob, If-Match по ревизии). */
export async function revokeJob(
  api: ApiClient,
  tenantId: string,
  id: string,
  revision: number,
): Promise<S['DatasetExportJob']> {
  return (await unwrap(
    await api.POST(`${JOBS}/{exportJobId}/revoke` as const, {
      params: {
        path: { tenantId, exportJobId: id },
        header: { ...idem(), 'If-Match': tag(revision) },
      },
    }),
  )) as S['DatasetExportJob'];
}

/**
 * Файл готовой выгрузки: короткая ссылка сервера (права перепроверяются, 5 минут), затем сам CSV из хранилища
 * (UTF-8 с BOM, как его записал воркер).
 */
export async function downloadJob(
  api: ApiClient,
  tenantId: string,
  id: string,
): Promise<{ blob: Blob; fileName: string }> {
  const d = await unwrap(
    await api.GET(`${JOBS}/{exportJobId}/download` as const, {
      params: { path: { tenantId, exportJobId: id } },
    }),
  );
  const url = new URL(d.downloadUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('downloadUrl: схема не http(s)');
  const r = await fetch(url.href, { credentials: 'omit' });
  if (!r.ok) throw new TypeError(`storage: ${r.status}`);
  return { blob: await r.blob(), fileName: d.fileName };
}

/** Id рейса по номеру (строка «Расходов» несёт номер рейса); не нашёлся — `undefined`. */
export async function tripIdByNumber(
  api: ApiClient,
  tenantId: string,
  number: string,
): Promise<string | undefined> {
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const p = await unwrap(
      await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
        params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
      }),
    );
    const hit = p.items.find((t) => t.number === number);
    if (hit) return hit.id;
    if (!p.nextCursor) return undefined;
    cursor = p.nextCursor;
  }
  return undefined;
}
