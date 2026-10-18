// W2.44 · Подготовка фото перед PUT (D-08, R-03; модель данных 4, ПДн §6). Перенесено из driver/photos.ts (W2.22):
// холст декодирует файл с учётом ориентации, сжимает до MAX_SIDE по большей стороне и перекодирует в JPEG 0,85;
// результат (и исходный файл, если холст его не читает: HEIC в Chromium и Firefox, jsdom, битый файл) проходит
// вырезание метаданных из байтов — геоданные не уходят ни по одному пути.
import { stripFileMetadata } from './metadata.ts';

/** Большая сторона фото после сжатия на клиенте (D-08, R-03). */
export const MAX_SIDE = 1600;

const JPEG_QUALITY = 0.85;

/** Размер после сжатия: большая сторона не больше MAX_SIDE, пропорции сохраняются. */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** Сжатие и перекодирование холстом; `null` — нет декодера или файл не читается как изображение. */
async function reencode(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) {
      bmp.close();
      return null;
    }
    g.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    return out && out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Фото для загрузки: сжатое холстом или исходное — без геоданных и метаданных съёмки. Не изображение (и
 * изображение без метаданных, которое холст не читает) — исходный файл: проверку содержимого делает сервер.
 */
export async function prepareImage(file: File): Promise<Blob> {
  return stripFileMetadata((await reencode(file)) ?? file);
}
