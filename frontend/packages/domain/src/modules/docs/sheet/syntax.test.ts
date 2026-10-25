import { describe, expect, it } from 'vitest';
import { checkFormula, lex, parse, parseFormula, upperOut } from './syntax.ts';

describe('upperOut', () => {
  it('поднимает регистр вне строк', () => {
    expect(upperOut('сумм(a1:b2)')).toBe('СУММ(A1:B2)');
  });
  it('строки в кавычках не трогает', () => {
    expect(upperOut('если(a1="да";"нет";1)')).toBe('ЕСЛИ(A1="да";"нет";1)');
  });
});

describe('lex', () => {
  it('число с запятой и точкой', () => {
    expect(lex('1,5')).toEqual([{ t: 'num', v: 1.5 }]);
    expect(lex('2.25')).toEqual([{ t: 'num', v: 2.25 }]);
  });
  it('строка, ссылка, диапазон, пробелы пропускаются', () => {
    expect(lex('"привет" A1 $B$2:C3')).toEqual([
      { t: 'str', v: 'привет' },
      { t: 'ref', v: 'A1' },
      { t: 'rng', v: 'B2:C3' },
    ]);
  });
  it('функция узнаётся по скобке, пробел перед скобкой допустим', () => {
    expect(lex('СУММ (A1)')).toEqual([
      { t: 'fn', v: 'СУММ' },
      { t: 'op', v: '(' },
      { t: 'ref', v: 'A1' },
      { t: 'op', v: ')' },
    ]);
  });
  it('логические константы RU и EN', () => {
    expect(lex('ИСТИНА ЛОЖЬ TRUE FALSE').map((t) => t.v)).toEqual([true, false, true, false]);
  });
  it('двухсимвольные операторы', () => {
    expect(lex('<=>=<>').map((t) => t.v)).toEqual(['<=', '>=', '<>']);
  });
  it('все односимвольные операторы', () => {
    expect(lex('-+*/^&=<%();,').map((t) => t.v)).toEqual([
      ...'-+*/^&=<%();,'.split(''),
    ]);
  });
  it('неизвестный символ — ошибка с этим символом', () => {
    expect(() => lex('1 @')).toThrow('непонятный символ «@»');
  });
});

describe('parse', () => {
  const p = (s: string) => parse(lex(s));
  it('приоритет: умножение выше сложения', () => {
    expect(p('1+2*3')).toEqual({
      k: 'bin',
      o: '+',
      a: { k: 'num', v: 1 },
      b: { k: 'bin', o: '*', a: { k: 'num', v: 2 }, b: { k: 'num', v: 3 } },
    });
  });
  it('унарный минус сильнее степени, как в эталоне: -2^2 = (-2)^2', () => {
    // эталон: pow = un ^ un, un = '-' un → (-2)^2
    expect(p('-2^2')).toEqual({
      k: 'bin',
      o: '^',
      a: { k: 'neg', a: { k: 'num', v: 2 } },
      b: { k: 'num', v: 2 },
    });
  });
  it('процент постфиксный', () => {
    expect(p('50%')).toEqual({ k: 'pct', a: { k: 'num', v: 50 } });
  });
  it('унарный плюс отбрасывается', () => {
    expect(p('+3')).toEqual({ k: 'num', v: 3 });
  });
  it('склейка & слабее сложения, сравнение слабее склейки', () => {
    expect(p('1+1&2=3')).toMatchObject({ k: 'bin', o: '=', a: { k: 'bin', o: '&' } });
  });
  it('функция: аргументы через «;» и «,»', () => {
    expect(p('СУММ(A1;2,B2:B3)')).toEqual({
      k: 'fn',
      n: 'СУММ',
      args: [{ k: 'ref', v: 'A1' }, { k: 'num', v: 2 }, { k: 'rng', v: 'B2:B3' }],
    });
  });
  it('функция без аргументов', () => {
    expect(p('И()')).toEqual({ k: 'fn', n: 'И', args: [] });
  });
  it('скобки группируют', () => {
    expect(p('(1+2)*3')).toMatchObject({ k: 'bin', o: '*', a: { k: 'bin', o: '+' } });
  });
  it.each([
    ['', 'формула оборвалась'],
    ['1+', 'формула оборвалась'],
    ['(1+2', 'не закрыта скобка'],
    ['СУММ(1', 'не закрыта скобка в СУММ'],
    ['1 2', 'лишний символ «2»'],
    [')', 'лишний символ «)»'],
    ['1+*2', 'лишний символ «*»'],
  ])('ошибка разбора %j → %s', (s, msg) => {
    expect(() => p(s)).toThrow(msg);
  });
  it('«после X нужна скобка» при токене функции без скобки', () => {
    expect(() => parse([{ t: 'fn', v: 'СУММ' }])).toThrow('после СУММ нужна скобка');
  });
});

describe('parseFormula / checkFormula', () => {
  it('«=» в начале и регистр не мешают', () => {
    expect(parseFormula('=a1+1')).toEqual(parseFormula('A1+1'));
  });
  it.each([
    ['=СУММ(A1:A3', 'не закрыта скобка в СУММ'],
    ['=1+', 'формула оборвалась'],
    ['=1 @', 'непонятный символ «@»'],
  ])('checkFormula(%s) → %s', (raw, msg) => {
    expect(checkFormula(raw)).toBe(msg);
  });
  it.each(['=A1+A2', '=ЕСЛИ(1>2;"да";"нет")', 'sum(a1:a3)', '=2^3', '="а"&"б"'])(
    'корректная формула %s → null',
    (raw) => {
      expect(checkFormula(raw)).toBeNull();
    },
  );
});