import { describe, expect, it } from 'vitest';
import { OUT_CSS, OUT_TS, generate, readTokens } from '../../scripts/generate.mjs';
import { read } from './_css';

describe('сгенерированные файлы совпадают с генератором (corepack pnpm --filter @ortus/tokens gen)', () => {
  const { base, prototype } = readTokens();
  const out = generate(base, prototype);

  it('src/tokens.css', () => {
    expect(read(OUT_CSS)).toBe(out.css);
  });

  it('src/tokens.ts', () => {
    expect(read(OUT_TS)).toBe(out.ts);
  });
});
