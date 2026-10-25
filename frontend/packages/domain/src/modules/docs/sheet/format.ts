// Вывод значений, сетка просмотра и импорт CSV (documents.js 19.10:371–402).
// Числа форматируются по правилам ru-RU (неразрывный пробел между разрядами, запятая).
import { valErr, sheetCompute } from './eval.ts';
import { colName, keyOf, parseKey } from './refs.ts';
import type { CsvSheet, Sheet, SheetCell, SheetValue } from './types.ts';

const nf = (x: number, d: number, min?: number): string =>
  Number(x).toLocaleString('ru-RU', {
    minimumFractionDigits: min ?? d,
    maximumFractionDigits: d,
  });

/** Текст ячейки для показа. Формат: `dpct`, `pct`, `n0`, `n1`, `rub`; иначе «общий». */
export function fmtVal(v: SheetValue | undefined, fmt?: string): string {
  if (v == null || v === '') return '';
  if (valErr(v)) return v.err;
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
  if (typeof v === 'number') {
    if (fmt === 'dpct') return (v > 0 ? '+' : '') + nf(v * 100, 1) + ' %';
    if (fmt === 'pct') return nf(v * 100, 1) + ' %';
    if (fmt === 'n0') return nf(v, 0);
    if (fmt === 'n1') return nf(v, 1);
    if (fmt === 'rub') return nf(v, 0) + ' ₽';
    return nf(v, 2, 0);
  }
  return String(v);
}

/** Что показать в строке формул: формула как есть, число — с десятичной запятой. */
export function rawOf(c: SheetCell | null | undefined): string {
  if (!c) return '';
  if (c.f != null) return c.f;
  if (c.v == null) return '';
  return typeof c.v === 'number' ? String(c.v).replace('.', ',') : String(c.v);
}

/** Сетка текста для просмотра: не больше 16 строк и 10 столбцов. */
export function gridOf(sh: Sheet): string[][] {
  const calc = sheetCompute(sh);
  const cells = sh.cells ?? {};
  const keys = Object.keys(cells)
    .map(parseKey)
    .filter((k) => k !== null);
  const rows = Math.min(16, Math.max(1, ...keys.map((k) => k.r)));
  const cols = Math.min(10, Math.max(1, ...keys.map((k) => k.c + 1)));
  const out: string[][] = [];
  for (let r = 1; r <= rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const k = keyOf(c, r);
      const cell = cells[k];
      row.push(cell ? fmtVal(calc.get(k), cell.fmt) : '');
    }
    out.push(row);
  }
  return out;
}

/** Импорт CSV: до 200 строк и 26 столбцов, разделитель «;» или «,», первая строка — заголовок. */
export function csvCells(text: unknown): CsvSheet {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 200);
  const cells: Record<string, SheetCell> = {};
  const first = lines[0];
  if (first === undefined) return { cells, rows: 20, cols: 8 };
  const sep = (first.match(/;/g) ?? []).length >= (first.match(/,/g) ?? []).length ? ';' : ',';
  let cols = 1;
  lines.forEach((l, r) => {
    const xs = l.split(sep).slice(0, 26);
    cols = Math.max(cols, xs.length);
    xs.forEach((x, c) => {
      const v = x.trim().replace(/^"|"$/g, '');
      if (!v) return;
      const n = v.replace(/\s/g, '').replace(',', '.');
      cells[colName(c) + (r + 1)] = {
        v: /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : v,
        ...(r === 0 ? { st: 'head' } : {}),
      };
    });
  });
  return { cells, rows: Math.max(20, lines.length + 5), cols: Math.max(8, cols) };
}
