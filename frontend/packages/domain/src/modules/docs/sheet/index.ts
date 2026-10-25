// Табличный движок документов (W7.20, P1d docs-sheet): чистые функции из прототипа 19.10
// (`design/ortus/documents.js`, docs/24). Без часов, случайных чисел и обращений к БД.
export type {
  CellFmt,
  CellRef,
  CsvSheet,
  Node as FormulaNode,
  Sheet,
  SheetCell,
  SheetErr,
  SheetValue,
  Token as FormulaToken,
} from './types.ts';
export { FN_LIST, FN_SIG, colName, inRange, keyOf, parseKey, rangeKeys } from './refs.ts';
export { checkFormula, lex, parse, parseFormula, upperOut } from './syntax.ts';
export { sheetCompute, valErr } from './eval.ts';
export { csvCells, fmtVal, gridOf, rawOf } from './format.ts';
