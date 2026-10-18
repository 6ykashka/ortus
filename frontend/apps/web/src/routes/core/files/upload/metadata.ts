// W2.44 · Геоданные и прочие метаданные съёмки вырезаются из байтов фото до загрузки (модель данных 4: «EXIF-геоданные
// вырезать на клиенте», ПДн §6 — геоданные не собирать). Работает без декодера изображений: путь, когда холст не
// читает файл (HEIC в Chromium и Firefox, битый файл) и когда перекодирование холстом уже сделано (контрольный проход).
// Форматы фото сервера (FILE-02: JPEG, PNG, WebP, HEIC):
//   JPEG — COM и все APPn, кроме APP0 (JFIF), APP2 ICC_PROFILE и APP14 Adobe (Exif, XMP, MPF, IPTC, GPMF и прочие
//          сегменты производителей), и всё после EOI основного кадра (вторые кадры MPF со своим Exif); ориентация
//          остаётся минимальным Exif с одним тегом Orientation;
//   PNG  — eXIf и текстовые чанки (XMP, «Raw profile type exif»), всё после IEND;
//   WebP — чанки EXIF и «XMP », флаги VP8X, размер RIFF; всё после конца RIFF;
//   HEIF — данные элементов Exif и XMP (iinf/iloc, способы 0 и 1) обнуляются на месте: боксы и ftyp не меняются;
//          не найдены (битый iinf/iloc, обрезанный meta, способ 2) — исключение.
// Неизвестный формат и файл без метаданных возвращаются как есть.

/** Байты файла (буфер — ArrayBuffer: годится для Blob и crypto.subtle). */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Байт по индексу; за концом — 0 (границы проверяют вызывающие). */
const byte = (b: Bytes, i: number): number => b[i] ?? 0;

const u16be = (b: Bytes, at: number): number => {
  if (at < 0 || at + 2 > b.length) throw new RangeError('u16');
  return (byte(b, at) << 8) | byte(b, at + 1);
};
const u32be = (b: Bytes, at: number): number => {
  if (at < 0 || at + 4 > b.length) throw new RangeError('u32');
  return (
    ((byte(b, at) << 24) >>> 0) +
    ((byte(b, at + 1) << 16) | (byte(b, at + 2) << 8) | byte(b, at + 3))
  );
};
const u32le = (b: Bytes, at: number): number => {
  if (at < 0 || at + 4 > b.length) throw new RangeError('u32');
  return (
    ((byte(b, at + 3) << 24) >>> 0) +
    ((byte(b, at + 2) << 16) | (byte(b, at + 1) << 8) | byte(b, at))
  );
};
const fourcc = (b: Bytes, at: number): string =>
  at + 4 <= b.length
    ? String.fromCharCode(byte(b, at), byte(b, at + 1), byte(b, at + 2), byte(b, at + 3))
    : '';

function concat(parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- JPEG --------------------------------------------------------------------------------------------------------

const SOS = 0xda;
const EOI = 0xd9;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;
const COM = 0xfe;

/** Маркер без сегмента длины: TEM, RST0–RST7 (и SOI, EOI — отдельно). */
const standalone = (m: number): boolean => m === 0x01 || (m >= 0xd0 && m <= 0xd7);

/** Начало следующего маркера в сжатых данных: FF не 00 (вставленный ноль) и не RSTn. */
function nextMarker(b: Bytes, from: number): number {
  for (let i = from; i + 1 < b.length; i++) {
    if (b[i] !== 0xff) continue;
    const m = byte(b, i + 1);
    if (m !== 0x00 && m !== 0xff && !standalone(m)) return i;
  }
  return b.length;
}

const startsWith = (b: Bytes, at: number, s: string): boolean => {
  if (at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** Orientation (1–8) из Exif APP1; `at` — начало «Exif\0\0». */
function exifOrientation(b: Bytes, at: number, end: number): number | undefined {
  const t = b.subarray(at + 6, end);
  const le = startsWith(t, 0, 'II');
  if (!le && !startsWith(t, 0, 'MM')) return undefined;
  const u16 = (o: number) => {
    const x = u16be(t, o);
    return le ? ((x & 0xff) << 8) | (x >> 8) : x;
  };
  const u32 = (o: number) => (le ? u32le(t, o) : u32be(t, o));
  try {
    if (u16(2) !== 42) return undefined;
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112 && u16(e + 2) === 3) {
        const v = u16(e + 8);
        return v >= 1 && v <= 8 ? v : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Минимальный Exif APP1 (36 байт): FF E1, длина 34, «Exif\0\0», TIFF «MM» 42, IFD0 по смещению 8 — одна запись
 * Orientation (0x0112, SHORT × 1), следующего IFD нет.
 */
function orientationApp1(v: number): Bytes {
  const out = new Uint8Array(36);
  const d = new DataView(out.buffer);
  d.setUint16(0, 0xffe1);
  d.setUint16(2, 34);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d], 4);
  d.setUint16(12, 42);
  d.setUint32(14, 8);
  d.setUint16(18, 1);
  d.setUint16(20, 0x0112);
  d.setUint16(22, 3);
  d.setUint32(24, 1);
  d.setUint16(28, v);
  return out;
}

/**
 * Сегмент, который уходит из файла: COM и все APPn, кроме нужных декодеру — APP0 (JFIF), APP2 ICC_PROFILE, APP14
 * Adobe. Уходят Exif и XMP (APP1), MPF и FlashPix (APP2), IPTC (APP13), телеметрия GoPro GPMF с GPS (APP6) и прочие
 * сегменты производителей.
 */
function dropped(b: Bytes, marker: number, payload: number): boolean {
  if (marker === COM) return true;
  if (marker < APP0 || marker > APP15 || marker === APP0) return false;
  if (marker === APP2) return !startsWith(b, payload, 'ICC_PROFILE\0');
  if (marker === APP14) return !startsWith(b, payload, 'Adobe');
  return true;
}

function stripJpeg(b: Bytes): Bytes {
  const out: Bytes[] = [b.subarray(0, 2)];
  let changed = false;
  let orientation: number | undefined;
  /** Место первого вырезанного APP1 — туда встаёт Exif с ориентацией. */
  let exifSlot = -1;
  let pos = 2;
  while (pos < b.length) {
    if (b[pos] !== 0xff) {
      // Сжатые данные или мусор между сегментами — как есть до следующего маркера.
      const next = nextMarker(b, pos);
      out.push(b.subarray(pos, next));
      pos = next;
      continue;
    }
    let m = pos + 1;
    while (m < b.length && b[m] === 0xff) m++; // байты заполнения
    if (m >= b.length) {
      out.push(b.subarray(pos));
      break;
    }
    const marker = byte(b, m);
    if (marker === EOI) {
      out.push(b.subarray(pos, m + 1));
      // Всё после EOI основного кадра (вторые кадры MPF, хвосты производителей) — не загружается.
      if (m + 1 < b.length) changed = true;
      break;
    }
    if (standalone(marker) || marker === 0x00) {
      out.push(b.subarray(pos, m + 1));
      pos = m + 1;
      continue;
    }
    const len = m + 3 <= b.length ? u16be(b, m + 1) : -1;
    const end = m + 1 + len;
    if (len < 2 || end > b.length) {
      // Обрезанный сегмент: метаданные — вырезать до конца файла, прочее — оставить как есть.
      if (len >= 2 && dropped(b, marker, m + 3)) changed = true;
      else out.push(b.subarray(pos));
      break;
    }
    if (dropped(b, marker, m + 3)) {
      changed = true;
      if (marker === APP1 && startsWith(b, m + 3, 'Exif\0')) {
        orientation ??= exifOrientation(b, m + 3, end);
      }
      if (marker === APP1 && exifSlot < 0) exifSlot = out.length;
    } else out.push(b.subarray(pos, end));
    pos = end;
    if (marker === SOS) {
      const next = nextMarker(b, pos);
      out.push(b.subarray(pos, next));
      pos = next;
    }
  }
  if (!changed) return b;
  if (orientation !== undefined && orientation !== 1 && exifSlot >= 0) {
    out.splice(exifSlot, 0, orientationApp1(orientation));
  }
  return concat(out);
}

// --- PNG ---------------------------------------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

function stripPng(b: Bytes): Bytes {
  const out: Bytes[] = [b.subarray(0, 8)];
  let changed = false;
  let pos = 8;
  while (pos < b.length) {
    if (pos + 8 > b.length) {
      out.push(b.subarray(pos));
      break;
    }
    const type = fourcc(b, pos + 4);
    const end = pos + 12 + u32be(b, pos);
    if (end > b.length) {
      if (PNG_DROP.has(type)) changed = true;
      else out.push(b.subarray(pos));
      break;
    }
    if (PNG_DROP.has(type)) changed = true;
    else out.push(b.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      if (pos < b.length) changed = true;
      break;
    }
  }
  return changed ? concat(out) : b;
}

// --- WebP --------------------------------------------------------------------------------------------------------

const WEBP_DROP = new Set(['EXIF', 'XMP ']);
/** Флаги VP8X: 0x08 — есть EXIF, 0x04 — есть XMP. */
const VP8X_META = 0x08 | 0x04;

function stripWebp(b: Bytes): Bytes {
  const limit = Math.min(b.length, 8 + u32le(b, 4));
  const chunks: Bytes[] = [];
  let changed = limit < b.length;
  let pos = 12;
  while (pos < limit) {
    if (pos + 8 > limit) {
      chunks.push(b.subarray(pos, limit));
      break;
    }
    const type = fourcc(b, pos);
    const size = u32le(b, pos + 4);
    const bare = pos + 8 + size;
    if (bare > limit) {
      if (WEBP_DROP.has(type)) changed = true;
      else chunks.push(b.subarray(pos, limit));
      break;
    }
    const end = Math.min(limit, bare + (size & 1));
    if (WEBP_DROP.has(type)) changed = true;
    else if (type === 'VP8X' && size >= 1 && (byte(b, pos + 8) & VP8X_META) !== 0) {
      const c = b.slice(pos, end);
      c[8] = byte(c, 8) & ~VP8X_META;
      chunks.push(c);
      changed = true;
    } else chunks.push(b.subarray(pos, end));
    pos = end;
  }
  if (!changed) return b;
  const body = concat([b.subarray(8, 12), ...chunks]);
  const head = new Uint8Array(8);
  head.set(b.subarray(0, 4));
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

// --- HEIF (ISOBMFF) ----------------------------------------------------------------------------------------------

// Разбор строгий (W2.44-4): элемент Exif или XMP, данные которого не найдены целиком, — исключение, а не исходный
// файл. Обрезанный файл (meta не найден или оборван, iinf неполный) — тоже исключение: при mdat до meta Exif остаётся в
// файле, а найти его без iloc нельзя.

class HeifError extends Error {
  override name = 'HeifError';
}

interface Box {
  type: string;
  /** Начало содержимого (после заголовка). */
  body: number;
  end: number;
  /** Объявленный размер больше отрезка: бокс обрезан, `end` — граница отрезка. */
  cut: boolean;
}

/** Боксы на отрезке [from, to): размер 1 — 64-битный, 0 — до конца; обрезанный бокс — до `to`. */
function boxes(b: Bytes, from: number, to: number): Box[] {
  const list: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = u32be(b, p);
    let head = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12);
      head = 16;
    } else if (size === 0) size = to - p;
    if (size < head) break;
    const cut = p + size > to;
    list.push({ type: fourcc(b, p + 4), body: p + head, end: cut ? to : p + size, cut });
    p += size;
  }
  return list;
}

/** Отрезок разобран до конца: последний бокс кончается на `to`, обрезанных нет. */
const whole = (list: readonly Box[], from: number, to: number): boolean =>
  !list.some((x) => x.cut) && (list.at(-1)?.end ?? from) === to;

/** Чтение полей бокса: за его концом — исключение (не чтение соседних боксов). */
function fields(b: Bytes, at: number, end: number) {
  let p = at;
  const skip = (n: number): void => {
    if (p + n > end) throw new HeifError('поле за концом бокса');
    p += n;
  };
  return {
    get at() {
      return p;
    },
    skip,
    read(n: number): number {
      if (n !== 0 && n !== 1 && n !== 2 && n !== 4 && n !== 8) {
        throw new HeifError(`размер поля ${n}`);
      }
      const at = p;
      skip(n);
      if (n === 0) return 0;
      if (n === 1) return byte(b, at);
      if (n === 2) return u16be(b, at);
      if (n === 4) return u32be(b, at);
      return u32be(b, at) * 2 ** 32 + u32be(b, at + 4);
    },
    fourcc(): string {
      skip(4);
      return fourcc(b, p - 4);
    },
    /** Строка до NUL (без NUL — до конца бокса: так пишут некоторые камеры). */
    cstring(): string {
      let i = p;
      while (i < end && b[i] !== 0) i++;
      const s = String.fromCharCode(...b.subarray(p, i));
      p = Math.min(end, i + 1);
      return s;
    },
  };
}

/** Id элементов Exif и XMP из iinf; оборванный iinf и битая запись infe — исключение. */
function metaItems(b: Bytes, iinf: Box): Set<number> {
  if (iinf.cut) throw new HeifError('iinf обрезан');
  const head = fields(b, iinf.body, iinf.end);
  const v = head.read(1);
  head.skip(3);
  const count = head.read(v === 0 ? 2 : 4);
  const list = boxes(b, head.at, iinf.end).filter((x) => x.type === 'infe');
  if (list.length < count) throw new HeifError('в iinf меньше записей, чем entry_count');
  const ids = new Set<number>();
  for (const infe of list) {
    if (infe.cut) throw new HeifError('infe обрезан');
    const f = fields(b, infe.body, infe.end);
    const iv = f.read(1);
    f.skip(3);
    let id: number;
    let type: string;
    if (iv >= 2) {
      id = f.read(iv === 2 ? 2 : 4);
      f.skip(2); // protection_index
      type = f.fourcc();
      f.cstring(); // item_name
    } else {
      id = f.read(2);
      f.skip(2);
      f.cstring();
      type = 'mime'; // infe v0/v1 — только content_type
    }
    const content = type === 'mime' ? f.cstring() : '';
    if (type === 'Exif' || (type === 'mime' && /rdf\+xml|xmp/i.test(content))) ids.add(id);
  }
  return ids;
}

/**
 * Диапазоны данных элементов `ids` по iloc (способ 0 — смещение в файле, 1 — в idat) — в `out` по мере разбора, чтобы
 * найденное до сбоя сохранялось. В `located` — элементы, все экстенты которых прочитаны и данные которых в этом файле
 * найдены (или лежат вне его: data_reference_index ≠ 0). Способ 2 (сборка из других элементов) и способ 1 без idat
 * найденными не считаются.
 */
function itemRanges(
  b: Bytes,
  iloc: Box,
  ids: ReadonlySet<number>,
  idat: Box | undefined,
  out: [number, number][],
  located: Set<number>,
): void {
  const f = fields(b, iloc.body, iloc.end);
  const v = f.read(1);
  if (v > 2) throw new HeifError(`iloc версии ${v}`);
  f.skip(3);
  const sizes = f.read(1);
  const sizes2 = f.read(1);
  const offSize = sizes >> 4;
  const lenSize = sizes & 0x0f;
  const baseSize = sizes2 >> 4;
  const idxSize = v >= 1 ? sizes2 & 0x0f : 0;
  const count = f.read(v < 2 ? 2 : 4);
  for (let i = 0; i < count; i++) {
    const id = f.read(v < 2 ? 2 : 4);
    const method = v >= 1 ? f.read(2) & 0x0f : 0;
    const dataRef = f.read(2);
    const base = f.read(baseSize);
    const extents = f.read(2);
    const wanted = ids.has(id) && dataRef === 0;
    const here = method === 0 || (method === 1 && idat !== undefined);
    for (let e = 0; e < extents; e++) {
      f.read(idxSize);
      const off = f.read(offSize);
      const len = f.read(lenSize);
      if (!wanted || !here) continue;
      if (method === 0) out.push([base + off, len > 0 ? base + off + len : b.length]);
      else if (idat) {
        const at = idat.body + base + off;
        out.push([at, len > 0 ? at + len : idat.end]);
      }
    }
    if (ids.has(id) && (dataRef !== 0 || here)) located.add(id);
  }
}

/** Бренды ftyp изображений HEIF (HEIC, AVIF): у такого файла meta обязателен. */
const HEIF_BRANDS = new Set([
  'mif1',
  'mif2',
  'msf1',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'avif',
  'avis',
]);

/** Основной или совместимый бренд ftyp — HEIF. */
function heifBrand(b: Bytes, ftyp: Box | undefined): boolean {
  if (!ftyp || ftyp.type !== 'ftyp') return false;
  if (HEIF_BRANDS.has(fourcc(b, ftyp.body))) return true;
  for (let p = ftyp.body + 8; p + 4 <= ftyp.end; p += 4) {
    if (HEIF_BRANDS.has(fourcc(b, p))) return true;
  }
  return false;
}

function stripHeif(b: Bytes): Bytes {
  const top = boxes(b, 0, b.length);
  const meta = top.find((x) => x.type === 'meta');
  if (!meta) {
    // HEIF без meta — обрезанный файл: meta не дошёл, а Exif в mdat уже может быть (mdat до meta). Прочие ISOBMFF
    // (MP4 и т. п.) без meta элементов не имеют — как есть, если файл целый.
    if (!heifBrand(b, top[0]) && whole(top, 0, b.length)) return b;
    throw new HeifError('meta не найден');
  }
  // meta HEIF — FullBox; у QuickTime-варианта дети начинаются сразу.
  const children = fourcc(b, meta.body + 4) === 'hdlr' ? meta.body : meta.body + 4;
  const inner = boxes(b, children, meta.end);
  const iinf = inner.find((x) => x.type === 'iinf');
  if (!iinf) {
    if (!meta.cut && whole(inner, children, meta.end)) return b;
    throw new HeifError('iinf не найден в обрезанном meta');
  }
  const ids = metaItems(b, iinf);
  if (ids.size === 0) return b;
  const iloc = inner.find((x) => x.type === 'iloc');
  if (!iloc) throw new HeifError('нет iloc для элементов Exif и XMP');
  const ranges: [number, number][] = [];
  const located = new Set<number>();
  try {
    itemRanges(
      b,
      iloc,
      ids,
      inner.find((x) => x.type === 'idat'),
      ranges,
      located,
    );
  } catch (e) {
    // Битый iloc: найденное до сбоя остаётся в `ranges`; не найден хотя бы один элемент — исключение ниже.
    if (!(e instanceof HeifError || e instanceof RangeError)) throw e;
  }
  for (const id of ids) {
    if (!located.has(id)) throw new HeifError(`данные элемента ${id} (Exif или XMP) не найдены`);
  }
  if (ranges.length === 0) return b;
  const out = b.slice();
  for (const [from, to] of ranges) {
    const a = Math.max(0, Math.min(from, out.length));
    out.fill(0, a, Math.max(a, Math.min(to, out.length)));
  }
  return out;
}

// --- Вход ----------------------------------------------------------------------------------------------------------

type Kind = 'jpeg' | 'png' | 'webp' | 'heif';

function sniff(b: Bytes): Kind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && PNG_SIG.every((x, i) => b[i] === x)) return 'png';
  if (b.length >= 12 && startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
  if (b.length >= 12 && startsWith(b, 4, 'ftyp')) return 'heif';
  return null;
}

const STRIP: Record<Kind, (b: Bytes) => Bytes> = {
  jpeg: stripJpeg,
  png: stripPng,
  webp: stripWebp,
  heif: stripHeif,
};

/**
 * Копия фото без геоданных и метаданных съёмки; исходный массив не меняется. Неизвестный формат и файл без
 * метаданных — тот же массив. Битый JPEG, PNG, WebP разбирается до места поломки: обрезанный сегмент метаданных
 * уходит целиком. HEIF, в котором данные Exif или XMP не найдены (битый iinf/iloc, обрезанный meta), — исключение:
 * загрузка падает («Ошибка загрузки»), а не уходит исходный файл (W2.44-4).
 */
export function stripMetadata(bytes: Bytes): Bytes {
  const kind = sniff(bytes);
  return kind ? STRIP[kind](bytes) : bytes;
}

/** Байтов в начале файла, по которым `sniff` узнаёт формат. */
const SNIFF_BYTES = 12;

/**
 * Файл без геоданных того же типа (у File — то же имя и время изменения); неизвестный формат и файл без метаданных
 * — тот же объект. Не изображение (документ) целиком в память не читается: формат — по первым байтам.
 */
export async function stripFileMetadata(blob: Blob): Promise<Blob> {
  if (!sniff(new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer()))) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const out = stripMetadata(bytes);
  if (out === bytes) return blob;
  if (blob instanceof File) {
    return new File([out], blob.name, { type: blob.type, lastModified: blob.lastModified });
  }
  return new Blob([out], { type: blob.type });
}
