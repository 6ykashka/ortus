// W2.21 · Запрос очереди блокирующих дефектов (listInspectionDefects, контракт 0.5.0-stage2): на проверке и решённые,
// все страницы курсора; ключ — под префиксом логистики организации (команды «Приёмки смен» его перечитывают).
import { unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import { allPages, fleetKey, pageQuery } from '../review/api.ts';

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
