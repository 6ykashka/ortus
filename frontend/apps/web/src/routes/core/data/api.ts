// W2.26 · Запросы «Данных» (контракт 0.6.0-stage2, тег Data; W2.51, backend W2.08): каталог наборов listDatasets,
// строки queryDataset страницами по курсору (курсор привязан к фильтру, поиску и сортировке — новая выборка
// начинается без курсора), число строк вкладки (`includeCount`, `limit` 1), рейс расхода по номеру (listTripPlans).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
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
