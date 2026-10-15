import { describe, expect, it } from 'vitest';
import { formatInteger, formatMoney, parseMoney, parseNumber } from './format';

const NBSP = ' ';

describe('formatMoney: amountMinor → «1 250,00» (components.md: MoneyInput, Дизайн-система.dc.html:223)', () => {
  it.each([
    [325000, `3${NBSP}250,00`],
    [125000, `1${NBSP}250,00`],
    [0, '0,00'],
    [5, '0,05'],
    [84370000, `843${NBSP}700,00`],
    [-50000, '-500,00'],
    [123456789, `1${NBSP}234${NBSP}567,89`],
  ])('%d → %s', (minor, text) => {
    expect(formatMoney(minor)).toBe(text);
  });

  it('разделитель разрядов — неразрывный пробел U+00A0, не U+0020', () => {
    expect(formatMoney(325000)).not.toContain(' ');
  });
});

describe('parseMoney: текст поля → amountMinor', () => {
  it.each([
    ['3 250,00', 325000],
    [`3${NBSP}250,00`, 325000],
    ['3 250,00', 325000],
    ['1250', 125000],
    ['12,5', 1250],
    ['12.05', 1205],
    ['-500', -50000],
    ['0,07', 7],
  ])('«%s» → %d', (text, minor) => {
    expect(parseMoney(text)).toBe(minor);
  });

  it.each(['', '   ', 'abc', '12,345', '1-2', ','])('«%s» → null', (text) => {
    expect(parseMoney(text)).toBeNull();
  });
});

describe('formatInteger и parseNumber: «48 210 км» (Дизайн-система.dc.html:220)', () => {
  it.each([
    [48210, `48${NBSP}210`],
    [0, '0'],
    [999, '999'],
    [1000000, `1${NBSP}000${NBSP}000`],
    [-1500, `-1${NBSP}500`],
    [3.5, '3,5'],
  ])('%d → %s', (value, text) => {
    expect(formatInteger(value)).toBe(text);
  });

  it.each([
    ['48 210', 48210],
    [`48${NBSP}210`, 48210],
    ['3,5', 3.5],
    ['-12', -12],
  ])('«%s» → %d', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it('пустая строка → «нет значения», мусор → null', () => {
    expect(parseNumber('')).toBe('');
    expect(parseNumber('  ')).toBe('');
    expect(parseNumber('12a')).toBeNull();
    expect(parseNumber('-')).toBeNull();
  });
});
