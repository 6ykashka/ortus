// Пиксельная сверка снимков (порог maxDiffPixelRatio 0.01, D-22). Бриф W0.05 §4.2, §6 п.5.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PNG } from 'pngjs';

import type * as Compare from '../src/compare.ts';
import { load } from './_load.ts';

const m = await load<typeof Compare>('../src/compare.ts');

function cmp(
  ...args: Parameters<typeof Compare.comparePng>
): ReturnType<typeof Compare.comparePng> {
  assert.equal(typeof m.comparePng, 'function', 'comparePng экспортирован');
  return (m.comparePng as typeof Compare.comparePng)(...args);
}

/** PNG width×height, залитый цветом; первые `changed` пикселей — красные. */
function png(width: number, height: number, changed = 0): Buffer {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const red = i < changed;
    img.data[i * 4] = red ? 255 : 230;
    img.data[i * 4 + 1] = red ? 0 : 233;
    img.data[i * 4 + 2] = red ? 0 : 227;
    img.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(img);
}

describe('comparePng', () => {
  it('одинаковые снимки → 0 пикселей, ratio 0, pass', () => {
    const r = cmp(png(390, 100), png(390, 100));
    assert.equal(r.diffPixels, 0);
    assert.equal(r.ratio, 0);
    assert.equal(r.pass, true);
    assert.equal(r.width, 390);
    assert.equal(r.height, 100);
    assert.ok(Buffer.isBuffer(r.diff));
  });

  it('1 % пикселей отличается → ratio ≈ 0.01, проходит порог 0.01', () => {
    const r = cmp(png(100, 100), png(100, 100, 100));
    assert.equal(r.diffPixels, 100);
    assert.equal(r.ratio, 0.01);
    assert.equal(r.pass, true);
  });

  it('больше порога → pass = false', () => {
    const r = cmp(png(100, 100), png(100, 100, 101));
    assert.equal(r.pass, false);
    const strict = cmp(png(100, 100), png(100, 100, 1), { maxDiffPixelRatio: 0 });
    assert.equal(strict.pass, false);
  });

  it('разные размеры → ошибка size mismatch', () => {
    assert.throws(() => cmp(png(390, 844), png(390, 900)), /size mismatch 390×844 vs 390×900/);
  });

  it('порог по умолчанию — 0.01 (D-22)', () => {
    assert.equal(m.DEFAULT_MAX_DIFF_PIXEL_RATIO, 0.01);
  });
});
