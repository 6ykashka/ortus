// W0.03 · гигиена репозитория: игноры, атрибуты EOL, editorconfig, prettier.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { git, read, readJson } from './_util.mjs';

describe('.gitignore', () => {
  const ignored = [
    'node_modules/x/index.js',
    'frontend/packages/ui/node_modules/x.js',
    '.playwright-mcp/6102/page.png',
    'playwright-report/index.html',
    'test-results/x.txt',
    'frontend/apps/web/src/routeTree.gen.ts',
    '.env',
    '.env.local',
    'backend/bin/api',
    'storybook-static/index.html',
    'coverage/lcov.info',
    'frontend/packages/ui/dist/index.js',
    'tsconfig.tsbuildinfo',
  ];
  for (const path of ignored) {
    it(`игнорирует ${path}`, () => {
      assert.equal(git('check-ignore', '-q', '--no-index', path).status, 0);
    });
  }

  it('не игнорирует .env.example', () => {
    assert.equal(git('check-ignore', '-q', '--no-index', '.env.example').status, 1);
  });
});

describe('.gitattributes', () => {
  const attr = (name, path) => git('check-attr', name, '--', path).stdout.trim();

  it('исходники хранятся с LF', () => {
    assert.match(attr('eol', 'README.md'), /: eol: lf$/);
    assert.match(attr('eol', 'frontend/packages/ui/src/index.ts'), /: eol: lf$/);
  });

  it('эталон design/** не нормализуется (text: unset)', () => {
    assert.match(attr('text', 'design/Ортус CRM.dc.html'), /: text: unset$/);
    assert.match(attr('text', 'design/ortus/models.js'), /: text: unset$/);
  });

  it('вендорные скилы .claude/skills/** не нормализуются (в индексе CRLF)', () => {
    assert.match(attr('text', '.claude/skills/git-commit/SKILL.md'), /: text: unset$/);
  });

  it('pnpm-lock.yaml помечен как генерируемый', () => {
    assert.match(attr('linguist-generated', 'pnpm-lock.yaml'), /: linguist-generated: set$/);
  });

  it('шрифты и картинки бинарные', () => {
    assert.match(attr('binary', 'frontend/packages/tokens/fonts/a.woff2'), /: binary: set$/);
    assert.match(attr('binary', 'x.png'), /: binary: set$/);
  });

  it('атрибуты не «пачкают» эталон и скилы: git status пуст', () => {
    const r = git('status', '--porcelain', '--', 'design', '.claude/skills');
    assert.equal(r.stdout, '');
  });
});

describe('.editorconfig', () => {
  const text = read('.editorconfig');
  it('root, utf-8, LF, финальный перевод строки', () => {
    assert.match(text, /^root = true$/m);
    assert.match(text, /^charset = utf-8$/m);
    assert.match(text, /^end_of_line = lf$/m);
    assert.match(text, /^insert_final_newline = true$/m);
  });
  it('Go и Makefile — табы', () => {
    assert.match(text, /\[\*\.go\]\s*\nindent_style = tab/);
    assert.match(text, /\[Makefile\]\s*\nindent_style = tab/);
  });
});

describe('prettier', () => {
  it('.prettierrc.json: LF, ширина 100', () => {
    const cfg = readJson('.prettierrc.json');
    assert.equal(cfg.endOfLine, 'lf');
    assert.equal(cfg.printWidth, 100);
  });
  it('.prettierignore исключает эталон, скилы, планы и генерируемое', () => {
    const lines = read('.prettierignore').split(/\r?\n/);
    for (const p of ['design/', '.claude/', 'docs/', 'pnpm-lock.yaml', '**/routeTree.gen.ts']) {
      assert.ok(lines.includes(p), `нет строки ${p}`);
    }
  });
});
