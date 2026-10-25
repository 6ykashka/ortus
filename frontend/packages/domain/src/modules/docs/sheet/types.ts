// Типы табличного движка документов (design/ortus/documents.js 19.10:237–402, docs/24).
// Движок чистый: без часов, случайных чисел и обращений к БД.

/** Ошибка вычисления ячейки: `{err:'#ДЕЛ/0!'}` и др. */
export interface SheetErr {
  readonly err: string;
}

/** Значение ячейки после вычисления; пустая ячейка — `null`. */
export type SheetValue = number | string | boolean | null | SheetErr;

/** Формат вывода числа (`fmt` ячейки). Неизвестный формат — как «общий». */
export type CellFmt = 'dpct' | 'pct' | 'n0' | 'n1' | 'rub' | (string & {});

export interface SheetCell {
  /** Введённое значение (когда нет формулы). */
  v?: number | string | boolean | null;
  /** Формула, с «=» или без. */
  f?: string | null;
  fmt?: CellFmt;
  /** Стиль ячейки (например, `head` для первой строки CSV). */
  st?: string;
}

export interface Sheet {
  cells?: Record<string, SheetCell>;
}

/** Разобранная ссылка: столбец с 0 и строка с 1. */
export interface CellRef {
  c: number;
  r: number;
}

export type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'rng' | 'fn' | 'ref' | 'op'; v: string };

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; v: string }
  | { k: 'rng'; v: string }
  | { k: 'neg'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'fn'; n: string; args: Node[] }
  | { k: 'bin'; o: string; a: Node; b: Node };

/** Результат разбора CSV: ячейки и размер сетки. */
export interface CsvSheet {
  cells: Record<string, SheetCell>;
  rows: number;
  cols: number;
}