// W0.03 · pnpm workspace, корневой package.json и заглушки всех пакетов дерева
// (docs/plan/v2/analysis/D-plan-reconciliation.md §2, владельцы — план v2 §4 «Этап 0»).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exists, read, readJson } from './_util.mjs';

/** Каталог → [имя пакета, владелец заглушки]. Контракт брифа W0.03 §4.2. */
export const PACKAGES = {
  'frontend/apps/web': ['@ortus/web', 'W0.09'],
  'frontend/packages/tokens': ['@ortus/tokens', 'W0.10'],
  'frontend/packages/ui': ['@ortus/ui', 'W0.10'],
  'frontend/packages/domain': ['@ortus/domain', 'W0.11'],
  'frontend/packages/adapter': ['@ortus/adapter', 'W0.13'],
  'frontend/packages/texts': ['@ortus/texts', 'W0.14'],
  'frontend/packages/e2e-kit': ['@ortus/e2e-kit', 'W0.05'],
  'frontend/packages/api-client': ['@ortus/api-client', 'W0.09'],
};

/** Скрипты корневого package.json (бриф W0.03 §4.1). */
export const ROOT_SCRIPTS = [
  'lint',
  'lint:js',
  'lint:go',
  'format',
  'format:check',
  'typecheck',
  'test',
  'test:repo',
  'test:go',
  'build',
  'dev',
  'gen',
  'up',
  'down',
  'migrate',
  'seed',
  'examples',
  'prepare',
];

describe('корневой package.json', () => {
  const pkg = exists('package.json') ? readJson('package.json') : {};

  it('приватный, pnpm 9 через corepack (packageManager с точной версией)', () => {
    assert.equal(pkg.private, true);
    assert.match(pkg.packageManager ?? '', /^pnpm@9\.\d+\.\d+$/);
  });

  it('Node 22 (engines и .nvmrc), engine-strict', () => {
    assert.equal(pkg.engines?.node, '>=22.12 <23');
    assert.equal(read('.nvmrc').trim(), '22');
    assert.match(read('.npmrc'), /^engine-strict=true$/m);
  });

  it('все скрипты контракта на месте', () => {
    for (const s of ROOT_SCRIPTS) assert.ok(pkg.scripts?.[s], `нет скрипта ${s}`);
  });

  it('скрипт install не объявлен (это хук жизненного цикла pnpm)', () => {
    assert.equal(pkg.scripts?.install, undefined);
  });

  it('devDependencies закреплены точными версиями', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(Object.keys(deps).length > 0, 'нет devDependencies');
    for (const [name, v] of Object.entries(deps)) {
      assert.match(v, /^\d+\.\d+\.\d+$/, `${name}@${v} — не точная версия`);
    }
  });
});

describe('pnpm-workspace.yaml', () => {
  it('объявляет frontend/apps/* и frontend/packages/*', () => {
    const text = exists('pnpm-workspace.yaml') ? read('pnpm-workspace.yaml') : '';
    assert.match(text, /^packages:\s*$/m);
    assert.match(text, /^\s+- ['"]?frontend\/apps\/\*['"]?\s*$/m);
    assert.match(text, /^\s+- ['"]?frontend\/packages\/\*['"]?\s*$/m);
  });

  it('pnpm-lock.yaml закоммичен рядом', () => {
    assert.ok(exists('pnpm-lock.yaml'));
  });
});

describe('frontend/tsconfig.base.json', () => {
  it('strict, noUncheckedIndexedAccess, bundler', () => {
    const { compilerOptions: o } = readJson('frontend/tsconfig.base.json');
    assert.equal(o.strict, true);
    assert.equal(o.noUncheckedIndexedAccess, true);
    assert.equal(o.moduleResolution, 'bundler');
    assert.equal(o.jsx, 'react-jsx');
  });
});

describe('заглушки пакетов', () => {
  for (const [dir, [name, owner]] of Object.entries(PACKAGES)) {
    it(`${dir} → ${name} (владелец ${owner})`, () => {
      assert.ok(exists(`${dir}/package.json`), `нет ${dir}/package.json`);
      const pkg = readJson(`${dir}/package.json`);
      assert.equal(pkg.name, name);
      assert.equal(pkg.private, true);
      assert.equal(pkg.type, 'module');
      assert.match(pkg.scripts?.typecheck ?? '', /^tsc -p tsconfig\.json --noEmit$/);

      const ts = readJson(`${dir}/tsconfig.json`);
      assert.equal(ts.extends, '../../tsconfig.base.json');
      assert.deepEqual(ts.include, ['src']);

      const head = read(`${dir}/src/index.ts`).split('\n').slice(0, 3).join('\n');
      assert.match(head, new RegExp(`@stub Owner: ${owner.replace('.', '\\.')}\\b`));
    });
  }
});
