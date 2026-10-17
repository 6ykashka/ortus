// W1.24 · Запросы и команды «Модули и место» и «Хранилища» (контракт 0.4.0-stage1): каталог модулей, место и
// разбивка (ключ места общий с баннером оболочки — Q-W1.20-18), сотрудники с правами модуля, предпросмотр
// отключения; подключение и отключение с If-Match, смена лимита quote → commit (Q-W1.24-3).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { ME_CONTEXT_KEY } from '../../../shell/me.ts';
import { type ApiModuleKey, moduleHolders } from './vm.ts';

type S = components['schemas'];

/** Место организации: тот же ключ и те же данные, что у баннера оболочки (Banners.tsx). */
export const storageKey = (tenantId: string) => ['tenant', tenantId, 'storage'] as const;
const breakdownKey = (tenantId: string) => [...storageKey(tenantId), 'breakdown'] as const;
export const catalogKey = (tenantId: string) => ['tenant', tenantId, 'modules'] as const;
const holdersKey = (tenantId: string) => [...catalogKey(tenantId), 'holders'] as const;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const PAGE = 200;
const MAX_PAGES = 20;

/** Все страницы списка (курсор контракта), не больше MAX_PAGES запросов. */
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

export function useStorageUsage(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: storageKey(tenantId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/storage', { params: { path: { tenantId } } }),
      ),
  });
}

export function useBreakdown(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: breakdownKey(tenantId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/storage/breakdown', {
          params: { path: { tenantId } },
        }),
      ),
  });
}

export function useCatalog(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: catalogKey(tenantId),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/modules', { params: { path: { tenantId } } }),
      ),
  });
}

/** Сотрудники с правами каждого модуля: роли, назначения и группы организации (Q-W1.24-7). */
export function useHolders(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: holdersKey(tenantId),
    queryFn: async () => {
      const path = { tenantId };
      const page = (cursor: string | undefined) => ({
        params: { path, query: { limit: PAGE, ...(cursor ? { cursor } : {}) } },
      });
      const [roles, assignments, groups, members] = await Promise.all([
        allPages(async (c) => unwrap(await api.GET('/api/v1/tenants/{tenantId}/roles', page(c)))),
        allPages(async (c) =>
          unwrap(await api.GET('/api/v1/tenants/{tenantId}/assignments', page(c))),
        ),
        allPages(async (c) => unwrap(await api.GET('/api/v1/tenants/{tenantId}/groups', page(c)))),
        allPages(async (c) => unwrap(await api.GET('/api/v1/tenants/{tenantId}/members', page(c)))),
      ]);
      return moduleHolders(roles, assignments, groups, members);
    },
  });
}

/** «Затронет сейчас» диалога отключения (S1-18): свежий предпросмотр при каждом открытии диалога. */
export async function fetchPreview(
  api: ApiClient,
  tenantId: string,
  moduleKey: ApiModuleKey,
): Promise<S['ModuleDeactivationPreview']> {
  return unwrap(
    await api.GET('/api/v1/tenants/{tenantId}/modules/{moduleKey}/deactivation-preview', {
      params: { path: { tenantId, moduleKey } },
    }),
  );
}

/** Подключение и отключение: ETag свежего GET → PUT с If-Match; отключение сохраняет историю. */
export async function setModule(
  api: ApiClient,
  tenantId: string,
  moduleKey: ApiModuleKey,
  enabled: boolean,
): Promise<S['ModuleManifest']> {
  const path = { tenantId, moduleKey };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/modules/{moduleKey}', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  // Без версии команду не отправляем: пустой If-Match сервер отклонил бы так же (428), но уже после PUT.
  if (!etag) throw new ProblemError(428);
  const body: S['ModuleInstallationUpdate'] = enabled
    ? { enabled }
    : { enabled, retainedAccess: 'history_read' };
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/modules/{moduleKey}', {
      params: { path, header: { ...idem(), 'If-Match': etag } },
      body,
    }),
  );
}

/** Расчёт смены квоты (без записи). */
export async function quoteStorage(
  api: ApiClient,
  tenantId: string,
  requestedQuotaBytes: number,
): Promise<S['StorageChange']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/storage/changes', {
      params: { path: { tenantId }, header: idem() },
      body: { requestedQuotaBytes, mode: 'quote' },
    }),
  );
}

/** Подтверждение расчёта (`acceptedQuoteId`). */
export async function commitStorage(
  api: ApiClient,
  tenantId: string,
  quote: S['StorageChange'],
): Promise<S['StorageChange']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/storage/changes', {
      params: { path: { tenantId }, header: idem() },
      body: {
        requestedQuotaBytes: quote.requestedQuotaBytes,
        mode: 'commit',
        ...(quote.quoteId ? { acceptedQuoteId: quote.quoteId } : {}),
      },
    }),
  );
}

/** После смены лимита: место и разбивка (баннер владельца) и /me/context (баннер сотрудников, Q-W1.20-18). */
export async function afterQuota(qc: QueryClient, tenantId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: storageKey(tenantId) }),
    qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY }),
  ]);
}

/** После подключения или отключения: каталог и /me/context (меню D-23, гейты, баннеры). */
export async function afterModule(qc: QueryClient, tenantId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: catalogKey(tenantId) }),
    qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY }),
  ]);
}
