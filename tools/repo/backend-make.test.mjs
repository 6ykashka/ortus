// W0.03 · Go-модуль backend и Makefile (цели ≡ скрипты корневого package.json).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exists, read, readJson, run } from './_util.mjs';

describe('backend/go.mod', () => {
  const text = exists('backend/go.mod') ? read('backend/go.mod') : '';

  it('module github.com/ortus/ortus-crm/backend, go 1.26', () => {
    assert.equal(text.split('\n')[0], 'module github.com/ortus/ortus-crm/backend');
    assert.match(text, /^go 1\.26(\.\d+)?$/m);
  });

  it('каталоги cmd/ и internal/ есть в git (.gitkeep)', () => {
    assert.ok(exists('backend/cmd/.gitkeep'));
    assert.ok(exists('backend/internal/.gitkeep'));
  });

  it('в модуле есть хотя бы один пакет: go test/vet ./... не падают на «no packages»', () => {
    assert.ok(exists('backend/doc.go'));
    assert.match(read('backend/doc.go'), /^package backend$/m);
  });
});

describe('backend/.golangci.yml', () => {
  const text = exists('backend/.golangci.yml') ? read('backend/.golangci.yml') : '';

  it('формат v2, build-теги integration/isolation/concurrency', () => {
    assert.match(text, /^version: "2"$/m);
    assert.match(text, /build-tags:\s*\[integration, isolation, concurrency\]/);
  });

  it('depguard включён: модули не импортируют control и чужие internal', () => {
    assert.match(text, /^\s+- depguard\b/m);
    assert.match(text, /files:\s*\[\s*["']\*\*\/internal\/modules\/\*\*["']\s*\]/);
    assert.match(text, /list-mode: strict/);
  });
});

/** Цели Makefile, у которых нет одноимённого скрипта (help — справка make, install — lifecycle pnpm). */
const MAKE_ONLY = new Set(['help', 'install']);
const TARGETS = [
  'help',
  'install',
  'lint',
  'format',
  'typecheck',
  'test',
  'build',
  'dev',
  'gen',
  'up',
  'down',
  'migrate',
  'seed',
  'examples',
];

describe('Makefile', () => {
  const text = exists('Makefile') ? read('Makefile') : '';
  const declared = [...text.matchAll(/^([a-z][a-z0-9-]*):/gm)].map((m) => m[1]);
  const recipes = text.split('\n').filter((l) => l.startsWith('\t'));

  it('объявлены все цели контракта и .PHONY', () => {
    for (const t of TARGETS) assert.ok(declared.includes(t), `нет цели ${t}`);
    assert.match(text, /^\.PHONY:/m);
  });

  it('у каждой цели (кроме help/install) есть одноимённый скрипт package.json', () => {
    const scripts = readJson('package.json').scripts;
    for (const t of declared.filter((d) => !MAKE_ONLY.has(d))) {
      assert.ok(scripts[t], `цель ${t} без скрипта package.json`);
    }
  });

  it('рецепты — один вызов $(PNPM) run <цель>, без &&, ||, |', () => {
    for (const r of recipes) {
      assert.doesNotMatch(r, /&&|\|\||\s\|\s/, r);
    }
    for (const t of declared.filter((d) => !MAKE_ONLY.has(d))) {
      assert.match(text, new RegExp(`^${t}:.*\\n\\t\\$\\(PNPM\\) run ${t}$`, 'm'), `рецепт ${t}`);
    }
  });
});

describe('stub-target.mjs', () => {
  it('заглушка цели: exit 2 и владелец в stderr', () => {
    const r = run(process.execPath, ['tools/repo/stub-target.mjs', 'gen', 'W0.09']);
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'gen: заглушка W0.03, реализует W0.09');
  });

  it('скрипты-заглушки package.json указывают владельцев карточек §4', () => {
    const scripts = readJson('package.json').scripts;
    const owners = {
      gen: 'W0.09',
      examples: 'W0.13',
    };
    for (const [t, owner] of Object.entries(owners)) {
      assert.equal(scripts[t], `node tools/repo/stub-target.mjs ${t} ${owner}`);
    }
  });

  it('цели стенда W0.06 (up, down, migrate, seed) вызывают deploy/compose/stand.mjs', () => {
    const scripts = readJson('package.json').scripts;
    for (const t of ['up', 'down', 'migrate', 'seed']) {
      assert.equal(scripts[t], `node deploy/compose/stand.mjs ${t}`);
    }
  });
});
