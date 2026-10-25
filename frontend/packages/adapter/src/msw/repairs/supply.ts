// Тег Repairs сценарного сервера, шаг 6.4 (W6.00, контракт 0.12.0-stage6): снабжение по всем объектам — заявки прораба
// (request → reserved → issued или request → ordered → bought, затем used), закупка на несколько объектов с чеком QR,
// остатки на объектах (возврат на склад, перемещение на другой объект). Основа — склад: остатки складов и движения
// ведёт общий модуль «Склад» (этап 5); здесь — их проекция сида. Правила — design/docs/19-construction.md «Снабжение по
// всем объектам и склады», решения Q-W4.00-repair-6, -7, -18, -23.
import { page } from '../core/page.ts';
import { fail, type Violation } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { WAREHOUSES } from './data.ts';
import {
  addFeed,
  A,
  can,
  isForeman,
  money,
  newRid,
  type ProjectRow,
  priceOf,
  projectOr404,
  qty,
  type PurchaseRow,
  type SupplyRow,
  type View,
  viewOf,
} from './state.ts';

const invalid = (field: string, code: string, message: string): never =>
  fail('validation_failed', message, {
    violations: [{ field, code, message } satisfies Violation],
  });

export const supplyDto = (v: View, r: SupplyRow) => {
  const item = v.rp.prices.find((x) => x.id === r.priceItemId);
  const proj = v.rp.projects.find((x) => x.id === r.projectId);
  const dto: Record<string, unknown> = {
    id: r.id,
    number: r.number,
    projectId: r.projectId,
    projectName: proj?.name ?? '',
    priceItemId: r.priceItemId,
    name: item?.name ?? '',
    unit: item?.unit ?? 'piece',
    quantity: qty(r.quantity),
    needBy: r.needBy,
    state: r.state,
    createdAt: r.createdAt,
    revision: r.revision,
  };
  if (r.warehouseId) dto.warehouseId = r.warehouseId;
  if (r.purchaseId) dto.purchaseId = r.purchaseId;
  if (can(v, 'repairs.supply.manage')) {
    if (r.costMinor !== undefined) dto.cost = money(r.costMinor);
    if (r.state === 'request') {
      dto.available = WAREHOUSES.flatMap((w) => {
        const st = v.rp.whStock.find(
          (x) => x.warehouseId === A(w.id) && x.priceItemId === r.priceItemId,
        );
        const free = st ? st.quantity - st.reserved : 0;
        return free > 0 ? [{ warehouseId: A(w.id), warehouseName: w.name, free: qty(free) }] : [];
      });
    }
  }
  return dto;
};

export const purchaseDto = (v: View, p: PurchaseRow) => {
  const dto: Record<string, unknown> = {
    id: p.id,
    number: p.number,
    supplier: p.supplier,
    state: p.state,
    lines: p.lines.map((l) => ({
      supplyRequestId: l.supplyRequestId,
      projectId: l.projectId,
      priceItemId: l.priceItemId,
      quantity: qty(l.quantity),
      price: money(l.priceMinor),
    })),
    total: money(p.lines.reduce((a, l) => a + Math.round(l.quantity * l.priceMinor), 0)),
    createdAt: p.createdAt,
    revision: p.revision,
  };
  if (p.receiptQr) dto.receiptQr = p.receiptQr;
  if (p.receivedAt) dto.receivedAt = p.receivedAt;
  void v;
  return dto;
};

const stockDto = (
  v: View,
  p: ProjectRow | undefined,
  s: { projectId: string; priceItemId: string; quantity: number; costMinor: number },
) => {
  const item = v.rp.prices.find((x) => x.id === s.priceItemId);
  return {
    projectId: s.projectId,
    projectName: p?.name ?? '',
    priceItemId: s.priceItemId,
    name: item?.name ?? '',
    unit: item?.unit ?? 'piece',
    quantity: qty(s.quantity),
    cost: money(s.costMinor),
  };
};

const nextNumber = (rows: { number: string }[], prefix: string): string =>
  `${prefix}${rows.reduce((a, r) => Math.max(a, Number(r.number.slice(prefix.length)) || 0), 0) + 1}`;

const needOf = (v: View, id: string | undefined): SupplyRow => {
  const r = v.rp.supply.find((x) => x.id === (id ?? '').toLowerCase());
  const p = r ? v.rp.projects.find((x) => x.id === r.projectId) : undefined;
  if (!r || !p || !(v.office || isForeman(v, p))) return fail('not_found', 'Заявка не найдена.');
  return r;
};

const stateGuard = (r: SupplyRow, ...ok: SupplyRow['state'][]): void => {
  if (!ok.includes(r.state)) {
    fail('invalid_transition', 'Заявка не в том состоянии для этой операции.', {
      reason: 'repair_supply_state',
    });
  }
};

function takeFromProject(
  v: View,
  projectId: string,
  items: { priceItemId: string; quantity: string }[],
) {
  return items.map((it, i) => {
    const s = v.rp.stock.find((x) => x.projectId === projectId && x.priceItemId === it.priceItemId);
    const n = Number(it.quantity);
    if (!(n > 0))
      invalid(`items[${i}].quantity`, 'positive', 'Количество должно быть больше нуля.');
    if (!s || s.quantity + 1e-9 < n) {
      fail('invalid_transition', 'На объекте нет такого остатка.', {
        reason: 'repair_stock_insufficient',
      });
    }
    const unit = s ? s.costMinor / s.quantity : 0;
    return { s: s as NonNullable<typeof s>, n, cost: Math.round(unit * n) };
  });
}

export const supplyHandlers: Registry = {
  listSupplyRequests: (ctx) => {
    const v = viewOf(ctx);
    const state = ctx.query.get('state');
    if (
      state !== null &&
      !['request', 'reserved', 'issued', 'ordered', 'bought', 'used'].includes(state)
    ) {
      fail('malformed_request', 'Неизвестное состояние заявки.');
    }
    const projectId = ctx.query.get('projectId')?.toLowerCase();
    const seeAll = v.office;
    const items = v.rp.supply
      .filter((r) => {
        const p = v.rp.projects.find((x) => x.id === r.projectId);
        return p && (seeAll || (p.status !== 'draft' && p.foremanId === v.member?.id));
      })
      .filter((r) => !state || r.state === state)
      .filter((r) => !projectId || r.projectId === projectId)
      .sort(
        (a, b) =>
          Number(b.state === 'request') - Number(a.state === 'request') ||
          a.needBy.localeCompare(b.needBy) ||
          a.number.localeCompare(b.number),
      )
      .map((r) => supplyDto(v, r));
    return { body: page(items, ctx.query) };
  },

  createSupplyRequest: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    if (!isForeman(v, p)) fail('forbidden_action', 'Заявку по объекту пишет его прораб.');
    if (p.status === 'handed_over')
      fail('invalid_transition', 'Объект сдан: заявки не принимаются.', {
        reason: 'project_handed_over',
      });
    const b = ctx.body as { priceItemId: string; quantity: string; needBy: string };
    const item = priceOf(v, b.priceItemId);
    if (item.kind !== 'material')
      invalid('priceItemId', 'kind', 'Заявка — на материал справочника.');
    if (!(Number(b.quantity) > 0))
      invalid('quantity', 'positive', 'Количество должно быть больше нуля.');
    const row: SupplyRow = {
      id: newRid(v, 'supply'),
      number: nextNumber(v.rp.supply, 'З-'),
      projectId: p.id,
      priceItemId: item.id,
      quantity: Number(b.quantity),
      needBy: b.needBy,
      state: 'request',
      createdAt: ctx.now(),
      revision: 1,
    };
    v.rp.supply.push(row);
    addFeed(v, p.id, `попросил материал: ${item.name}, заявка ${row.number}`);
    return { status: 201, body: supplyDto(v, row) };
  },

  reserveSupplyRequest: (ctx) => {
    const v = viewOf(ctx);
    const r = needOf(v, ctx.params.supplyRequestId);
    ctx.revision(r.revision);
    stateGuard(r, 'request');
    const wh = (ctx.body as { warehouseId: string }).warehouseId;
    if (!WAREHOUSES.some((w) => A(w.id) === wh))
      invalid('warehouseId', 'unknown', 'Склада нет в организации.');
    const st = v.rp.whStock.find((x) => x.warehouseId === wh && x.priceItemId === r.priceItemId);
    if (!st || st.quantity - st.reserved + 1e-9 < r.quantity) {
      fail('invalid_transition', 'На складе нет нужного остатка.', {
        reason: 'repair_stock_insufficient',
      });
    }
    (st as NonNullable<typeof st>).reserved += r.quantity;
    r.state = 'reserved';
    r.warehouseId = wh;
    r.revision++;
    return { body: supplyDto(v, r) };
  },

  issueSupplyRequest: (ctx) => {
    const v = viewOf(ctx);
    const r = needOf(v, ctx.params.supplyRequestId);
    ctx.revision(r.revision);
    stateGuard(r, 'reserved');
    const st = v.rp.whStock.find(
      (x) => x.warehouseId === r.warehouseId && x.priceItemId === r.priceItemId,
    );
    const cost = Math.round((st?.avgMinor ?? 0) * r.quantity);
    if (st) {
      st.quantity -= r.quantity;
      st.reserved = Math.max(0, st.reserved - r.quantity);
    }
    const on = v.rp.stock.find(
      (x) => x.projectId === r.projectId && x.priceItemId === r.priceItemId,
    );
    if (on) {
      on.quantity += r.quantity;
      on.costMinor += cost;
    } else
      v.rp.stock.push({
        projectId: r.projectId,
        priceItemId: r.priceItemId,
        quantity: r.quantity,
        costMinor: cost,
      });
    r.costMinor = cost;
    const p = v.rp.projects.find((x) => x.id === r.projectId);
    if (p) p.spentMinor += cost;
    r.state = 'issued';
    r.revision++;
    return { body: supplyDto(v, r) };
  },

  consumeSupplyRequest: (ctx) => {
    const v = viewOf(ctx);
    const r = needOf(v, ctx.params.supplyRequestId);
    ctx.revision(r.revision);
    stateGuard(r, 'issued', 'bought');
    const on = v.rp.stock.find(
      (x) => x.projectId === r.projectId && x.priceItemId === r.priceItemId,
    );
    if (on) {
      const unit = on.quantity ? on.costMinor / on.quantity : 0;
      on.quantity = Math.max(0, on.quantity - r.quantity);
      on.costMinor = Math.round(unit * on.quantity);
    }
    r.state = 'used';
    r.revision++;
    return { body: supplyDto(v, r) };
  },

  createPurchase: (ctx) => {
    const v = viewOf(ctx);
    const b = ctx.body as {
      supplier: string;
      lines: { supplyRequestId: string; price?: { amountMinor: number } }[];
    };
    const seen = new Set<string>();
    const lines = b.lines.map((ln, i) => {
      const r = v.rp.supply.find((x) => x.id === ln.supplyRequestId);
      if (!r) return invalid(`lines[${i}].supplyRequestId`, 'unknown', 'Заявки нет в организации.');
      if (seen.has(r.id))
        return invalid(`lines[${i}].supplyRequestId`, 'duplicate', 'Заявка уже в закупке.');
      seen.add(r.id);
      if (r.state !== 'request') {
        return fail('invalid_transition', 'Заявка не в том состоянии для закупки.', {
          reason: 'repair_supply_state',
        });
      }
      // Цена по умолчанию: средняя цена склада → цена последней закупки → цена справочника (Q-W4.00-repair-23).
      const wh = v.rp.whStock.filter((x) => x.priceItemId === r.priceItemId && x.quantity > 0);
      const avg = wh.length
        ? Math.round(
            wh.reduce((a, x) => a + x.avgMinor * x.quantity, 0) /
              wh.reduce((a, x) => a + x.quantity, 0),
          )
        : 0;
      const last =
        [...v.rp.purchases]
          .reverse()
          .flatMap((p) => p.lines)
          .find((l) => l.priceItemId === r.priceItemId)?.priceMinor ?? 0;
      const priceMinor =
        ln.price?.amountMinor ?? (avg || last || priceOf(v, r.priceItemId).priceMinor);
      return {
        r,
        line: {
          supplyRequestId: r.id,
          projectId: r.projectId,
          priceItemId: r.priceItemId,
          quantity: r.quantity,
          priceMinor,
        },
      };
    });
    const row: PurchaseRow = {
      id: newRid(v, 'purchase'),
      number: nextNumber(v.rp.purchases, 'ЗК-'),
      supplier: b.supplier.trim(),
      state: 'ordered',
      lines: lines.map((l) => l.line),
      createdAt: ctx.now(),
      revision: 1,
    };
    v.rp.purchases.push(row);
    for (const { r, line } of lines) {
      r.state = 'ordered';
      r.purchaseId = row.id;
      r.costMinor = Math.round(line.quantity * line.priceMinor);
      r.revision++;
    }
    return { status: 201, body: purchaseDto(v, row) };
  },

  listPurchases: (ctx) => {
    const v = viewOf(ctx);
    const items = [...v.rp.purchases]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
      .map((p) => purchaseDto(v, p));
    return { body: page(items, ctx.query) };
  },

  receivePurchase: (ctx) => {
    const v = viewOf(ctx);
    const p = v.rp.purchases.find((x) => x.id === (ctx.params.purchaseId ?? '').toLowerCase());
    if (!p) fail('not_found', 'Закупка не найдена.');
    const pur = p as PurchaseRow;
    ctx.revision(pur.revision);
    if (pur.state !== 'ordered') {
      fail('invalid_transition', 'Закупка уже получена.', { reason: 'repair_purchase_state' });
    }
    pur.state = 'received';
    pur.receiptQr = (ctx.body as { receiptQr: string }).receiptQr;
    pur.receivedAt = ctx.now();
    pur.revision++;
    for (const l of pur.lines) {
      const r = v.rp.supply.find((x) => x.id === l.supplyRequestId);
      if (r) {
        r.state = 'bought';
        r.revision++;
      }
      const cost = Math.round(l.quantity * l.priceMinor);
      const on = v.rp.stock.find(
        (x) => x.projectId === l.projectId && x.priceItemId === l.priceItemId,
      );
      if (on) {
        on.quantity += l.quantity;
        on.costMinor += cost;
      } else
        v.rp.stock.push({
          projectId: l.projectId,
          priceItemId: l.priceItemId,
          quantity: l.quantity,
          costMinor: cost,
        });
      const proj = v.rp.projects.find((x) => x.id === l.projectId);
      if (proj) proj.spentMinor += cost;
    }
    return { body: purchaseDto(v, pur) };
  },

  listProjectStock: (ctx) => {
    const v = viewOf(ctx);
    const items = v.rp.stock
      .filter((s) => s.quantity > 0)
      .map((s) =>
        stockDto(
          v,
          v.rp.projects.find((x) => x.id === s.projectId),
          s,
        ),
      );
    return { body: { items } };
  },

  returnProjectStock: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const b = ctx.body as {
      warehouseId: string;
      items: { priceItemId: string; quantity: string }[];
    };
    if (!WAREHOUSES.some((w) => A(w.id) === b.warehouseId))
      invalid('warehouseId', 'unknown', 'Склада нет в организации.');
    const taken = takeFromProject(v, p.id, b.items);
    const ids: string[] = [];
    for (const { s, n, cost } of taken) {
      s.quantity -= n;
      s.costMinor -= cost;
      p.spentMinor = Math.max(0, p.spentMinor - cost);
      const wh = v.rp.whStock.find(
        (x) => x.warehouseId === b.warehouseId && x.priceItemId === s.priceItemId,
      );
      if (wh) {
        wh.avgMinor = Math.round((wh.avgMinor * wh.quantity + cost) / (wh.quantity + n));
        wh.quantity += n;
      } else
        v.rp.whStock.push({
          warehouseId: b.warehouseId,
          priceItemId: s.priceItemId,
          quantity: n,
          reserved: 0,
          avgMinor: Math.round(cost / n),
        });
      ids.push(newRid(v, 'movement'));
    }
    return {
      body: {
        movementIds: ids,
        items: v.rp.stock
          .filter((x) => x.projectId === p.id && x.quantity > 0)
          .map((x) => stockDto(v, p, x)),
      },
    };
  },

  transferProjectStock: (ctx) => {
    const v = viewOf(ctx);
    const p = projectOr404(v, ctx.params.projectId);
    const b = ctx.body as {
      toProjectId: string;
      items: { priceItemId: string; quantity: string }[];
    };
    const to = v.rp.projects.find((x) => x.id === b.toProjectId);
    if (!to || to.id === p.id || to.status === 'draft')
      invalid('toProjectId', 'unknown', 'Выберите другой объект организации.');
    const target = to as ProjectRow;
    const taken = takeFromProject(v, p.id, b.items);
    const ids: string[] = [];
    for (const { s, n, cost } of taken) {
      s.quantity -= n;
      s.costMinor -= cost;
      p.spentMinor = Math.max(0, p.spentMinor - cost);
      const on = v.rp.stock.find(
        (x) => x.projectId === target.id && x.priceItemId === s.priceItemId,
      );
      if (on) {
        on.quantity += n;
        on.costMinor += cost;
      } else
        v.rp.stock.push({
          projectId: target.id,
          priceItemId: s.priceItemId,
          quantity: n,
          costMinor: cost,
        });
      target.spentMinor += cost;
      // Заявка цели на тот же материал уменьшается или закрывается.
      const req = v.rp.supply.find(
        (r) =>
          r.projectId === target.id && r.priceItemId === s.priceItemId && r.state === 'request',
      );
      if (req) {
        if (req.quantity > n) req.quantity -= n;
        else req.state = 'used';
        req.revision++;
      }
      ids.push(newRid(v, 'movement'));
    }
    return {
      body: {
        movementIds: ids,
        items: v.rp.stock
          .filter((x) => x.projectId === p.id && x.quantity > 0)
          .map((x) => stockDto(v, p, x)),
      },
    };
  },
};
