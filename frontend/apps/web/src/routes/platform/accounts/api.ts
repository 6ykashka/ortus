// W4.61 · Запросы «Пользователей платформы» (W4.07): организации (listPlatformTenants — ключ и вид данных как у
// «Организаций» W1.25), каталог аккаунтов по организации, поиску и фильтру (listPlatformUsers, счётчики без
// фильтра), карточка аккаунта с участиями (getPlatformUser), операторы платформы и команды.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { allPages, idem, PLATFORM_KEY } from '../kit/api.ts';
import type { Filter } from './model.ts';

type S = components['schemas'];
type User = S['PlatformUser'];

const USERS_KEY = [...PLATFORM_KEY, 'users'] as const;
const cardKey = (id: string) => [...USERS_KEY, 'card', id] as const;

export interface UserList {
  items: User[];
  counts: S['PlatformUserCounts'];
}

/** Организации платформы: тот же ключ и вид, что у «Организаций» (W1.25), — общий кэш. */
export function useTenantList() {
  const api = useApi();
  return useQuery({
    queryKey: [...PLATFORM_KEY, 'tenants'] as const,
    queryFn: async (): Promise<S['Tenant'][]> =>
      (
        await unwrap(
          await api.GET('/api/v1/platform/tenants', { params: { query: { limit: 200 } } }),
        )
      ).items,
  });
}

const ZERO: S['PlatformUserCounts'] = {
  all: 0,
  multiTenant: 0,
  noMfa: 0,
  locked: 0,
  neverSignedIn: 0,
};

async function loadUsers(
  api: ApiClient,
  query: { tenantId?: string; q?: string; filter?: Exclude<Filter, 'all'> },
): Promise<UserList> {
  let counts: S['PlatformUserCounts'] | undefined;
  const items = await allPages(async (cursor) => {
    const page = await unwrap(
      await api.GET('/api/v1/platform/users', {
        params: { query: { ...query, limit: 200, ...(cursor ? { cursor } : {}) } },
      }),
    );
    counts ??= page.counts;
    return page;
  });
  return { items, counts: counts ?? ZERO };
}

/** Аккаунты организации (`all` — всей платформы) без поиска и фильтра: итог и счётчики фильтров эталона. */
export function useUsersBase(org: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...USERS_KEY, 'base', org] as const,
    queryFn: () => loadUsers(api, org === 'all' ? {} : { tenantId: org }),
  });
}

/** Строки списка: организация, поиск и фильтр; без поиска и фильтра — базовый список. */
export function useUsersList(org: string, q: string, filter: Filter) {
  const api = useApi();
  const text = q.trim();
  const narrowed = text !== '' || filter !== 'all';
  return useQuery({
    queryKey: [...USERS_KEY, narrowed ? 'list' : 'base', org, ...(narrowed ? [text, filter] : [])],
    placeholderData: keepPreviousData,
    queryFn: () =>
      loadUsers(api, {
        ...(org === 'all' ? {} : { tenantId: org }),
        ...(text ? { q: text.slice(0, 100) } : {}),
        ...(filter === 'all' ? {} : { filter }),
      }),
  });
}

/** Число всех аккаунтов платформы (строка «Все аккаунты» слева). */
export function useAllCount() {
  const api = useApi();
  return useQuery({
    queryKey: [...USERS_KEY, 'count-all'] as const,
    queryFn: async () =>
      (await unwrap(await api.GET('/api/v1/platform/users', { params: { query: { limit: 1 } } })))
        .counts?.all ?? 0,
  });
}

const loadCard = async (api: ApiClient, accountId: string): Promise<User> =>
  unwrap(await api.GET('/api/v1/platform/users/{accountId}', { params: { path: { accountId } } }));

export function useUserCard(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: cardKey(id ?? ''),
    enabled: id !== undefined,
    queryFn: () => loadCard(api, id ?? ''),
  });
}

/** Карточки (участия) аккаунтов: чипы участия строк в организации и popover. */
export function useUserCards(ids: readonly string[]): ReadonlyMap<string, User> {
  const api = useApi();
  return useQueries({
    queries: ids.map((id) => ({ queryKey: cardKey(id), queryFn: () => loadCard(api, id) })),
    combine: (results) =>
      new Map(
        results.flatMap((r, i): [string, User][] => (r.data ? [[ids[i] ?? '', r.data]] : [])),
      ),
  });
}

export function useOperators() {
  const api = useApi();
  return useQuery({
    queryKey: [...PLATFORM_KEY, 'operators'] as const,
    queryFn: async (): Promise<S['PlatformOperatorPage']> =>
      unwrap(await api.GET('/api/v1/platform/operators', { params: { query: { limit: 200 } } })),
  });
}

const path = (accountId: string) => ({ path: { accountId }, header: idem() });

export async function lockUser(api: ApiClient, id: string, reason: string): Promise<User> {
  return unwrap(
    await api.POST('/api/v1/platform/users/{accountId}/lock', {
      params: path(id),
      body: { reason: reason.trim() },
    }),
  );
}

export async function unlockUser(api: ApiClient, id: string): Promise<User> {
  return unwrap(await api.POST('/api/v1/platform/users/{accountId}/unlock', { params: path(id) }));
}

export async function resetMfa(api: ApiClient, id: string): Promise<User> {
  return unwrap(
    await api.POST('/api/v1/platform/users/{accountId}/mfa-reset', { params: path(id) }),
  );
}

export async function inviteOperator(
  api: ApiClient,
  body: S['PlatformOperatorInvite'],
): Promise<S['PlatformOperator']> {
  return unwrap(await api.POST('/api/v1/platform/operators', { params: { header: idem() }, body }));
}

/**
 * Роль или состояние оператора; If-Match — версия строки списка (`"rev-N"`, как ETag сценарного сервера W4.07:
 * отдельного чтения оператора с ETag в контракте нет).
 */
export async function updateOperator(
  api: ApiClient,
  o: S['PlatformOperator'],
  body: S['PlatformOperatorPatch'],
): Promise<S['PlatformOperator']> {
  return unwrap(
    await api.PATCH('/api/v1/platform/operators/{operatorId}', {
      params: {
        path: { operatorId: o.id },
        header: { ...idem(), 'If-Match': `"rev-${o.revision}"` },
      },
      body,
    }),
  );
}
