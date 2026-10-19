// W2.41 · Запросы справочника категорий расходов (тег Fleet, контракт 0.6.1-stage2): listExpenseCategories с
// архивными (один запрос на экран владельца, форму водителя и «Приёмку смен» — архивные нужны для подписей уже
// созданных расходов), createExpenseCategory и archiveExpenseCategory (If-Match `"rev-<revision>"` из строки списка,
// Q-W2.41-1; Idempotency-Key). Ключ — под общим префиксом логистики: `afterChange` «Приёмки» его тоже перечитывает.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { fleetKey } from '../manager/review/api.ts';
import { type Category, categoryETag } from './model.ts';

type S = components['schemas'];

export const categoriesKey = (tenantId: string) =>
  [...fleetKey(tenantId), 'expense-categories'] as const;

/** Справочник тенанта с архивными, в порядке каталога (`fleet.expenses.read` в любой области). */
export function useExpenseCategories(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: categoriesKey(tenantId),
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/expense-categories', {
            params: { path: { tenantId }, query: { includeArchived: true } },
          }),
        )
      ).items,
  });
}

export async function createCategory(
  api: ApiClient,
  tenantId: string,
  body: S['ExpenseCategoryCreate'],
): Promise<Category> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/expense-categories', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
    }),
  );
}

export async function archiveCategory(
  api: ApiClient,
  tenantId: string,
  c: Category,
): Promise<Category> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/expense-categories/{categoryCode}/archive', {
      params: {
        path: { tenantId, categoryCode: c.code },
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': categoryETag(c) },
      },
    }),
  );
}

/** После команды — перечитать справочник (и при ошибке: 412 — строка устарела). */
export const refreshCategories = (qc: QueryClient, tenantId: string): Promise<void> =>
  qc.invalidateQueries({ queryKey: categoriesKey(tenantId) });
