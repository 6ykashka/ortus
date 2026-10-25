// Сид снабжения по объектам (design/Ремонт и стройка.dc.html:914–933, 1020–1030): заявки, склады,
// остатки, закупка, остатки на объектах и движения.
import { describe, expect, it } from 'vitest';
import { MOVEMENT_KINDS, SUPPLY_CHIPS } from './dictionaries.ts';
import { CATALOG } from './estimate-seed.ts';
import {
  MOVEMENTS,
  ON_OBJECT,
  OBJECT_SHORT_NAMES,
  PURCHASES,
  STOCK,
  SUPPLIERS,
  SUPPLY_REQUESTS,
  WAREHOUSES,
  stageSupply,
} from './supply-seed.ts';

describe('заявки на материалы', () => {
  it('девять заявок: З-12…З-15 по кв. 42, З-21…З-25 по остальным; суммы', () => {
    expect(SUPPLY_REQUESTS().map((r) => [r.id, r.obj, r.st, r.sum])).toEqual([
      ['З-12', 'obj-42', 'used', 18_400],
      ['З-13', 'obj-42', 'bought', 13_200],
      ['З-14', 'obj-42', 'request', 70_200],
      ['З-15', 'obj-42', 'request', 32_400],
      ['З-21', 'obj-38', 'request', 13_020],
      ['З-22', 'obj-38', 'request', 9_720],
      ['З-23', 'obj-31', 'request', 21_560],
      ['З-24', 'obj-45', 'request', 126_000],
      ['З-25', 'obj-45', 'request', 21_600],
    ]);
  });

  it('номенклатура — позиции справочника расценок (Q-W4.00-repair-7), кроме кабеля З-13', () => {
    const ids = new Set(CATALOG.map((c) => c.id));
    for (const r of SUPPLY_REQUESTS()) {
      if (r.mat) expect(ids.has(r.mat), r.id).toBe(true);
    }
    expect(SUPPLY_REQUESTS().find((r) => r.id === 'З-13')?.mat).toBeNull();
  });

  it('ждут решения снабжения: семь заявок по четырём объектам', () => {
    const waiting = SUPPLY_REQUESTS().filter((r) => r.st === 'request');
    expect(waiting).toHaveLength(7);
    const by: Record<string, number> = {};
    for (const r of waiting) by[r.obj] = (by[r.obj] ?? 0) + 1;
    expect(by).toEqual({
      'obj-42': 2,
      'obj-38': 2,
      'obj-31': 1,
      'obj-45': 2,
    });
  });

  it('каждый вызов — копия', () => {
    const a = SUPPLY_REQUESTS();
    const first = a[0];
    if (first) first.st = 'request';
    expect(SUPPLY_REQUESTS()[0]?.st).toBe('used');
  });
});

describe('склады, остатки, закупки, движения', () => {
  it('два склада двух фирм; три поставщика', () => {
    expect(WAREHOUSES).toEqual([
      { id: 'wh-msk', name: 'Москва · Отрадное', firm: 'Альта Север' },
      { id: 'wh-mo', name: 'Мытищи', firm: 'Альта Область' },
    ]);
    expect(SUPPLIERS).toEqual(['СтройБаза Север', 'ПолМаркет', 'КерамТорг']);
  });

  it('остатки: шесть позиций; стоимость по средней цене закупки', () => {
    expect(STOCK()).toHaveLength(6);
    const total = STOCK().reduce((a, s) => a + s.qty * s.cost, 0);
    expect(total).toBe(60 * 265 + 40 * 78 + 12 * 345 + 10 * 460 + 40 * 840 + 6 * 1540);
    expect(STOCK().every((s) => s.res === 0)).toBe(true);
  });

  it('остатки на объектах: сданный дом на Лесной и профсоюзная', () => {
    expect(ON_OBJECT().map((o) => [o.id, o.obj, o.mat, o.qty, o.cost])).toEqual([
      ['oo1', 'obj-27', 'm-tile', 4, 1540],
      ['oo2', 'obj-27', 'm-primer', 12, 78],
      ['oo3', 'obj-31', 'm-skirting', 8, 265],
    ]);
  });

  it('закупка ЗК-6: кабель на кв. 42, 150 м по 88 ₽ = 13 200 ₽, получена', () => {
    const [p] = PURCHASES();
    expect(p).toMatchObject({ id: 'ЗК-6', supplier: 'СтройБаза Север', st: 'received' });
    expect(p?.lines.reduce((a, l) => a + l.n * l.price, 0)).toBe(13_200);
  });

  it('четыре движения: Д-30…Д-27; виды известны', () => {
    expect(MOVEMENTS().map((m) => [m.id, m.kind, m.sum])).toEqual([
      ['Д-30', 'buy', 13_200],
      ['Д-29', 'buy', 18_400],
      ['Д-28', 'receipt', 15_900],
      ['Д-27', 'return', 33_600],
    ]);
    for (const m of MOVEMENTS()) expect(MOVEMENT_KINDS).toHaveProperty(m.kind);
  });

  it('сокращённые названия объектов для снабжения', () => {
    expect(OBJECT_SHORT_NAMES['obj-42']).toBe('ЖК Речной · кв. 42');
    expect(Object.keys(OBJECT_SHORT_NAMES)).toEqual([
      'obj-42',
      'obj-38',
      'obj-31',
      'obj-45',
      'obj-27',
    ]);
  });
});

describe('справочники статусов', () => {
  it('статусы заявки: подписи дословно', () => {
    expect(Object.fromEntries(Object.entries(SUPPLY_CHIPS).map(([k, v]) => [k, v.label]))).toEqual({
      request: 'Ждёт решения снабжения',
      reserved: 'К выдаче со склада',
      ordered: 'В закупке',
      bought: 'Закуплено',
      issued: 'Выдано со склада',
      used: 'Списано на объект',
    });
  });

  it('виды движений склада', () => {
    expect(
      Object.fromEntries(Object.entries(MOVEMENT_KINDS).map(([k, v]) => [k, v.label])),
    ).toEqual({
      receipt: 'Приход на склад',
      buy: 'Закупка на объект',
      issue: 'Выдача со склада',
      return: 'Возврат на склад',
      move: 'Перемещение',
      use: 'Списание в работу',
    });
  });
});

describe('заявка этапа графика', () => {
  it('этап ссылается на заявку по номеру; нет ссылки — null', () => {
    const reqs = SUPPLY_REQUESTS();
    expect(stageSupply('З-15', reqs)).toEqual({
      id: 'З-15',
      st: 'request',
      item: 'Плитка керамогранит 60×60',
      qty: '18 м²',
    });
    expect(stageSupply('З-99', reqs)).toBeNull();
    expect(stageSupply(undefined, reqs)).toBeNull();
  });

  it('заявка в закупке получает номер закупки', () => {
    const reqs = SUPPLY_REQUESTS().map((r) =>
      r.id === 'З-14' ? { ...r, st: 'ordered' as const, pur: 'ЗК-7' } : r,
    );
    expect(stageSupply('З-14', reqs)).toMatchObject({ st: 'ordered', pur: 'ЗК-7' });
  });
});
