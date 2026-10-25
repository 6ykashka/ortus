// Экспорт-лист табличного движка (`modules/docs/sheet/index.ts`). Подключение в баррели — у интегратора.
// Расширяется только добавлением.
import { describe, expect, it } from 'vitest';

const SHEET_EXPORTS = [
  'FN_LIST',
  'FN_SIG',
  'checkFormula',
  'colName',
  'csvCells',
  'fmtVal',
  'gridOf',
  'inRange',
  'keyOf',
  'lex',
  'parse',
  'parseFormula',
  'parseKey',
  'rangeKeys',
  'rawOf',
  'sheetCompute',
  'upperOut',
  'valErr',
];

describe('экспорт табличного движка', () => {
  it('значения из index.ts — ровно перечисленные', async () => {
    const m = await import('./index.ts');
    expect(Object.keys(m).sort()).toEqual([...SHEET_EXPORTS].sort());
  });
  it('пример из анализа через публичный вход', async () => {
    const { sheetCompute } = await import('./index.ts');
    expect(sheetCompute({ cells: { A1: { v: 2 }, A2: { v: 3 }, A3: { f: '=A1+A2' } } }).get('A3')).toBe(5);
  });
});
