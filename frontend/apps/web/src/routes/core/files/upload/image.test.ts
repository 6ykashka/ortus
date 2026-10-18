// W2.44 · Подготовка фото перед PUT (D-08, модель данных 4, ПДн §6): холст сжимает до 1600 px и перекодирует в
// JPEG 0,85, затем контрольный проход вырезания метаданных; без декодера (jsdom, HEIC в Chromium, битый файл) —
// вырезание из байтов без сжатия. Ни один путь не отправляет геоданные.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fitSize, prepareImage } from './image.ts';
import { heicWithGps, jpegWithGps, leaks } from './metadata.fixtures.test-util.ts';

const bytes = async (b: Blob): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await b.arrayBuffer());
const jpeg = () => new File([jpegWithGps({ orientation: 6 })], 'front.jpg', { type: 'image/jpeg' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Холст jsdom: декодер `createImageBitmap` и 2d-контекст подменены, toBlob отдаёт `encoded`. */
function fakeCanvas(o: { width: number; height: number; encoded?: Blob; decode?: 'fail' }) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      if (o.decode === 'fail')
        throw new DOMException('Формат не поддерживается', 'InvalidStateError');
      return { width: o.width, height: o.height, close };
    }),
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((cb) => cb(o.encoded ?? new Blob([jpegWithGps()], { type: 'image/jpeg' })));
  return { drawImage, toBlob, close };
}

describe('prepareImage', () => {
  it('fitSize: большая сторона не больше 1600 px, пропорции сохраняются', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('без декодера: JPEG с GPS уходит без геоданных, ориентация сохранена', async () => {
    const out = await prepareImage(jpeg());
    const b = await bytes(out);
    expect(leaks(b)).toEqual([]);
    expect(out.type).toBe('image/jpeg');
    expect(b.length).toBeLessThan(jpeg().size);
  });

  it('холст: 4000×3000 → 1600×1200, JPEG 0,85; результат кодировщика проходит вырезание метаданных', async () => {
    const c = fakeCanvas({ width: 4000, height: 3000 });
    const out = await prepareImage(jpeg());
    expect(c.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(c.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(c.close).toHaveBeenCalled();
    expect(leaks(await bytes(out))).toEqual([]);
  });

  it('декодер не читает HEIC: данные Exif и XMP обнулены, файл того же размера и типа', async () => {
    fakeCanvas({ width: 1, height: 1, decode: 'fail' });
    const f = heicWithGps();
    const out = await prepareImage(new File([f.bytes], 'IMG_0001.HEIC', { type: 'image/heic' }));
    expect(leaks(await bytes(out))).toEqual([]);
    expect(out.size).toBe(f.bytes.length);
    expect(out.type).toBe('image/heic');
  });

  it('не изображение — исходный файл', async () => {
    const f = new File([new Uint8Array([7, 7, 7])], 'front.jpg', { type: 'image/jpeg' });
    expect(await prepareImage(f)).toBe(f);
  });
});
