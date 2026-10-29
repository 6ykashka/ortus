// W6.22 · Запросы и команды «Шаблонов и расценок» (тег Repairs контракта 0.12.0-stage6): шаблоны (список, правка строк,
// копия) и справочник расценок (список, новая позиция, цена). Ключи — под префиксом `['tenant', id, 'repairs']`:
// смета объекта и снабжение перечитываются вместе с каталогом. Ревизия для If-Match — из последнего ответа (`"rev-N"`).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { allPages, repairsKey } from '../supply/api.ts';

type S = components['schemas'];

const PAGE = 100;
const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const ifMatch = (revision: number) => ({ 'If-Match': `"rev-${revision}"` });

export function useTemplates(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'catalog', 'templates'],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/templates', {
            params: { path: { tenantId } },
          }),
        )
      ).items,
  });
}

export function usePriceItems(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'catalog', 'price-items'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/price-items', {
            params: {
              path: { tenantId },
              query: { limit: PAGE, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

/** «Сделать копию»: свой шаблон организации с названием эталона «… · копия». */
export async function copyTemplate(
  api: ApiClient,
  tenantId: string,
  t: S['Template'],
): Promise<S['Template']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/templates/{templateId}/copy', {
      params: { path: { tenantId, templateId: t.id }, header: idem() },
      body: { name: `${t.name} · копия` },
    }),
  );
}

/** «Готово» правки: строки шаблона целиком (updateTemplate, If-Match — ревизия шаблона). */
export async function saveTemplateLines(
  api: ApiClient,
  tenantId: string,
  t: S['Template'],
  lines: S['TemplateLine'][],
): Promise<S['Template']> {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/repairs/templates/{templateId}', {
      params: {
        path: { tenantId, templateId: t.id },
        header: { ...idem(), ...ifMatch(t.revision) },
      },
      body: { lines },
    }),
  );
}

/** «Добавить» в справочник (createPriceItem). */
export async function addPriceItem(
  api: ApiClient,
  tenantId: string,
  body: S['PriceItemCreate'],
): Promise<S['PriceItem']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/price-items', {
      params: { path: { tenantId }, header: idem() },
      body,
    }),
  );
}

/** Цена в строке справочника (updatePriceItem, If-Match — ревизия позиции). */
export async function setPrice(
  api: ApiClient,
  tenantId: string,
  p: S['PriceItem'],
  amountMinor: number,
): Promise<S['PriceItem']> {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/repairs/price-items/{priceItemId}', {
      params: {
        path: { tenantId, priceItemId: p.id },
        header: { ...idem(), ...ifMatch(p.revision) },
      },
      body: { price: { amountMinor, currency: 'RUB' } },
    }),
  );
}
