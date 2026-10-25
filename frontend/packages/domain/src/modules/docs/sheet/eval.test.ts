import { describe, expect, it } from 'vitest';
import { sheetCompute, valErr } from './eval.ts';
import type { Sheet, SheetCell } from './types.ts';

/** Ячейка с формулой или значением: строка с «=» — формула. */
const sh = (cells: Record<string, SheetCell | number | string>): Sheet => ({
  cells: Object.fromEntries(
    Object.entries(cells).map(([k, c]) => [
      k,
      typeof c === 'object' ? c : typeof c === 'string' && c.startsWith('=') ? { f: c } : { v: c },
    ]),
  ),
});
const calc = (f: string, base: Record<string, SheetCell | number | string> = {}) =>
  sheetCompute(sh({ ...base, Z99: f })).get('Z99');
const NUMS = { A1: 1, A2: 2, A3: 3 };
const TABLE = {
  ...NUMS,
  B1: 'Да',
  B2: 'нет',
  B3: 'да',
  C1: 10,
  C2: 20,
  C3: 30,
};
const err = (e: string) => ({ err: e });

describe('valErr', () => {
  it('узнаёт только объект с полем err', () => {
    expect(valErr({ err: '#ЗНАЧ!' })).toBe(true);
    expect(valErr(null)).toBe(false);
    expect(valErr(0)).toBe(false);
    expect(valErr('err')).toBe(false);
    expect(valErr([{ err: 'x' }])).toBe(false);
  });
});

describe('sheetCompute: значения и ссылки', () => {
  it('пример из анализа: A3 = A1 + A2 = 5', () => {
    expect(sheetCompute(sh({ A1: 2, A2: 3, A3: '=A1+A2' })).get('A3')).toBe(5);
  });
  it('пустой лист, пустая и несуществующая ячейка — null', () => {
    expect(sheetCompute(null).get('A1')).toBeNull();
    expect(sheetCompute({}).get('A1')).toBeNull();
    expect(sheetCompute(sh({ A1: { fmt: 'n0' } })).get('A1')).toBeNull();
  });
  it('введённое значение возвращается как есть', () => {
    const c = sheetCompute(sh({ A1: 7, A2: 'текст', A3: { v: true } }));
    expect([c.get('A1'), c.get('A2'), c.get('A3')]).toEqual([7, 'текст', true]);
  });
  it('формула без «=» тоже работает', () => {
    expect(sheetCompute(sh({ A1: 4, A2: { f: 'A1*2' } })).get('A2')).toBe(8);
  });
  it('пустая ячейка в арифметике — 0, число-строка с запятой — число', () => {
    expect(calc('=A1+1')).toBe(1);
    expect(calc('=A1+1', { A1: '1,5' })).toBe(2.5);
  });
  it('цепочка ссылок', () => {
    expect(sheetCompute(sh({ A1: 1, A2: '=A1+1', A3: '=A2*10' })).get('A3')).toBe(20);
  });
  it('диапазон в позиции значения — первая ячейка', () => {
    expect(calc('=A1:A3', NUMS)).toBe(1);
  });
});

describe('sheetCompute: операторы', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=10-4-3', 3],
    ['=2^3', 8],
    ['=-2^2', 4],
    ['=7/2', 3.5],
    ['=50%', 0.5],
    ['=200*10%', 20],
    ['=ИСТИНА+1', 2],
    ['="a"&1', 'a1'],
    ['="a"&A9', 'a'],
  ])('%s → %j', (f, want) => {
    expect(calc(f)).toBe(want);
  });
  it.each([
    ['=1/0', '#ДЕЛ/0!'],
    ['="abc"+1', '#ЗНАЧ!'],
    ['=-"abc"', '#ЗНАЧ!'],
    ['=FOO(1)', '#ИМЯ?'],
    ['=1+', '#ИМЯ?'],
  ])('%s → ошибка %s', (f, code) => {
    expect(calc(f)).toEqual(err(code));
  });
  it('ошибка распространяется по ссылкам и операторам', () => {
    const c = sheetCompute(sh({ A1: '=1/0', A2: '=A1+1', A3: '=-A1', A4: '=A1%' }));
    expect([c.get('A2'), c.get('A3'), c.get('A4')]).toEqual([
      err('#ДЕЛ/0!'),
      err('#ДЕЛ/0!'),
      err('#ДЕЛ/0!'),
    ]);
  });
  it('циклическая ссылка', () => {
    const c = sheetCompute(sh({ A1: '=A2', A2: '=A1' }));
    expect(c.get('A1')).toEqual(err('#ЦИКЛ!'));
    expect(c.get('A2')).toEqual(err('#ЦИКЛ!'));
    expect(sheetCompute(sh({ A1: '=A1+1' })).get('A1')).toEqual(err('#ЦИКЛ!'));
  });
  it.each([
    ['=2<10', true],
    ['=2>10', false],
    ['=1=1', true],
    ['=1<>1', false],
    ['=2<=2', true],
    ['=2>=3', false],
    ['="а"="А"', true],
    ['="abc"<"abd"', true],
    ['="a"<>"a"', false],
    ['="10"=10', true],
  ])('сравнение %s → %j', (f, want) => {
    expect(calc(f)).toBe(want);
  });
});

describe('sheetCompute: функции', () => {
  it.each([
    ['=СУММ(A1:A3)', 6],
    ['=SUM(A1:A3)', 6],
    ['=sum(a1:a3)', 6],
    ['=СУММ(A1;A2;10)', 13],
    ['=СУММ(B1:B3)', 0],
    ['=СРЗНАЧ(A1:A3)', 2],
    ['=МИН(A1:A3)', 1],
    ['=МАКС(A1:A3;100)', 100],
    ['=МИН(B1:B3)', 0],
    ['=СЧЁТ(A1:A3;B1)', 3],
    ['=СЧЁТЗ(A1:C3)', 9],
    ['=ОКРУГЛ(2,567;2)', 2.57],
    ['=ОКРУГЛ(2,5)', 3],
    ['=ABS(-3)', 3],
    ['=СЦЕП("a";1;A9;"b")', 'a1b'],
    ['=И(1;1;ИСТИНА)', true],
    ['=И(1;0)', false],
    ['=ИЛИ(0;0;1)', true],
    ['=ИЛИ(0;0)', false],
    ['=НЕ(0)', true],
    ['=НЕ(5)', false],
    ['=ЕСЛИ(1>2;"да";"нет")', 'нет'],
    ['=ЕСЛИ(1<2;"да";"нет")', 'да'],
    ['=ЕСЛИ(1)', true],
    ['=ЕСЛИ(0)', false],
    ['=ЕСЛИ(0;1)', false],
    ['=ЕСЛИОШИБКА(1/0;"x")', 'x'],
    ['=ЕСЛИОШИБКА(1/0)', ''],
    ['=ЕСЛИОШИБКА(5;"x")', 5],
  ])('%s → %j', (f, want) => {
    expect(calc(f, TABLE)).toBe(want);
  });
  it.each([
    ['=СРЗНАЧ(B1:B3)', '#ДЕЛ/0!'],
    ['=ОКРУГЛ("x")', '#ЗНАЧ!'],
    ['=ABS("x")', '#ЗНАЧ!'],
    ['=ЕСЛИ(1/0;1;2)', '#ДЕЛ/0!'],
    ['=ОКРУГЛ(1/0;1)', '#ДЕЛ/0!'],
  ])('%s → ошибка %s', (f, code) => {
    expect(calc(f, TABLE)).toEqual(err(code));
  });
  it('ошибка в диапазоне перетекает в СУММ, СРЗНАЧ, МИН, МАКС', () => {
    const base = { A1: 1, A2: '=1/0' };
    for (const fn of ['СУММ', 'СРЗНАЧ', 'МИН', 'МАКС']) {
      expect(calc(`=${fn}(A1:A2)`, base), fn).toEqual(err('#ДЕЛ/0!'));
    }
  });
  it.each([
    ['=СУММЕСЛИ(A1:A3;">1")', 5],
    ['=СУММЕСЛИ(A1:A3;">1";C1:C3)', 50],
    ['=СУММЕСЛИ(B1:B3;"да";C1:C3)', 40],
    ['=СУММЕСЛИ(A1:A3;2)', 2],
    ['=СЧЁТЕСЛИ(A1:A3;"<>2")', 2],
    ['=СЧЁТЕСЛИ(B1:B3;"да")', 2],
    ['=СЧЁТЕСЛИ(B1:B3;"<>да")', 1],
    ['=СЧЁТЕСЛИ(A1:A3;">=2")', 2],
    ['=СЧЁТЕСЛИ(A1:A3;"<=2")', 2],
    ['=СЧЁТЕСЛИ(A1:A3;"<3")', 2],
    ['=СРЗНАЧЕСЛИ(A1:A3;">1")', 2.5],
    ['=СРЗНАЧЕСЛИ(A1:A3;">1";C1:C3)', 25],
    ['=СУММЕСЛИМН(C1:C3;A1:A3;">1";B1:B3;"да")', 30],
    ['=СРЗНАЧЕСЛИМН(C1:C3;A1:A3;">=1";B1:B3;"да")', 20],
    ['=СЧЁТЕСЛИМН(A1:A3;">1";B1:B3;"да")', 1],
    ['=СЧЁТЕСЛИМН()', 0],
    ['=COUNTIF(A1:A3;">1")', 2],
    ['=SUMIFS(C1:C3;A1:A3;">1")', 50],
  ])('%s → %j', (f, want) => {
    expect(calc(f, TABLE)).toBe(want);
  });
  it('критерий с пустой ячейкой: «<>» истинно, остальные ложны', () => {
    expect(calc('=СЧЁТЕСЛИ(D1:D3;"<>5")', TABLE)).toBe(3);
    expect(calc('=СЧЁТЕСЛИ(D1:D3;">5")', TABLE)).toBe(0);
  });
  it('СРЗНАЧЕСЛИ без подходящих — #ДЕЛ/0!', () => {
    expect(calc('=СРЗНАЧЕСЛИ(A1:A3;">100")', TABLE)).toEqual(err('#ДЕЛ/0!'));
  });
});
