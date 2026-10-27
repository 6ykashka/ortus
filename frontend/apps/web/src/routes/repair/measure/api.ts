// W6.21 · Запросы вкладок «Замер» и «Смета» к тегу Repairs (контракт 0.12.0-stage6): объект getRepairProject,
// замер getMeasurement и команда putMeasurement (If-Match = Measurement.revision, «"rev-N"»). Ключи — префикс
// объекта `['tenant', id, 'repairs', projectId]`: после любой команды сметы или замера перечитывается всё под ним
// (черновик сметы пересчитывается по замеру на сервере).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const repairKey = (tenantId: string, projectId: string) =>
  ['tenant', tenantId, 'repairs', projectId] as const;

/** If-Match по ревизии ресурса (сильный ETag сценарного сервера и backend). */
export const ifMatch = (revision: number): string => `"rev-${revision}"`;

export function useProject(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'project'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

export function useMeasurement(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'measurement'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/measurement', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

/** Новая версия замера; черновик сметы сервер пересчитывает сам. */
export async function saveMeasurement(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  body: S['MeasurementPut'],
  revision: number,
): Promise<S['Measurement']> {
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/measurement', {
      params: {
        path: { tenantId, projectId },
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': ifMatch(revision) },
      },
      body,
    }),
  );
}
