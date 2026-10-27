// W5.11 · Тег Inventory сценарного сервера (контракт 0.12.0-stage5, W5.00; страницы склада W5.11, backend — W5.10):
// склады, номенклатура, остатки по партиям в порядке FEFO (D-20 комплекта), движения (приход, расход, перемещение,
// корректировка, сторно), резервы. Сид «Альты» — остатки кабинета эталона (design/ortus/extra-data.js spa.stock:
// «Масло массажное» 250 мл, «Крем восстанавливающий» 12 г) и расходные материалы. Экрана склада в эталоне нет (B-6).
import { seedUuid } from '@ortus/domain/seed';
import { beforeEach, describe, expect, it } from 'vitest';

import { createScenarioServer } from '../src/msw/server.ts';
import { Client, type Reply, type Session } from './conformance/client.ts';

const ALTA = seedUuid('platform', 't-alta');
const A = (proto: string): string => seedUuid('t-alta', proto);
const base = `/api/v1/tenants/${ALTA}/inventory`;
const MISSING = '00000000-0000-5000-8000-0000000000aa';

const WH_SALON = A('wh-spa');
const WH_MAIN = A('wh-main');
const OIL = A('inv-oil');
const CREAM = A('inv-cream');
const TOWEL = A('it-towel');
const GLOVES = A('it-gloves');
const LOT_OIL_A = A('lot-oil-a');
const LOT_OIL_B = A('lot-oil-b');
const LOT_OIL_OLD = A('lot-oil-old');

type Json = Record<string, unknown>;
type Line = { itemId: string; quantity: string; lotId?: string | null; expiresOn?: string | null };
type Balance = {
  warehouseId: string;
  itemId: string;
  onHand: string;
  reserved: string;
  available: string;
  minLevel: string | null;
  belowMinimum: boolean;
  lots: { lotId: string | null; expiresOn: string | null; onHand: string }[];
};
const body = <T = Json>(r: Reply): T => r.body as T;

let owner: Session;
beforeEach(async () => {
  const server = createScenarioServer();
  server.applyPreset('inventory-ready');
  const api = new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) });
  owner = await api.as('owner');
});

const balances = async (query = ''): Promise<Balance[]> =>
  body<{ items: Balance[] }>(await owner.get(`${base}/balances${query}`)).items;
const balance = async (warehouseId: string, itemId: string): Promise<Balance> => {
  const [b] = await balances(`?warehouseId=${warehouseId}&itemId=${itemId}`);
  if (!b) throw new Error('нет остатка');
  return b;
};
const post = (b: Json): Promise<Reply> => owner.post(`${base}/movements`, b);
const reasonOf = (r: Reply): unknown => body(r).reason;

describe('склады и номенклатура', () => {
  it('два склада «Альты» с кодами; создание — подразделение, название, уникальный код', async () => {
    const list = body<{ items: Json[] }>(await owner.get(`${base}/warehouses`)).items;
    expect(list.map((w) => [w.name, w.code, w.archived])).toEqual([
      ['Склад салона', 'SPA', false],
      ['Склад № 1', 'S1', false],
    ]);
    const unit = list[0]?.orgUnitId;
    const ok = await owner.post(`${base}/warehouses`, {
      orgUnitId: unit,
      name: 'Склад прачечной',
      code: 'LND',
    });
    expect(ok.status).toBe(201);
    expect(body(ok)).toMatchObject({ name: 'Склад прачечной', code: 'LND', archived: false });
    const dup = await owner.post(`${base}/warehouses`, {
      orgUnitId: unit,
      name: 'Другой',
      code: 'S1',
    });
    expect(dup.status).toBe(422);
    expect(body<{ violations: Json[] }>(dup).violations[0]).toMatchObject({
      field: 'code',
      code: 'duplicate',
    });
    const noUnit = await owner.post(`${base}/warehouses`, { orgUnitId: MISSING, name: 'X' });
    expect(noUnit.status).toBe(404);
    const blank = await owner.post(`${base}/warehouses`, { orgUnitId: unit, name: '   ' });
    expect(blank.status).toBe(422);
  });

  it('четыре позиции сида с единицами; создание — уникальный артикул, 201', async () => {
    const list = body<{ items: Json[] }>(await owner.get(`${base}/items`)).items;
    expect(list.map((i) => [i.name, i.baseUnit, i.sku])).toEqual([
      ['Крем восстанавливающий', 'g', 'CRM-50'],
      ['Масло массажное', 'ml', 'OIL-500'],
      ['Перчатки нитриловые', 'piece', 'GLV-100'],
      ['Полотенца одноразовые', 'piece', 'TWL-200'],
    ]);
    const unit = list[0]?.orgUnitId;
    const ok = await owner.post(`${base}/items`, {
      orgUnitId: unit,
      name: 'Скраб солевой',
      sku: 'SCR-1',
      baseUnit: 'g',
      trackLots: true,
    });
    expect(ok.status).toBe(201);
    expect(body(ok)).toMatchObject({ name: 'Скраб солевой', revision: 1 });
    const dup = await owner.post(`${base}/items`, {
      orgUnitId: unit,
      name: 'Ещё скраб',
      sku: 'SCR-1',
      baseUnit: 'g',
      trackLots: true,
    });
    expect(dup.status).toBe(422);
    expect(body<{ violations: Json[] }>(dup).violations[0]).toMatchObject({ field: 'sku' });
  });

  it('правка позиции: If-Match, минимальный уровень, название; архив убирает из списка; 412 при старой ревизии', async () => {
    const before = body<{ items: { id: string; revision: number }[] }>(
      await owner.get(`${base}/items`),
    ).items.find((i) => i.id === CREAM);
    const rev = before?.revision ?? 0;
    const ok = await owner.patch(
      `${base}/items/${CREAM}`,
      { minLevel: '20', name: 'Крем восстанавливающий 50 г' },
      { ifMatch: rev },
    );
    expect(ok.status).toBe(200);
    expect(body(ok)).toMatchObject({ minLevel: '20', revision: rev + 1 });
    const stale = await owner.patch(`${base}/items/${CREAM}`, { minLevel: '30' }, { ifMatch: rev });
    expect(stale.status).toBe(412);
    expect((await balance(WH_SALON, CREAM)).belowMinimum).toBe(true);
    const gone = await owner.patch(`${base}/items/${GLOVES}`, { archived: true }, { ifMatch: 1 });
    expect(gone.status).toBe(200);
    const names = body<{ items: Json[] }>(await owner.get(`${base}/items`)).items.map((i) => i.id);
    expect(names).not.toContain(GLOVES);
    expect(
      (await owner.patch(`${base}/items/${MISSING}`, { name: 'Z' }, { ifMatch: 1 })).status,
    ).toBe(404);
  });

  it('водитель без прав склада — 403 forbidden_action', async () => {
    const server = createScenarioServer();
    const driver = await new Client({
      base: 'http://ortus.test',
      fetch: (r) => server.handle(r),
    }).as('driver');
    const r = await driver.get(`${base}/warehouses`);
    expect(r.status).toBe(403);
    expect(body(r).code).toBe('forbidden_action');
  });
});

describe('остатки по партиям в порядке FEFO', () => {
  it('масло в салоне: 250 мл, резерв 30, доступно 220; партии — ближайший срок первым', async () => {
    const b = await balance(WH_SALON, OIL);
    expect(b).toMatchObject({
      onHand: '250',
      reserved: '30',
      available: '220',
      minLevel: '100',
      belowMinimum: false,
    });
    expect(b.lots).toEqual([
      { lotId: LOT_OIL_A, expiresOn: '2026-11-15', onHand: '100' },
      { lotId: LOT_OIL_B, expiresOn: '2027-03-01', onHand: '150' },
    ]);
  });

  it('партия без срока — последней; позиция без партий — одна строка с lotId null', async () => {
    const t = await balance(WH_SALON, TOWEL);
    expect(t.lots).toEqual([{ lotId: null, expiresOn: null, onHand: '200' }]);
  });

  it('belowMinimum: крем (12 г при уровне 50) и перчатки (0); фильтр по складу, позиции и «ниже минимума»', async () => {
    const low = await balances('?belowMinimum=true');
    expect(low.map((x) => x.itemId).sort()).toEqual([CREAM, GLOVES].sort());
    expect(low.every((x) => x.belowMinimum)).toBe(true);
    const main = await balances(`?warehouseId=${WH_MAIN}`);
    expect(new Set(main.map((x) => x.warehouseId))).toEqual(new Set([WH_MAIN]));
    expect((await balances(`?itemId=${OIL}`)).map((x) => x.itemId)).toEqual([OIL, OIL]);
    expect((await owner.get(`${base}/balances?warehouseId=oops`)).status).toBe(400);
  });
});

describe('движения', () => {
  it('журнал: от новых к старым, у каждого строки с партиями', async () => {
    const list = body<{ items: { kind: string; postedAt: string }[] }>(
      await owner.get(`${base}/movements`),
    ).items;
    expect(list.length).toBeGreaterThanOrEqual(6);
    const times = list.map((m) => m.postedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(list[0]?.kind).toBe('issue');
  });

  it('приход с партией и сроком: 201, партия в остатках в порядке срока', async () => {
    const r = await post({
      kind: 'receipt',
      warehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '40.5', expiresOn: '2026-12-01' }],
    });
    expect(r.status).toBe(201);
    const line = body<{ lines: Line[] }>(r).lines[0];
    expect(line?.lotId).toMatch(/^[0-9a-f-]{36}$/);
    const b = await balance(WH_SALON, OIL);
    expect(b.onHand).toBe('290.5');
    expect(b.lots.map((l) => l.expiresOn)).toEqual(['2026-11-15', '2026-12-01', '2027-03-01']);
  });

  it('расход без партии идёт по FEFO: сначала ближайший срок, строки по партиям', async () => {
    const r = await post({
      kind: 'issue',
      warehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '120' }],
    });
    expect(r.status).toBe(201);
    expect(body<{ lines: Line[] }>(r).lines.map((l) => [l.lotId, l.quantity])).toEqual([
      [LOT_OIL_A, '100'],
      [LOT_OIL_B, '20'],
    ]);
    const b = await balance(WH_SALON, OIL);
    expect(b.onHand).toBe('130');
    expect(b.lots).toEqual([{ lotId: LOT_OIL_B, expiresOn: '2027-03-01', onHand: '130' }]);
  });

  it('больше остатка — 409 insufficient_stock; из просроченной партии — lot_expired; свободного нет — тоже', async () => {
    const big = await post({
      kind: 'issue',
      warehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '1000' }],
    });
    expect(big.status).toBe(409);
    expect(body(big).code).toBe('invalid_transition');
    expect(reasonOf(big)).toBe('insufficient_stock');
    const expired = await post({
      kind: 'issue',
      warehouseId: WH_MAIN,
      lines: [{ itemId: OIL, quantity: '10', lotId: LOT_OIL_OLD }],
    });
    expect(expired.status).toBe(409);
    expect(reasonOf(expired)).toBe('lot_expired');
    const spill = await post({
      kind: 'issue',
      warehouseId: WH_MAIN,
      lines: [{ itemId: OIL, quantity: '520' }],
    });
    expect(reasonOf(spill)).toBe('lot_expired');
    const over = await post({
      kind: 'issue',
      warehouseId: WH_MAIN,
      lines: [{ itemId: OIL, quantity: '600' }],
    });
    expect(reasonOf(over)).toBe('insufficient_stock');
    expect((await balance(WH_MAIN, OIL)).onHand).toBe('540');
  });

  it('количество должно быть больше нуля: 422 с нарушением строки', async () => {
    const r = await post({
      kind: 'receipt',
      warehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '0' }],
    });
    expect(r.status).toBe(422);
    expect(body<{ violations: Json[] }>(r).violations[0]).toMatchObject({
      field: 'lines[0].quantity',
    });
    const nowhere = await post({
      kind: 'receipt',
      warehouseId: MISSING,
      lines: [{ itemId: OIL, quantity: '1' }],
    });
    expect(nowhere.status).toBe(404);
    const noItem = await post({
      kind: 'receipt',
      warehouseId: WH_SALON,
      lines: [{ itemId: MISSING, quantity: '1' }],
    });
    expect(noItem.status).toBe(404);
  });

  it('перемещение: партии переезжают на другой склад; склад назначения обязателен и другой', async () => {
    const r = await post({
      kind: 'transfer',
      warehouseId: WH_SALON,
      targetWarehouseId: WH_MAIN,
      lines: [{ itemId: OIL, quantity: '120' }],
    });
    expect(r.status).toBe(201);
    expect((await balance(WH_SALON, OIL)).onHand).toBe('130');
    const main = await balance(WH_MAIN, OIL);
    expect(main.onHand).toBe('660');
    expect(main.lots.map((l) => l.lotId)).toContain(LOT_OIL_A);
    const same = await post({
      kind: 'transfer',
      warehouseId: WH_SALON,
      targetWarehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '1' }],
    });
    expect(same.status).toBe(422);
    const none = await post({
      kind: 'transfer',
      warehouseId: WH_SALON,
      lines: [{ itemId: OIL, quantity: '1' }],
    });
    expect(none.status).toBe(422);
  });

  it('корректировка: направление и причина обязательны; уменьшение — по FEFO, нехватка — 409', async () => {
    const noReason = await post({
      kind: 'adjustment',
      warehouseId: WH_SALON,
      adjustmentDirection: 'decrease',
      lines: [{ itemId: CREAM, quantity: '2' }],
    });
    expect(noReason.status).toBe(422);
    expect(body<{ violations: Json[] }>(noReason).violations[0]).toMatchObject({ field: 'reason' });
    const noDir = await post({
      kind: 'adjustment',
      warehouseId: WH_SALON,
      reason: 'Пролив',
      lines: [{ itemId: CREAM, quantity: '2' }],
    });
    expect(body<{ violations: Json[] }>(noDir).violations[0]).toMatchObject({
      field: 'adjustmentDirection',
    });
    const down = await post({
      kind: 'adjustment',
      warehouseId: WH_SALON,
      adjustmentDirection: 'decrease',
      reason: 'Пролив',
      lines: [{ itemId: CREAM, quantity: '2' }],
    });
    expect(down.status).toBe(201);
    expect((await balance(WH_SALON, CREAM)).onHand).toBe('10');
    const up = await post({
      kind: 'adjustment',
      warehouseId: WH_SALON,
      adjustmentDirection: 'increase',
      reason: 'Пересчёт',
      lines: [{ itemId: CREAM, quantity: '5', expiresOn: '2027-01-31' }],
    });
    expect(up.status).toBe(201);
    expect((await balance(WH_SALON, CREAM)).onHand).toBe('15');
    const over = await post({
      kind: 'adjustment',
      warehouseId: WH_SALON,
      adjustmentDirection: 'decrease',
      reason: 'Списание',
      lines: [{ itemId: CREAM, quantity: '100' }],
    });
    expect(reasonOf(over)).toBe('insufficient_stock');
  });

  it('сторно: причина обязательна, возвращает остаток, повторное — 409, сторно сторно нельзя', async () => {
    const issued = body<{ id: string; lines: Line[] }>(
      await post({
        kind: 'issue',
        warehouseId: WH_SALON,
        lines: [{ itemId: OIL, quantity: '30' }],
      }),
    );
    const bad = await post({
      kind: 'reversal',
      warehouseId: WH_SALON,
      reversesMovementId: issued.id,
      lines: issued.lines,
    });
    expect(bad.status).toBe(422);
    expect(body<{ violations: Json[] }>(bad).violations[0]).toMatchObject({ field: 'reason' });
    const ok = await post({
      kind: 'reversal',
      warehouseId: WH_SALON,
      reversesMovementId: issued.id,
      reason: 'Ошибочное списание',
      lines: issued.lines,
    });
    expect(ok.status).toBe(201);
    expect((await balance(WH_SALON, OIL)).onHand).toBe('250');
    const again = await post({
      kind: 'reversal',
      warehouseId: WH_SALON,
      reversesMovementId: issued.id,
      reason: 'Ещё раз',
      lines: issued.lines,
    });
    expect(again.status).toBe(409);
    expect(body(again).code).toBe('invalid_transition');
    const rev = body<{ id: string }>(ok);
    const twice = await post({
      kind: 'reversal',
      warehouseId: WH_SALON,
      reversesMovementId: rev.id,
      reason: 'Сторно сторно',
      lines: issued.lines,
    });
    expect(twice.status).toBe(409);
    const nobody = await post({
      kind: 'reversal',
      warehouseId: WH_SALON,
      reversesMovementId: MISSING,
      reason: 'Нет такого',
      lines: issued.lines,
    });
    expect(nobody.status).toBe(404);
  });
});

describe('резервы', () => {
  it('сид: активный резерв записи SPA и снятый; фильтр по статусу', async () => {
    const all = body<{ items: { status: string; lines: Line[] }[] }>(
      await owner.get(`${base}/reservations`),
    ).items;
    expect(all.map((r) => r.status).sort()).toEqual(['active', 'released']);
    const active = body<{ items: Json[] }>(
      await owner.get(`${base}/reservations?status=active`),
    ).items;
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      warehouseId: WH_SALON,
      source: { moduleKey: 'spa', entityType: 'appointment' },
      lines: [{ itemId: OIL, quantity: '30' }],
    });
  });

  it('создание уменьшает доступное; больше доступного — 409 insufficient_stock; снятие возвращает', async () => {
    const source = { moduleKey: 'spa', entityType: 'appointment', entityId: A('ap-w511') };
    const ok = await owner.post(`${base}/reservations`, {
      warehouseId: WH_SALON,
      source,
      lines: [{ itemId: OIL, quantity: '190' }],
    });
    expect(ok.status).toBe(201);
    expect(body(ok)).toMatchObject({ status: 'active', revision: 1 });
    expect((await balance(WH_SALON, OIL)).available).toBe('30');
    const over = await owner.post(`${base}/reservations`, {
      warehouseId: WH_SALON,
      source,
      lines: [{ itemId: OIL, quantity: '31' }],
    });
    expect(over.status).toBe(409);
    expect(reasonOf(over)).toBe('insufficient_stock');
    const id = body<{ id: string }>(ok).id;
    const rel = await owner.post(`${base}/reservations/${id}/release`);
    expect(rel.status).toBe(200);
    expect(body(rel)).toMatchObject({ status: 'released', revision: 2 });
    expect((await balance(WH_SALON, OIL)).available).toBe('220');
    const again = await owner.post(`${base}/reservations/${id}/release`);
    expect(again.status).toBe(409);
    expect(reasonOf(again)).toBe('reservation_not_active');
    expect((await owner.post(`${base}/reservations/${MISSING}/release`)).status).toBe(404);
  });

  it('расход не трогает резерв: остаток после расхода не меньше резерва не требуется, доступное считается заново', async () => {
    await post({ kind: 'issue', warehouseId: WH_SALON, lines: [{ itemId: OIL, quantity: '100' }] });
    const b = await balance(WH_SALON, OIL);
    expect([b.onHand, b.reserved, b.available]).toEqual(['150', '30', '120']);
  });
});
