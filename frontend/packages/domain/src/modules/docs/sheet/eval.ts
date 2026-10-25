// Вычисление листа (documents.js 19.10:299–370). Чистая функция: лист → `get(ключ)`.
// Ячейка без формулы — введённое значение; формула считается лениво, с запоминанием и защитой от циклов.
// Ошибки — объекты `{err:'#КОД'}`: #ДЕЛ/0!, #ЗНАЧ!, #ИМЯ?, #ЦИКЛ!. Функции принимают русские и английские имена.
import { FN_LIST, rangeKeys } from './refs.ts';
import { parseFormula } from './syntax.ts';
import type { Node, Sheet, SheetErr, SheetValue } from './types.ts';

/** Результат узла: значение, список значений диапазона. */
type Result = SheetValue | SheetValue[];
type Pred = (v: SheetValue) => boolean;

const ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  FN_LIST.map(([ru, en]) => [en, ru]),
);
const COMPARE = ['=', '<>', '<', '>', '<=', '>='];

export const valErr = (v: unknown): v is SheetErr =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'err' in v;
const ERR = (code: string): SheetErr => ({ err: code });

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  return /^-?\d+(?:[.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : NaN;
};
const truthy = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : !!v;
const avg = (xs: number[]): SheetValue =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : ERR('#ДЕЛ/0!');
const first = (r: Result): SheetValue => (Array.isArray(r) ? (r[0] ?? null) : r);

/** Условие СУММЕСЛИ и родственных: число, либо строка с необязательным оператором. */
function crit(c: Result): Pred {
  if (typeof c === 'number') return (v) => num(v) === c;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c == null ? '' : String(c));
  const o = m?.[1] || '=';
  const rhs = m?.[2] ?? '';
  const n = num(rhs);
  if (rhs !== '' && !isNaN(n)) {
    return (v) => {
      const x = num(v);
      if (v == null || v === '' || isNaN(x)) return o === '<>';
      if (o === '=') return x === n;
      if (o === '<>') return x !== n;
      if (o === '<') return x < n;
      if (o === '>') return x > n;
      return o === '<=' ? x <= n : x >= n;
    };
  }
  const s = rhs.toLowerCase();
  return (v) => {
    const t = String(v == null ? '' : v).toLowerCase();
    return o === '<>' ? t !== s : t === s;
  };
}

export function sheetCompute(sheet?: Sheet | null): { get(key: string): SheetValue } {
  const cells = sheet?.cells ?? {};
  const memo = new Map<string, SheetValue>();
  const stack = new Set<string>();

  const val = (key: string): SheetValue => {
    if (memo.has(key)) return memo.get(key) ?? null;
    const c = cells[key];
    if (!c) return null;
    if (c.f == null) return c.v === undefined ? null : c.v;
    if (stack.has(key)) return ERR('#ЦИКЛ!');
    stack.add(key);
    let r: SheetValue;
    try {
      r = first(ev(parseFormula(c.f)));
    } catch {
      r = ERR('#ИМЯ?');
    }
    stack.delete(key);
    memo.set(key, r);
    return r;
  };

  const rng = (s: string): SheetValue[] => {
    const [a, b] = s.split(':');
    return rangeKeys(a ?? '', b).map(val);
  };
  const arg = (a: Node | undefined): SheetValue[] =>
    a && a.k === 'rng' ? rng(a.v) : a ? [first(ev(a))] : [];
  const flat = (A: Node[]): SheetValue[] => A.flatMap(arg);
  const scalar = (a: Node | undefined): Result => (a ? ev(a) : null);
  const pairs = (A: Node[]): [SheetValue[], Pred][] => {
    const out: [SheetValue[], Pred][] = [];
    for (let i = 0; i + 1 < A.length; i += 2) out.push([arg(A[i]), crit(scalar(A[i + 1]))]);
    return out;
  };
  const numbers = (xs: SheetValue[]): number[] => xs.filter((x): x is number => typeof x === 'number');
  const realNums = (xs: number[]): number[] => xs.filter((x) => !isNaN(x));

  function call(name: string, A: Node[]): Result {
    const xs = flat(A);
    const e0 = xs.find(valErr);
    switch (name) {
      case 'СУММ':
        return e0 ?? numbers(xs).reduce((s, x) => s + x, 0);
      case 'СРЗНАЧ':
        return e0 ?? avg(numbers(xs));
      case 'МИН':
      case 'МАКС': {
        if (e0) return e0;
        const n = numbers(xs);
        if (!n.length) return 0;
        return name === 'МИН' ? Math.min(...n) : Math.max(...n);
      }
      case 'СЧЁТ':
        return numbers(xs).length;
      case 'СЧЁТЗ':
        return xs.filter((x) => x != null && x !== '').length;
      case 'ОКРУГЛ': {
        const a = scalar(A[0]);
        if (valErr(a)) return a;
        const x = num(a);
        const d = A[1] ? num(scalar(A[1])) : 0;
        if (isNaN(x)) return ERR('#ЗНАЧ!');
        const k = Math.pow(10, d);
        return Math.round(x * k) / k;
      }
      case 'ЕСЛИ': {
        const c = scalar(A[0]);
        if (valErr(c)) return c;
        if (truthy(c)) return A[1] ? ev(A[1]) : true;
        return A[2] ? ev(A[2]) : false;
      }
      case 'И':
        return xs.every(truthy);
      case 'ИЛИ':
        return xs.some(truthy);
      case 'НЕ':
        return !truthy(scalar(A[0]));
      case 'ЕСЛИОШИБКА': {
        const v = scalar(A[0]);
        return valErr(v) ? (A[1] ? ev(A[1]) : '') : v;
      }
      case 'ABS': {
        const x = num(scalar(A[0]));
        return isNaN(x) ? ERR('#ЗНАЧ!') : Math.abs(x);
      }
      case 'СЦЕП':
        return xs.map((x) => (x == null ? '' : String(x))).join('');
      case 'СУММЕСЛИ': {
        const r = arg(A[0]);
        const p = crit(scalar(A[1]));
        const s = A[2] ? arg(A[2]) : r;
        return r.reduce<number>((t, v, i) => (p(v) ? t + (num(s[i]) || 0) : t), 0);
      }
      case 'СЧЁТЕСЛИ': {
        const p = crit(scalar(A[1]));
        return arg(A[0]).filter(p).length;
      }
      case 'СРЗНАЧЕСЛИ': {
        const r = arg(A[0]);
        const p = crit(scalar(A[1]));
        const s = A[2] ? arg(A[2]) : r;
        return avg(realNums(r.map((v, i) => (p(v) ? num(s[i]) : NaN))));
      }
      case 'СУММЕСЛИМН': {
        const s = arg(A[0]);
        const c = pairs(A.slice(1));
        return s.reduce<number>(
          (t, v, i) => (c.every(([r, p]) => p(r[i] ?? null)) ? t + (num(v) || 0) : t),
          0,
        );
      }
      case 'СРЗНАЧЕСЛИМН': {
        const s = arg(A[0]);
        const c = pairs(A.slice(1));
        return avg(realNums(s.map((v, i) => (c.every(([r, p]) => p(r[i] ?? null)) ? num(v) : NaN))));
      }
      case 'СЧЁТЕСЛИМН': {
        const c = pairs(A);
        const n = c[0] ? c[0][0].length : 0;
        let k = 0;
        for (let i = 0; i < n; i++) if (c.every(([r, p]) => p(r[i] ?? null))) k++;
        return k;
      }
      default:
        return ERR('#ИМЯ?');
    }
  }

  function ev(n: Node): Result {
    if (n.k === 'num' || n.k === 'str' || n.k === 'bool') return n.v;
    if (n.k === 'ref') return val(n.v);
    if (n.k === 'rng') return rng(n.v);
    if (n.k === 'neg') {
      const a = ev(n.a);
      if (valErr(a)) return a;
      const x = num(a);
      return isNaN(x) ? ERR('#ЗНАЧ!') : -x;
    }
    if (n.k === 'pct') {
      const a = ev(n.a);
      return valErr(a) ? a : num(a) / 100;
    }
    if (n.k === 'fn') return call(ALIAS[n.n] ?? n.n, n.args);
    const a = first(ev(n.a));
    const b = first(ev(n.b));
    if (valErr(a)) return a;
    if (valErr(b)) return b;
    if (n.o === '&') return String(a == null ? '' : a) + String(b == null ? '' : b);
    if (COMPARE.includes(n.o)) {
      const txt = (typeof a === 'string' && isNaN(num(a))) || (typeof b === 'string' && isNaN(num(b)));
      const x = txt ? String(a == null ? '' : a).toLowerCase() : num(a);
      const y = txt ? String(b == null ? '' : b).toLowerCase() : num(b);
      if (n.o === '=') return x === y;
      if (n.o === '<>') return x !== y;
      if (n.o === '<') return x < y;
      if (n.o === '>') return x > y;
      return n.o === '<=' ? x <= y : x >= y;
    }
    const x = num(a);
    const y = num(b);
    if (isNaN(x) || isNaN(y)) return ERR('#ЗНАЧ!');
    if (n.o === '/' && y === 0) return ERR('#ДЕЛ/0!');
    if (n.o === '+') return x + y;
    if (n.o === '-') return x - y;
    if (n.o === '*') return x * y;
    return n.o === '/' ? x / y : Math.pow(x, y);
  }

  return { get: val };
}
