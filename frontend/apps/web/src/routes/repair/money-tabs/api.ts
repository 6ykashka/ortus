// W6.24 · Запросы и команды вкладок объекта (тег Repairs, контракт 0.12.0-stage6): документы и подпись по SMS, сдача
// объекта, финансы, начисления бригаде и выплата предложением в кассу, подрядчики, ссылка кабинета заказчика.
// Изменяющие операции — с Idempotency-Key; сдача объекта — с If-Match по ETag свежего getRepairProject.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

const PAGE = 100;
const MAX_PAGES = 20;

/** Ключ всех данных объекта: после команды сбрасывается целиком (вкладки показывают одни и те же сущности). */
export const projectKey = (tenantId: string, projectId: string) =>
  ['tenant', tenantId, 'repair', projectId] as const;
const listKey = (tenantId: string) => ['tenant', tenantId, 'repair', 'projects'] as const;

export async function afterChange(
  qc: QueryClient,
  tenantId: string,
  projectId: string,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: projectKey(tenantId, projectId) }),
    qc.invalidateQueries({ queryKey: listKey(tenantId) }),
  ]);
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

// ── чтение ──

export function useProjects(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: listKey(tenantId),
    queryFn: async () => {
      const out: S['RepairProject'][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects', {
            params: { path: { tenantId }, query: { limit: PAGE, ...(cursor ? { cursor } : {}) } },
          }),
        );
        out.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return out;
    },
  });
}

export function useProject(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'card'],
    retry: (n, e) => !(e instanceof ProblemError && e.status === 404) && n < 2,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

export function useDocuments(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'documents'],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/documents', {
            params: { path: { tenantId, projectId } },
          }),
        )
      ).items,
  });
}

export function useFinance(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'finance'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/finance', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

export function useAccruals(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'accruals'],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/accruals', {
            params: { path: { tenantId, projectId } },
          }),
        )
      ).items,
  });
}

export function useSubcontractors(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'subcontractors'],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/subcontractors', {
            params: { path: { tenantId, projectId } },
          }),
        )
      ).items,
  });
}

export function useClientLink(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'client-link'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/client-link', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

/** Этапы графика для превью кабинета (без сумм: операция доступна всем, кто видит объект). */
export function useScheduleStages(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'schedule'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

/** Дата последней принятой отметки — подпись «Фотоотчёт прораба · …» в превью кабинета. */
export function useLastAcceptedLog(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'accepted-log'],
    enabled,
    queryFn: async () => {
      const page = await unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/work-logs', {
          params: { path: { tenantId }, query: { projectId, status: 'accepted', limit: PAGE } },
        }),
      );
      return (
        [...page.items].sort((a, b) => b.workDate.localeCompare(a.workDate))[0]?.workDate ?? null
      );
    },
  });
}

// ── команды ──

export async function requestSignature(
  api: ApiClient,
  tenantId: string,
  documentId: string,
): Promise<S['RepairSignRequestResult']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/documents/{documentId}/sign-requests', {
      params: { path: { tenantId, documentId }, header: idem() },
    }),
  );
}

export async function handOver(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  actDocumentId: string,
): Promise<S['RepairProject']> {
  const path = { tenantId, projectId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/hand-over', {
      params: { path, header: { ...idem(), 'If-Match': etag } },
      body: { actDocumentId },
    }),
  );
}

export async function accrueByAct(
  api: ApiClient,
  tenantId: string,
  documentId: string,
): Promise<S['CrewAccrualList']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/acts/{documentId}/accruals', {
      params: { path: { tenantId, documentId }, header: idem() },
    }),
  );
}

export async function payout(
  api: ApiClient,
  tenantId: string,
  accrualIds: string[],
): Promise<S['PayoutResult']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/accruals/payout', {
      params: { path: { tenantId }, header: idem() },
      body: { accrualIds },
    }),
  );
}

export async function setAccess(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  subcontractorId: string,
  body: S['SubcontractorAccessSet'],
): Promise<S['Subcontractor']> {
  return unwrap(
    await api.PUT(
      '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/subcontractors/{subcontractorId}',
      { params: { path: { tenantId, projectId, subcontractorId }, header: idem() }, body },
    ),
  );
}

export async function issueLink(
  api: ApiClient,
  tenantId: string,
  projectId: string,
): Promise<S['ClientLinkIssued']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/client-link', {
      params: { path: { tenantId, projectId }, header: idem() },
    }),
  );
}

export async function revokeLink(
  api: ApiClient,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const r = await api.DELETE(
    '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/client-link',
    {
      params: { path: { tenantId, projectId }, header: idem() },
    },
  );
  // 204 без тела: unwrap требует данные, поэтому успех проверяем по статусу.
  if (!r.response.ok) await unwrap({ ...r, data: undefined });
}
