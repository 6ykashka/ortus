// Временные хендлеры склада для страниц «Салона и SPA» (W5.21): номенклатура, склады и остатки салона из сида модуля
// до W5.10 (настоящие `listInventoryItems`, `listWarehouses`, `listInventoryBalances` — W5.10, W5.11). Реестр W5.10
// подключается после этого и заменяет ключи целиком.
import type { components } from '@ortus/api-client';

import { page, uuidParam } from '../core/page.ts';
import type { Registry } from '../core/registry.ts';
import { fail } from '../core/problem.ts';
import { itemDto, spaOf, toQty, viewOf, warehouseOf } from './state.ts';

type S = components['schemas'];

const inScope = (units: Set<string> | 'all', unitId: string): boolean =>
  units === 'all' || units.has(unitId);

export const spaInventoryHandlers: Registry = {
  listInventoryItems: (ctx) => {
    const v = viewOf(ctx);
    const units = v.units('inventory.items.read');
    const items = v.data.items.filter((i) => inScope(units, i.orgUnitId)).map(itemDto);
    return { body: page(items, ctx.query) };
  },

  listWarehouses: (ctx) => {
    const t = ctx.org();
    const v = viewOf(ctx);
    const w = warehouseOf(t.org);
    const units = v.units('inventory.items.read');
    const items = inScope(units, w.orgUnitId) ? [w] : [];
    return { body: page(items, ctx.query) };
  },

  listInventoryBalances: (ctx) => {
    const v = viewOf(ctx);
    const w = warehouseOf(v.t.org);
    const warehouseId = uuidParam(ctx.query, 'warehouseId', false);
    const itemId = uuidParam(ctx.query, 'itemId', false);
    const below = ctx.query.get('belowMinimum');
    if (below !== null && below !== 'true' && below !== 'false') fail('malformed_request');
    const units = v.units('inventory.items.read');
    const items: S['InventoryBalance'][] =
      !inScope(units, w.orgUnitId) || (warehouseId && warehouseId !== w.id)
        ? []
        : spaOf(v.t.org)
            .items.filter((i) => !itemId || i.id === itemId)
            .map((i) => ({
              warehouseId: w.id,
              itemId: i.id,
              onHand: toQty(i.onHand),
              reserved: '0',
              available: toQty(i.onHand),
              minLevel: null,
              belowMinimum: false,
              lots: [],
            }))
            .filter((b) => below === null || b.belowMinimum === (below === 'true'));
    return { body: page(items, ctx.query) };
  },
};
