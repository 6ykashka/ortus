// W0.14 · Контракт пакета: генерируемый index.ts, замороженные ключи, экспорт, отсутствие зависимостей.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import * as texts from '../src/index.ts';
import { PKG, camel, domainFiles, leaves, readJson, readText } from './_util.mjs';

const DOMAINS = [
  'banners',
  // W4.41: домен страницы «Календарь» (core-calendar, CAL-01…05).
  'calendar',
  'company',
  // W2.26: домен страницы «Данные» (`core-data`, S2-16).
  'data',
  'errors',
  'gate',
  'home',
  'logistics-driver',
  'logistics-manager',
  'platform',
  'screen-labels',
  'shell',
  'toast',
];

describe('файлы доменов', () => {
  it('13 доменов этапов 0–4', () =>
    assert.deepEqual(
      domainFiles(),
      DOMAINS.map((d) => `${d}.ts`),
    ));

  for (const f of DOMAINS.map((d) => `${d}.ts`)) {
    it(`${f} экспортирует ровно одно значение ${camel(f)}`, async () => {
      const mod = await import(pathToFileURL(join(PKG, 'src', f)).href);
      assert.deepEqual(Object.keys(mod), [camel(f)]);
      assert.ok(leaves(mod[camel(f)]).length > 0, `${f} пустой`);
    });
  }
});

describe('index.ts', () => {
  it('совпадает с выводом scripts/gen-index.mjs (не правится руками)', async () => {
    const { renderIndex } = await import(pathToFileURL(join(PKG, 'scripts', 'gen-index.mjs')).href);
    assert.equal(readText(join(PKG, 'src', 'index.ts')), renderIndex());
  });

  it('экспортирует 13 пространств, ALL и ICU-функции', () => {
    for (const d of DOMAINS) assert.ok(texts[camel(`${d}.ts`)], `нет экспорта ${camel(`${d}.ts`)}`);
    assert.deepEqual(Object.keys(texts.ALL).sort(), DOMAINS.map((d) => camel(`${d}.ts`)).sort());
    for (const fn of ['format', 'parseMessage', 'argNames'])
      assert.equal(typeof texts[fn], 'function', fn);
    assert.equal(typeof texts.IcuSyntaxError, 'function');
  });
});

describe('contract/keys.json — только добавление', () => {
  const keys = readJson(join(PKG, 'contract', 'keys.json'));
  const now = Object.entries(texts.ALL)
    .flatMap(([ns, t]) => leaves(t, ns))
    .map(([p]) => p);

  it('каждый замороженный ключ существует (удаление и переименование запрещены)', () => {
    const set = new Set(now);
    assert.deepEqual(
      keys.filter((k) => !set.has(k)),
      [],
    );
  });

  it('каждый ключ словаря зарегистрирован (node scripts/gen-index.mjs --keys)', () => {
    const set = new Set(keys);
    assert.deepEqual(
      now.filter((k) => !set.has(k)),
      [],
    );
  });

  it('без повторов', () => assert.equal(new Set(keys).size, keys.length));
});

describe('package.json', () => {
  const pkg = readJson(join(PKG, 'package.json'));
  it('лист графа: нет dependencies', () => assert.equal(pkg.dependencies, undefined));
  it('экспорт «.» → src/index.ts', () => assert.equal(pkg.exports['.'], './src/index.ts'));
  it('скрипты test, typecheck, gen', () => {
    assert.match(pkg.scripts.typecheck, /^tsc -p tsconfig\.json --noEmit/);
    assert.ok(pkg.scripts.test && pkg.scripts.gen);
  });
});
