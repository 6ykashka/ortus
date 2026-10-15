// W1.45 · Ложные аннотации ##[error] в job unit (критика этапа 1, П-9).
// Matcher `go` из actions/setup-go (`^\s*(.+\.go):(?:(\d+):(\d+):)? (.*)`) принимал строки TAP
// `# Subtest: router.go: …` и `ok 4 - router.go: …` за ошибки компилятора. Тесты: симулятор раннера
// воспроизводит дефект и по-прежнему ловит настоящие ошибки; охрана — ни одно имя теста не даёт аннотаций.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import { abs, importIfExists, read, ROOT, runNode } from './_util.mjs';

const MODULE = 'tools/ci/problem-matchers.mjs';
const pm = await importIfExists(MODULE);

function need() {
  assert.ok(pm, `${MODULE} ещё не существует`);
  return pm;
}

// Лог job unit, run 38790795342 (job 116615652760), строки 3113–3135 без префикса раннера.
// На GitHub из этого куска — ровно 6 аннотаций уровня failure на `.github`.
const RUN_38790795342 = [
  '# Subtest: рендер Go',
  '    # Subtest: файлы помечены как сгенерированные (golangci-lint их пропускает)',
  '    ok 1 - файлы помечены как сгенерированные (golangci-lint их пропускает)',
  '      ---',
  '      duration_ms: 4.068568',
  "      type: 'test'",
  '      ...',
  '    # Subtest: operations.gen.go: строка операции с правами',
  '    ok 2 - operations.gen.go: строка операции с правами',
  '      ---',
  '      duration_ms: 2.559099',
  "      type: 'test'",
  '      ...',
  '    # Subtest: problems.gen.go: код → статус и title',
  '    ok 3 - problems.gen.go: код → статус и title',
  '      ---',
  '      duration_ms: 0.292726',
  "      type: 'test'",
  '      ...',
  '    # Subtest: router.go: Servers с полем на тег; тег без реализации — 501',
  '    ok 4 - router.go: Servers с полем на тег; тег без реализации — 501',
  '      ---',
  '      duration_ms: 0.439581',
  "      type: 'test'",
  '      ...',
  '    # Subtest: рендер детерминирован',
  '    ok 5 - рендер детерминирован',
];

describe('симулятор problem matcher (раннер GitHub Actions)', () => {
  it('T-1: кусок лога run 38790795342 → 6 аннотаций go, как на GitHub', () => {
    const got = need().annotate(RUN_38790795342);
    assert.deepEqual(
      got.map((a) => [a.owner, a.message]),
      [
        ['go', 'строка операции с правами'],
        ['go', 'строка операции с правами'],
        ['go', 'код → статус и title'],
        ['go', 'код → статус и title'],
        ['go', 'Servers с полем на тег; тег без реализации — 501'],
        ['go', 'Servers с полем на тег; тег без реализации — 501'],
      ],
    );
    assert.deepEqual(
      got.map((a) => a.logLine),
      [8, 9, 14, 15, 20, 21],
    );
    assert.equal(got[1].file, 'ok 2 - operations.gen.go');
  });

  it('T-2: тест Go не компилируется → аннотация go с файлом, строкой и колонкой', () => {
    const got = need().annotate([
      '# github.com/ortus/ortus-crm/backend/internal/modules/access/roles [github.com/ortus/ortus-crm/backend/internal/modules/access/roles.test]',
      'internal/modules/access/roles/roles_test.go:42:2: undefined: wantStatus',
      'FAIL\tgithub.com/ortus/ortus-crm/backend/internal/modules/access/roles [build failed]',
    ]);
    assert.equal(got.length, 1);
    assert.deepEqual(
      [got[0].owner, got[0].file, got[0].line, got[0].column, got[0].message],
      ['go', 'internal/modules/access/roles/roles_test.go', '42', '2', 'undefined: wantStatus'],
    );
  });

  // Шаблон setup-go требует строку И колонку (`(?:(\d+):(\d+):)?`), поэтому `x_test.go:42: msg` из
  // t.Errorf он не ловит — так было и до W1.45: упавший go test виден по коду выхода шага.
  it('T-2: строка t.Errorf (файл:строка без колонки) matcher go не ловит — как на GitHub', () => {
    assert.deepEqual(
      need().annotate([
        '--- FAIL: TestRoles (0.00s)',
        '    roles_test.go:42: want 403, got 200',
        'FAIL',
      ]),
      [],
    );
  });

  it('T-2: ошибка компилятора Go (файл:строка:колонка) → аннотация go', () => {
    const [a] = need().annotate(['internal/api/fleet/fleet.gen.go:12:3: undefined: Foo']);
    assert.deepEqual(
      [a.owner, a.file, a.line, a.column, a.message],
      ['go', 'internal/api/fleet/fleet.gen.go', '12', '3', 'undefined: Foo'],
    );
  });

  it('T-2: tsc, eslint stylish и compact (setup-node) ловятся', () => {
    const { annotate } = need();
    const [tsc] = annotate([
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    ]);
    assert.deepEqual(
      [tsc.owner, tsc.file, tsc.line, tsc.severity, tsc.code],
      ['tsc', 'src/a.ts', '3', 'error', '2322'],
    );

    const stylish = annotate([
      '/repo/frontend/apps/web/src/main.tsx',
      "  12:5  error  'x' is assigned a value but never used  no-unused-vars",
      '  14:1  warning  Unexpected console statement  no-console',
      '',
    ]);
    assert.deepEqual(
      stylish.map((a) => [a.owner, a.file, a.line, a.severity]),
      [
        ['eslint-stylish', '/repo/frontend/apps/web/src/main.tsx', '12', 'error'],
        ['eslint-stylish', '/repo/frontend/apps/web/src/main.tsx', '14', 'warning'],
      ],
    );

    const [compact] = annotate(['/repo/a.js: line 1, col 2, Error - Unexpected var (no-var)']);
    assert.deepEqual(
      [compact.owner, compact.line, compact.code],
      ['eslint-compact', '1', 'no-var'],
    );
  });

  it('проходящие строки TAP и spec с «.go —» вместо двоеточия аннотаций не дают', () => {
    assert.deepEqual(
      need().annotate([
        'TAP version 13',
        '# Subtest: operations.gen.go — строка операции с правами',
        'ok 1 - operations.gen.go — строка операции с правами',
        '✔ router.go — Servers с полем на тег (0.4ms)',
        'ok  \tgithub.com/ortus/ortus-crm/backend/cmd/api\t1.2s',
      ]),
      [],
    );
  });
});

describe('копия matcher-ов совпадает с action, закреплёнными в ci.yml', () => {
  it('T-3: SHA setup-go и setup-node в SOURCES — те же, что в uses: job unit', () => {
    const { SOURCES, MATCHERS } = need();
    const wf = parse(read('.github/workflows/ci.yml'));
    const uses = wf.jobs.unit.steps.map((s) => s.uses).filter(Boolean);
    for (const action of ['actions/setup-go', 'actions/setup-node']) {
      const pinned = uses.find((u) => u.startsWith(`${action}@`));
      assert.ok(pinned, `job unit без ${action}`);
      const src = SOURCES.find((s) => s.action === action);
      assert.ok(src, `SOURCES без ${action}`);
      assert.equal(`${src.action}@${src.sha}`, pinned, `${action}: обнови копию matcher-ов`);
    }
    assert.deepEqual(MATCHERS.map((m) => m.owner).sort(), [
      'eslint-compact',
      'eslint-stylish',
      'go',
      'tsc',
    ]);
    // Шаблон go — дословно из matchers.json setup-go (b7ad1dad…).
    const go = MATCHERS.find((m) => m.owner === 'go');
    assert.equal(go.pattern[0].regexp, '^\\s*(.+\\.go):(?:(\\d+):(\\d+):)? (.*)');
  });
});

// Имя теста — строковый литерал первого аргумента it/test/describe/suite (и t.test).
const NAME_RE =
  /(?:^|[^.\w$])(?:(?:it|test|describe|suite)(?:\.(?:only|skip|todo|concurrent|sequential|fixme|serial|parallel))?|t\.test)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gm;

function testNames() {
  const r = spawnSync(
    'git',
    [
      'ls-files',
      '-z',
      '--',
      '*.test.mjs',
      '*.test.js',
      '*.test.cjs',
      '*.test.ts',
      '*.test.tsx',
      '*.test.mts',
      '*.spec.ts',
      '*.spec.tsx',
      '*.spec.mjs',
      ':!design/**',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.split('\0').filter(Boolean);
  const names = [];
  for (const file of files) {
    const text = readFileSync(abs(file), 'utf8');
    for (const m of text.matchAll(NAME_RE)) {
      names.push({ file, name: m[2].replace(/\$\{[^}]*\}/g, 'x') });
    }
  }
  return { files, names };
}

// Как имя попадает в лог: TAP (node --test в CI без TTY), spec, vitest, Playwright list.
const renderings = (name) => [
  `# Subtest: ${name}`,
  `    # Subtest: ${name}`,
  `ok 1 - ${name}`,
  `    ok 12 - ${name}`,
  `not ok 3 - ${name}`,
  `✔ ${name} (0.4ms)`,
  `▶ ${name}`,
  `  ✓ ${name} 3ms`,
  `frontend/packages/texts test: ok 1 - ${name}`,
];

describe('охрана: имена тестов не похожи на ошибки компилятора', () => {
  it('T-4: ни одно имя теста в репозитории не даёт аннотаций matcher-ов job', () => {
    const { annotate } = need();
    const { files, names } = testNames();
    assert.ok(files.length > 100, `нашлось только ${files.length} файлов тестов`);
    assert.ok(names.length > 1000, `нашлось только ${names.length} имён`);
    const bad = names.filter(({ name }) => annotate(renderings(name)).length > 0);
    assert.deepEqual(
      bad.map(({ file, name }) => `${file}: ${name}`),
      [],
      'имя вида «<файл>.go: …» матчер setup-go принимает за ошибку — пиши «<файл>.go — …»',
    );
  });

  it('T-5: реальный прогон tools/gen/codegen.test.mjs (TAP) → 0 аннотаций', () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', abs('tools/gen/codegen.test.mjs')],
      // Без NODE_TEST_CONTEXT: иначе вложенный node --test пишет родителю не TAP, а свой поток событий.
      { cwd: ROOT, encoding: 'utf8', env },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
    assert.ok(out.some((l) => /# Subtest: /.test(l)));
    assert.deepEqual(
      need()
        .annotate(out)
        .map((a) => out[a.logLine - 1]),
      [],
    );
  });
});

describe('CLI: локальное воспроизведение', () => {
  it('T-6: вывод с ошибкой компиляции Go → код 1 и строка аннотации; чистый вывод → 0', () => {
    need();
    const bad = runNode(MODULE, ['-'], {
      input: 'ok 1 - чисто\n./x_test.go:7:2: boom\n',
    });
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stdout, /^2: \[go\] error \.\/x_test\.go:7:2 — boom$/m);
    assert.match(bad.stdout, /аннотаций: 1/);

    const ok = runNode(MODULE, ['-'], { input: 'TAP version 13\nok 1 - всё хорошо\n' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /аннотаций: 0/);
  });
});
