// W0.14 · Охранники словаря: одна строка — один файл, типографика, «ё», U+00A0, эмодзи, формат ключей.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ALL } from '../src/index.ts';
import { PKG, domainFiles, leaves, readText } from './_util.mjs';

const all = Object.entries(ALL).flatMap(([ns, tree]) => leaves(tree, ns));
const CYR = /[А-Яа-яЁё]/;

/** Строковые литералы с кириллицей в исходнике (без строк импорта). */
function literals(src) {
  const body = src
    .split('\n')
    .filter((l) => !/^\s*(import|export \* from|export \{)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  return [...body.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).filter((s) => CYR.test(s));
}

describe('одна строка-литерал — один файл', () => {
  const owner = new Map();
  const dups = [];
  for (const f of domainFiles()) {
    for (const s of new Set(literals(readText(join(PKG, 'src', f))))) {
      if (owner.has(s) && owner.get(s) !== f) dups.push(`«${s}»: ${owner.get(s)} и ${f}`);
      else owner.set(s, f);
    }
  }
  it('литерал с кириллицей встречается только в одном файле домена (другие ссылаются)', () =>
    assert.deepEqual(dups, []));
});

describe('типографика и орфография значений', () => {
  const rules = [
    ['ASCII-кавычка «"»', (v) => v.includes('"')],
    ['ASCII-апостроф', (v) => v.includes("'")],
    ['три точки вместо «…»', (v) => v.includes('...')],
    ['дефис вместо тире « — »', (v) => / - /.test(v)],
    ['«<<» / «>>» вместо «»', (v) => v.includes('<<') || v.includes('>>')],
    ['двойной пробел', (v) => v.includes('  ')],
    ['пробел в начале или в конце', (v) => v !== v.trim()],
    ['эмодзи', (v) => /\p{Extended_Pictographic}/u.test(v)],
  ];
  for (const [name, bad] of rules) {
    it(name, () =>
      assert.deepEqual(
        all.filter(([, v]) => bad(v)).map(([p, v]) => `${p}: ${v}`),
        [],
      ),
    );
  }
});

describe('«ё» там, где её пишет эталон', () => {
  const NO_YO =
    /(^|[^А-Яа-яЁё])(Приемк|приемк|Еще|еще|Все равно|подключен|отключен|учет|отчет|ждет|идет|трех|сдает|черн|счет)([^А-Яа-яЁё]|$)/;
  it('нет форм без «ё»', () =>
    assert.deepEqual(
      all.filter(([, v]) => NO_YO.test(v)).map(([p, v]) => `${p}: ${v}`),
      [],
    ));
});

describe('U+00A0 в числах', () => {
  /** Строки, где эталон сам печатает обычный пробел между разрядами. */
  const ALLOW = new Set([
    'Больше 200 000 ₽ — проверьте сумму', // design/ortus/models.js:384 — дословно (PD-27: ошибки эталона повторяются)
  ]);
  it('нет обычного пробела между разрядами', () => {
    const bad = all.filter(([, v]) => /\d \d{3}(?!\d)/.test(v) && !ALLOW.has(v));
    assert.deepEqual(
      bad.map(([p, v]) => `${p}: ${v}`),
      [],
    );
  });
});

describe('ключи', () => {
  const SNAKE = ['errors.problem.', 'errors.client.'];
  it('ASCII camelCase; snake_case — только словари кодов API; errors.http — httpNNN', () => {
    const bad = all
      .map(([p]) => p)
      .filter((p) => {
        const parts = p.split('.');
        const last = parts.at(-1);
        if (SNAKE.some((s) => p.startsWith(s)))
          return !/^[a-z][a-z0-9_]*$/.test(last) || parts.length !== 3;
        if (p.startsWith('errors.http.')) return !/^http\d{3}$/.test(last);
        return parts.some((k) => !/^[a-z][A-Za-z0-9]*$/.test(k));
      });
    assert.deepEqual(bad, []);
  });
});
