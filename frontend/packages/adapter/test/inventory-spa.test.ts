// W5.11 · Возврат 1: единый склад сценарного сервера. Склад «Салона и SPA» (W5.21: `msw/spa/inventory.ts`, сид эталона —
// масло 250 мл и крем 12 г на «Складе салона») и склад W5.11 (`msw/inventory/`) раньше были двумя хранилищами: реестр
// W5.11 подключался последним и перекрывал SPA-склад, пять conformance-кейсов `spa` падали. Теперь хранилище одно:
//   - по умолчанию сид склада «Альты» — это сид эталона (две позиции, один склад, без резервов);
//   - расширенный сид страниц W5.11 (два склада, партии, просрочка, резерв) — пресет `inventory-ready`;
//   - завершение визита SPA списывает со склада по FEFO и пишет движение с основанием «визит».
import { seedUuid } from '@ortus/domain/seed';
import { beforeEach, describe, expect, it } from 'vitest';

import { createScenarioServer } from '../src/msw/server.ts';
import { Client, type Reply, type Session } from './conformance/client.ts';

const ALTA = seedUuid('platform', 't-alta');
const A = (proto: string): string => seedUuid('t-alta', proto);
const inv = `/api/v1/tenants/${ALTA}/inventory`;
const spa = `/api/v1/tenants/${ALTA}/spa`;

const WH_SPA = A('wh-spa');
const OIL = A('inv-oil');
const CREAM = A('inv-cream');

type Json = Record<string, unknown>;
type Page = { items: Json[] };
const body = <T = Json>(r: Reply): T => r.body as T;

let server: ReturnType<typeof createScenarioServer>;
let owner: Session;
beforeEach(async () => {
  server = createScenarioServer();
  const api = new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) });
  owner = await api.as('owner');
});

const items = async (path: string): Promise<Json[]> => body<Page>(await owner.get(path)).items;

/** Визит: отметка выполнения и завершение со списанием по техкарте. */
async function completeVisit(proto: string, over: Json = {}): Promise<Reply> {
  const cur = body<{ revision: number }>(await owner.get(`${spa}/appointments/${A(proto)}`));
  const done = await owner.post(
    `${spa}/appointments/${A(proto)}/performance`,
    { performedAt: '2026-10-01T07:30:00Z' },
    { ifMatch: cur.revision },
  );
  expect(done.status).toBe(200);
  return owner.post(
    `${spa}/appointments/${A(proto)}/completion`,
    { warehouseId: WH_SPA, overrides: [], ...over },
    { ifMatch: body<{ revision: number }>(done).revision },
  );
}

describe('сид по умолчанию совпадает с сидом эталона (W5.21)', () => {
  it('номенклатура — масло и крем в порядке сида, склад один, остатки 250 и 12 без резерва', async () => {
    expect((await items(`${inv}/items`)).map((i) => [i.id, i.name])).toEqual([
      [OIL, 'Масло массажное'],
      [CREAM, 'Крем восстанавливающий'],
    ]);
    const wh = await items(`${inv}/warehouses`);
    expect(wh.map((w) => [w.id, w.name])).toEqual([[WH_SPA, 'Склад салона']]);
    const bal = await items(`${inv}/balances`);
    expect(bal.map((b) => [b.itemId, b.onHand, b.reserved, b.available])).toEqual([
      [OIL, '250', '0', '250'],
      [CREAM, '12', '0', '12'],
    ]);
  });

  it('остаток масла по партиям: ближайший срок первым', async () => {
    const [b] = await items(`${inv}/balances?itemId=${OIL}`);
    expect((b?.lots as Json[]).map((l) => [l.expiresOn, l.onHand])).toEqual([
      ['2026-11-15', '100'],
      ['2027-03-01', '150'],
    ]);
  });
});

describe('завершение визита SPA и склад W5.11 — одно хранилище', () => {
  it('списание по техкарте 30 мл: остаток 220, движение «Расход» с основанием «визит» в журнале склада', async () => {
    const before = (await items(`${inv}/movements`)).length;
    const r = await completeVisit('ap-1');
    expect(r.status).toBe(200);
    const ids = body<{ inventoryMovementIds: string[] }>(r).inventoryMovementIds;
    expect(ids).toHaveLength(1);
    const [b] = await items(`${inv}/balances?itemId=${OIL}`);
    expect(b).toMatchObject({ onHand: '220', available: '220' });
    expect((b?.lots as Json[]).map((l) => l.onHand)).toEqual(['70', '150']);
    const journal = await items(`${inv}/movements`);
    expect(journal).toHaveLength(before + 1);
    expect(journal.find((m) => m.id === ids[0])).toMatchObject({
      kind: 'issue',
      warehouseId: WH_SPA,
      source: { moduleKey: 'spa', entityType: 'appointment', entityId: A('ap-1') },
    });
  });

  it('нехватка крема на ap-2 — 409 insufficient_stock, склад и журнал не меняются', async () => {
    const before = (await items(`${inv}/movements`)).length;
    const r = await completeVisit('ap-2');
    expect(r.status).toBe(409);
    expect(body(r).reason).toBe('insufficient_stock');
    expect((await items(`${inv}/balances`)).map((b) => b.onHand)).toEqual(['250', '12']);
    expect(await items(`${inv}/movements`)).toHaveLength(before);
  });

  it('сторно списания визита возвращает масло в ту же партию, остаток снова 250', async () => {
    const ids = body<{ inventoryMovementIds: string[] }>(
      await completeVisit('ap-1'),
    ).inventoryMovementIds;
    const issued = (await items(`${inv}/movements`)).find((m) => m.id === ids[0]);
    const rev = await owner.post(`${inv}/movements`, {
      kind: 'reversal',
      warehouseId: WH_SPA,
      reversesMovementId: ids[0],
      reason: 'Визит завершён по ошибке',
      lines: issued?.lines,
    });
    expect(rev.status).toBe(201);
    const [b] = await items(`${inv}/balances?itemId=${OIL}`);
    expect(b).toMatchObject({ onHand: '250' });
  });

  it('позиция, созданная через склад, видна в списке; остатки масла не меняются', async () => {
    const unit = (await items(`${inv}/warehouses`))[0]?.orgUnitId;
    const ok = await owner.post(`${inv}/items`, {
      orgUnitId: unit,
      name: 'Скраб солевой',
      sku: 'SCR-1',
      baseUnit: 'g',
      trackLots: true,
    });
    expect(ok.status).toBe(201);
    expect((await items(`${inv}/items`)).map((i) => i.name)).toEqual([
      'Масло массажное',
      'Крем восстанавливающий',
      'Скраб солевой',
    ]);
  });
});

describe('пресет inventory-ready — расширенный сид страниц склада', () => {
  beforeEach(() => {
    server.applyPreset('inventory-ready');
  });

  it('те же позиции масла и крема (id сида эталона) и «Склад салона» (wh-spa) плюс «Склад № 1»', async () => {
    const wh = await items(`${inv}/warehouses`);
    expect(wh.map((w) => [w.id, w.name])).toEqual([
      [WH_SPA, 'Склад салона'],
      [A('wh-main'), 'Склад № 1'],
    ]);
    const names = (await items(`${inv}/items`)).map((i) => [i.id, i.name]);
    expect(names).toContainEqual([OIL, 'Масло массажное']);
    expect(names).toContainEqual([CREAM, 'Крем восстанавливающий']);
    expect(names).toHaveLength(4);
  });

  it('масло в салоне: 250 в наличии, резерв 30, доступно 220 — как в сиде эталона плюс резерв визита', async () => {
    const [b] = await items(`${inv}/balances?warehouseId=${WH_SPA}&itemId=${OIL}`);
    expect(b).toMatchObject({ onHand: '250', reserved: '30', available: '220' });
  });

  it('завершение визита под пресетом списывает с салона по FEFO и гасит резерв визита', async () => {
    const r = await completeVisit('ap-1');
    expect(r.status).toBe(200);
    const [b] = await items(`${inv}/balances?warehouseId=${WH_SPA}&itemId=${OIL}`);
    expect(b).toMatchObject({ onHand: '220', reserved: '0' });
    expect((b?.lots as Json[]).map((l) => l.onHand)).toEqual(['70', '150']);
  });
});
