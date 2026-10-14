// Пиксельная сверка снимков: pixelmatch поверх pngjs, порог maxDiffPixelRatio (D-22).
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01;
/** Чувствительность к цвету одного пикселя (0…1), как у Playwright toHaveScreenshot. */
export const DEFAULT_THRESHOLD = 0.2;

export interface CompareOptions {
  maxDiffPixelRatio?: number;
  threshold?: number;
}

export interface CompareResult {
  width: number;
  height: number;
  diffPixels: number;
  ratio: number;
  pass: boolean;
  diff: Buffer;
}

/** Сравнивает два PNG одинакового размера; разные размеры — ошибка `size mismatch`. */
export function comparePng(a: Buffer, b: Buffer, o: CompareOptions = {}): CompareResult {
  const max = o.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`size mismatch ${left.width}×${left.height} vs ${right.width}×${right.height}`);
  }
  const { width, height } = left;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(left.data, right.data, diff.data, width, height, {
    threshold: o.threshold ?? DEFAULT_THRESHOLD,
  });
  const ratio = diffPixels / (width * height);
  return { width, height, diffPixels, ratio, pass: ratio <= max, diff: PNG.sync.write(diff) };
}
