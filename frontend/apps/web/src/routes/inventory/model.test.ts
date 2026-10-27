// W5.11 · Модель страниц склада (экраны inventory-stock, inventory-movements; no-reference, B-6): подписи единиц,
// количества Quantity контракта (десятичная строка) для показа и ввода, срок годности партий (FEFO), строки остатков,
// подписи движений и причины отказа 409 invalid_transition.
import { ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  type Balance,
  canReverse,
  dateRu,
  fieldErrors,
  isExpired,
  itemETag,
  lotLabel,
  moveKindLabel,
  moveSign,
  parseQuantity,
  qty,
  reasonOf,
  sourceLabel,
  stockRows,
  todayMsk,
  unitLabel,
  violationOf,
} from './model.ts';

const NB = ' ';
const id = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, '0')}`;

describe('единицы и количества', () => {
  it('единицы измерения контракта — по-русски', () => {
    expect(['ml', 'g', 'piece', 'litre', 'kg'].map((u) => unitLabel(u as never))).toEqual([
      'мл',
      'г',
      'шт.',
      'л',
      'кг',
    ]);
  });

  it('показ количества: запятая, пробел-разделитель тысяч, неразрывный пробел перед единицей', () => {
    expect(qty('250', 'ml')).toBe(`250${NB}мл`);
    expect(qty('40.5', 'g')).toBe(`40,5${NB}г`);
    expect(qty('1250.125', 'kg')).toBe(`1${NB}250,125${NB}кг`);
    expect(qty('0', 'piece')).toBe(`0${NB}шт.`);
  });

  it('ввод количества: запятая или точка, больше нуля, не более шести знаков', () => {
    expect(parseQuantity('40,5')).toBe('40.5');
    expect(parseQuantity(' 12 ')).toBe('12');
    expect(parseQuantity('0.000001')).toBe('0.000001');
    expect(parseQuantity('007')).toBe('7');
    for (const bad of ['', '0', '0,0', '-1', 'abc', '1,2,3', '1.1234567', '1e3']) {
      expect(parseQuantity(bad), bad).toBeNull();
    }
  });

  it('минимальный уровень допускает ноль', () => {
    expect(parseQuantity('0', { zero: true })).toBe('0');
    expect(parseQuantity('', { zero: true })).toBeNull();
  });
});

describe('срок годности и партии (FEFO)', () => {
  it('«сегодня» по Москве: 02:30 МСК 1 октября — ещё 1 октября', () => {
    expect(todayMsk(Date.parse('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
    expect(todayMsk(Date.parse('2026-10-01T07:30:00Z'))).toBe('2026-10-01');
  });

  it('просрочена только партия со сроком раньше сегодняшнего дня', () => {
    expect(isExpired('2026-09-30', '2026-10-01')).toBe(true);
    expect(isExpired('2026-10-01', '2026-10-01')).toBe(false);
    expect(isExpired(null, '2026-10-01')).toBe(false);
  });

  it('подпись партии: «до дд.мм.гггг», «Без срока», просрочена — с признаком', () => {
    expect(dateRu('2026-11-05')).toBe('05.11.2026');
    expect(lotLabel('2026-11-15', '2026-10-01')).toEqual({ text: 'до 15.11.2026', expired: false });
    expect(lotLabel(null, '2026-10-01')).toEqual({ text: 'Без срока', expired: false });
    expect(lotLabel('2026-09-20', '2026-10-01')).toEqual({ text: 'до 20.09.2026', expired: true });
  });
});

describe('строки остатков', () => {
  const warehouses = [
    { id: id(1), orgUnitId: id(9), name: 'Склад салона', archived: false, revision: 1 },
    { id: id(2), orgUnitId: id(9), name: 'Склад № 1', archived: false, revision: 1 },
  ];
  const items = [
    {
      id: id(10),
      orgUnitId: id(9),
      name: 'Масло',
      sku: 'OIL',
      baseUnit: 'ml' as const,
      trackLots: true,
      revision: 3,
    },
  ];
  const bal = (warehouseId: string, itemId: string): Balance => ({
    warehouseId,
    itemId,
    onHand: '10',
    reserved: '0',
    available: '10',
    minLevel: null,
    belowMinimum: false,
    lots: [],
  });

  it('склеивает остаток с позицией и складом в порядке сервера; чужие и неизвестные пропускает', () => {
    const rows = stockRows(
      [bal(id(2), id(10)), bal(id(1), id(10)), bal(id(1), id(99)), bal(id(77), id(10))],
      items,
      warehouses,
    );
    expect(rows.map((r) => [r.item.name, r.warehouse.name])).toEqual([
      ['Масло', 'Склад № 1'],
      ['Масло', 'Склад салона'],
    ]);
    expect(rows[0]?.key).toBe(`${id(2)}:${id(10)}`);
  });

  it('If-Match позиции — "rev-<ревизия>"', () => {
    expect(itemETag(items[0] as never)).toBe('"rev-3"');
  });
});

describe('движения', () => {
  it('подписи и знаки видов; сторно и корректировка без знака (направления нет в ответе, Q-W5.11-6)', () => {
    expect(
      (['receipt', 'issue', 'transfer', 'adjustment', 'reversal'] as const).map(moveKindLabel),
    ).toEqual(['Приход', 'Расход', 'Перемещение', 'Корректировка', 'Сторно']);
    expect(
      (['receipt', 'issue', 'transfer', 'adjustment', 'reversal'] as const).map(moveSign),
    ).toEqual(['+', '−', '→', '', '']);
  });

  it('сторнировать можно всё, кроме самого сторно', () => {
    expect(canReverse({ kind: 'issue' } as never)).toBe(true);
    expect(canReverse({ kind: 'reversal' } as never)).toBe(false);
  });

  it('основание: модуль и вид объекта по-русски, неизвестные — как есть', () => {
    expect(sourceLabel({ moduleKey: 'spa', entityType: 'appointment', entityId: id(1) })).toBe(
      'Салон и SPA · запись',
    );
    expect(sourceLabel({ moduleKey: 'repairs', entityType: 'purchase', entityId: id(1) })).toBe(
      'Ремонт и стройка · закупка',
    );
    expect(sourceLabel({ moduleKey: 'zzz', entityType: 'thing', entityId: id(1) })).toBe(
      'zzz · thing',
    );
    expect(sourceLabel(undefined)).toBe('');
  });
});

describe('ошибки полей 422', () => {
  const invalid = (
    violations: { field: string; code: string; message: string }[],
    detail?: string,
  ) =>
    new ProblemError(422, {
      type: 'x',
      title: 'x',
      status: 422,
      code: 'validation_failed',
      requestId: 'r',
      ...(detail ? { detail } : {}),
      violations,
    } as never);

  it('нарушения по полям формы: текст сервера под своим полем, чужие поля пропускаются', () => {
    const e = invalid([
      { field: 'sku', code: 'duplicate', message: 'Позиция с таким артикулом уже есть' },
      { field: 'zzz', code: 'x', message: 'чужое' },
    ]);
    expect(fieldErrors(e, ['name', 'sku'])).toEqual({ sku: 'Позиция с таким артикулом уже есть' });
  });

  it('сервер без violations (problem.Body): detail без точки — под первым полем списка', () => {
    expect(fieldErrors(invalid([], 'Артикул занят.'), ['sku', 'name'])).toEqual({
      sku: 'Артикул занят',
    });
    expect(fieldErrors(invalid([]), ['sku'])).toEqual({ sku: 'Проверьте заполнение полей.' });
  });

  it('не 422 — пусто (ошибку показывает тост)', () => {
    expect(fieldErrors(new Error('x'), ['sku'])).toEqual({});
    expect(violationOf(invalid([{ field: 'sku', code: 'c', message: 'm' }]), 'sku')).toBe('m');
    expect(violationOf(invalid([]), 'sku')).toBeNull();
  });
});

describe('причина отказа 409', () => {
  const problem = (reason: string | undefined): ProblemError =>
    new ProblemError(409, {
      type: 'x',
      title: 'x',
      status: 409,
      code: 'invalid_transition',
      requestId: 'r',
      ...(reason ? { reason } : {}),
    } as never);

  it('читает reason из Problem; чужую причину и не-409 не знает', () => {
    expect(reasonOf(problem('insufficient_stock'))).toBe('insufficient_stock');
    expect(reasonOf(problem('lot_expired'))).toBe('lot_expired');
    expect(reasonOf(problem('reservation_not_active'))).toBe('reservation_not_active');
    expect(reasonOf(problem('shift_not_open'))).toBeNull();
    expect(reasonOf(problem(undefined))).toBeNull();
    expect(reasonOf(new Error('x'))).toBeNull();
  });
});
