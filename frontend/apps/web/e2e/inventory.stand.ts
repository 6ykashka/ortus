// W2.103 · Данные склада для строк @stand: склад, позиция и партии создаются командами API (Inventory, W5.10) из
// сессии владельца; название и артикул несут метку прогона, поэтому три проекта и повторы не пересекаются.
import type { Page } from '@playwright/test';

import { expectStatus, listUnits, runLabel } from './_stand/stand.ts';
import { call } from './shell.helpers.ts';

export interface StockFixture {
  tenant: string;
  label: string;
  warehouse: { id: string; name: string; orgUnitId: string; unitName: string };
  item: { id: string; name: string; sku: string; revision: number };
}

/** Склад и позиция с партиями: количества — десятичные строки, срок годности — дата `YYYY-MM-DD`. */
export async function stockFixture(
  page: Page,
  tenant: string,
  project: string,
  opts: { lots?: { qty: string; expiresOn: string }[]; trackLots?: boolean } = {},
): Promise<StockFixture> {
  const label = runLabel(project);
  const units = await listUnits(page, tenant);
  const unit = units.find((u) => u.kind === 'company') ?? units[0];
  if (!unit) throw new Error('в организации нет подразделений');
  const wName = `Склад ${label}`;
  const w = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/inventory/warehouses`, {
      body: { orgUnitId: unit.id, name: wName, code: label.toUpperCase() },
    }),
    201,
    'createWarehouse',
  ).body as { id: string; orgUnitId: string };
  const iName = `Масло ${label}`;
  const sku = `OIL-${label.toUpperCase()}`;
  const it = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/inventory/items`, {
      body: {
        orgUnitId: unit.id,
        name: iName,
        sku,
        baseUnit: 'ml',
        trackLots: opts.trackLots ?? true,
      },
    }),
    201,
    'createInventoryItem',
  ).body as { id: string; revision: number };
  for (const lot of opts.lots ?? []) {
    expectStatus(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/inventory/movements`, {
        body: {
          kind: 'receipt',
          warehouseId: w.id,
          lines: [{ itemId: it.id, quantity: lot.qty, expiresOn: lot.expiresOn }],
        },
      }),
      201,
      'postMovement receipt',
    );
  }
  return {
    tenant,
    label,
    warehouse: { id: w.id, name: wName, orgUnitId: w.orgUnitId, unitName: unit.name },
    item: { id: it.id, name: iName, sku, revision: it.revision },
  };
}

/** Остатки позиции на складе (listInventoryBalances) глазами владельца. */
export async function balanceOf(
  page: Page,
  f: StockFixture,
): Promise<{ onHand: string; lots: { expiresOn: string | null; onHand: string }[] }> {
  const r = expectStatus(
    await call(
      page,
      'GET',
      `/api/v1/tenants/${f.tenant}/inventory/balances?warehouseId=${f.warehouse.id}&itemId=${f.item.id}&limit=50`,
    ),
    200,
    'listInventoryBalances',
  );
  const items = (
    r.body as { items: { onHand: string; lots: { expiresOn: string | null; onHand: string }[] }[] }
  ).items;
  return items[0] ?? { onHand: '0', lots: [] };
}

/**
 * Дата через `days` суток по часам сервера: часы страницы в харнессе заморожены на «сейчас» эталона (1.10.2026), а
 * срок годности сервер сверяет со своими — поэтому дата считается в процессе теста, не в странице.
 */
export function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
