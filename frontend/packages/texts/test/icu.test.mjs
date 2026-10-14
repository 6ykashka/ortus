// W0.14 · ICU MessageFormat: парсер, format(), формы множественного числа ru и валидность всех строк словаря.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL, IcuSyntaxError, argNames, format, parseMessage } from '../src/index.ts';
import { leaves } from './_util.mjs';

const NBSP = ' ';
const DAYS = '{n, plural, one {# день} few {# дня} many {# дней} other {# дня}}';

describe('Intl ru-RU (ICU среды)', () => {
  it('PluralRules ru-RU различает one/few/many/other', () => {
    const pr = new Intl.PluralRules('ru-RU');
    assert.deepEqual(
      [1, 2, 5, 11, 21, 22, 25, 112, 1.5].map((n) => pr.select(n)),
      ['one', 'few', 'many', 'many', 'one', 'few', 'many', 'many', 'other'],
    );
    assert.deepEqual([...pr.resolvedOptions().pluralCategories].sort(), [
      'few',
      'many',
      'one',
      'other',
    ]);
  });

  it('NumberFormat ru-RU группирует разряды U+00A0 и пишет запятую', () => {
    assert.equal(new Intl.NumberFormat('ru-RU').format(84370.5), `84${NBSP}370,5`);
  });
});

describe('format', () => {
  const cases = [
    ['Привет', {}, 'Привет'],
    ['Модуль «{name}» подключён', { name: 'Логистика' }, 'Модуль «Логистика» подключён'],
    [DAYS, { n: 1 }, '1 день'],
    [DAYS, { n: 2 }, '2 дня'],
    [DAYS, { n: 5 }, '5 дней'],
    [DAYS, { n: 11 }, '11 дней'],
    [DAYS, { n: 21 }, '21 день'],
    [DAYS, { n: 112 }, '112 дней'],
    [DAYS, { n: 1.5 }, '1,5 дня'],
    ['{n, plural, =0 {нет} other {# шт.}}', { n: 0 }, 'нет'],
    ['{n, plural, =0 {нет} other {# шт.}}', { n: 3 }, '3 шт.'],
    ['{n}', { n: 84370 }, `84${NBSP}370`],
    ['{n}', { n: '46,2' }, '46,2'],
    ['{who, select, owner {Владелец} other {Сотрудник}}', { who: 'owner' }, 'Владелец'],
    ['{who, select, owner {Владелец} other {Сотрудник}}', { who: 'driver' }, 'Сотрудник'],
    ['{on, select, true { (да)} other {}}.', { on: true }, ' (да).'],
    ['{on, select, true { (да)} other {}}.', { on: false }, '.'],
    [
      '{n, plural, one {# из {limit}} few {# из {limit}} many {# из {limit}} other {# из {limit}}}',
      { n: 3, limit: 10 },
      '3 из 10',
    ],
    ["Скобки '{'n'}' и апостроф ''", {}, "Скобки {n} и апостроф '"],
  ];
  for (const [msg, values, expected] of cases) {
    it(`${msg} ← ${JSON.stringify(values)}`, () => assert.equal(format(msg, values), expected));
  }

  it('пропущенный аргумент — ошибка с именем аргумента', () => {
    assert.throws(() => format('Модуль «{name}»', {}), /name/);
  });

  it('синтаксические ошибки — IcuSyntaxError', () => {
    for (const bad of [
      '{name',
      'текст}',
      '{n, plural, one {#}}',
      '{n, select, a {x}}',
      '{n, plural, one {# день}',
      '{, plural}',
      '{n, number, x}',
    ]) {
      assert.throws(() => parseMessage(bad), IcuSyntaxError, bad);
    }
  });

  it('argNames собирает аргументы, в том числе вложенные', () => {
    assert.deepEqual(argNames('{a} {n, plural, one {# {b}} few {#} many {#} other {#}} {a}'), [
      'a',
      'n',
      'b',
    ]);
    assert.deepEqual(argNames('Без аргументов'), []);
  });
});

describe('каждая строка словаря — валидный ICU', () => {
  const all = Object.entries(ALL).flatMap(([ns, tree]) => leaves(tree, ns));

  it('словарь непустой', () => assert.ok(all.length > 300, `строк: ${all.length}`));

  for (const [path, value] of all) {
    it(path, () => {
      const ast = parseMessage(value);
      const walk = (nodes) => {
        for (const n of nodes) {
          if (n.type === 'argument') {
            assert.match(n.name, /^[a-z][A-Za-z0-9]*$/, `${path}: аргумент ${n.name} не camelCase`);
          }
          if (n.type === 'plural' || n.type === 'select') {
            assert.match(n.name, /^[a-z][A-Za-z0-9]*$/, `${path}: аргумент ${n.name} не camelCase`);
            const keys = Object.keys(n.options);
            assert.ok(keys.includes('other'), `${path}: у ${n.type} нет other`);
            if (n.type === 'plural' && keys.some((k) => ['one', 'few', 'many'].includes(k))) {
              for (const k of ['one', 'few', 'many'])
                assert.ok(keys.includes(k), `${path}: plural без ${k}`);
            }
            for (const sub of Object.values(n.options)) walk(sub);
          }
        }
      };
      walk(ast);
    });
  }
});
