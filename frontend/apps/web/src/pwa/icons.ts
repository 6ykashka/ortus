// W2.24 · Иконки PWA без файлов в репозитории (18-branding: «без файла — первая буква на фирменном цвете»): знак
// «О» — белое кольцо на акценте, PNG RGBA рисуется при сборке и в dev-сервере (плагин pwa()). Кольцо целиком внутри
// безопасной зоны maskable-иконки (круг 80 % стороны), поэтому обычная и maskable отличаются только назначением.
import { deflateSync } from 'node:zlib';

import { ICON_FILES, THEME_COLOR } from './manifest.ts';

export const ICONS: readonly { path: string; size: number; maskable: boolean }[] = ICON_FILES.map(
  (i) => ({ path: i.src, size: i.size, maskable: i.maskable }),
);

/** Радиусы кольца «О» в долях стороны. */
const OUTER = 0.28;
const INNER = 0.18;
/** Подвыборка на пиксель (сглаживание края). */
const SS = 4;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** Доля подвыборок пикселя (x, y), попавших в кольцо. */
function coverage(x: number, y: number, size: number): number {
  const c = size / 2;
  const ro = OUTER * size;
  const ri = INNER * size;
  let hit = 0;
  for (let i = 0; i < SS; i++) {
    for (let j = 0; j < SS; j++) {
      const r = Math.hypot(x + (i + 0.5) / SS - c, y + (j + 0.5) / SS - c);
      if (r <= ro && r >= ri) hit++;
    }
  }
  return hit / (SS * SS);
}

/** PNG иконки `size`×`size`: фон — акцент, белое кольцо «О» по центру (maskable — то же, назначение в манифесте). */
export function iconPng(size: number, maskable: boolean): Uint8Array {
  void maskable;
  const [r, g, b] = rgb(THEME_COLOR);
  const stride = size * 4 + 1;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const k = coverage(x, y, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = Math.round(r + (255 - r) * k);
      raw[o + 1] = Math.round(g + (255 - g) * k);
      raw[o + 2] = Math.round(b + (255 - b) * k);
      raw[o + 3] = 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
