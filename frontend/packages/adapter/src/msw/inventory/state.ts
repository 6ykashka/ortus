// Склад сценарного сервера (W5.11, контракт 0.12.0-stage5, W5.00; backend — W5.10): склады организации, номенклатура,
// партии с остатками по складам, неизменяемый журнал движений и резервы. Количества — целые микроединицы
// (Quantity контракта — десятичная строка до шести знаков). Хранилище одно на организацию и общее с «Салоном и SPA»
// (W5.21): сид по умолчанию — сид эталона (design/ortus/extra-data.js spa.stock: «Масло массажное» 250 мл,
// «Крем восстанавливающий» 12 г на «Складе салона»; ids и склад `wh-spa` — из модуля SPA), завершение визита списывает
// отсюда по FEFO. Расширенный сид страниц склада (второй склад, просроченная партия, резерв, расходные материалы) —
// пресет `inventory-ready` (`richInventory`). Экрана склада в эталоне нет (B-6).
import type { components } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';

import type { Org } from '../core/state.ts';
import { spaOf, warehouseOf } from '../spa/state.ts';

type S = components['schemas'];

export type Unit = S['InventoryItem']['baseUnit'];

export interface WarehouseRow {
  id: string;
  orgUnitId: string;
  name: string;
  code: string | null;
  archived: boolean;
  revision: number;
}

export interface ItemRow {
  id: string;
  orgUnitId: string;
  name: string;
  sku: string;
  baseUnit: Unit;
  trackLots: boolean;
  /** Минимальный уровень в микроединицах; `null` — не задан. */
  minLevel: number | null;
  archived: boolean;
  revision: number;
}

/** Партия (приход одной строкой): срок годности общий для всех складов, где она лежит. */
export interface LotRow {
  id: string;
  itemId: string;
  expiresOn: string | null;
}

/** Остаток партии на складе; у позиции без партий `lotId` — `null`. */
export interface StockRow {
  warehouseId: string;
  itemId: string;
  lotId: string | null;
  onHand: number;
}

export interface LineRow {
  itemId: string;
  /** Микроединицы. */
  quantity: number;
  lotId: string | null;
  expiresOn: string | null;
}

export interface MovementRow {
  id: string;
  kind: S['InventoryMovement']['kind'];
  warehouseId: string;
  targetWarehouseId: string | null;
  lines: LineRow[];
  source: S['ObjectRef'] | null;
  postedAt: string;
  /** Для сторно — движение, которое оно отменяет. */
  reverses: string | null;
  /** Корректировка и сторно: в контракте ответа направления нет (Q-W5.11-6), сервер хранит его для сторно сторно и отмены. */
  direction?: 'increase' | 'decrease';
}

export interface ReservationRow {
  id: string;
  warehouseId: string;
  source: S['ObjectRef'];
  lines: { itemId: string; quantity: number }[];
  status: S['InventoryReservation']['status'];
  expiresAt: string | null;
  createdAt: string;
  revision: number;
}

export interface InventoryData {
  warehouses: WarehouseRow[];
  items: ItemRow[];
  lots: LotRow[];
  stock: StockRow[];
  movements: MovementRow[];
  reservations: ReservationRow[];
}

type WithInventory = Org & { inventory?: InventoryData };

const SCALE = 1_000_000;

/** `"40.5"` → 40 500 000. Строки контракта проверены схемой (`Quantity`). */
export function toMicro(q: string): number {
  const [int = '0', frac = ''] = q.split('.');
  return Number(int) * SCALE + Number(frac.padEnd(6, '0'));
}

/** 40 500 000 → `"40.5"` (без хвостовых нулей). */
export function fromMicro(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const int = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${sign}${int}${frac ? `.${frac}` : ''}`;
}

/** Расширенный сид страниц склада: два склада, четыре позиции, партии с просрочкой, активный резерв визита. */
function richSeed(org: Org): InventoryData {
  const U = (proto: string): string => seedUuid(org.proto, proto);
  const unit =
    org.units.find((u) => u.proto === 'f-msk-sever') ??
    org.units.find((u) => u.parentId !== null) ??
    org.units[0];
  const unitId = unit?.id ?? U('f-msk-sever');
  const m = (n: number): number => n * SCALE;

  const warehouses: WarehouseRow[] = [
    {
      id: U('wh-spa'),
      orgUnitId: unitId,
      name: 'Склад салона',
      code: 'SPA',
      archived: false,
      revision: 1,
    },
    {
      id: U('wh-main'),
      orgUnitId: unitId,
      name: 'Склад № 1',
      code: 'S1',
      archived: false,
      revision: 1,
    },
  ];
  const item = (
    proto: string,
    name: string,
    sku: string,
    baseUnit: Unit,
    trackLots: boolean,
    minLevel: number | null,
  ): ItemRow => ({
    id: U(proto),
    orgUnitId: unitId,
    name,
    sku,
    baseUnit,
    trackLots,
    minLevel: minLevel === null ? null : m(minLevel),
    archived: false,
    revision: 1,
  });
  const items: ItemRow[] = [
    item('inv-cream', 'Крем восстанавливающий', 'CRM-50', 'g', true, 50),
    item('inv-oil', 'Масло массажное', 'OIL-500', 'ml', true, 100),
    item('it-gloves', 'Перчатки нитриловые', 'GLV-100', 'piece', false, 100),
    item('it-towel', 'Полотенца одноразовые', 'TWL-200', 'piece', false, 100),
  ];
  const lots: LotRow[] = [
    { id: U('lot-oil-a'), itemId: U('inv-oil'), expiresOn: '2026-11-15' },
    { id: U('lot-oil-b'), itemId: U('inv-oil'), expiresOn: '2027-03-01' },
    { id: U('lot-oil-old'), itemId: U('inv-oil'), expiresOn: '2026-09-20' },
    { id: U('lot-oil-d'), itemId: U('inv-oil'), expiresOn: '2027-06-30' },
    { id: U('lot-cream'), itemId: U('inv-cream'), expiresOn: '2026-12-31' },
  ];
  const stock: StockRow[] = [
    { warehouseId: U('wh-spa'), itemId: U('inv-oil'), lotId: U('lot-oil-a'), onHand: m(100) },
    { warehouseId: U('wh-spa'), itemId: U('inv-oil'), lotId: U('lot-oil-b'), onHand: m(150) },
    { warehouseId: U('wh-main'), itemId: U('inv-oil'), lotId: U('lot-oil-old'), onHand: m(40) },
    { warehouseId: U('wh-main'), itemId: U('inv-oil'), lotId: U('lot-oil-d'), onHand: m(500) },
    { warehouseId: U('wh-spa'), itemId: U('inv-cream'), lotId: U('lot-cream'), onHand: m(12) },
    { warehouseId: U('wh-spa'), itemId: U('it-towel'), lotId: null, onHand: m(200) },
  ];
  const line = (
    itemId: string,
    quantity: number,
    lotId: string | null,
    expiresOn: string | null,
  ): LineRow => ({ itemId: U(itemId), quantity: m(quantity), lotId: lotId && U(lotId), expiresOn });
  const apSource = (id: string): S['ObjectRef'] => ({
    moduleKey: 'spa',
    entityType: 'appointment',
    entityId: U(id),
  });
  const movements: MovementRow[] = [
    {
      id: U('mv-1'),
      kind: 'receipt',
      warehouseId: U('wh-spa'),
      targetWarehouseId: null,
      lines: [
        line('inv-oil', 160, 'lot-oil-a', '2026-11-15'),
        line('inv-oil', 150, 'lot-oil-b', '2027-03-01'),
        line('inv-cream', 12, 'lot-cream', '2026-12-31'),
        line('it-towel', 200, null, null),
      ],
      source: null,
      postedAt: '2026-09-10T08:00:00Z',
      reverses: null,
    },
    {
      id: U('mv-2'),
      kind: 'receipt',
      warehouseId: U('wh-main'),
      targetWarehouseId: null,
      lines: [
        line('inv-oil', 40, 'lot-oil-old', '2026-09-20'),
        line('inv-oil', 500, 'lot-oil-d', '2027-06-30'),
      ],
      source: null,
      postedAt: '2026-09-12T09:30:00Z',
      reverses: null,
    },
    {
      id: U('mv-3'),
      kind: 'issue',
      warehouseId: U('wh-spa'),
      targetWarehouseId: null,
      lines: [line('inv-oil', 30, 'lot-oil-a', '2026-11-15')],
      source: apSource('ap-0929'),
      postedAt: '2026-09-29T14:05:00Z',
      reverses: null,
    },
    {
      id: U('mv-4'),
      kind: 'issue',
      warehouseId: U('wh-spa'),
      targetWarehouseId: null,
      lines: [line('inv-oil', 30, 'lot-oil-a', '2026-11-15')],
      source: apSource('ap-1'),
      postedAt: '2026-09-30T16:40:00Z',
      reverses: null,
    },
    {
      id: U('mv-5'),
      kind: 'reversal',
      warehouseId: U('wh-spa'),
      targetWarehouseId: null,
      lines: [line('inv-oil', 30, 'lot-oil-a', '2026-11-15')],
      source: null,
      postedAt: '2026-09-30T17:10:00Z',
      reverses: U('mv-4'),
    },
    {
      id: U('mv-6'),
      kind: 'issue',
      warehouseId: U('wh-spa'),
      targetWarehouseId: null,
      lines: [line('inv-oil', 30, 'lot-oil-a', '2026-11-15')],
      source: apSource('ap-0930'),
      postedAt: '2026-10-01T06:50:00Z',
      reverses: null,
    },
  ];
  // Журнал сходится с остатками: партия A масла — 160 − 30 − 30 + 30 − 30 = 100 (сторно mv-5 отменяет mv-4).
  const reservations: ReservationRow[] = [
    {
      id: U('rs-1'),
      warehouseId: U('wh-spa'),
      source: apSource('ap-1'),
      lines: [{ itemId: U('inv-oil'), quantity: m(30) }],
      status: 'active',
      expiresAt: null,
      createdAt: '2026-09-30T12:00:00Z',
      revision: 1,
    },
    {
      id: U('rs-2'),
      warehouseId: U('wh-spa'),
      source: apSource('ap-0929'),
      lines: [{ itemId: U('inv-oil'), quantity: m(30) }],
      status: 'released',
      expiresAt: null,
      createdAt: '2026-09-28T12:00:00Z',
      revision: 2,
    },
  ];
  return { warehouses, items, lots, stock, movements, reservations };
}

/** Сид по умолчанию: сид эталона салона из модуля SPA (W5.21) — две позиции, один склад, партии масла 100 + 150 мл. */
function baselineSeed(org: Org): InventoryData {
  const spa = spaOf(org);
  const w = warehouseOf(org);
  const U = (proto: string): string => seedUuid(org.proto, proto);
  const m = (n: number): number => n * SCALE;
  const warehouses: WarehouseRow[] = [
    {
      id: w.id,
      orgUnitId: w.orgUnitId,
      name: w.name,
      code: 'SPA',
      archived: false,
      revision: 1,
    },
  ];
  const items: ItemRow[] = spa.items.map((i) => ({
    id: i.id,
    orgUnitId: i.orgUnitId,
    name: i.name,
    sku: i.sku,
    baseUnit: i.baseUnit,
    trackLots: true,
    minLevel: null,
    archived: false,
    revision: 1,
  }));
  const oil = spa.items.find((i) => i.proto === 'oil');
  const cream = spa.items.find((i) => i.proto === 'cream');
  const lots: LotRow[] = [];
  const stock: StockRow[] = [];
  const lines: LineRow[] = [];
  const add = (itemId: string | undefined, lot: string, expiresOn: string, qty: number): void => {
    if (!itemId) return;
    const lotId = U(lot);
    lots.push({ id: lotId, itemId, expiresOn });
    stock.push({ warehouseId: w.id, itemId, lotId, onHand: m(qty) });
    lines.push({ itemId, quantity: m(qty), lotId, expiresOn });
  };
  add(oil?.id, 'lot-oil-a', '2026-11-15', 100);
  add(oil?.id, 'lot-oil-b', '2027-03-01', 150);
  add(cream?.id, 'lot-cream', '2026-12-31', 12);
  const movements: MovementRow[] = lines.length
    ? [
        {
          id: U('mv-1'),
          kind: 'receipt',
          warehouseId: w.id,
          targetWarehouseId: null,
          lines,
          source: null,
          postedAt: '2026-09-10T08:00:00Z',
          reverses: null,
        },
      ]
    : [];
  return { warehouses, items, lots, stock, movements, reservations: [] };
}

/** Расширенный сид страниц склада (пресет `inventory-ready`): заменяет данные склада организации. */
export function richInventory(org: Org): void {
  (org as WithInventory).inventory = richSeed(org);
}
/** Данные склада организации (после первого чтения). */
export function inventoryOf(org: Org): InventoryData {
  const x = org as WithInventory;
  x.inventory ??= baselineSeed(org);
  return x.inventory;
}

// ───────────────────────────── DTO ─────────────────────────────

export const warehouseDto = (w: WarehouseRow): S['Warehouse'] => ({
  id: w.id,
  orgUnitId: w.orgUnitId,
  name: w.name,
  ...(w.code ? { code: w.code } : {}),
  archived: w.archived,
  revision: w.revision,
});

export const itemDto = (i: ItemRow): S['InventoryItem'] => ({
  id: i.id,
  orgUnitId: i.orgUnitId,
  name: i.name,
  sku: i.sku,
  baseUnit: i.baseUnit,
  trackLots: i.trackLots,
  revision: i.revision,
  ...(i.minLevel === null ? {} : { minLevel: fromMicro(i.minLevel) }),
});

export const lineDto = (l: LineRow): S['InventoryMovementLine'] => ({
  itemId: l.itemId,
  quantity: fromMicro(l.quantity),
  ...(l.lotId ? { lotId: l.lotId } : {}),
  ...(l.expiresOn ? { expiresOn: l.expiresOn } : {}),
});

export const movementDto = (m: MovementRow): S['InventoryMovement'] => ({
  id: m.id,
  kind: m.kind,
  warehouseId: m.warehouseId,
  ...(m.targetWarehouseId ? { targetWarehouseId: m.targetWarehouseId } : {}),
  lines: m.lines.map(lineDto),
  ...(m.source ? { source: m.source } : {}),
  postedAt: m.postedAt,
});

export const reservationDto = (r: ReservationRow): S['InventoryReservation'] => ({
  id: r.id,
  warehouseId: r.warehouseId,
  source: r.source,
  lines: r.lines.map((l) => ({ itemId: l.itemId, quantity: fromMicro(l.quantity) })),
  status: r.status,
  expiresAt: r.expiresAt,
  createdAt: r.createdAt,
  revision: r.revision,
});

// ───────────────────────────── остатки ─────────────────────────────

/** Срок партии: ближайший первым, без срока — последними (FEFO, D-20 комплекта). */
export const byExpiry = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

export const expiresOf = (d: InventoryData, lotId: string | null): string | null =>
  (lotId && d.lots.find((l) => l.id === lotId)?.expiresOn) || null;

/** Остатки позиции на складе, партии в порядке FEFO. */
export const stockOf = (d: InventoryData, warehouseId: string, itemId: string): StockRow[] =>
  d.stock
    .filter((s) => s.warehouseId === warehouseId && s.itemId === itemId)
    .sort((a, b) => byExpiry(expiresOf(d, a.lotId), expiresOf(d, b.lotId)));

export const onHandOf = (d: InventoryData, warehouseId: string, itemId: string): number =>
  stockOf(d, warehouseId, itemId).reduce((sum, s) => sum + s.onHand, 0);

export const reservedOf = (d: InventoryData, warehouseId: string, itemId: string): number =>
  d.reservations
    .filter((r) => r.status === 'active' && r.warehouseId === warehouseId)
    .reduce(
      (sum, r) =>
        sum + r.lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.quantity, 0),
      0,
    );

export function balanceDto(d: InventoryData, w: WarehouseRow, i: ItemRow): S['InventoryBalance'] {
  const onHand = onHandOf(d, w.id, i.id);
  const reserved = reservedOf(d, w.id, i.id);
  return {
    warehouseId: w.id,
    itemId: i.id,
    onHand: fromMicro(onHand),
    reserved: fromMicro(reserved),
    available: fromMicro(Math.max(0, onHand - reserved)),
    minLevel: i.minLevel === null ? null : fromMicro(i.minLevel),
    belowMinimum: i.minLevel !== null && onHand < i.minLevel,
    lots: stockOf(d, w.id, i.id)
      .filter((s) => s.onHand > 0)
      .map((s) => ({
        lotId: s.lotId,
        expiresOn: expiresOf(d, s.lotId),
        onHand: fromMicro(s.onHand),
      })),
  };
}
