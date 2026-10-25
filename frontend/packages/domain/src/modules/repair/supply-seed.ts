// Сид снабжения по объектам (design/Ремонт и стройка.dc.html:914–933, 1020–1030): заявки прорабов,
// склады фирм, остатки, закупка, остатки на объектах и движения. Номенклатура — позиции справочника
// расценок (Q-W4.00-repair-7). Данные дочернего модуля эталона: в срез `db.repair` не входят,
// ими будут владеть операции снабжения (W6.13) поверх общего модуля «Склад» (W5.10).
import type { SupplyRef } from '../../lib/schedule/types.ts';

export type SupplyState = 'request' | 'reserved' | 'ordered' | 'bought' | 'issued' | 'used';

export interface SupplyRequest {
  id: string;
  obj: string;
  /** Позиция справочника расценок; `null` — вне справочника (кабель). */
  mat: string | null;
  item: string;
  n: number;
  unit: string;
  /** Подпись количества: «46 мешков». */
  qty: string;
  /** Нужно к дате `ДД.ММ`. */
  need: string;
  st: SupplyState;
  sum: number;
  /** Номер закупки для `ordered`. */
  pur?: string;
}

const req = (
  id: string,
  obj: string,
  mat: string | null,
  item: string,
  n: number,
  unit: string,
  qty: string,
  need: string,
  st: SupplyState,
  sum: number,
): SupplyRequest => ({ id, obj, mat, item, n, unit, qty, need, st, sum });

export const SUPPLY_REQUESTS = (): SupplyRequest[] => [
  req(
    'З-12',
    'obj-42',
    'm-plaster',
    'Штукатурка гипсовая 30 кг',
    46,
    'меш',
    '46 мешков',
    '08.10',
    'used',
    18_400,
  ),
  req('З-13', 'obj-42', null, 'Кабель ВВГнг 3×2,5', 150, 'м', '150 м', '14.10', 'bought', 13_200),
  req(
    'З-14',
    'obj-42',
    'm-laminate',
    'Ламинат 33 класс',
    52,
    'м²',
    '52 м²',
    '27.10',
    'request',
    70_200,
  ),
  req(
    'З-15',
    'obj-42',
    'm-tile',
    'Плитка керамогранит 60×60',
    18,
    'м²',
    '18 м²',
    '23.10',
    'request',
    32_400,
  ),
  req('З-21', 'obj-38', 'm-skirting', 'Плинтус МДФ', 42, 'м', '42 м', '22.10', 'request', 13_020),
  req(
    'З-22',
    'obj-38',
    'm-paint',
    'Краска интерьерная',
    18,
    'л',
    '18 л',
    '24.10',
    'request',
    9_720,
  ),
  req(
    'З-23',
    'obj-31',
    'm-laminate32',
    'Ламинат 32 класс',
    22,
    'м²',
    '22 м²',
    '21.10',
    'request',
    21_560,
  ),
  req(
    'З-24',
    'obj-45',
    'm-tile',
    'Керамогранит 60×60',
    70,
    'м²',
    '70 м²',
    '03.11',
    'request',
    126_000,
  ),
  req(
    'З-25',
    'obj-45',
    'm-paint',
    'Краска интерьерная',
    40,
    'л',
    '40 л',
    '05.11',
    'request',
    21_600,
  ),
];

/** Сокращённые названия объектов в снабжении (`OBJN`). */
export const OBJECT_SHORT_NAMES: Readonly<Record<string, string>> = {
  'obj-42': 'ЖК Речной · кв. 42',
  'obj-38': 'ЖК Северный парк · кв. 117',
  'obj-31': 'Профсоюзная, 64 · кв. 210',
  'obj-45': 'Кофейня на Покровке',
  'obj-27': 'Дом на Лесной · Мытищи',
};

export interface Warehouse {
  id: string;
  name: string;
  firm: string;
}

export const WAREHOUSES: readonly Warehouse[] = [
  { id: 'wh-msk', name: 'Москва · Отрадное', firm: 'Альта Север' },
  { id: 'wh-mo', name: 'Мытищи', firm: 'Альта Область' },
];

export const SUPPLIERS: readonly string[] = ['СтройБаза Север', 'ПолМаркет', 'КерамТорг'];

export interface StockRow {
  wh: string;
  mat: string;
  qty: number;
  /** В резерве под заявки. */
  res: number;
  /** Средняя цена закупки. */
  cost: number;
}

export const STOCK = (): StockRow[] => [
  { wh: 'wh-msk', mat: 'm-skirting', qty: 60, res: 0, cost: 265 },
  { wh: 'wh-msk', mat: 'm-primer', qty: 40, res: 0, cost: 78 },
  { wh: 'wh-msk', mat: 'm-plaster', qty: 12, res: 0, cost: 345 },
  { wh: 'wh-msk', mat: 'm-paint', qty: 10, res: 0, cost: 460 },
  { wh: 'wh-mo', mat: 'm-laminate32', qty: 40, res: 0, cost: 840 },
  { wh: 'wh-mo', mat: 'm-tile', qty: 6, res: 0, cost: 1540 },
];

export interface OnObjectRow {
  id: string;
  obj: string;
  mat: string;
  qty: number;
  cost: number;
}

export const ON_OBJECT = (): OnObjectRow[] => [
  { id: 'oo1', obj: 'obj-27', mat: 'm-tile', qty: 4, cost: 1540 },
  { id: 'oo2', obj: 'obj-27', mat: 'm-primer', qty: 12, cost: 78 },
  { id: 'oo3', obj: 'obj-31', mat: 'm-skirting', qty: 8, cost: 265 },
];

export interface PurchaseLine {
  req: string;
  obj: string;
  mat: string | null;
  item: string;
  n: number;
  unit: string;
  price: number;
}

export interface Purchase {
  id: string;
  supplier: string;
  at: string;
  st: 'ordered' | 'received';
  lines: PurchaseLine[];
}

export const PURCHASES = (): Purchase[] => [
  {
    id: 'ЗК-6',
    supplier: 'СтройБаза Север',
    at: '14.10',
    st: 'received',
    lines: [
      {
        req: 'З-13',
        obj: 'obj-42',
        mat: null,
        item: 'Кабель ВВГнг 3×2,5',
        n: 150,
        unit: 'м',
        price: 88,
      },
    ],
  },
];

export type MovementKind = 'receipt' | 'buy' | 'issue' | 'return' | 'move' | 'use';

export interface Movement {
  id: string;
  at: string;
  kind: MovementKind;
  item: string;
  qty: number;
  unit: string;
  from: string;
  to: string;
  sum: number;
  by: string;
}

export const MOVEMENTS = (): Movement[] => [
  {
    id: 'Д-30',
    at: '14.10',
    kind: 'buy',
    item: 'Кабель ВВГнг 3×2,5',
    qty: 150,
    unit: 'м',
    from: 'СтройБаза Север',
    to: 'ЖК Речной · кв. 42',
    sum: 13_200,
    by: 'Снабженец · чек по QR',
  },
  {
    id: 'Д-29',
    at: '08.10',
    kind: 'buy',
    item: 'Штукатурка гипсовая 30 кг',
    qty: 46,
    unit: 'меш',
    from: 'СтройБаза Север',
    to: 'ЖК Речной · кв. 42',
    sum: 18_400,
    by: 'Снабженец · чек по QR',
  },
  {
    id: 'Д-28',
    at: '02.10',
    kind: 'receipt',
    item: 'Плинтус МДФ',
    qty: 60,
    unit: 'м',
    from: 'ПолМаркет',
    to: 'Склад «Москва · Отрадное»',
    sum: 15_900,
    by: 'Снабженец',
  },
  {
    id: 'Д-27',
    at: '12.09',
    kind: 'return',
    item: 'Ламинат 32 класс',
    qty: 40,
    unit: 'м²',
    from: 'Дом на Лесной · Мытищи',
    to: 'Склад «Мытищи»',
    sum: 33_600,
    by: 'Прораб сдал, кладовщик принял',
  },
];

/** Заявка снабжения, привязанная к этапу графика, в форме библиотеки графика. */
export function stageSupply(
  id: string | undefined,
  requests: readonly SupplyRequest[],
): SupplyRef | null {
  const r = id ? requests.find((x) => x.id === id) : undefined;
  if (!r) return null;
  return {
    id: r.id,
    st: r.st,
    item: r.item,
    qty: r.qty,
    ...(r.pur ? { pur: r.pur } : {}),
  };
}
