import { describe, expect, it } from 'vitest';
import {
  DESIGN_TOKENS_CSS,
  OUT_CSS,
  collect,
  cssVarName,
  readTokens,
} from '../../scripts/generate.mjs';
import { baseDeclarations, normalize, read } from './_css';

describe('паритет src/tokens.css с design/docs/design-system/tokens.css', () => {
  const design = baseDeclarations(read(DESIGN_TOKENS_CSS));
  const ours = baseDeclarations(read(OUT_CSS));

  it('в эталоне 64 объявления (16 цветов, 15 тонов, шрифты, размеры, тени, движение)', () => {
    expect(design.size).toBe(64);
  });

  it('каждое объявление эталона есть с тем же значением', () => {
    const missing: string[] = [];
    for (const [name, value] of design) {
      const got = ours.get(name);
      if (got === undefined || normalize(got) !== normalize(value)) {
        missing.push(`${name}: ждали ${value}, есть ${got ?? '—'}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('лишние переменные выводятся только из tokens.json и prototype.json', () => {
    const { base, prototype } = readTokens();
    const allowed = new Set(
      [...collect(base), ...collect(prototype)].map((leaf) => cssVarName(leaf.path)),
    );
    const extra = [...ours.keys()].filter((n) => !design.has(n) && !allowed.has(n));
    expect(extra).toEqual([]);
  });

  it('хвост: reduced-motion обнуляет оба времени, :focus-visible через --ox-focus', () => {
    const css = read(OUT_CSS);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--ox-motion-fast: 0ms;\s*--ox-motion-base: 0ms;/,
    );
    expect(css).toMatch(
      /:focus-visible \{\s*outline: 2px solid var\(--ox-focus\);\s*outline-offset: 2px;\s*\}/,
    );
  });
});
