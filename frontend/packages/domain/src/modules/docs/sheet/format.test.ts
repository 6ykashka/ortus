import { describe, expect, it } from 'vitest';
import { csvCells, fmtVal, gridOf, rawOf } from './format.ts';

const NB = ' ';

describe('fmtVal', () => {
  it.each([
    [null, undefined, ''],
    [undefined, undefined, ''],
    ['', 'n0', ''],
    [true, undefined, 'ИСТИНА'],
    [false, 'n0', 'ЛОЖЬ'],
    [{ err: '#ДЕЛ/0!' }, 'rub', '#ДЕЛ/0!'],
    ['текст', 'n0', 'текст'],
    [0.041667, 'dpct', '+4,2 %'],
    [-0.05, 'dpct', '-5,0 %'],
    [0, 'dpct', '0,0 %'],
    [0.5, 'pct', '50,0 %'],
    [56405, 'n0', '56' + NB + '405'],
    [12.56, 'n0', '13'],
    [12.54, 'n1', '12,5'],
    [1234.5, 'rub', '1' + NB + '235 ₽'],
    [12.5, undefined, '12,5'],
    [13.75, undefined, '13,75'],
    [3, undefined, '3'],
    [1234.567, 'unknown', '1' + NB + '234,57'],
    [0, undefined, '0'],
  ])('fmtVal(%j, %s) = %j', (v, fmt, want) => {
    expect(fmtVal(v, fmt)).toBe(want);
  });
});

describe('rawOf', () => {
  it.each([
    [undefined, ''],
    [null, ''],
    [{ f: '=A1+1' }, '=A1+1'],
    [{ f: '=A1', v: 5 }, '=A1'],
    [{ v: 2.5 }, '2,5'],
    [{ v: 7 }, '7'],
    [{ v: 'текст' }, 'текст'],
    [{ v: true }, 'true'],
    [{ v: null }, ''],
    [{}, ''],
  ])('rawOf(%j) = %j', (c, want) => {
    expect(rawOf(c)).toBe(want);
  });
});

describe('gridOf', () => {
  it('пример из анализа: A1=1, B2=A1*2', () => {
    expect(gridOf({ cells: { A1: { v: 1 }, B2: { f: '=A1*2' } } })).toEqual([
      ['1', ''],
      ['', '2'],
    ]);
  });
  it('формат ячейки применяется', () => {
    expect(gridOf({ cells: { A1: { v: 56405, fmt: 'n0' }, B1: { v: 0.5, fmt: 'pct' } } })).toEqual([
      ['56' + NB + '405', '50,0 %'],
    ]);
  });
  it('пустой лист — одна пустая ячейка', () => {
    expect(gridOf({})).toEqual([['']]);
    expect(gridOf({ cells: {} })).toEqual([['']]);
  });
  it('размер ограничен 16 строками и 10 столбцами', () => {
    const g = gridOf({ cells: { Z99: { v: 1 }, A1: { v: 1 } } });
    expect(g).toHaveLength(16);
    expect(g[0]).toHaveLength(10);
  });
  it('ошибки формул показываются кодом', () => {
    expect(gridOf({ cells: { A1: { f: '=1/0' } } })).toEqual([['#ДЕЛ/0!']]);
  });
  it('ключи не ссылки игнорируются при расчёте размера', () => {
    expect(gridOf({ cells: { foo: { v: 1 }, B2: { v: 2 } } })).toEqual([
      ['', ''],
      ['', '2'],
    ]);
  });
});

describe('csvCells', () => {
  it('пустой текст — пустая сетка 20×8', () => {
    expect(csvCells('')).toEqual({ cells: {}, rows: 20, cols: 8 });
    expect(csvCells(null)).toEqual({ cells: {}, rows: 20, cols: 8 });
    expect(csvCells('\n  \n')).toEqual({ cells: {}, rows: 20, cols: 8 });
  });
  it('разделитель «;», числа с запятой, первая строка — заголовок', () => {
    expect(csvCells('Имя;Сумма\nАкция;1 234,5\nИтого;-7')).toEqual({
      cells: {
        A1: { v: 'Имя', st: 'head' },
        B1: { v: 'Сумма', st: 'head' },
        A2: { v: 'Акция' },
        B2: { v: 1234.5 },
        A3: { v: 'Итого' },
        B3: { v: -7 },
      },
      rows: 20,
      cols: 8,
    });
  });
  it('разделитель «,» выбирается, когда запятых в первой строке больше', () => {
    const r = csvCells('a,b,c\n1,2,3');
    expect(r.cells['C2']).toEqual({ v: 3 });
    expect(r.cells['A1']).toEqual({ v: 'a', st: 'head' });
  });
  it('ничья считается «;»', () => {
    expect(csvCells('a\nb').cells['A1']).toEqual({ v: 'a', st: 'head' });
    expect(csvCells('a;b,c').cells['B1']).toEqual({ v: 'b,c', st: 'head' });
  });
  it('кавычки по краям снимаются после обрезки пробелов, пустые ячейки пропускаются', () => {
    const r = csvCells('"x"; ;" y "\r\n;;3');
    expect(r.cells).toEqual({
      A1: { v: 'x', st: 'head' },
      C1: { v: ' y ', st: 'head' },
      C2: { v: 3 },
    });
  });
  it('не число остаётся строкой', () => {
    expect(csvCells('1.2.3;12abc').cells).toEqual({
      A1: { v: '1.2.3', st: 'head' },
      B1: { v: '12abc', st: 'head' },
    });
  });
  it('не больше 200 строк и 26 столбцов; размер сетки растёт', () => {
    const many = Array.from({ length: 250 }, (_, i) => String(i)).join('\n');
    const r = csvCells(many);
    expect(Object.keys(r.cells)).toHaveLength(200);
    expect(r.rows).toBe(205);
    const wide = csvCells(Array.from({ length: 30 }, (_, i) => 'c' + i).join(';'));
    expect(Object.keys(wide.cells)).toHaveLength(26);
    expect(wide.cols).toBe(26);
    expect(csvCells('a;b').cols).toBe(8);
  });
});
