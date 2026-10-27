// Тег Inventory сценарного сервера (W5.11, контракт 0.12.0-stage5, W5.00; backend — W5.10; страницы — W5.11): склады,
// номенклатура, остатки по партиям в порядке FEFO (D-20 комплекта), неизменяемый журнал движений с компенсирующим
// сторно, резервы. Отрицательных остатков нет (409 invalid_transition, причина insufficient_stock); просроченная
// партия обычным проведением не используется (причина lot_expired); расход без партии идёт по FEFO.
import type { components } from '@ortus/api-client';

import { page, uuidParam } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import {
  balanceDto,
  byExpiry,
  expiresOf,
  fromMicro,
  type InventoryData,
  inventoryOf,
  type ItemRow,
  itemDto,
  type LineRow,
  type MovementRow,
  movementDto,
  onHandOf,
  reservedOf,
  reservationDto,
  type StockRow,
  toMicro,
  warehouseDto,
  type WarehouseRow,
} from './state.ts';

type S = components['schemas'];

const lower = (id: string | undefined | null): string => (id ?? '').toLowerCase();
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'ru');
const sameText = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru');

function invalid(violations: Violation | Violation[]): never {
  const list = Array.isArray(violations) ? violations : [violations];
  return fail('validation_failed', list[0]?.message ?? 'Проверьте поля.', { violations: list });
}
const bad = (field: string, code: string, message: string): Violation => ({ field, code, message });

const dataOf = (ctx: HandlerContext): InventoryData => inventoryOf(ctx.org().org);
const today = (ctx: HandlerContext): string => ctx.now().slice(0, 10);

function warehouseOr404(d: InventoryData, id: string | undefined): WarehouseRow {
  const w = d.warehouses.find((x) => x.id === lower(id));
  return w ?? fail('not_found', 'Склад не найден.');
}

function itemOr404(d: InventoryData, id: string | undefined): ItemRow {
  const i = d.items.find((x) => x.id === lower(id));
  return i ?? fail('not_found', 'Позиция не найдена.');
}

function unitOr404(ctx: HandlerContext, id: string | undefined): string {
  const u = ctx.org().org.units.find((x) => x.id === lower(id));
  return u?.id ?? fail('not_found', 'Подразделение не найдено.');
}

// ───────────────────────────── ядро движений ─────────────────────────────

const stockFail = (
  reason: 'insufficient_stock' | 'lot_expired' | 'reservation_not_active',
  text: string,
): never => fail('invalid_transition', text, { reason });

/**
 * Снять `qty` позиции со склада в рабочей копии остатков: с названной партии или по FEFO (ближайший срок первым,
 * без срока — последними, просроченные пропускаются). Возвращает строки по партиям.
 */
function take(
  d: InventoryData,
  work: StockRow[],
  now: string,
  warehouseId: string,
  item: ItemRow,
  qty: number,
  lotId: string | null,
): LineRow[] {
  const rows = work
    .filter((s) => s.warehouseId === warehouseId && s.itemId === item.id)
    .sort((a, b) => byExpiry(expiresOf(d, a.lotId), expiresOf(d, b.lotId)));
  const expired = (s: StockRow): boolean => {
    const at = expiresOf(d, s.lotId);
    return at !== null && at < now;
  };
  const line = (s: StockRow, q: number): LineRow => ({
    itemId: item.id,
    quantity: q,
    lotId: s.lotId,
    expiresOn: expiresOf(d, s.lotId),
  });
  if (lotId) {
    const s = rows.find((x) => x.lotId === lotId);
    if (!s || s.onHand <= 0) return stockFail('insufficient_stock', 'На складе нет этой партии.');
    if (expired(s)) return stockFail('lot_expired', 'Срок годности партии истёк.');
    if (s.onHand < qty) return stockFail('insufficient_stock', 'В партии не хватает.');
    s.onHand -= qty;
    return [line(s, qty)];
  }
  const usable = rows.filter((s) => s.onHand > 0 && !expired(s));
  const usableTotal = usable.reduce((sum, s) => sum + s.onHand, 0);
  if (usableTotal < qty) {
    const expiredTotal = rows
      .filter((s) => s.onHand > 0 && expired(s))
      .reduce((n, s) => n + s.onHand, 0);
    return expiredTotal > 0 && usableTotal + expiredTotal >= qty
      ? stockFail('lot_expired', 'Хватает только партий с истёкшим сроком годности.')
      : stockFail('insufficient_stock', 'На складе не хватает.');
  }
  const out: LineRow[] = [];
  let left = qty;
  for (const s of usable) {
    if (left <= 0) break;
    const q = Math.min(s.onHand, left);
    s.onHand -= q;
    left -= q;
    out.push(line(s, q));
  }
  return out;
}

function put(
  work: StockRow[],
  warehouseId: string,
  itemId: string,
  lotId: string | null,
  qty: number,
): void {
  const row = work.find(
    (s) => s.warehouseId === warehouseId && s.itemId === itemId && s.lotId === lotId,
  );
  if (row) row.onHand += qty;
  else work.push({ warehouseId, itemId, lotId, onHand: qty });
}

interface Parsed {
  item: ItemRow;
  quantity: number;
  lotId: string | null;
  expiresOn: string | null;
}

/** Строки тела: позиции существуют (404), количество больше нуля (422 `lines[i].quantity`). */
function parseLines(d: InventoryData, lines: S['InventoryMovementLine'][]): Parsed[] {
  const violations: Violation[] = [];
  const out = lines.map((l, i) => {
    const item = itemOr404(d, l.itemId);
    const quantity = toMicro(l.quantity);
    if (quantity <= 0) {
      violations.push(
        bad(`lines[${i}].quantity`, 'positive', 'Количество должно быть больше нуля'),
      );
    }
    return {
      item,
      quantity,
      lotId: item.trackLots && l.lotId ? lower(l.lotId) : null,
      expiresOn: item.trackLots ? (l.expiresOn ?? null) : null,
    };
  });
  if (violations.length) invalid(violations);
  return out;
}

/** Приход: новая партия (или существующая, если названа) с остатком на складе. */
function receive(
  ctx: HandlerContext,
  d: InventoryData,
  work: StockRow[],
  warehouseId: string,
  p: Parsed,
): LineRow {
  let lotId: string | null = null;
  let expiresOn: string | null = null;
  if (p.item.trackLots) {
    const known = p.lotId
      ? d.lots.find((l) => l.id === p.lotId && l.itemId === p.item.id)
      : undefined;
    if (known) {
      lotId = known.id;
      expiresOn = known.expiresOn;
    } else {
      lotId = ctx.newId(ctx.org().org.proto);
      expiresOn = p.expiresOn;
      d.lots.push({ id: lotId, itemId: p.item.id, expiresOn });
    }
  }
  put(work, warehouseId, p.item.id, lotId, p.quantity);
  return { itemId: p.item.id, quantity: p.quantity, lotId, expiresOn };
}

/** Строки сторно из исходного движения: что и откуда вернуть. */
function reverseOf(
  ctx: HandlerContext,
  d: InventoryData,
  work: StockRow[],
  orig: MovementRow,
): void {
  const now = today(ctx);
  const back = (kind: 'in' | 'out', warehouseId: string): void => {
    for (const l of orig.lines) {
      const item = itemOr404(d, l.itemId);
      if (kind === 'in') put(work, warehouseId, l.itemId, l.lotId, l.quantity);
      else take(d, work, now, warehouseId, item, l.quantity, l.lotId);
    }
  };
  switch (orig.kind) {
    case 'receipt':
      return back('out', orig.warehouseId);
    case 'issue':
      return back('in', orig.warehouseId);
    case 'transfer':
      back('out', orig.targetWarehouseId ?? orig.warehouseId);
      return back('in', orig.warehouseId);
    case 'adjustment':
      return back(orig.direction === 'decrease' ? 'in' : 'out', orig.warehouseId);
    default:
      return fail('invalid_transition', 'Сторно нельзя сторнировать.');
  }
}

/** Движение по основанию гасит резерв этого основания на складе: резерв становится «израсходован». */
function consumeReservations(d: InventoryData, warehouseId: string, source: S['ObjectRef']): void {
  for (const r of d.reservations) {
    if (
      r.status === 'active' &&
      r.warehouseId === warehouseId &&
      r.source.entityId === lower(source.entityId)
    ) {
      r.status = 'consumed';
      r.revision++;
    }
  }
}
function postMovement(ctx: HandlerContext): MovementRow {
  const t = ctx.org();
  const d = inventoryOf(t.org);
  const b = ctx.body as S['InventoryMovementCreate'];
  const wh = warehouseOr404(d, b.warehouseId);
  const now = today(ctx);
  const work = d.stock.map((s) => ({ ...s }));
  const row: MovementRow = {
    id: ctx.newId(t.org.proto),
    kind: b.kind,
    warehouseId: wh.id,
    targetWarehouseId: null,
    lines: [],
    source: b.source ?? null,
    postedAt: ctx.now(),
    reverses: null,
  };

  if (b.kind === 'reversal') {
    const violations: Violation[] = [];
    if (!b.reason?.trim()) violations.push(bad('reason', 'required', 'Укажите причину сторно'));
    if (!b.reversesMovementId) {
      violations.push(bad('reversesMovementId', 'required', 'Укажите движение для сторно'));
    }
    if (violations.length) invalid(violations);
    const orig = d.movements.find((m) => m.id === lower(b.reversesMovementId));
    if (!orig) return fail('not_found', 'Движение не найдено.');
    if (orig.kind === 'reversal') fail('invalid_transition', 'Сторно нельзя сторнировать.');
    if (d.movements.some((m) => m.reverses === orig.id)) {
      fail('invalid_transition', 'Движение уже сторнировано.');
    }
    if (orig.warehouseId !== wh.id) {
      invalid(bad('warehouseId', 'mismatch', 'Склад сторно должен совпадать со складом движения'));
    }
    reverseOf(ctx, d, work, orig);
    row.lines = orig.lines.map((l) => ({ ...l }));
    row.targetWarehouseId = orig.targetWarehouseId;
    row.reverses = orig.id;
    d.stock = work;
    return row;
  }

  const parsed = parseLines(d, b.lines);
  if (b.kind === 'transfer') {
    if (!b.targetWarehouseId) {
      invalid(bad('targetWarehouseId', 'required', 'Выберите склад назначения'));
    }
    const target = warehouseOr404(d, b.targetWarehouseId);
    if (target.id === wh.id) {
      invalid(bad('targetWarehouseId', 'same', 'Склад назначения должен отличаться от исходного'));
    }
    row.targetWarehouseId = target.id;
    for (const p of parsed) {
      for (const l of take(d, work, now, wh.id, p.item, p.quantity, p.lotId)) {
        put(work, target.id, l.itemId, l.lotId, l.quantity);
        row.lines.push(l);
      }
    }
  } else if (b.kind === 'adjustment') {
    const violations: Violation[] = [];
    if (!b.adjustmentDirection) {
      violations.push(bad('adjustmentDirection', 'required', 'Выберите «Больше» или «Меньше»'));
    }
    if (!b.reason?.trim())
      violations.push(bad('reason', 'required', 'Укажите причину корректировки'));
    if (violations.length) invalid(violations);
    row.direction = b.adjustmentDirection;
    for (const p of parsed) {
      if (b.adjustmentDirection === 'increase') row.lines.push(receive(ctx, d, work, wh.id, p));
      else row.lines.push(...take(d, work, now, wh.id, p.item, p.quantity, p.lotId));
    }
  } else if (b.kind === 'receipt') {
    for (const p of parsed) row.lines.push(receive(ctx, d, work, wh.id, p));
  } else {
    for (const p of parsed) {
      row.lines.push(...take(d, work, now, wh.id, p.item, p.quantity, p.lotId));
    }
    // Движение по основанию гасит резерв этого основания: резерв становится «израсходован».
    if (b.source) consumeReservations(d, wh.id, b.source);
  }
  d.stock = work;
  return row;
}

/** Остаток позиции на складе в базовых единицах (число) — для проверки нехватки у модулей-потребителей. */
export function onHandNumber(ctx: HandlerContext, warehouseId: string, itemId: string): number {
  return Number(fromMicro(onHandOf(dataOf(ctx), warehouseId, itemId)));
}

/**
 * Расход материалов по основанию (завершение визита «Салона и SPA», W5.21): одним проведением, без частичных списаний.
 * Каждая позиция снимается по FEFO отдельным движением «Расход» с основанием; резерв этого основания становится
 * «израсходован». Возвращает ids движений. Нехватка или просрочка — 409 до любых изменений.
 */
export function issueForSource(
  ctx: HandlerContext,
  warehouseId: string,
  lines: readonly { itemId: string; quantity: number }[],
  source: S['ObjectRef'],
): string[] {
  const t = ctx.org();
  const d = inventoryOf(t.org);
  const wh = warehouseOr404(d, warehouseId);
  const work = d.stock.map((s) => ({ ...s }));
  const rows: MovementRow[] = [];
  for (const l of lines) {
    const quantity = toMicro(l.quantity.toFixed(6));
    if (quantity <= 0) continue;
    const item = itemOr404(d, l.itemId);
    rows.push({
      id: ctx.newId(t.org.proto),
      kind: 'issue',
      warehouseId: wh.id,
      targetWarehouseId: null,
      lines: take(d, work, today(ctx), wh.id, item, quantity, null),
      source,
      postedAt: ctx.now(),
      reverses: null,
    });
  }
  d.stock = work;
  d.movements.push(...rows);
  consumeReservations(d, wh.id, source);
  return rows.map((r) => r.id);
}
// ───────────────────────────── хендлеры ─────────────────────────────

export const inventoryHandlers: Registry = {
  listWarehouses: (ctx) => {
    const items = [...dataOf(ctx).warehouses].sort(byName).map(warehouseDto);
    return { body: page(items, ctx.query) };
  },

  createWarehouse: (ctx) => {
    const d = dataOf(ctx);
    const b = ctx.body as S['WarehouseCreate'];
    const orgUnitId = unitOr404(ctx, b.orgUnitId);
    const name = b.name.trim();
    if (!name) invalid(bad('name', 'required', 'Укажите название склада'));
    const code = b.code?.trim() || null;
    if (code && d.warehouses.some((w) => w.code && sameText(w.code, code))) {
      invalid(bad('code', 'duplicate', 'Склад с таким кодом уже есть'));
    }
    const row: WarehouseRow = {
      id: ctx.newId(ctx.org().org.proto),
      orgUnitId,
      name,
      code,
      archived: false,
      revision: 1,
    };
    d.warehouses.push(row);
    return { status: 201, body: warehouseDto(row) };
  },

  listInventoryItems: (ctx) => {
    // Порядок сида (у «Альты» — как в эталоне: масло, крем), новые позиции — в конце.
    const items = dataOf(ctx)
      .items.filter((i) => !i.archived)
      .map(itemDto);
    return { body: page(items, ctx.query) };
  },

  createInventoryItem: (ctx) => {
    const d = dataOf(ctx);
    const b = ctx.body as S['InventoryItemCreate'];
    const orgUnitId = unitOr404(ctx, b.orgUnitId);
    const name = b.name.trim();
    const sku = b.sku.trim();
    const violations: Violation[] = [];
    if (!name) violations.push(bad('name', 'required', 'Укажите название позиции'));
    if (!sku) violations.push(bad('sku', 'required', 'Укажите артикул'));
    else if (d.items.some((i) => sameText(i.sku, sku))) {
      violations.push(bad('sku', 'duplicate', 'Позиция с таким артикулом уже есть'));
    }
    if (violations.length) invalid(violations);
    const row: ItemRow = {
      id: ctx.newId(ctx.org().org.proto),
      orgUnitId,
      name,
      sku,
      baseUnit: b.baseUnit,
      trackLots: b.trackLots,
      minLevel: null,
      archived: false,
      revision: 1,
    };
    d.items.push(row);
    return { status: 201, body: itemDto(row) };
  },

  updateInventoryItem: (ctx) => {
    const item = itemOr404(dataOf(ctx), ctx.params.itemId);
    ctx.revision(item.revision);
    const b = ctx.body as S['InventoryItemPatch'];
    if (b.name !== undefined) {
      const name = b.name.trim();
      if (!name) invalid(bad('name', 'required', 'Укажите название позиции'));
      item.name = name;
    }
    if (b.minLevel !== undefined) item.minLevel = toMicro(b.minLevel);
    if (b.archived !== undefined) item.archived = b.archived;
    item.revision++;
    return { body: itemDto(item) };
  },

  listInventoryBalances: (ctx) => {
    const d = dataOf(ctx);
    const warehouseId = uuidParam(ctx.query, 'warehouseId', false);
    const itemId = uuidParam(ctx.query, 'itemId', false);
    const below = ctx.query.get('belowMinimum') === 'true';
    const warehouses = [...d.warehouses].sort(byName);
    const rows: S['InventoryBalance'][] = [];
    for (const item of d.items.filter((i) => !i.archived)) {
      if (itemId && item.id !== itemId) continue;
      const has = d.stock.some((s) => s.itemId === item.id);
      const first = warehouses.find((w) => w.orgUnitId === item.orgUnitId) ?? warehouses[0];
      for (const w of warehouses) {
        if (warehouseId && w.id !== warehouseId) continue;
        const here = d.stock.some((s) => s.itemId === item.id && s.warehouseId === w.id);
        if (!here && (has || w !== first)) continue;
        const dto = balanceDto(d, w, item);
        if (!below || dto.belowMinimum) rows.push(dto);
      }
    }
    return { body: page(rows, ctx.query) };
  },

  listInventoryReservations: (ctx) => {
    const d = dataOf(ctx);
    const warehouseId = uuidParam(ctx.query, 'warehouseId', false);
    const status = ctx.query.get('status');
    const items = d.reservations
      .filter(
        (r) => (!warehouseId || r.warehouseId === warehouseId) && (!status || r.status === status),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(reservationDto);
    return { body: page(items, ctx.query) };
  },

  createInventoryReservation: (ctx) => {
    const d = dataOf(ctx);
    const b = ctx.body as S['InventoryReservationCreate'];
    const wh = warehouseOr404(d, b.warehouseId);
    const need = new Map<string, number>();
    const violations: Violation[] = [];
    b.lines.forEach((l, i) => {
      const item = itemOr404(d, l.itemId);
      const q = toMicro(l.quantity);
      if (q <= 0)
        violations.push(
          bad(`lines[${i}].quantity`, 'positive', 'Количество должно быть больше нуля'),
        );
      need.set(item.id, (need.get(item.id) ?? 0) + q);
    });
    if (violations.length) invalid(violations);
    for (const [itemId, q] of need) {
      if (onHandOf(d, wh.id, itemId) - reservedOf(d, wh.id, itemId) < q) {
        stockFail('insufficient_stock', 'Свободного остатка не хватает для резерва.');
      }
    }
    const row = {
      id: ctx.newId(ctx.org().org.proto),
      warehouseId: wh.id,
      source: { ...b.source, entityId: lower(b.source.entityId) },
      lines: b.lines.map((l) => ({ itemId: lower(l.itemId), quantity: toMicro(l.quantity) })),
      status: 'active' as const,
      expiresAt: b.expiresAt ?? null,
      createdAt: ctx.now(),
      revision: 1,
    };
    d.reservations.push(row);
    return { status: 201, body: reservationDto(row) };
  },

  releaseInventoryReservation: (ctx) => {
    const d = dataOf(ctx);
    const r = d.reservations.find((x) => x.id === lower(ctx.params.reservationId));
    if (!r) fail('not_found', 'Резерв не найден.');
    if (r.status !== 'active') {
      stockFail('reservation_not_active', 'Резерв уже не действует.');
    }
    r.status = 'released';
    r.revision++;
    return { body: reservationDto(r) };
  },

  listInventoryMovements: (ctx) => {
    // Новые первыми; при одинаковом времени (часы сценария стоят) — позже проведённое первым.
    const items = dataOf(ctx)
      .movements.map((m, i) => ({ m, i }))
      .sort((a, b) =>
        a.m.postedAt === b.m.postedAt ? b.i - a.i : a.m.postedAt < b.m.postedAt ? 1 : -1,
      )
      .map((x) => movementDto(x.m));
    return { body: page(items, ctx.query) };
  },

  postInventoryMovement: (ctx) => {
    const row = postMovement(ctx);
    const d = dataOf(ctx);
    d.movements.push(row);
    return { status: 201, body: movementDto(row) };
  },
};
