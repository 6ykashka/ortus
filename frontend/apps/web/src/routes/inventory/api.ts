// W5.11 · Запросы склада (тег Inventory, контракт 0.12.0-stage5): склады, номенклатура, остатки по партиям (FEFO),
// резервы и журнал движений; команды — создание склада и позиции, правка позиции (If-Match `"rev-<revision>"`),
// проведение движения, снятие резерва (Idempotency-Key у каждой). Ключи — под общим префиксом склада организации:
// после любой команды перечитывается всё, что склад показывает (остатки зависят от движений и резервов).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';
import { type Item, itemETag } from './model.ts';

type S = components['schemas'];

const LIMIT = 200;

export const inventoryKey = (tenantId: string) => ['tenant', tenantId, 'inventory'] as const;

const base = (tenantId: string) => ({ tenantId });

export function useWarehouses(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'warehouses'],
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/warehouses', {
            params: { path: base(tenantId), query: { limit: LIMIT } },
          }),
        )
      ).items,
  });
}

export function useItems(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'items'],
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/items', {
            params: { path: base(tenantId), query: { limit: LIMIT } },
          }),
        )
      ).items,
  });
}

export interface BalanceFilter {
  warehouseId?: string;
  itemId?: string;
  belowMinimum?: boolean;
}

export function useBalances(tenantId: string, filter: BalanceFilter = {}, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'balances', filter],
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/balances', {
            params: {
              path: base(tenantId),
              query: {
                limit: LIMIT,
                ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
                ...(filter.itemId ? { itemId: filter.itemId } : {}),
                ...(filter.belowMinimum ? { belowMinimum: true } : {}),
              },
            },
          }),
        )
      ).items,
  });
}

export function useReservations(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'reservations'],
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/reservations', {
            params: { path: base(tenantId), query: { limit: LIMIT } },
          }),
        )
      ).items,
  });
}

export function useMovements(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...inventoryKey(tenantId), 'movements'],
    enabled: enabled && !!tenantId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/inventory/movements', {
            params: { path: base(tenantId), query: { limit: LIMIT } },
          }),
        )
      ).items,
  });
}

const key = (): { 'Idempotency-Key': string } => ({ 'Idempotency-Key': crypto.randomUUID() });

export async function createWarehouse(
  api: ApiClient,
  tenantId: string,
  body: S['WarehouseCreate'],
): Promise<S['Warehouse']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/inventory/warehouses', {
      params: { path: base(tenantId), header: key() },
      body,
    }),
  );
}

export async function createItem(
  api: ApiClient,
  tenantId: string,
  body: S['InventoryItemCreate'],
): Promise<Item> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/inventory/items', {
      params: { path: base(tenantId), header: key() },
      body,
    }),
  );
}

export async function updateItem(
  api: ApiClient,
  tenantId: string,
  item: Item,
  body: S['InventoryItemPatch'],
): Promise<Item> {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/inventory/items/{itemId}', {
      params: {
        path: { ...base(tenantId), itemId: item.id },
        header: { ...key(), 'If-Match': itemETag(item) },
      },
      body,
    }),
  );
}

export async function postMovement(
  api: ApiClient,
  tenantId: string,
  body: S['InventoryMovementCreate'],
): Promise<S['InventoryMovement']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/inventory/movements', {
      params: { path: base(tenantId), header: key() },
      body,
    }),
  );
}

export async function releaseReservation(
  api: ApiClient,
  tenantId: string,
  reservationId: string,
): Promise<S['InventoryReservation']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/inventory/reservations/{reservationId}/release', {
      params: { path: { ...base(tenantId), reservationId }, header: key() },
    }),
  );
}

/** После команды (и при ошибке: 409 и 412 — данные устарели) перечитать всё, что показывает склад. */
export const refreshInventory = (qc: QueryClient, tenantId: string): Promise<void> =>
  qc.invalidateQueries({ queryKey: inventoryKey(tenantId) });
