// tools/verify-pages.js: Stop-хук и --check — свежий evidence для изменённых страниц.
// Бриф W0.05 §4.6, §6 п.10.
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { load, read, tempDir } from './_util.mjs';

const mod = await load('tools/verify-pages.js');
const need = (name) => {
  assert.equal(typeof mod[name], 'function', `${name} экспортирован`);
  return mod[name];
};

const REGISTRY = {
  version: 1,
  pages: [
    {
      key: 'modules',
      stage: 1,
      paths: ['frontend/apps/web/src/routes/company/modules/**'],
      reference: 'Ортус CRM.dc.html',
    },
    {
      key: 'shell',
      stage: 1,
      paths: ['frontend/apps/web/src/{app,shell}/**'],
      reference: 'Ортус CRM.dc.html',
    },
    {
      key: 'inbox',
      stage: 1,
      paths: ['frontend/apps/web/src/features/inbox/*.tsx'],
      reference: null,
    },
  ],
};

const EVIDENCE = ['390.png', '768.png', '1440.png', 'snapshot.txt', 'console.txt', 'network.txt'];
const T0 = Date.parse('2026-10-15T10:00:00Z');

/** Временный корень с evidence ключа: `files` — имена, `mtime` — время файлов. */
function evidenceRoot(key, files, mtime) {
  const root = tempDir('ortus-verify-');
  const dir = join(root, 'docs', 'plan', 'evidence', key);
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const p = join(dir, f);
    writeFileSync(p, 'x');
    utimesSync(p, new Date(mtime), new Date(mtime));
  }
  return root;
}

/** Поддельный git: изменённые файлы ветки, статус и время коммита. */
function fakeGit({ diff = [], status = [], commitTs = T0 / 1000 } = {}) {
  return (args) => {
    const cmd = args.join(' ');
    if (cmd.startsWith('merge-base')) return 'abc123\n';
    if (cmd.startsWith('diff --name-only')) return diff.map((f) => `${f}\n`).join('');
    if (cmd.startsWith('status --porcelain')) return status.map((f) => ` M ${f}\n`).join('');
    if (cmd.startsWith('log -1 --format=%ct')) return `${commitTs}\n`;
    throw new Error(`unexpected git ${cmd}`);
  };
}

describe('keysForPaths', () => {
  const keys = (paths) => need('keysForPaths')(paths, REGISTRY);

  it('файл страницы → ключ', () => {
    assert.deepEqual(keys(['frontend/apps/web/src/routes/company/modules/vm/omVM.ts']), [
      'modules',
    ]);
  });

  it('{a,b} и ** в глобе', () => {
    assert.deepEqual(keys(['frontend/apps/web/src/shell/AppShell.tsx']), ['shell']);
    assert.deepEqual(keys(['frontend/apps/web/src/app/main.tsx']), ['shell']);
  });

  it('* не переходит через /', () => {
    assert.deepEqual(keys(['frontend/apps/web/src/features/inbox/Panel.tsx']), ['inbox']);
    assert.deepEqual(keys(['frontend/apps/web/src/features/inbox/x/Panel.tsx']), []);
  });

  it('эталон и чужие файлы — пусто; ключи без повторов, по алфавиту', () => {
    assert.deepEqual(keys(['design/support.js', 'README.md']), []);
    assert.deepEqual(
      keys([
        'frontend/apps/web/src/shell/a.ts',
        'frontend/apps/web/src/routes/company/modules/b.ts',
        'frontend/apps/web/src/shell/c.ts',
      ]),
      ['modules', 'shell'],
    );
  });
});

describe('isFresh', () => {
  const fresh = (root, key, since) => need('isFresh')(join(root, 'docs/plan/evidence', key), since);

  it('нет папки → не свежий', () => {
    const r = fresh(tempDir(), 'modules', T0);
    assert.equal(r.fresh, false);
    assert.match(r.reason, /нет папки/);
  });

  it('5 файлов из 6 → не свежий, в причине — недостающий', () => {
    const root = evidenceRoot('modules', EVIDENCE.slice(0, 5), T0 + 1000);
    const r = fresh(root, 'modules', T0);
    assert.equal(r.fresh, false);
    assert.match(r.reason, /network\.txt/);
  });

  it('6 файлов новее изменения → свежий', () => {
    const root = evidenceRoot('modules', EVIDENCE, T0 + 1000);
    assert.deepEqual(fresh(root, 'modules', T0), { fresh: true, reason: '' });
  });

  it('файл старше изменения → не свежий', () => {
    const root = evidenceRoot('modules', EVIDENCE, T0 - 60_000);
    const r = fresh(root, 'modules', T0);
    assert.equal(r.fresh, false);
    assert.match(r.reason, /старше/);
  });

  it('REQUIRED_EVIDENCE — шесть имён verification-protocol', () => {
    assert.deepEqual(mod.REQUIRED_EVIDENCE, EVIDENCE);
  });
});

describe('main', () => {
  const run = (o) =>
    need('main')({
      argv: [],
      env: {},
      stdin: '',
      registry: REGISTRY,
      git: fakeGit({ diff: ['frontend/apps/web/src/routes/company/modules/x.ts'] }),
      root: tempDir(),
      ...o,
    });

  it('нет свежего evidence → напоминание в stdout, код 0', () => {
    const r = run({});
    assert.equal(r.code, 0);
    assert.match(r.stdout, /verify-pages: нет свежего evidence для: modules/);
    assert.match(r.stdout, /verification-protocol\.md §1–§4/);
  });

  it('VERIFY_PAGES_BLOCK=1 → код 2 и текст в stderr', () => {
    const r = run({ env: { VERIFY_PAGES_BLOCK: '1' } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /нет свежего evidence для: modules/);
  });

  it('Stop-хук с stop_hook_active → всегда 0', () => {
    const r = run({
      argv: ['--hook'],
      env: { VERIFY_PAGES_BLOCK: '1' },
      stdin: '{"stop_hook_active": true}',
    });
    assert.equal(r.code, 0);
  });

  it('--check → код 1 при устаревании', () => {
    assert.equal(run({ argv: ['--check'] }).code, 1);
  });

  it('свежий evidence → код 0 и «свежий»', () => {
    const root = evidenceRoot('modules', EVIDENCE, T0 + 5000);
    const r = run({ argv: ['--check'], root });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /evidence свежий: modules/);
  });

  it('незакоммиченное изменение страницы новее evidence → устарел', () => {
    const root = evidenceRoot('modules', EVIDENCE, T0 + 5000);
    const src = join(root, 'frontend/apps/web/src/routes/company/modules');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'y.ts'), 'x');
    utimesSync(join(src, 'y.ts'), new Date(T0 + 10_000), new Date(T0 + 10_000));
    const r = run({
      argv: ['--check'],
      root,
      git: fakeGit({ status: ['frontend/apps/web/src/routes/company/modules/y.ts'] }),
    });
    assert.equal(r.code, 1);
  });

  it('изменённых страниц нет → код 0', () => {
    const r = run({ argv: ['--check'], git: fakeGit({ diff: ['README.md'] }) });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /изменённых страниц нет/);
  });

  it('пустой реестр → код 0 и «нет страниц в реестре»', () => {
    const r = run({ argv: ['--check'], registry: { version: 1, pages: [] } });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /нет страниц в реестре/);
  });
});

describe('tools/page-keys.json', () => {
  it('схема: version 1, pages[] с key, stage, paths, reference; ключи уникальны', () => {
    const reg = JSON.parse(read('tools/page-keys.json'));
    assert.equal(reg.version, 1);
    assert.ok(Array.isArray(reg.pages));
    const keys = new Set();
    for (const p of reg.pages) {
      assert.match(p.key, /^[a-z][a-z0-9-]*$/);
      assert.ok(!keys.has(p.key), `дубликат ${p.key}`);
      keys.add(p.key);
      assert.ok(Number.isInteger(p.stage) && p.stage >= 1);
      assert.ok(Array.isArray(p.paths) && p.paths.length > 0);
      assert.ok(p.reference === null || p.reference.endsWith('.dc.html'));
    }
  });

  it('validateRegistry отвергает дубликаты и пустые paths', () => {
    const validate = need('validateRegistry');
    assert.deepEqual(validate(REGISTRY), []);
    const bad = { version: 1, pages: [REGISTRY.pages[0], { ...REGISTRY.pages[0], paths: [] }] };
    const errs = validate(bad);
    assert.ok(errs.some((e) => /дубликат/.test(e)));
    assert.ok(errs.some((e) => /paths/.test(e)));
  });
});
