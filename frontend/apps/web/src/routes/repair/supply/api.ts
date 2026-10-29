// W6.22 · Запросы и команды снабжения «Ремонта и стройки» (тег Repairs контракта 0.12.0-stage6): заявки, закупки,
// остатки на объектах, объекты организации (имена и цели перемещения), материалы справочника; склады, остатки и
// движения — модуль «Склад» (Inventory). Ключи — под префиксом `['tenant', id, 'repairs']`: команды перечитывают всё
// снабжение разом. Ревизия для If-Match — из последнего ответа (`"rev-N"`, форма сценарного сервера).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

const PAGE = 100;
const MAX_PAGES = 50;

export async function allPages<T>(
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

const pageQuery = (cursor: string | undefined) => ({
  limit: PAGE,
  ...(cursor ? { cursor } : {}),
});

export const repairsKey = (tenantId: string) => ['tenant', tenantId, 'repairs'] as const;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const ifMatch = (revision: number) => ({ 'If-Match': `"rev-${revision}"` });

/** Заявки видимых объектов (прораб — свои); `projectId` — заявки одного объекта. */
export function useSupplyRequests(tenantId: string, projectId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'supply', 'requests', projectId ?? 'all'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/supply-requests', {
            params: {
              path: { tenantId },
              query: { ...pageQuery(cursor), ...(projectId ? { projectId } : {}) },
            },
          }),
        ),
      ),
  });
}

export function usePurchases(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'supply', 'purchases'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/purchases', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

export function useProjectStock(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'supply', 'project-stock'],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/project-stock', {
            params: { path: { tenantId } },
          }),
        )
      ).items,
  });
}

/** Объекты организации: имена и цели перемещения остатков. */
export function useRepairProjects(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'supply', 'projects'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Материалы справочника расценок (форма заявки прораба). */
export function useMaterials(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairsKey(tenantId), 'supply', 'materials'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/price-items', {
            params: { path: { tenantId }, query: { ...pageQuery(cursor), kind: 'material' } },
          }),
        ),
      ),
  });
}

// ── Склад (модуль «Склад», этап 5): при недоступности блок показывает пояснение, а не ошибку страницы ──

export type Inventory<T> = { status: 'ok'; items: T[] } | { status: 'unavailable' };

/** Недоступно: операция ещё не реализована (501), нет права (403) или модуль не подключён (404). */
const UNAVAILABLE = new Set([403, 404, 501]);

async function inventory<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<Inventory<T>> {
  try {
    return { status: 'ok', items: await allPages(load) };
  } catch (e) {
    if (e instanceof ProblemError && UNAVAILABLE.has(e.status)) return { status: 'unavailable' };
    throw e;
  }
}

export function useWarehouses(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'inventory', 'warehouses'],
    enabled,
    queryFn: () =>
      inventory<S['Warehouse']>(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/warehouses', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

export function useInventoryItems(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'inventory', 'items'],
    enabled,
    queryFn: () =>
      inventory<S['InventoryItem']>(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/items', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

export function useBalances(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'inventory', 'balances'],
    enabled,
    queryFn: () =>
      inventory<S['InventoryBalance']>(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/balances', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

export function useMovements(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'inventory', 'movements'],
    enabled,
    queryFn: () =>
      inventory<S['InventoryMovement']>(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/movements', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

// ── Команды ──

/** Прораб просит материал справочника с датой «Нужно к» (createSupplyRequest). */
export async function createRequest(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  body: S['SupplyRequestCreate'],
): Promise<S['SupplyRequest']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/supply-requests', {
      params: { path: { tenantId, projectId }, header: idem() },
      body,
    }),
  );
}

/** «Выдать со склада»: резерв на складе (reserveSupplyRequest, If-Match — ревизия заявки). */
export async function reserveRequest(
  api: ApiClient,
  tenantId: string,
  r: S['SupplyRequest'],
  warehouseId: string,
): Promise<S['SupplyRequest']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/supply-requests/{supplyRequestId}/reserve', {
      params: {
        path: { tenantId, supplyRequestId: r.id },
        header: { ...idem(), ...ifMatch(r.revision) },
      },
      body: { warehouseId },
    }),
  );
}

/** Кладовщик выдаёт зарезервированное (issueSupplyRequest): стоимость уходит в расходы объекта. */
export async function issueRequest(
  api: ApiClient,
  tenantId: string,
  r: S['SupplyRequest'],
): Promise<S['SupplyRequest']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/supply-requests/{supplyRequestId}/issue', {
      params: {
        path: { tenantId, supplyRequestId: r.id },
        header: { ...idem(), ...ifMatch(r.revision) },
      },
    }),
  );
}

/** «Списать на объект» (consumeSupplyRequest): движение use модуля «Склад». */
export async function consumeRequest(
  api: ApiClient,
  tenantId: string,
  r: S['SupplyRequest'],
): Promise<S['SupplyRequest']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/supply-requests/{supplyRequestId}/consume', {
      params: {
        path: { tenantId, supplyRequestId: r.id },
        header: { ...idem(), ...ifMatch(r.revision) },
      },
    }),
  );
}

/** «Оформить закупку»: одна закупка на несколько заявок и объектов (createPurchase). */
export async function orderPurchase(
  api: ApiClient,
  tenantId: string,
  body: S['PurchaseCreate'],
): Promise<S['Purchase']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/purchases', {
      params: { path: { tenantId }, header: idem() },
      body,
    }),
  );
}

/** Приход по чеку QR (receivePurchase, If-Match — ревизия закупки). */
export async function receivePurchase(
  api: ApiClient,
  tenantId: string,
  p: S['Purchase'],
  receiptQr: string,
): Promise<S['Purchase']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/purchases/{purchaseId}/receive', {
      params: {
        path: { tenantId, purchaseId: p.id },
        header: { ...idem(), ...ifMatch(p.revision) },
      },
      body: { receiptQr },
    }),
  );
}

/** Вернуть остаток объекта на склад (returnProjectStock). */
export async function returnStock(
  api: ApiClient,
  tenantId: string,
  s: S['ProjectStockItem'],
  warehouseId: string,
): Promise<S['StockMoveResult']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/stock/return', {
      params: { path: { tenantId, projectId: s.projectId }, header: idem() },
      body: { warehouseId, items: [{ priceItemId: s.priceItemId, quantity: s.quantity }] },
    }),
  );
}

/** Переместить остаток объекта на другой объект (transferProjectStock). */
export async function transferStock(
  api: ApiClient,
  tenantId: string,
  s: S['ProjectStockItem'],
  toProjectId: string,
): Promise<S['StockMoveResult']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/stock/transfer', {
      params: { path: { tenantId, projectId: s.projectId }, header: idem() },
      body: { toProjectId, items: [{ priceItemId: s.priceItemId, quantity: s.quantity }] },
    }),
  );
}

/** После любой команды снабжения перечитываются заявки, закупки, остатки и объекты (расходы, «Требует решения»). */
export const refreshSupply = (qc: QueryClient, tenantId: string): Promise<void> =>
  qc.invalidateQueries({ queryKey: repairsKey(tenantId) });
