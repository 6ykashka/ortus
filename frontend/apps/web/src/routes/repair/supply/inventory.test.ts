// W6.22 · Строки «Остатков» и «Движений» складов по контракту «Склада» (InventoryBalance, InventoryMovement):
// эталон :793–825 с колонками `Остаток · В резерве · Свободно` и журналом `№ · дата · Операция · Материал · Откуда → куда`.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { movementRows, stockRows, warehouseChoices } from './inventory.ts';

type S = components['schemas'];

const items: S['InventoryItem'][] = [
  {
    id: 'i-1',
    orgUnitId: 'u',
    name: 'Плинтус МДФ',
    sku: 'm-skirting',
    baseUnit: 'piece',
    trackLots: false,
    revision: 1,
  },
  {
    id: 'i-2',
    orgUnitId: 'u',
    name: 'Грунтовка',
    sku: 'm-primer',
    baseUnit: 'litre',
    trackLots: false,
    revision: 1,
  },
];
const warehouses: S['Warehouse'][] = [
  { id: 'w-1', orgUnitId: 'u', name: 'Москва · Отрадное', archived: false, revision: 1 },
  { id: 'w-2', orgUnitId: 'u', name: 'Мытищи', archived: false, revision: 1 },
];
const balance = (o: Partial<S['InventoryBalance']>): S['InventoryBalance'] => ({
  warehouseId: 'w-1',
  itemId: 'i-1',
  onHand: '60',
  reserved: '0',
  available: '60',
  belowMinimum: false,
  lots: [],
  ...o,
});

describe('остатки складов', () => {
  it('строка: материал, склад, остаток, резерв («—» без резерва), свободно', () => {
    const rows = stockRows(
      [
        balance({}),
        balance({
          warehouseId: 'w-2',
          itemId: 'i-2',
          onHand: '40',
          reserved: '12',
          available: '28',
        }),
      ],
      items,
      warehouses,
      'all',
    );
    expect(rows).toEqual([
      {
        key: 'w-1:i-1',
        item: 'Плинтус МДФ',
        warehouse: 'Москва · Отрадное',
        onHand: '60 шт',
        reserved: '—',
        free: '60 шт',
      },
      {
        key: 'w-2:i-2',
        item: 'Грунтовка',
        warehouse: 'Мытищи',
        onHand: '40 л',
        reserved: '12 л',
        free: '28 л',
      },
    ]);
  });

  it('фильтр по складу', () => {
    const rows = stockRows(
      [balance({}), balance({ warehouseId: 'w-2' })],
      items,
      warehouses,
      'w-2',
    );
    expect(rows.map((r) => r.key)).toEqual(['w-2:i-1']);
  });

  it('склад и материал вне справочников — «—»', () => {
    const [r] = stockRows([balance({ warehouseId: 'x', itemId: 'y' })], items, warehouses, 'all');
    expect(r).toMatchObject({ item: '—', warehouse: '—' });
  });
});

describe('движения складов', () => {
  const mv = (o: Partial<S['InventoryMovement']>): S['InventoryMovement'] => ({
    id: 'mv-1',
    kind: 'receipt',
    warehouseId: 'w-1',
    lines: [{ itemId: 'i-1', quantity: '60' }],
    postedAt: '2026-10-02T08:00:00Z',
    ...o,
  });

  it('приход, выдача и перемещение: подписи видов, материал, маршрут, дата', () => {
    const rows = movementRows(
      [
        mv({}),
        mv({ id: 'mv-2', kind: 'issue', lines: [{ itemId: 'i-2', quantity: '3' }] }),
        mv({ id: 'mv-3', kind: 'transfer', targetWarehouseId: 'w-2' }),
      ],
      items,
      warehouses,
    );
    expect(rows.map((r) => [r.kind.label, r.item, r.route, r.at])).toEqual([
      ['Приход на склад', 'Плинтус МДФ · 60 шт', '→ Склад «Москва · Отрадное»', '02.10'],
      ['Выдача со склада', 'Грунтовка · 3 л', 'Склад «Москва · Отрадное» →', '02.10'],
      ['Перемещение', 'Плинтус МДФ · 60 шт', 'Склад «Москва · Отрадное» → Склад «Мытищи»', '02.10'],
    ]);
    expect(rows[0]?.kind.tone).toBe('info');
  });

  it('несколько строк движения — по строке на материал', () => {
    const rows = movementRows(
      [
        mv({
          lines: [
            { itemId: 'i-1', quantity: '1' },
            { itemId: 'i-2', quantity: '2' },
          ],
        }),
      ],
      items,
      warehouses,
    );
    expect(rows.map((r) => r.item)).toEqual(['Плинтус МДФ · 1 шт', 'Грунтовка · 2 л']);
    expect(rows.map((r) => r.key)).toEqual(['mv-1:0', 'mv-1:1']);
  });
});

describe('склады для возврата остатка', () => {
  it('из модуля «Склад»; архивные не берутся', () => {
    const live = {
      id: 'w-1',
      orgUnitId: 'u',
      name: 'Москва · Отрадное',
      archived: false,
      revision: 1,
    };
    const old = { id: 'w-2', orgUnitId: 'u', name: 'Мытищи', archived: true, revision: 1 };
    expect(warehouseChoices({ status: 'ok', items: [live, old] }, new Map())).toEqual([
      { id: 'w-1', name: 'Москва · Отрадное' },
    ]);
  });

  it('склады из заявок (available) дополняют список «Склада», архивный не возвращается', () => {
    const live = { id: 'w-1', orgUnitId: 'u', name: 'Склад салона', archived: false, revision: 1 };
    const old = { id: 'w-2', orgUnitId: 'u', name: 'Старый', archived: true, revision: 1 };
    expect(
      warehouseChoices(
        { status: 'ok', items: [live, old] },
        new Map([
          ['w-3', 'Мытищи'],
          ['w-2', 'Старый'],
          ['w-1', 'Склад салона'],
        ]),
      ),
    ).toEqual([
      { id: 'w-3', name: 'Мытищи' },
      { id: 'w-1', name: 'Склад салона' },
    ]);
  });
  it('без модуля — из складов, замеченных в заявках (available)', () => {
    expect(
      warehouseChoices(
        { status: 'unavailable' },
        new Map([
          ['w-2', 'Мытищи'],
          ['w-1', 'Москва · Отрадное'],
        ]),
      ),
    ).toEqual([
      { id: 'w-1', name: 'Москва · Отрадное' },
      { id: 'w-2', name: 'Мытищи' },
    ]);
  });
});
