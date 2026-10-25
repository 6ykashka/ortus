import { describe, expect, it } from 'vitest';
import { FN_LIST, FN_SIG, colName, inRange, keyOf, parseKey, rangeKeys } from './refs.ts';

describe('colName / keyOf', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, '?'],
    [-1, '?'],
  ])('colName(%i) = %s', (i, want) => {
    expect(colName(i)).toBe(want);
  });
  it('keyOf склеивает столбец и строку', () => {
    expect(keyOf(0, 1)).toBe('A1');
    expect(keyOf(25, 16)).toBe('Z16');
  });
});

describe('parseKey', () => {
  it.each([
    ['B3', { c: 1, r: 3 }],
    ['b3', { c: 1, r: 3 }],
    ['$C$12', { c: 2, r: 12 }],
    ['Z1', { c: 25, r: 1 }],
    ['AA1', null],
    ['A', null],
    ['1A', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('parseKey(%j)', (k, want) => {
    expect(parseKey(k)).toEqual(want);
  });
});

describe('rangeKeys', () => {
  it('перечисляет построчно слева направо', () => {
    expect(rangeKeys('A1', 'B2')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
  it('нормализует перевёрнутый диапазон', () => {
    expect(rangeKeys('B2', 'A1')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
  it('без второго конца — одна ячейка', () => {
    expect(rangeKeys('C3')).toEqual(['C3']);
  });
  it('неверная ссылка — пустой список', () => {
    expect(rangeKeys('AA1', 'B2')).toEqual([]);
    expect(rangeKeys('A1', 'zz')).toEqual([]);
  });
});

describe('inRange', () => {
  it.each([
    ['B2', 'A1:C3', true],
    ['D2', 'A1:C3', false],
    ['B4', 'A1:C3', false],
    ['B2', 'C3:A1', true],
    ['A1', 'A1', true],
    ['A2', 'A1', false],
    ['AA1', 'A1:C3', false],
    ['A1', 'A1:ZZ', false],
    ['b2', 'a1:c3', true],
  ])('inRange(%s, %s) = %s', (key, range, want) => {
    expect(inRange(key, range)).toBe(want);
  });
});

describe('FN_LIST / FN_SIG', () => {
  it('20 функций, пары RU/EN и описание', () => {
    expect(FN_LIST).toHaveLength(20);
    expect(FN_LIST[0]).toEqual(['СУММ', 'SUM', 'Сумма чисел']);
    expect(FN_LIST[19]).toEqual(['СЦЕП', 'CONCAT', 'Объединить текст']);
    expect(FN_LIST.map(([ru]) => ru)).toContain('СЧЁТЕСЛИМН');
  });
  it('подпись есть у каждой функции списка', () => {
    for (const [ru] of FN_LIST) expect(FN_SIG[ru], ru).toMatch(new RegExp('^' + ru + '\\('));
    expect(Object.keys(FN_SIG)).toHaveLength(20);
    expect(FN_SIG['ЕСЛИ']).toBe('ЕСЛИ(условие; [значение_если_истина]; [значение_если_ложь])');
  });
});