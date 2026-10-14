import { describe, expect, it } from 'vitest';
import { collect, cssVarName, readTokens } from '../../scripts/generate.mjs';

describe('prototype.json — алиасы рендера прототипа (PD-28)', () => {
  const { base, prototype } = readTokens();
  const leaves = collect(prototype);

  it('содержит пять алиасов, нужных компонентам этапа 0', () => {
    expect(leaves.map((l) => cssVarName(l.path)).sort()).toEqual([
      '--ox-accent-tint',
      '--ox-control-banner',
      '--ox-danger-hover',
      '--ox-radius-sheet',
      '--ox-scrim',
    ]);
  });

  it('у каждого алиаса ссылка на строку эталона и решение PD-28', () => {
    for (const leaf of leaves) {
      expect(leaf.prototype?.ref, leaf.path.join('.')).toMatch(
        /^(Ортус CRM|Дизайн-система|Документация)\.dc\.html:\d+(–\d+)?$/,
      );
      expect(leaf.prototype?.decision).toBe('PD-28');
    }
  });

  it('алиасы не переопределяют базовые токены', () => {
    const baseNames = new Set(collect(base).map((l) => cssVarName(l.path)));
    expect(leaves.filter((l) => baseNames.has(cssVarName(l.path)))).toEqual([]);
  });
});
