// W6.21 · Запросы и команды вкладки «Смета» (тег Repairs, контракт 0.12.0-stage6): версии listEstimates, допработы
// listChangeOrders, шаблоны listTemplates, справочник listPriceItems, сравнение diffEstimates; команды —
// createEstimateFromTemplate, createEstimateRevision, updateEstimateDraft, sendEstimate, recallEstimate,
// deleteEstimateDraft, rejectChangeOrder, saveProjectAsTemplate. If-Match — ревизия ресурса из последнего ответа
// («"rev-N"»): устаревшая правка получает 412 и страница перечитывается. Ключи — под префиксом объекта (measure/api.ts).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { ifMatch, repairKey } from '../measure/api.ts';

type S = components['schemas'];

const PAGE = 200;
const MAX_PAGES = 50;

export function useEstimates(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'estimates'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

export function useChangeOrders(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'change-orders'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/change-orders', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

export function useTemplates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'repairs', 'templates'],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/templates', {
          params: { path: { tenantId } },
        }),
      ),
  });
}

/** Весь справочник расценок (все страницы курсора). */
export function usePriceItems(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'repairs', 'price-items'],
    enabled,
    queryFn: async (): Promise<S['PriceItem'][]> => {
      const out: S['PriceItem'][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/price-items', {
            params: {
              path: { tenantId },
              query: { limit: PAGE, ...(cursor ? { cursor } : {}) },
            },
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

/** Сравнение версии `from` с `to` (по идентификатору строки). */
export function useDiff(
  tenantId: string,
  projectId: string,
  from: number,
  to: number,
  enabled: boolean,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'diff', from, to],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET(
          '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates/{version}/diff',
          {
            params: {
              path: { tenantId, projectId, version: from },
              query: { to },
            },
          },
        ),
      ),
  });
}

const key = (): { 'Idempotency-Key': string } => ({ 'Idempotency-Key': crypto.randomUUID() });
const keyed = (revision: number): { 'Idempotency-Key': string; 'If-Match': string } => ({
  ...key(),
  'If-Match': ifMatch(revision),
});

export async function createFromTemplate(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  templateId: string,
): Promise<S['Estimate']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimate-drafts', {
      params: { path: { tenantId, projectId }, header: key() },
      body: { templateId },
    }),
  );
}

/** Черновик новой версии (до договора) или допсоглашения; допработы уходят в раздел «Допработы · ДР-N». */
export async function createRevision(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  body: S['EstimateRevisionCreate'],
): Promise<S['Estimate']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates', {
      params: { path: { tenantId, projectId }, header: key() },
      body,
    }),
  );
}

export async function patchDraft(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  version: number,
  revision: number,
  body: S['EstimateDraftPatch'],
): Promise<S['Estimate']> {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates/{version}', {
      params: { path: { tenantId, projectId, version }, header: keyed(revision) },
      body,
    }),
  );
}

export async function sendEstimate(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  version: number,
  revision: number,
): Promise<S['Estimate']> {
  return unwrap(
    await api.POST(
      '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates/{version}/send',
      { params: { path: { tenantId, projectId, version }, header: keyed(revision) } },
    ),
  );
}

export async function recallEstimate(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  version: number,
  revision: number,
): Promise<S['Estimate']> {
  return unwrap(
    await api.POST(
      '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates/{version}/recall',
      { params: { path: { tenantId, projectId, version }, header: keyed(revision) } },
    ),
  );
}

export async function deleteDraft(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  version: number,
  revision: number,
): Promise<void> {
  const r = await api.DELETE(
    '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates/{version}',
    { params: { path: { tenantId, projectId, version }, header: keyed(revision) } },
  );
  // 204 без тела: unwrap требует данных, поэтому успех подтверждается заглушкой.
  await unwrap({ data: true, error: r.error, response: r.response });
}

export async function rejectOrder(
  api: ApiClient,
  tenantId: string,
  order: S['ChangeOrder'],
  reason: S['RepairRejectReason'],
): Promise<S['ChangeOrder']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/change-orders/{changeOrderId}/reject', {
      params: {
        path: { tenantId, changeOrderId: order.id },
        header: keyed(order.revision),
      },
      body: { reason },
    }),
  );
}

export async function saveAsTemplate(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  name: string,
): Promise<S['Template']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/save-as-template', {
      params: { path: { tenantId, projectId }, header: key() },
      body: { name },
    }),
  );
}
