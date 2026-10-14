// W0.03 · процесс: CODEOWNERS (план v2 §3.5), шаблоны PR и ADR, CLAUDE.md, README.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exists, read } from './_util.mjs';

describe('CODEOWNERS', () => {
  const lines = (exists('CODEOWNERS') ? read('CODEOWNERS') : '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const rules = lines.map((l) => {
    const [pattern, ...owners] = l.split(/\s+/);
    return { pattern, owners };
  });
  const ownersOf = (pattern) => rules.find((r) => r.pattern === pattern)?.owners ?? [];

  it('первое правило — * (по умолчанию интегратор), у каждого правила есть владелец @…', () => {
    assert.equal(rules[0]?.pattern, '*');
    for (const r of rules) {
      assert.ok(r.owners.length > 0, `${r.pattern} без владельца`);
      for (const o of r.owners) assert.match(o, /^@[\w.-]+(\/[\w.-]+)?$/, `${r.pattern}: ${o}`);
    }
  });

  it('контракт, права, ошибки, миграции, authz, изоляция — два владельца (2 ревьюера)', () => {
    for (const p of [
      'api/**',
      'api/permissions.yaml',
      'api/errors.yaml',
      'backend/migrations/**',
      'backend/internal/platform/authz/**',
      'backend/internal/platform/scopeddb/**',
    ]) {
      assert.ok(ownersOf(p).length >= 2, `${p}: нужно ≥ 2 владельцев`);
    }
  });

  it('финансы — два владельца', () => {
    for (const p of [
      'backend/internal/modules/finance/**',
      'backend/internal/modules/cash/**',
      'backend/internal/modules/fleet/expenses/**',
      'frontend/apps/web/src/routes/spa-cash/cash/**',
    ]) {
      assert.ok(ownersOf(p).length >= 2, `${p}: нужно ≥ 2 владельцев`);
    }
  });

  it('горячие точки §3.5 закреплены за интегратором/стюардом', () => {
    for (const p of [
      'frontend/packages/ui/src/index.ts',
      'backend/cmd/api/router.go',
      'backend/internal/api/**',
      'frontend/packages/api-client/**',
      'pnpm-lock.yaml',
      'backend/go.mod',
      'CLAUDE.md',
      'CODEOWNERS',
      '.github/**',
      'design/**',
    ]) {
      assert.ok(ownersOf(p).length >= 1, `нет правила ${p}`);
    }
  });
});

describe('шаблон PR', () => {
  const text = exists('.github/PULL_REQUEST_TEMPLATE.md')
    ? read('.github/PULL_REQUEST_TEMPLATE.md')
    : '';
  for (const s of [
    'docs/plan/v2/ws/',
    'docs/plan/v2/reports/',
    'test(',
    'mock',
    'stand',
    'allowlist',
    'второй ревьюер',
    'ADR',
  ]) {
    it(`содержит «${s}»`, () => assert.ok(text.includes(s)));
  }
});

describe('шаблон ADR (design/docs/16-raid-glossary.md «Шаблон ADR»)', () => {
  const text = exists('docs/adr/TEMPLATE.md') ? read('docs/adr/TEMPLATE.md') : '';
  for (const s of [
    '# NNNN. ',
    'Статус: предложено | принято | заменено NNNN',
    'Дата: ',
    '## Контекст',
    '## Варианты',
    '## Решение',
    '## Последствия',
  ]) {
    it(`содержит «${s}»`, () => assert.ok(text.includes(s)));
  }
});

describe('CLAUDE.md', () => {
  const text = exists('CLAUDE.md') ? read('CLAUDE.md') : '';
  for (const s of [
    'docs/plan/v2/00-parallel-plan.md',
    'docs/plan/tdd-protocol.md',
    'docs/plan/orchestration.md',
    'docs/plan/verification-protocol.md',
    '§3.5',
    'design/',
    'PowerShell 5.1',
    'corepack pnpm',
    'git commit -F',
    'без BOM',
    '5200 + slot',
    '6100 + slot',
    '7200 + slot',
    '8100 + slot',
    'COMPOSE_PROJECT_NAME',
    'git worktree',
    'go -C backend',
    'golangci-lint',
  ]) {
    it(`содержит «${s}»`, () => assert.ok(text.includes(s)));
  }
  it('короткий: не больше 150 строк', () => {
    assert.ok(text.split('\n').length <= 150);
  });
});

describe('README.md', () => {
  const text = exists('README.md') ? read('README.md') : '';
  it('есть onboarding и ссылка на CLAUDE.md', () => {
    assert.match(text, /^## Onboarding/m);
    assert.ok(text.includes('CLAUDE.md'));
    assert.ok(text.includes('corepack pnpm install'));
  });
});
