// W2.44 · Фикстуры фото с геоданными (генерируются кодом, двоичных файлов в репозитории нет): JPEG (Exif с GPS IFD,
// XMP, APP13, MPF-кадр после EOI), PNG (eXIf, iTXt, tEXt), WebP (EXIF, XMP, флаги VP8X), HEIC (элементы Exif и XMP
// по iinf/iloc). В каждой фикстуре — метки, по которым тест видит утечку: строка GPSMapDatum, атрибуты XMP, IPTC.
// Импортируется и из e2e (`driver-today.spec.ts`): только чистый TS без DOM.

type Bytes = Uint8Array<ArrayBuffer>;

/** Метки геоданных и метаданных съёмки, которых не должно быть в загружаемом файле. */
export const MARKS = {
  /** GPSMapDatum (тег 0x0012 GPS IFD). */
  gps: 'WGS-84-SECRET',
  /** Атрибут XMP с широтой. */
  xmp: 'exif:GPSLatitude',
  /** Город IPTC в APP13. */
  iptc: 'IPTC-CITY-SECRET',
  /** Метка второго кадра MPF после EOI. */
  mpf: 'MPF-SECOND-FRAME',
  /** Текстовый чанк PNG «Raw profile type exif». */
  rawExif: 'Raw profile type exif',
  /** Телеметрия GoPro GPMF с GPS в APP6. */
  gpmf: 'GPMF-GPS5-SECRET',
  /** Комментарий JPEG (COM) с координатами. */
  comment: 'COM-GPS-SECRET',
  /** APP3 (Kodak META и подобные производителей). */
  app3: 'APP3-META-SECRET',
  /** APP2 FlashPix (FPXR). */
  fpxr: 'FPXR-SECRET',
} as const;

const enc = new TextEncoder();
export const ascii = (s: string): Bytes => enc.encode(s);

export function concat(...parts: readonly (Bytes | readonly number[])[]): Bytes {
  const all = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
export const be32 = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
export const le32 = (n: number): number[] => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >>> 24) & 0xff,
];

/** Есть ли в байтах строка ASCII. */
export function includes(bytes: Bytes, s: string): boolean {
  const needle = ascii(s);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Найдена ли хотя бы одна метка геоданных. */
export const leaks = (bytes: Bytes): string[] =>
  Object.values(MARKS).filter((m) => includes(bytes, m));

// --- TIFF / Exif -------------------------------------------------------------------------------------------------

interface Entry {
  tag: number;
  /** 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL. */
  type: 2 | 3 | 4 | 5;
  count: number;
  /** Значение big-endian; длиннее 4 байт — после IFD по смещению. */
  data: readonly number[] | Bytes;
}

const pad = (n: number): number => n + (n & 1);

function ifdSize(es: readonly Entry[]): number {
  return es.reduce(
    (s, e) => s + (e.data.length > 4 ? pad(e.data.length) : 0),
    2 + es.length * 12 + 4,
  );
}

/** IFD по смещению `at` от начала TIFF: записи, ссылка на следующий IFD (0), данные длиннее 4 байт. */
function ifdBytes(es: readonly Entry[], at: number): Bytes {
  const out = new Uint8Array(ifdSize(es));
  const v = new DataView(out.buffer);
  v.setUint16(0, es.length);
  let extra = 2 + es.length * 12 + 4;
  es.forEach((e, i) => {
    const p = 2 + i * 12;
    v.setUint16(p, e.tag);
    v.setUint16(p + 2, e.type);
    v.setUint32(p + 4, e.count);
    if (e.data.length <= 4) out.set(e.data, p + 8);
    else {
      v.setUint32(p + 8, at + extra);
      out.set(e.data, extra);
      extra += pad(e.data.length);
    }
  });
  return out;
}

const cstr = (s: string): Bytes => concat(ascii(s), [0]);

/**
 * TIFF Exif (big-endian): IFD0 — Make, Orientation, GPSInfo; GPS IFD — широта 55°45'21.12" N и GPSMapDatum
 * с меткой. `mark` — строка GPSMapDatum (у второго кадра MPF своя).
 */
export function exifTiff(o: { orientation?: number; mark?: string } = {}): Bytes {
  const gps: Entry[] = [
    { tag: 0x0001, type: 2, count: 2, data: cstr('N') },
    {
      tag: 0x0002,
      type: 5,
      count: 3,
      data: [...be32(55), ...be32(1), ...be32(45), ...be32(1), ...be32(2112), ...be32(100)],
    },
    {
      tag: 0x0012,
      type: 2,
      count: (o.mark ?? MARKS.gps).length + 1,
      data: cstr(o.mark ?? MARKS.gps),
    },
  ];
  const make: Entry = { tag: 0x010f, type: 2, count: 6, data: cstr('Canon') };
  const orientation: Entry[] =
    o.orientation === undefined
      ? []
      : [{ tag: 0x0112, type: 3, count: 1, data: be16(o.orientation) }];
  const pointer = (at: number): Entry => ({ tag: 0x8825, type: 4, count: 1, data: be32(at) });
  const ifd0 = [make, ...orientation, pointer(0)];
  const gpsAt = 8 + ifdSize(ifd0);
  ifd0[ifd0.length - 1] = pointer(gpsAt);
  return concat(ascii('MM'), [0x00, 0x2a], be32(8), ifdBytes(ifd0, 8), ifdBytes(gps, gpsAt));
}

/** Пакет XMP с координатами. */
export const xmpPacket = (): Bytes =>
  ascii(
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      `<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" ${MARKS.xmp}="55,45.352N"` +
      ' exif:GPSLongitude="37,37.000E"/></rdf:RDF></x:xmpmeta>',
  );

// --- JPEG --------------------------------------------------------------------------------------------------------

const seg = (marker: number, payload: Bytes | readonly number[]): Bytes =>
  concat([0xff, marker], be16(payload.length + 2), payload);

/** Сегменты JPEG с геоданными по отдельности (тест собирает ожидаемый результат из сохраняемых). */
export function jpegParts(o: { orientation?: number } = {}) {
  const orientation = o.orientation ?? 6;
  return {
    soi: Uint8Array.from([0xff, 0xd8]),
    app0: seg(0xe0, concat(ascii('JFIF'), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    exif: seg(0xe1, concat(ascii('Exif'), [0, 0], exifTiff({ orientation }))),
    xmp: seg(0xe1, concat(cstr('http://ns.adobe.com/xap/1.0/'), xmpPacket())),
    icc: seg(0xe2, concat(cstr('ICC_PROFILE'), [1, 1], [0, 0, 0, 0x20, 0x6c, 0x63, 0x6d, 0x73])),
    mpf: seg(0xe2, concat(cstr('MPF'), ascii('MM'), [0x00, 0x2a], be32(8), [0, 0])),
    fpxr: seg(0xe2, concat(cstr('FPXR'), [0, 1], ascii(MARKS.fpxr))),
    app3: seg(0xe3, concat(cstr('META'), ascii(MARKS.app3))),
    gpmf: seg(0xe6, concat(cstr('GoPro'), ascii('GPMF'), ascii(MARKS.gpmf))),
    // APP14 Adobe нужен декодеру (преобразование цвета) — остаётся.
    adobe: seg(0xee, concat(ascii('Adobe'), [0, 100, 0, 0, 0, 0, 1])),
    com: seg(0xfe, ascii(MARKS.comment)),
    app13: seg(
      0xed,
      concat(
        cstr('Photoshop 3.0'),
        ascii('8BIM'),
        [0x04, 0x04, 0, 0],
        be32(18),
        [0x1c, 0x02, 0x5a],
        be16(16),
        ascii(MARKS.iptc),
      ),
    ),
    // В таблице квантования есть байты FF D9: разбор идёт по длинам сегментов, а не поиском маркера.
    dqt: seg(
      0xdb,
      concat(
        [0],
        Array.from({ length: 62 }, (_, i) => i + 1),
        [0xff, 0xd9],
      ),
    ),
    sof: seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    sos: seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    // Сжатые данные: FF 00 (вставленный ноль) и RST0 — не маркеры конца.
    scan: Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]),
    eoi: Uint8Array.from([0xff, 0xd9]),
    // Второй кадр MPF после EOI основного изображения — со своим Exif и GPS.
    trailer: concat(
      [0xff, 0xd8],
      seg(0xe1, concat(ascii('Exif'), [0, 0], exifTiff({ mark: MARKS.mpf }))),
      [0xff, 0xd9],
    ),
  };
}

/**
 * JPEG с Exif (GPS, ориентация 6), XMP, ICC, MPF, FPXR, APP3, GPMF в APP6, APP13, Adobe, COM и вторым кадром после
 * EOI.
 */
export function jpegWithGps(o: { orientation?: number } = {}): Bytes {
  const p = jpegParts(o);
  return concat(
    p.soi,
    p.app0,
    p.exif,
    p.xmp,
    p.icc,
    p.mpf,
    p.fpxr,
    p.app3,
    p.gpmf,
    p.app13,
    p.adobe,
    p.com,
    p.dqt,
    p.sof,
    p.sos,
    p.scan,
    p.eoi,
    p.trailer,
  );
}

/** Минимальный Exif APP1 с одним тегом Orientation (то, что остаётся от Exif). */
export const orientationApp1 = (orientation: number): Bytes =>
  concat(
    [0xff, 0xe1, 0x00, 0x22],
    ascii('Exif'),
    [0, 0],
    ascii('MM'),
    [0x00, 0x2a],
    be32(8),
    be16(1),
    [0x01, 0x12, 0x00, 0x03],
    be32(1),
    be16(orientation),
    [0, 0],
    be32(0),
  );

/**
 * Вставляет Exif с GPS после SOI в готовый JPEG (e2e: настоящий JPEG холста страницы + геоданные), ориентация 1.
 */
export function withGps(jpeg: Bytes): Bytes {
  const p = jpegParts({ orientation: 1 });
  return concat(jpeg.subarray(0, 2), p.exif, p.xmp, jpeg.subarray(2));
}

// --- PNG ---------------------------------------------------------------------------------------------------------

const chunk = (type: string, data: Bytes | readonly number[]): Bytes =>
  concat(be32(data.length), ascii(type), data, [0xde, 0xad, 0xbe, 0xef]);

export function pngParts() {
  return {
    sig: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr: chunk('IHDR', [...be32(16), ...be32(16), 8, 2, 0, 0, 0]),
    exif: chunk('eXIf', exifTiff({ orientation: 1 })),
    itxt: chunk('iTXt', concat(cstr('XML:com.adobe.xmp'), [0, 0, 0, 0], xmpPacket())),
    text: chunk('tEXt', concat(cstr(MARKS.rawExif), ascii('\nexif\n 12\n4d4d002a\n'))),
    idat: chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
    iend: chunk('IEND', []),
    trailer: ascii(MARKS.gps),
  };
}

export function pngWithGps(): Bytes {
  const p = pngParts();
  return concat(p.sig, p.ihdr, p.exif, p.itxt, p.text, p.idat, p.iend, p.trailer);
}

// --- WebP --------------------------------------------------------------------------------------------------------

const riffChunk = (type: string, data: Bytes | readonly number[]): Bytes =>
  concat(ascii(type), le32(data.length), data, data.length & 1 ? [0] : []);

/** VP8X с флагами `flags` (0x08 — EXIF, 0x04 — XMP), холст 16×16. */
export const vp8x = (flags: number): Bytes =>
  riffChunk('VP8X', [flags, 0, 0, 0, 15, 0, 0, 15, 0, 0]);

/** Кадр VP8 нечётной длины (проверка выравнивания). */
export const vp8 = (): Bytes => riffChunk('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01]);

export const riff = (...chunks: Bytes[]): Bytes => {
  const body = concat(ascii('WEBP'), ...chunks);
  return concat(ascii('RIFF'), le32(body.length), body);
};

export function webpWithGps(): Bytes {
  return riff(
    vp8x(0x10 | 0x08 | 0x04),
    vp8(),
    riffChunk('EXIF', exifTiff({ orientation: 1 })),
    riffChunk('XMP ', concat(xmpPacket(), [0x20])),
  );
}

// --- HEIF (ISOBMFF) ----------------------------------------------------------------------------------------------

const box = (type: string, ...payload: (Bytes | readonly number[])[]): Bytes => {
  const body = concat(...payload);
  return concat(be32(body.length + 8), ascii(type), body);
};
const fullBox = (type: string, version: number, ...payload: (Bytes | readonly number[])[]) =>
  box(type, [version, 0, 0, 0], ...payload);

export const HEVC_DATA = ascii('HEVC-CODED-IMAGE-DATA');

export interface HeifFixture {
  bytes: Bytes;
  /** Диапазоны [начало, конец) данных Exif и XMP, которые должны стать нулями. */
  meta: [number, number][];
  /** Диапазон кодированного изображения — без изменений. */
  image: [number, number];
}

export interface HeifOptions {
  ilocVersion?: 0 | 1 | 2;
  offsetSize?: 4 | 8;
  /** mdat до meta (так пишут многие камеры): обрезанный meta оставляет Exif в файле. */
  mdatFirst?: boolean;
  /** Порча iloc: item_count больше настоящего на столько. */
  ilocCountExtra?: number;
  /** Порча iloc: размеры offset и length в заголовке (неподдерживаемые, например 3). */
  ilocFieldSize?: number;
  /** Порча iinf: запись infe элемента Exif обрезана (нет item_type). */
  brokenExifInfe?: boolean;
}

/**
 * HEIC: ftyp `heic`, meta (hdlr, iinf из infe v2: hvc1, Exif, mime XMP; iloc версии `ilocVersion`), mdat с
 * изображением и Exif (смещение заголовка TIFF + TIFF). У iloc v1 XMP лежит в idat (construction_method 1), иначе —
 * в mdat. По умолчанию mdat после meta.
 */
export function heicWithGps(o: HeifOptions = {}): HeifFixture {
  const v = o.ilocVersion ?? 1;
  const off = o.offsetSize ?? 4;
  const fieldSize = o.ilocFieldSize ?? off;
  const exif = concat(be32(0), exifTiff({ orientation: 1 }));
  const xmp = xmpPacket();
  const xmpInIdat = v === 1;
  const id = (n: number): number[] => (v === 2 ? be32(n) : be16(n));
  const num = (n: number): number[] => (off === 8 ? [0, 0, 0, 0, ...be32(n)] : be32(n));

  const ftyp = box('ftyp', ascii('heic'), be32(0), ascii('mif1'), ascii('heic'));
  const hdlr = fullBox('hdlr', 0, be32(0), ascii('pict'), be32(0), be32(0), be32(0), [0]);
  const infe = (n: number, type: string, extra: Bytes = new Uint8Array()) =>
    fullBox('infe', 2, be16(n), be16(0), ascii(type), [0], extra);
  const iinf = fullBox(
    'iinf',
    0,
    be16(3),
    infe(1, 'hvc1'),
    o.brokenExifInfe ? fullBox('infe', 2, be16(2)) : infe(2, 'Exif'),
    infe(3, 'mime', cstr('application/rdf+xml')),
  );
  const iloc = (offsets: { image: number; exif: number; xmp: number }) => {
    const item = (n: number, method: number, at: number, len: number) =>
      concat(id(n), v >= 1 ? be16(method) : [], be16(0), be16(1), num(at), num(len));
    const count = 3 + (o.ilocCountExtra ?? 0);
    return fullBox(
      'iloc',
      v,
      [(fieldSize << 4) | fieldSize, 0],
      v === 2 ? be32(count) : be16(count),
      item(1, 0, offsets.image, HEVC_DATA.length),
      item(2, 0, offsets.exif, exif.length),
      item(3, xmpInIdat ? 1 : 0, offsets.xmp, xmp.length),
    );
  };
  const idat = xmpInIdat ? box('idat', xmp) : new Uint8Array();
  const mdatPayload = concat(HEVC_DATA, exif, xmpInIdat ? new Uint8Array() : xmp);
  const build = (offsets: { image: number; exif: number; xmp: number }) => {
    const meta = fullBox('meta', 0, hdlr, iinf, iloc(offsets), idat);
    const mdat = box('mdat', mdatPayload);
    return o.mdatFirst ? concat(ftyp, mdat, meta) : concat(ftyp, meta, mdat);
  };
  // Размеры боксов не зависят от смещений: первый проход — раскладка, второй — настоящие смещения.
  const draft = build({ image: 0, exif: 0, xmp: 0 });
  const mdatData = o.mdatFirst ? ftyp.length + 8 : draft.length - mdatPayload.length;
  const image = mdatData;
  const exifAt = image + HEVC_DATA.length;
  const xmpAt = xmpInIdat ? 0 : exifAt + exif.length;
  const bytes = build({ image, exif: exifAt, xmp: xmpAt });
  // idat — последний бокс meta: в конце файла (mdat первым) или сразу перед заголовком mdat (8 байт).
  const idatEnd = o.mdatFirst ? bytes.length : mdatData - 8;
  const idatData = xmpInIdat ? idatEnd - xmp.length : 0;
  const xmpRange: [number, number] = xmpInIdat
    ? [idatData, idatData + xmp.length]
    : [xmpAt, xmpAt + xmp.length];
  return {
    bytes,
    meta: [[exifAt, exifAt + exif.length], xmpRange],
    image: [image, image + HEVC_DATA.length],
  };
}
