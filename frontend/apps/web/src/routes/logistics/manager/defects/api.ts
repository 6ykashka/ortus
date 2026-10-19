// W2.21 · Запрос очереди блокирующих дефектов (listInspectionDefects, контракт 0.5.0-stage2): на проверке и решённые,
// все страницы курсора; ключ — под префиксом логистики организации (команды «Приёмки смен» его перечитывают).
// W2.46 (D-29 комплекта, контракт 0.6.1-stage2): участники для выбора исполнителя (listMembers) и назначение
// исполнителя и срока (assignInspectionDefect, If-Match свежего getInspectionDefect, Idempotency-Key).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import { allPages, fleetKey, pageQuery } from '../review/api.ts';

type S = components['schemas'];

const STATES = ['in_review', 'resolved', 'confirmed_out_of_service'] as const;

export function useDefects(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...fleetKey(tenantId), 'defects', 'queue'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/defects', {
            params: { path: { tenantId }, query: { ...pageQuery(cursor), state: [...STATES] } },
          }),
        ),
      ),
  });
}

/** Участники для выбора исполнителя; без `members.read` или при сбое — пусто (форма назначения не показывается). */
export function useAssignees(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'members', 'defect-assignees'],
    enabled,
    queryFn: async (): Promise<S['Member'][]> => {
      try {
        return await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: pageQuery(cursor) },
            }),
          ),
        );
      } catch {
        return [];
      }
    },
  });
}

/** Исполнитель и срок решения (W2.46): ETag свежего getInspectionDefect → POST …/assignment. */
export async function assignDefect(
  api: ApiClient,
  tenantId: string,
  defectId: string,
  body: S['DefectAssignment'],
): Promise<S['InspectionDefect']> {
  const path = { tenantId, defectId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/defects/{defectId}/assignment', {
      params: { path, header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': etag } },
      body,
    }),
  );
}
