// Паритет табличного движка с эталоном 19.10 (`design/ortus/documents.js`): одинаковые входы → одинаковые выходы.
// Эталон только импортируется (`seed/reference.ts`). `lex`, `parse` и `csvCells` в эталоне не экспортируются:
// лексер и парсер сверяются через `checkFormula` и `sheetCompute`, CSV — табличными случаями в `format.test.ts`.
//
// Намеренных расхождений с эталоном нет.
import { beforeAll, describe, expect, it } from 'vitest';
import { importReference } from '../../../seed/reference.ts';
import { sheetCompute, valErr } from './eval.ts';
import { fmtVal, gridOf, rawOf } from './format.ts';
import { FN_LIST, FN_SIG, colName, inRange, keyOf, parseKey, rangeKeys } from './refs.ts';
import { checkFormula } from './syntax.ts';
import type { Sheet, SheetCell } from './types.ts';

interface Ref {
  colName(i: number): string;
  parseKey(k: unknown): unknown;
  keyOf(c: number, r: number): string;
  rangeKeys(a: string, b?: string): string[];
  inRange(k: string, r: string): boolean;
  FN_LIST: unknown;
  FN_SIG: unknown;
  checkFormula(f: unknown): string | null;
  sheetCompute(s: unknown): { get(k: string): unknown };
  fmtVal(v: unknown, f?: string): string;
  valErr(v: unknown): boolean;
  rawOf(c: unknown): string;
  gridOf(s: unknown): string[][];
}

let ref: Ref;
beforeAll(async () => {
  ref = await importReference<Ref>('documents.js');
});

const c = (v: SheetCell['v'], fmt?: string): SheetCell => ({ v, ...(fmt ? { fmt } : {}) });
const f = (formula: string, fmt?: string): SheetCell => ({ f: formula, ...(fmt ? { fmt } : {}) });

/** «Расход топлива · октябрь» из сида эталона (`fuelSheets()[0]`, не экспортируется): расчётные ячейки. */
function fuelSheet(): Sheet {
  const cells: Record<string, SheetCell> = {
    A1: c('Расход топлива · октябрь 2026 · «Север Логистик»'),
    D2: c('Пробег, км'),
  };
  [
    [2140, 268, 12, 19135],
    [1870, 221, 11.5, 15779],
    [1320, 198, 13, 14137],
    [980, 103, 10, 7354],
  ].forEach(([d, e, g, i], k) => {
    const r = k + 3;
    Object.assign(cells, {
      ['A' + r]: c('М ' + r),
      ['D' + r]: c(d ?? null, 'n0'),
      ['E' + r]: c(e ?? null, 'n0'),
      ['F' + r]: f(`=ОКРУГЛ(E${r}/D${r}*100;1)`, 'n1'),
      ['G' + r]: c(g ?? null, 'n1'),
      ['H' + r]: f(`=F${r}/G${r}-1`, 'dpct'),
      ['I' + r]: c(i ?? null, 'n0'),
    });
  });
  Object.assign(cells, {
    D7: f('=СУММ(D3:D6)', 'n0'),
    E7: f('=СУММ(E3:E6)', 'n0'),
    F7: f('=ОКРУГЛ(E7/D7*100;1)', 'n1'),
    I7: f('=СУММ(I3:I6)', 'n0'),
    F9: f('=СРЗНАЧЕСЛИ(G3:G6;">=12";F3:F6)', 'n1'),
  });
  return { cells };
}

const BASE: Record<string, SheetCell> = {
  A1: c(1),
  A2: c(2),
  A3: c(3),
  A4: c('4,5'),
  A5: c('текст'),
  A6: c(true),
  B1: c('Да'),
  B2: c('нет'),
  B3: c('да'),
  B4: c(''),
  C1: c(10),
  C2: c(20),
  C3: c(30),
  D1: f('=1/0'),
  D2: f('=D3'),
  D3: f('=D2'),
  D4: f('=A1+A2*A3'),
  D5: f('=СУММ(A1:A3)'),
};

const FORMULAS = [
  '=1', '=1,5', '=1.5', '="x"', '=ИСТИНА', '=ЛОЖЬ', '=TRUE', '=false',
  '=A1+A2', '=A1-A2', '=A1*A3', '=A1/A2', '=A2^A3', '=-A1', '=+A1', '=A1%', '=A1+A5', '=A5&A1',
  '=-2^2', '=2^-1', '=2^3^2', '=1+2*3-4/2', '=(1+2)*(3-4)', '=10%*10%', '=--1', '=1/0', '=0/0',
  '=A1=A2', '=A1<>A2', '=A1<A2', '=A1>A2', '=A1<=1', '=A1>=2', '=B1=B3', '=B1<>B2', '=A5="ТЕКСТ"', '="10"=10',
  '=A1&A2&"!"', '="a"&B1', '=Z9+1', '=Z9&"x"', '=Z9=0', '=A4+1', '=A6+A1',
  '=СУММ(A1:A3)', '=SUM(A1:A3)', '=СУММ(A1:C3)', '=СУММ(A1;A2;5)', '=СУММ(D1)', '=СУММ(A1:D1)', '=СУММ()',
  '=СРЗНАЧ(A1:A3)', '=СРЗНАЧ(B1:B3)', '=СРЗНАЧ(A1:A5)', '=AVERAGE(C1:C3)',
  '=МИН(A1:A3)', '=МАКС(A1:A3;50)', '=МИН(B1:B3)', '=МАКС()', '=MIN(C1:C3)', '=MAX(C1:C3)',
  '=СЧЁТ(A1:A6)', '=СЧЁТЗ(A1:B6)', '=COUNT(A1:C3)', '=COUNTA(A1:C3)',
  '=ОКРУГЛ(2,567;2)', '=ОКРУГЛ(2,5)', '=ОКРУГЛ(-2,5)', '=ОКРУГЛ(A5)', '=ОКРУГЛ(1/3;3)', '=ROUND(1234,5;-2)',
  '=ABS(-3)', '=ABS(A5)', '=ABS(A1:A3)',
  '=ЕСЛИ(A1>A2;"да";"нет")', '=ЕСЛИ(A1<A2;"да";"нет")', '=ЕСЛИ(A1)', '=ЕСЛИ(0)', '=ЕСЛИ(0;1)', '=IF(1;2;3)', '=ЕСЛИ(D1;1;2)', '=ЕСЛИ(B4;1;2)',
  '=И(A1;A2)', '=И(A1;0)', '=ИЛИ(0;0)', '=ИЛИ(0;A1)', '=НЕ(0)', '=НЕ(A1)', '=AND(1;1)', '=OR(0;1)', '=NOT(1)', '=И(A1:A3)',
  '=ЕСЛИОШИБКА(1/0;"x")', '=ЕСЛИОШИБКА(D1)', '=ЕСЛИОШИБКА(A1;"x")', '=IFERROR(D1;0)', '=ЕСЛИОШИБКА(D2;"цикл")',
  '=СЦЕП("a";1;Z9;"b")', '=CONCAT(A1:A3)', '=СЦЕП(A5;A6)',
  '=СУММЕСЛИ(A1:A3;">1")', '=СУММЕСЛИ(A1:A3;">1";C1:C3)', '=СУММЕСЛИ(B1:B3;"да";C1:C3)', '=СУММЕСЛИ(A1:A3;2)', '=SUMIF(A1:A3;"<>2")',
  '=СЧЁТЕСЛИ(A1:A3;"<>2")', '=СЧЁТЕСЛИ(B1:B3;"да")', '=СЧЁТЕСЛИ(B1:B4;"<>да")', '=СЧЁТЕСЛИ(A1:A3;">=2")', '=СЧЁТЕСЛИ(A1:A5;"<=2")', '=COUNTIF(A1:A3;1)', '=СЧЁТЕСЛИ(E1:E3;"<>5")', '=СЧЁТЕСЛИ(A1:A3;"")',
  '=СРЗНАЧЕСЛИ(A1:A3;">1")', '=СРЗНАЧЕСЛИ(A1:A3;">1";C1:C3)', '=СРЗНАЧЕСЛИ(A1:A3;">100")', '=AVERAGEIF(A1:A3;"<3";C1:C3)',
  '=СУММЕСЛИМН(C1:C3;A1:A3;">1";B1:B3;"да")', '=СУММЕСЛИМН(C1:C3)', '=SUMIFS(C1:C3;A1:A3;">1")',
  '=СРЗНАЧЕСЛИМН(C1:C3;A1:A3;">=1";B1:B3;"да")', '=СРЗНАЧЕСЛИМН(C1:C3;A1:A3;">10")', '=AVERAGEIFS(C1:C3;B1:B3;"да")',
  '=СЧЁТЕСЛИМН(A1:A3;">1";B1:B3;"да")', '=СЧЁТЕСЛИМН()', '=COUNTIFS(A1:A3;">0")',
  '=FOO(1)', '=foo(A1)', '=СУММ(1', '=1+', '=1 @', '=(1', '=)', '=1 2', '=A1:', '=A1:A', '=$A$1+$A2', '=a1+b1', '=сумм(a1:a3)', '=Сумм(A1:A3)',
  '=D1+1', '=D2', '=D3+1', '=D4', '=D5*2', '=-D1', '=D1%', '=СУММ(D1:D5)', '=СРЗНАЧ(D4:D5)', '=D1&"x"', '=D1=D1',
  '=A1:A3', '=A1:A3+1', '=-A1:A3', '=A1:A3%', '=A1:A3&"x"', '=НЕ(A1:A3)', '=ЕСЛИ(A1:A3;1;2)',
  '=1E5', '= 1 + 1 ', '=ЕСЛИ( A1 > 0 ; "p" ; "n" )', '=СУММ (A1:A3)', '="a;b"', '="x"&"y"&"z"', '="Да"=B1', '=1<>"1"',
  'A1+1', 'СУММ(A1:A3)', '', '=',
];

describe('паритет с эталоном: ссылки и диапазоны', () => {
  it('colName и keyOf', () => {
    for (let i = -2; i < 30; i++) expect(colName(i), String(i)).toBe(ref.colName(i));
    for (let col = 0; col < 26; col++) {
      for (const r of [1, 9, 16, 99]) expect(keyOf(col, r)).toBe(ref.keyOf(col, r));
    }
  });
  it('parseKey на ссылках, мусоре и регистре', () => {
    const keys = ['A1', 'b3', '$C$12', 'Z1', 'AA1', 'A', '1A', '', 'A0', 'a 1', 'A1:B2', '$A1', 'A$1', 'я1'];
    for (const k of keys) expect(parseKey(k), k).toEqual(ref.parseKey(k));
    for (const k of [null, undefined, 5]) expect(parseKey(k)).toEqual(ref.parseKey(k));
  });
  it('rangeKeys и inRange на сетке ссылок', () => {
    const pts = ['A1', 'C3', 'B2', 'D4', 'Z16', 'AA1', 'zz', 'a1'];
    for (const a of pts) {
      expect(rangeKeys(a), a).toEqual(ref.rangeKeys(a));
      for (const b of pts) {
        expect(rangeKeys(a, b), a + ':' + b).toEqual(ref.rangeKeys(a, b));
        for (const k of ['A1', 'B2', 'C3', 'D5', 'AA1', 'b2']) {
          expect(inRange(k, a + ':' + b), k + ' в ' + a + ':' + b).toBe(ref.inRange(k, a + ':' + b));
        }
      }
      expect(inRange('A1', a)).toBe(ref.inRange('A1', a));
    }
  });
  it('FN_LIST и FN_SIG', () => {
    expect(FN_LIST).toEqual(ref.FN_LIST);
    expect(FN_SIG).toEqual(ref.FN_SIG);
  });
});

describe('паритет с эталоном: формулы', () => {
  it('checkFormula на всём корпусе', () => {
    for (const fm of FORMULAS) expect(checkFormula(fm), fm).toBe(ref.checkFormula(fm));
  });
  it('sheetCompute: каждая формула корпуса на общем листе', () => {
    for (const fm of FORMULAS) {
      const sheet: Sheet = { cells: { ...BASE, Z99: { f: fm } } };
      const mine = sheetCompute(sheet);
      const theirs = ref.sheetCompute(sheet);
      for (const k of ['Z99', ...Object.keys(BASE)]) {
        expect(mine.get(k), fm + ' → ' + k).toEqual(theirs.get(k));
      }
    }
  });
  it('sheetCompute: пустые входы', () => {
    for (const s of [null, undefined, {}, { cells: {} }]) {
      expect(sheetCompute(s as Sheet | null).get('A1')).toEqual(ref.sheetCompute(s).get('A1'));
    }
  });
  it('случайные арифметические выражения (детерминированный генератор)', () => {
    let seed = 20261019;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const atoms = ['A1', 'A2', 'A3', 'A4', 'C1', 'C2', '7', '0', '2,5', 'B1', 'Z9', 'D1', '"s"'];
    const ops = ['+', '-', '*', '/', '^', '&', '=', '<>', '<', '>', '<=', '>='];
    const gen = (d: number): string => {
      if (d === 0 || rnd(4) === 0) return atoms[rnd(atoms.length)] ?? '1';
      const k = rnd(8);
      if (k === 0) return '(' + gen(d - 1) + ')';
      if (k === 1) return '-' + gen(d - 1);
      if (k === 2) return gen(d - 1) + '%';
      if (k === 3) return 'ЕСЛИ(' + gen(d - 1) + ';' + gen(d - 1) + ';' + gen(d - 1) + ')';
      if (k === 4) return 'СУММ(' + gen(d - 1) + ';' + gen(d - 1) + ')';
      return gen(d - 1) + (ops[rnd(ops.length)] ?? '+') + gen(d - 1);
    };
    for (let i = 0; i < 600; i++) {
      const fm = '=' + gen(3);
      const sheet: Sheet = { cells: { ...BASE, Z99: { f: fm } } };
      expect(sheetCompute(sheet).get('Z99'), fm).toEqual(ref.sheetCompute(sheet).get('Z99'));
      expect(checkFormula(fm), fm).toBe(ref.checkFormula(fm));
    }
  });
});

describe('паритет с эталоном: значения, сетка, сид', () => {
  it('valErr', () => {
    for (const v of [null, 0, 'err', { err: 'x' }, [{ err: 'x' }], true, undefined]) {
      expect(valErr(v)).toBe(ref.valErr(v));
    }
  });
  it('fmtVal: значения × форматы', () => {
    const values = [null, undefined, '', 'текст', true, false, { err: '#ЗНАЧ!' }, 0, 1, -1, 0.5, -0.05, 0.041667, 12.5, 13.75, 56405, 1234567.891, -2500.5, 1e-7, 1e21];
    for (const v of values) {
      for (const fmt of [undefined, 'dpct', 'pct', 'n0', 'n1', 'rub', 'zzz']) {
        expect(fmtVal(v as never, fmt), JSON.stringify(v) + ' ' + fmt).toBe(ref.fmtVal(v, fmt));
      }
    }
  });
  it('rawOf', () => {
    const cells = [undefined, null, {}, { f: '=A1' }, { f: '=A1', v: 5 }, { v: 2.5 }, { v: 7 }, { v: 'т' }, { v: true }, { v: null }, { v: 0 }, { v: -0.5 }];
    for (const cell of cells) expect(rawOf(cell as SheetCell), JSON.stringify(cell)).toBe(ref.rawOf(cell));
  });
  it('gridOf: расходный лист сида и общий лист', () => {
    for (const sh of [fuelSheet(), { cells: BASE }, {}, { cells: { A1: c(1), B2: f('=A1*2') } }, { cells: { Z99: c(1) } }]) {
      expect(gridOf(sh)).toEqual(ref.gridOf(sh));
    }
  });
  it('сид «Расход топлива»: F3 = 12,5; I7 = 56 405; F9 = 13,75 (как в эталоне)', () => {
    const sh = fuelSheet();
    const mine = sheetCompute(sh);
    const theirs = ref.sheetCompute(sh);
    expect([mine.get('F3'), mine.get('I7'), mine.get('F9')]).toEqual([12.5, 56405, 13.75]);
    for (const k of Object.keys(sh.cells ?? {})) expect(mine.get(k), k).toEqual(theirs.get(k));
  });
});
