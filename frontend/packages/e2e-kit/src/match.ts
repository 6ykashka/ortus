// Пиксельная сверка двух целей (реализация ↔ эталон или эталон ↔ эталон) по корню снимка.
import type { Locator } from '@playwright/test';

import { comparePng, DEFAULT_MAX_DIFF_PIXEL_RATIO } from './compare.ts';
import type { Target } from './reference.ts';

export interface MatchOptions {
  maxDiffPixelRatio?: number;
  mask?: Locator[];
}

export interface MatchResult {
  pass: boolean;
  diffPixels: number;
  ratio: number;
  maxDiffPixelRatio: number;
  message: string;
  expected: Buffer;
  actual: Buffer;
  diff: Buffer | undefined;
}

/** Снимок корня цели в CSS-пикселях, без анимаций и каретки (D-45). */
export async function shootRoot(t: Target, mask: Locator[] = []): Promise<Buffer> {
  return t.root.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', mask });
}

/** Сравнивает `actual` (обычно реализация) с `expected` (эталон). Размеры разные — не проходит. */
export async function matchScreens(
  actual: Target,
  expected: Target,
  o: MatchOptions = {},
): Promise<MatchResult> {
  const max = o.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const [exp, act] = [await shootRoot(expected, o.mask), await shootRoot(actual, o.mask)];
  try {
    const r = comparePng(act, exp, { maxDiffPixelRatio: max });
    const ratio = Number(r.ratio.toFixed(6));
    const message = r.pass
      ? `ok: ${r.diffPixels} px (${ratio}) ≤ maxDiffPixelRatio ${max}`
      : `${r.diffPixels} px отличаются: ${ratio} > maxDiffPixelRatio ${max}`;
    return {
      pass: r.pass,
      diffPixels: r.diffPixels,
      ratio,
      maxDiffPixelRatio: max,
      message,
      expected: exp,
      actual: act,
      diff: r.diff,
    };
  } catch (err) {
    const message = `${(err as Error).message}; maxDiffPixelRatio ${max}`;
    return {
      pass: false,
      diffPixels: Number.NaN,
      ratio: 1,
      maxDiffPixelRatio: max,
      message,
      expected: exp,
      actual: act,
      diff: undefined,
    };
  }
}
