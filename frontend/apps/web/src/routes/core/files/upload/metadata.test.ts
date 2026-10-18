// W2.44 · Вырезание геоданных из байтов фото (модель данных 4, ПДн §6): JPEG, PNG, WebP, HEIC на фикстурах с GPS.
// Данные изображения и структура файла не меняются; ориентация JPEG сохраняется минимальным Exif.
import { describe, expect, it, vi } from 'vitest';

import { stripFileMetadata, stripMetadata } from './metadata.ts';
import {
  ascii,
  concat,
  HEVC_DATA,
  heicWithGps,
  jpegParts,
  jpegWithGps,
  leaks,
  orientationApp1,
  pngParts,
  pngWithGps,
  riff,
  vp8,
  vp8x,
  webpWithGps,
} from './metadata.fixtures.test-util.ts';

describe('фикстуры', () => {
  it('в каждой фикстуре метки геоданных есть (иначе тесты ниже ничего не проверяют)', () => {
    expect(leaks(jpegWithGps())).toEqual(
      expect.arrayContaining([
        'WGS-84-SECRET',
        'exif:GPSLatitude',
        'IPTC-CITY-SECRET',
        'MPF-SECOND-FRAME',
        'GPMF-GPS5-SECRET',
        'COM-GPS-SECRET',
        'APP3-META-SECRET',
        'FPXR-SECRET',
      ]),
    );
    expect(leaks(heicWithGps({ mdatFirst: true }).bytes)).toEqual([
      'WGS-84-SECRET',
      'exif:GPSLatitude',
    ]);
    expect(leaks(pngWithGps())).toEqual(
      expect.arrayContaining(['WGS-84-SECRET', 'exif:GPSLatitude', 'Raw profile type exif']),
    );
    expect(leaks(webpWithGps())).toEqual(['WGS-84-SECRET', 'exif:GPSLatitude']);
    expect(leaks(heicWithGps().bytes)).toEqual(['WGS-84-SECRET', 'exif:GPSLatitude']);
  });
});

describe('stripMetadata · JPEG', () => {
  // Возврат 1: остаются только APP0 (JFIF), APP2 ICC_PROFILE и APP14 Adobe — прочие APPn (GPMF GoPro в APP6, APP3,
  // FPXR) и COM вырезаются.
  it('APP1 (Exif, XMP), APP2 MPF и FPXR, APP3, APP6 GPMF, APP13, COM и кадр после EOI вырезаны; ориентация 6 — минимальным Exif; JFIF, ICC и Adobe остаются', () => {
    const p = jpegParts({ orientation: 6 });
    const out = stripMetadata(jpegWithGps({ orientation: 6 }));
    expect(leaks(out)).toEqual([]);
    expect([...out]).toEqual([
      ...concat(
        p.soi,
        p.app0,
        orientationApp1(6),
        p.icc,
        p.adobe,
        p.dqt,
        p.sof,
        p.sos,
        p.scan,
        p.eoi,
      ),
    ]);
  });

  it('ориентация 1 — Exif не нужен вовсе', () => {
    const p = jpegParts({ orientation: 1 });
    const out = stripMetadata(jpegWithGps({ orientation: 1 }));
    expect([...out]).toEqual([
      ...concat(p.soi, p.app0, p.icc, p.adobe, p.dqt, p.sof, p.sos, p.scan, p.eoi),
    ]);
  });

  it('обрезанный сегмент APP6 GPMF вырезается до конца файла', () => {
    const p = jpegParts();
    const cut = concat(p.soi, p.app0, p.gpmf.subarray(0, p.gpmf.length - 1));
    expect([...stripMetadata(cut)]).toEqual([...concat(p.soi, p.app0)]);
  });

  it('JPEG без метаданных — содержимое без изменений', () => {
    const p = jpegParts();
    const clean = concat(p.soi, p.app0, p.dqt, p.sof, p.sos, p.scan, p.eoi);
    expect([...stripMetadata(clean)]).toEqual([...clean]);
  });

  it('обрезанный файл: сегмент APP1 длиннее файла вырезается до конца', () => {
    const p = jpegParts();
    const cut = concat(p.soi, p.app0, p.exif.subarray(0, 40));
    expect([...stripMetadata(cut)]).toEqual([...concat(p.soi, p.app0)]);
  });
});

describe('stripMetadata · PNG', () => {
  it('eXIf, iTXt XMP, tEXt «Raw profile type exif» и данные после IEND вырезаны', () => {
    const p = pngParts();
    const out = stripMetadata(pngWithGps());
    expect(leaks(out)).toEqual([]);
    expect([...out]).toEqual([...concat(p.sig, p.ihdr, p.idat, p.iend)]);
  });
});

describe('stripMetadata · WebP', () => {
  it('чанки EXIF и XMP вырезаны, флаги VP8X сняты, размер RIFF пересчитан', () => {
    const out = stripMetadata(webpWithGps());
    expect(leaks(out)).toEqual([]);
    expect([...out]).toEqual([...riff(vp8x(0x10), vp8())]);
  });
});

describe('stripMetadata · HEIC', () => {
  for (const o of [
    { ilocVersion: 1, offsetSize: 4 },
    { ilocVersion: 0, offsetSize: 4 },
    { ilocVersion: 2, offsetSize: 8 },
    { ilocVersion: 1, offsetSize: 4, mdatFirst: true },
    { ilocVersion: 0, offsetSize: 8, mdatFirst: true },
  ] as const) {
    const layout = 'mdatFirst' in o ? ', mdat до meta' : '';
    it(`iloc v${o.ilocVersion}, смещения ${o.offsetSize} байт${layout}: данные Exif и XMP обнулены на месте, структура и изображение целы`, () => {
      const f = heicWithGps(o);
      const out = stripMetadata(f.bytes);
      expect(leaks(out)).toEqual([]);
      expect(out.length).toBe(f.bytes.length);
      const zero = (i: number) => f.meta.some(([a, b]) => i >= a && i < b);
      for (let i = 0; i < out.length; i++) {
        if (zero(i)) expect(out[i], `байт ${i}`).toBe(0);
        else if (out[i] !== f.bytes[i]) expect.fail(`байт ${i} изменён`);
      }
      expect([...out.subarray(...f.image)]).toEqual([...HEVC_DATA]);
      expect([...out.subarray(4, 12)]).toEqual([...ascii('ftypheic')]);
    });
  }

  it('исходный массив не меняется', () => {
    const f = heicWithGps();
    const copy = f.bytes.slice();
    stripMetadata(f.bytes);
    expect(f.bytes).toEqual(copy);
  });

  // Возврат 1 (W2.44-4): элемент Exif или XMP, данные которого не найдены, — исключение (загрузка падает), а не
  // исходный файл с GPS.
  it('битый iloc (item_count больше настоящего): найденные до сбоя Exif и XMP обнулены — меток нет', () => {
    for (const ilocVersion of [0, 1, 2] as const) {
      const f = heicWithGps({ ilocVersion, ilocCountExtra: 5 });
      expect(leaks(stripMetadata(f.bytes)), `iloc v${ilocVersion}`).toEqual([]);
    }
  });

  it('неподдерживаемый размер полей iloc — исключение, исходный файл не возвращается', () => {
    const f = heicWithGps({ ilocFieldSize: 3 });
    expect(() => stripMetadata(f.bytes)).toThrow();
  });

  it('битая запись infe (у элемента Exif нет item_type) — исключение', () => {
    const f = heicWithGps({ brokenExifInfe: true });
    expect(() => stripMetadata(f.bytes)).toThrow();
  });

  // HEIF без meta не бывает: файл, обрезанный ровно по концу mdat (mdat до meta), выглядит «целым», но Exif в нём есть.
  it('ftyp HEIF (heic, mif1) без meta — исключение, даже если боксы целые', () => {
    const f = heicWithGps({ mdatFirst: true });
    const mdatEnd = f.meta[0]?.[1] ?? 0;
    expect(() => stripMetadata(f.bytes.subarray(0, mdatEnd))).toThrow();
  });

  it('ftyp не HEIF (isom) без meta — тот же массив', () => {
    const ftyp = concat([0, 0, 0, 20], ascii('ftypisom'), [0, 0, 2, 0], ascii('isom'));
    const plain = concat(ftyp, [0, 0, 0, 12], ascii('mdat'), HEVC_DATA.subarray(0, 4));
    expect(stripMetadata(plain)).toBe(plain);
  });
});

describe('stripMetadata · устойчивость', () => {
  it('неизвестный формат — тот же массив', () => {
    const pdf = ascii('%PDF-1.7 exif:GPSLatitude');
    expect(stripMetadata(pdf)).toBe(pdf);
    const empty = new Uint8Array();
    expect(stripMetadata(empty)).toBe(empty);
  });

  it('любой префикс JPEG, PNG, WebP: без исключений и без меток геоданных', () => {
    const all = [jpegWithGps(), pngWithGps(), webpWithGps()];
    for (const bytes of all) {
      for (let n = 0; n <= bytes.length; n++) {
        const out = stripMetadata(bytes.subarray(0, n));
        if (leaks(out).length > 0) expect.fail(`префикс ${n}: ${leaks(out).join(', ')}`);
      }
    }
  });

  // Возврат 1: при mdat до meta обрезанный meta оставляет в файле Exif — такой префикс либо очищается, либо
  // разбор бросает исключение (загрузка падает), но не возвращает метки.
  it('любой префикс HEIC (mdat после и до meta): метки не возвращаются — очистка или исключение', () => {
    const all = [
      heicWithGps().bytes,
      heicWithGps({ mdatFirst: true }).bytes,
      heicWithGps({ ilocVersion: 0, mdatFirst: true }).bytes,
    ];
    for (const bytes of all) {
      for (let n = 0; n <= bytes.length; n++) {
        let out: ReturnType<typeof stripMetadata>;
        try {
          out = stripMetadata(bytes.subarray(0, n));
        } catch {
          continue;
        }
        if (leaks(out).length > 0) expect.fail(`префикс ${n}: ${leaks(out).join(', ')}`);
      }
    }
  });
});

describe('stripFileMetadata', () => {
  it('Blob JPEG с GPS → Blob без GPS того же типа', async () => {
    const out = await stripFileMetadata(new Blob([jpegWithGps()], { type: 'image/jpeg' }));
    expect(out.type).toBe('image/jpeg');
    expect(leaks(new Uint8Array(await out.arrayBuffer()))).toEqual([]);
  });

  it('File → File с тем же именем и типом (имя уходит в initiateUpload и в PUT)', async () => {
    const out = await stripFileMetadata(
      new File([jpegWithGps()], 'Чек АЗС.jpg', { type: 'image/jpeg' }),
    );
    expect(out).toBeInstanceOf(File);
    expect((out as File).name).toBe('Чек АЗС.jpg');
    expect(out.type).toBe('image/jpeg');
  });

  it('файл не изображение — тот же объект', async () => {
    const f = new File(['чек'], 'Чек.jpg', { type: 'image/jpeg' });
    expect(await stripFileMetadata(f)).toBe(f);
  });

  // Возврат 1: документ (PDF, DOCX) не читается в память целиком — формат определяется по первым байтам.
  it('документ: целиком не читается, формат — по первым 12 байтам', async () => {
    const f = new File([ascii('%PDF-1.7 '.repeat(1000))], 'Акт.pdf', { type: 'application/pdf' });
    const whole = vi.spyOn(f, 'arrayBuffer');
    const slice = vi.spyOn(f, 'slice');
    expect(await stripFileMetadata(f)).toBe(f);
    expect(whole).not.toHaveBeenCalled();
    expect(slice).toHaveBeenCalledWith(0, 12);
  });
});
