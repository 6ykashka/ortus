// W6.22 · Строки «Остатков» и «Движений» складов по контракту «Склада» (InventoryBalance, InventoryMovement; этап 5):
// колонки эталона :797–825. Средней цены и суммы в контракте «Склада» нет (Q-W6.22-1): колонки цены не выводятся.
import type { components } from '@ortus/api-client';

import type { Inventory } from './api.ts';
import { dmText, numText } from './model.ts';
import { SUPPLY_TEXT } from './texts.ts';
import type { ChipData } from './ui.tsx';

type S = components['schemas'];

/** Базовые единицы «Склада» → подпись. */
const BASE_UNIT: Readonly<Record<S['InventoryItem']['baseUnit'], string>> = {
  ml: 'мл',
  g: 'г',
  piece: 'шт',
  litre: 'л',
  kg: 'кг',
};

const qty = (q: string, item: S['InventoryItem'] | undefined): string =>
  `${numText(Number(q))}${item ? ` ${BASE_UNIT[item.baseUnit]}` : ''}`;

export interface StockRowView {
  key: string;
  item: string;
  warehouse: string;
  onHand: string;
  reserved: string;
  free: string;
}

/** Остатки по складам; `warehouse` — `all` или id склада (кнопки «Все склады · …»). */
export function stockRows(
  balances: readonly S['InventoryBalance'][],
  items: readonly S['InventoryItem'][],
  warehouses: readonly S['Warehouse'][],
  warehouse: string,
): StockRowView[] {
  return balances
    .filter((b) => warehouse === 'all' || b.warehouseId === warehouse)
    .map((b) => {
      const item = items.find((x) => x.id === b.itemId);
      return {
        key: `${b.warehouseId}:${b.itemId}`,
        item: item?.name ?? '—',
        warehouse: warehouses.find((w) => w.id === b.warehouseId)?.name ?? '—',
        onHand: qty(b.onHand, item),
        reserved: Number(b.reserved) > 0 ? qty(b.reserved, item) : '—',
        free: qty(b.available, item),
      };
    });
}

export interface MovementRowView {
  key: string;
  id: string;
  at: string;
  kind: ChipData;
  item: string;
  route: string;
}

const KIND_CHIP: Readonly<Record<S['InventoryMovement']['kind'], ChipData>> = {
  receipt: { label: SUPPLY_TEXT.movements.kinds.receipt, tone: 'info', icon: 'input' },
  issue: { label: SUPPLY_TEXT.movements.kinds.issue, tone: 'neutral', icon: 'output' },
  transfer: { label: SUPPLY_TEXT.movements.kinds.transfer, tone: 'neutral', icon: 'swap_horiz' },
  adjustment: { label: SUPPLY_TEXT.movements.kinds.adjustment, tone: 'neutral', icon: 'tune' },
  reversal: { label: SUPPLY_TEXT.movements.kinds.reversal, tone: 'ok', icon: 'undo' },
};

/** Журнал движений: строка на материал движения; «откуда → куда» по виду движения. */
export function movementRows(
  movements: readonly S['InventoryMovement'][],
  items: readonly S['InventoryItem'][],
  warehouses: readonly S['Warehouse'][],
): MovementRowView[] {
  const wh = (id: string | undefined): string => {
    const name = warehouses.find((w) => w.id === id)?.name;
    return name ? `Склад «${name}»` : '—';
  };
  return movements.flatMap((m) => {
    const route =
      m.kind === 'transfer'
        ? `${wh(m.warehouseId)} → ${wh(m.targetWarehouseId)}`
        : m.kind === 'receipt'
          ? `→ ${wh(m.warehouseId)}`
          : `${wh(m.warehouseId)} →`;
    return m.lines.map((ln, i) => {
      const item = items.find((x) => x.id === ln.itemId);
      return {
        key: `${m.id}:${i}`,
        id: m.id,
        at: dmText(m.postedAt),
        kind: KIND_CHIP[m.kind],
        item: `${item?.name ?? '—'} · ${qty(ln.quantity, item)}`,
        route,
      };
    });
  });
}

export interface WarehouseChoice {
  id: string;
  name: string;
}

/** Склады для «Вернуть на склад»: из «Склада», без него — замеченные в заявках (`available`). */
export function warehouseChoices(
  inv: Inventory<S['Warehouse']> | undefined,
  seen: ReadonlyMap<string, string>,
): WarehouseChoice[] {
  // Склады из заявок (`available`) дополняют список «Склада»: сценарный сервер ремонта и «Склад» могут знать разные
  // склады, а склад из заявки — настоящий. Архивные склады «Склада» не возвращаются.
  const byId = new Map<string, string>();
  const archived = new Set<string>();
  if (inv?.status === 'ok')
    for (const w of inv.items) {
      if (w.archived) archived.add(w.id);
      else byId.set(w.id, w.name);
    }
  for (const [id, name] of seen) if (!archived.has(id) && !byId.has(id)) byId.set(id, name);
  const list = [...byId].map(([id, name]) => ({ id, name }));
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
