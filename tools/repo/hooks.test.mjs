// W0.03 · git-хуки (husky), lint-staged, commitlint, ESLint flat config.
// verification-protocol.md §6: pre-commit — lint-staged; pre-push — test и e2e-smoke изменённых страниц.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abs, exists, read, readJson, run } from './_util.mjs';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

describe('.husky', () => {
  it('pre-commit запускает lint-staged', () => {
    assert.match(read('.husky/pre-commit'), /^lint-staged\b/m);
  });
  it('commit-msg: сначала проверка BOM, затем commitlint --edit', () => {
    const text = read('.husky/commit-msg');
    assert.match(text, /node tools\/repo\/commit-msg-bom\.mjs "\$1"/);
    assert.match(text, /commitlint --edit "\$1"/);
    assert.ok(text.indexOf('commit-msg-bom') < text.indexOf('commitlint'));
  });
  it('pre-push: тесты и решение о smoke', () => {
    const text = read('.husky/pre-push');
    assert.match(text, /pnpm run test/);
    assert.match(text, /node tools\/repo\/pre-push\.mjs/);
  });
});

describe('.lintstagedrc.json', () => {
  const cfg = exists('.lintstagedrc.json') ? readJson('.lintstagedrc.json') : {};
  const find = (ext) => Object.entries(cfg).find(([glob]) => glob.includes(ext))?.[1];
  const asList = (v) => (Array.isArray(v) ? v : [v]);

  it('*.go → gofmt -w', () => {
    assert.deepEqual(asList(find('go')), ['gofmt -w']);
  });
  it('ts/tsx → eslint --fix, затем prettier', () => {
    const cmds = asList(find('tsx'));
    assert.match(cmds[0], /^eslint --fix/);
    assert.match(cmds.at(-1), /^prettier --write/);
  });
  it('md/json/yaml → prettier', () => {
    assert.match(asList(find('md')).join(' '), /prettier --write/);
  });
});

describe('commit-msg-bom', async () => {
  const mod = exists('tools/repo/commit-msg-bom.mjs')
    ? await import(new URL(`file:///${abs('tools/repo/commit-msg-bom.mjs')}`).href)
    : {};

  it('checkBom: сообщение без BOM принимается', () => {
    assert.deepEqual(mod.checkBom(Buffer.from('feat(w0.03): каркас\n')), { ok: true });
  });
  it('checkBom: сообщение с BOM отклоняется с понятной причиной', () => {
    const r = mod.checkBom(Buffer.concat([BOM, Buffer.from('feat(w0.03): каркас\n')]));
    assert.equal(r.ok, false);
    assert.match(r.reason, /BOM \(EF BB BF\)/);
  });
  it('CLI: exit 1 на BOM, exit 0 без BOM', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'w003-bom-'));
    const bad = join(dir, 'bad.txt');
    const good = join(dir, 'good.txt');
    writeFileSync(bad, Buffer.concat([BOM, Buffer.from('feat: x\n')]));
    writeFileSync(good, 'feat: x\n');
    const r1 = run(process.execPath, ['tools/repo/commit-msg-bom.mjs', bad]);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /BOM/);
    assert.equal(run(process.execPath, ['tools/repo/commit-msg-bom.mjs', good]).status, 0);
  });
});

describe('commitlint (Conventional Commits)', () => {
  const cli = abs('node_modules/@commitlint/cli/cli.js');
  const lint = (msg) => run(process.execPath, [cli], { input: msg });

  it('commitlint.config.mjs расширяет @commitlint/config-conventional', () => {
    assert.match(read('commitlint.config.mjs'), /@commitlint\/config-conventional/);
  });

  for (const ok of [
    'feat(w0.03): каркас репозитория',
    'chore: начальный снимок репозитория',
    'test(w0.03)!: Заголовок с заглавной буквы',
    'docs(w0.03): бриф\n\nОчень длинная строка тела коммита, которая заметно длиннее ста символов и всё равно допустима, потому что это только предупреждение.',
  ]) {
    it(
      `принимает «${ok.split('\n')[0]}»`,
      {
        skip: !exists('node_modules/@commitlint/cli') && 'нет node_modules: corepack pnpm install',
      },
      () => {
        const r = lint(ok);
        assert.equal(r.status, 0, r.stdout + r.stderr);
      },
    );
  }

  for (const bad of ['update stuff', 'Feat: x', 'feat(W0.03): x', 'feat: ']) {
    it(
      `отклоняет «${bad}»`,
      {
        skip: !exists('node_modules/@commitlint/cli') && 'нет node_modules: corepack pnpm install',
      },
      () => {
        assert.notEqual(lint(bad).status, 0);
      },
    );
  }
});

describe('pre-push', async () => {
  const mod = exists('tools/repo/pre-push.mjs')
    ? await import(new URL(`file:///${abs('tools/repo/pre-push.mjs')}`).href)
    : {};

  it('изменена страница и есть playwright.config → smoke запускается', () => {
    const r = mod.decide({
      changed: ['frontend/apps/web/src/routes/home/x.tsx'],
      hasPlaywright: true,
    });
    assert.equal(r.runSmoke, true);
  });
  it('нет playwright.config → smoke пропущен с причиной', () => {
    const r = mod.decide({
      changed: ['frontend/apps/web/src/routes/home/x.tsx'],
      hasPlaywright: false,
    });
    assert.deepEqual(r, {
      runSmoke: false,
      message: 'smoke пропущен: нет frontend/apps/web/playwright.config.ts',
    });
  });
  it('страницы не менялись → smoke пропущен с причиной', () => {
    const r = mod.decide({ changed: ['docs/plan/x.md', 'backend/doc.go'], hasPlaywright: true });
    assert.deepEqual(r, { runSmoke: false, message: 'smoke пропущен: нет изменений страниц' });
  });
  it('изменение в packages/ui тоже меняет страницы', () => {
    assert.equal(
      mod.decide({ changed: ['frontend/packages/ui/src/core/Button.tsx'], hasPlaywright: true })
        .runSmoke,
      true,
    );
  });
});

describe('eslint.config.mjs', () => {
  const eslint = abs('node_modules/eslint/bin/eslint.js');
  const printConfig = (file) => run(process.execPath, [eslint, '--print-config', file]);

  it(
    'TypeScript-файлы линтуются правилами typescript-eslint',
    { skip: !exists('node_modules/eslint') && 'нет node_modules' },
    () => {
      const r = printConfig('frontend/packages/ui/src/index.ts');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /@typescript-eslint\/no-explicit-any/);
    },
  );
  it(
    'tsx — ещё и правила react-hooks',
    { skip: !exists('node_modules/eslint') && 'нет node_modules' },
    () => {
      const r = printConfig('frontend/apps/web/src/App.tsx');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /react-hooks\/rules-of-hooks/);
    },
  );
  it(
    'эталон design/ игнорируется',
    { skip: !exists('node_modules/eslint') && 'нет node_modules' },
    () => {
      const r = printConfig('design/ortus/models.js');
      assert.match(r.stdout + r.stderr, /undefined|ignored/i);
    },
  );
});
