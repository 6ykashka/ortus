// Лексер и парсер формул (documents.js 19.10:258–298). Формула — без «=», верхний регистр вне строк.
// Приоритеты (слабее → сильнее): сравнение, «&», «+ -», «* /», «^», унарный минус/плюс, «%».
import type { Node, Token } from './types.ts';

const CMP = ['=', '<>', '<', '>', '<=', '>='];

const RULES: readonly (readonly [string, RegExp])[] = [
  ['ws', /^\s+/],
  ['str', /^"([^"]*)"/],
  ['rng', /^\$?[A-Z]\$?\d+:\$?[A-Z]\$?\d+/],
  ['fn', /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9.]*(?=\s*\()/],
  ['ref', /^\$?[A-Z]\$?\d+(?![A-ZА-ЯЁ0-9(])/],
  ['bool', /^(ИСТИНА|ЛОЖЬ|TRUE|FALSE)(?![A-ZА-ЯЁ0-9])/],
  ['num', /^\d+(?:[.,]\d+)?/],
  ['op', /^(<=|>=|<>|[-+*/^&=<>%();,])/],
];

/** Верхний регистр везде, кроме строк в кавычках. */
export const upperOut = (s: string): string =>
  String(s).replace(/"[^"]*"|[^"]+/g, (x) => (x.startsWith('"') ? x : x.toUpperCase()));

export function lex(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let hit: [string, RegExpExecArray] | null = null;
    for (const [t, re] of RULES) {
      const m = re.exec(rest);
      if (m) {
        hit = [t, m];
        break;
      }
    }
    if (!hit) throw new Error('непонятный символ «' + s.charAt(i) + '»');
    const [t, m] = hit;
    i += m[0].length;
    if (t === 'ws') continue;
    if (t === 'str') out.push({ t, v: m[1] ?? '' });
    else if (t === 'num') out.push({ t, v: parseFloat(m[0].replace(',', '.')) });
    else if (t === 'bool') out.push({ t, v: /^(ИСТИНА|TRUE)$/.test(m[1] ?? '') });
    else out.push({ t: t as 'rng' | 'fn' | 'ref' | 'op', v: m[0].replace(/\$/g, '') });
  }
  return out;
}

export function parse(tokens: Token[]): Node {
  let p = 0;
  const isOp = (v: string): boolean => {
    const t = tokens[p];
    return !!t && t.t === 'op' && t.v === v;
  };
  const next = (): Token | undefined => tokens[p++];
  const binary = (ops: string[], sub: () => Node): Node => {
    let a = sub();
    for (;;) {
      const t = tokens[p];
      if (!t || t.t !== 'op' || !ops.includes(t.v)) return a;
      p++;
      a = { k: 'bin', o: t.v, a, b: sub() };
    }
  };
  const cmp = (): Node => binary(CMP, cat);
  const cat = (): Node => binary(['&'], add);
  const add = (): Node => binary(['+', '-'], mul);
  const mul = (): Node => binary(['*', '/'], pow);
  const pow = (): Node => binary(['^'], un);
  const un = (): Node => {
    if (isOp('-')) {
      next();
      return { k: 'neg', a: un() };
    }
    if (isOp('+')) {
      next();
      return un();
    }
    return post();
  };
  const post = (): Node => {
    let a = prim();
    while (isOp('%')) {
      next();
      a = { k: 'pct', a };
    }
    return a;
  };
  function prim(): Node {
    const t = next();
    if (!t) throw new Error('формула оборвалась');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'bool') return { k: 'bool', v: t.v };
    if (t.t === 'ref') return { k: 'ref', v: t.v };
    if (t.t === 'rng') return { k: 'rng', v: t.v };
    if (t.t === 'fn') {
      if (!isOp('(')) throw new Error('после ' + t.v + ' нужна скобка');
      next();
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(cmp());
        while (isOp(';') || isOp(',')) {
          next();
          args.push(cmp());
        }
      }
      if (!isOp(')')) throw new Error('не закрыта скобка в ' + t.v);
      next();
      return { k: 'fn', n: t.v, args };
    }
    if (t.v === '(') {
      const e = cmp();
      if (!isOp(')')) throw new Error('не закрыта скобка');
      next();
      return e;
    }
    throw new Error('лишний символ «' + String(t.v) + '»');
  }
  const e = cmp();
  const rest = tokens[p];
  if (rest) throw new Error('лишний символ «' + String(rest.v) + '»');
  return e;
}

/** Разбор формулы ячейки: «=» в начале необязателен. */
export const parseFormula = (raw: unknown): Node =>
  parse(lex(upperOut(String(raw).replace(/^=/, ''))));

/** Текст ошибки формулы или `null`, если формула разбирается. */
export function checkFormula(raw: unknown): string | null {
  try {
    parseFormula(raw);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
