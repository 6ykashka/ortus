// Тег Branding, контракт 0.8.0-stage4 (W4.07, шаг 4.6): оформление организации — название, короткое имя,
// логотип и знак, акцент с автокоррекцией контраста, термины, меню, «Работает на Ортус» (design/docs/18-branding.md).
// Действующая версия и файлы лежат в состоянии сервера (`branding`, JSON); на старте — оформление сида домена
// W0.12 (`createPlatform().tenants[].brand`, seedBrands эталона). Цвет — алгоритм эталона 19.10 (brandingVM).
import type { components } from '@ortus/api-client';
import { createPlatform, seedUuid } from '@ortus/domain/seed';

import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { ScenarioState, TenantRow } from '../core/state.ts';
import { mskStamp } from '../core/time.ts';

type S = components['schemas'];
type Branding = S['Branding'];
type Asset = S['BrandingAsset'];

const P = (id: string): string => seedUuid('platform', id);

// ---------------------------------------------------------------------------------------------
// Цвет: контраст с белым текстом ≥ 4.5:1, иначе шаги по 4% к чёрному; производные −18% к чёрному, 86% и 93% к белому.
const hex2rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r: number[]): string =>
  '#' +
  r
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
const relLum = (h: string): number => {
  const [r = 0, g = 0, b = 0] = hex2rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Контраст цвета с белым текстом. */
export const contrastWithWhite = (h: string): number => 1.05 / (relLum(h) + 0.05);
const mixHex = (h: string, w: string, t: number): string => {
  const a = hex2rgb(h);
  const b = hex2rgb(w);
  return rgb2hex(a.map((x, i) => x + ((b[i] ?? 0) - x) * t));
};
/** accentUsed: цвет владельца, затемнённый шагами по 4% к чёрному до контраста 4.5:1. */
export function fixAccent(hex: string): string {
  let c = hex.toUpperCase();
  for (let n = 0; contrastWithWhite(c) < 4.5 && n < 60; n++) c = mixHex(c, '#000000', 0.04);
  return c;
}
export const accentVariants = (used: string): S['BrandingAccentVariants'] => ({
  accent: used,
  hover: mixHex(used, '#000000', 0.18),
  soft: mixHex(used, '#FFFFFF', 0.86),
  tint: mixHex(used, '#FFFFFF', 0.93),
});

// ---------------------------------------------------------------------------------------------
// Состояние

interface TenantBranding {
  current: Branding;
  assets: Asset[];
}

type WithBranding = ScenarioState & { branding?: Record<string, TenantBranding> };

/** Пункты меню, которые не скрываются (разделы управления). */
const LOCKED = new Set(['home', 'modules', 'users', 'billing', 'branding']);
/** Подписи терминов каталога (для текста ошибки). */
const TERM_LABEL: Readonly<Record<string, string>> = {
  shift: 'смена',
  vehicle: 'машина',
  trip: 'рейс',
  visit: 'визит',
  object: 'объект',
};
const FORMS = ['one', 'plural', 'few', 'many'] as const;
const DEFAULT_ACCENT = '#1F6B52';

function seedBranding(s: ScenarioState): Record<string, TenantBranding> {
  const P0 = createPlatform();
  const out: Record<string, TenantBranding> = {};
  for (const t of P0.tenants) {
    const b = t.brand;
    const accent = b?.accent || DEFAULT_ACCENT;
    const used = fixAccent(accent);
    const terms: S['BrandingTerms'] = {};
    for (const [k, v] of Object.entries(b?.terms ?? {})) {
      if (k in TERM_LABEL && v.one && v.plural && v.few && v.many) {
        terms[k as keyof S['BrandingTerms']] = {
          one: v.one,
          plural: v.plural,
          few: v.few,
          many: v.many,
        };
      }
    }
    const current: Branding = {
      version: b?.version ?? 1,
      displayName: t.name,
      shortName: b?.short ? b.short : null,
      accentHex: accent,
      accentUsed: used,
      accentVariants: accentVariants(used),
      terms,
      menu: { items: {}, order: [...(b?.order ?? [])] },
      poweredBy: b?.poweredBy !== false,
    };
    const at = mskStamp(b?.updatedAt);
    if (at) current.updatedAt = at;
    if (b?.updatedBy) {
      const acc = s.accounts.find((a) => a.displayName === b.updatedBy);
      current.updatedBy = acc
        ? { accountId: acc.id, displayName: acc.displayName }
        : { displayName: b.updatedBy };
    }
    out[P(t.id)] = { current, assets: [] };
  }
  return out;
}

/** Оформление организации (на старте — из сида домена; новая организация — стандартное). */
export function brandingOf(s: ScenarioState, t: TenantRow): TenantBranding {
  const x = s as WithBranding;
  x.branding ??= seedBranding(s);
  const all = x.branding;
  return (all[t.id] ??= {
    current: {
      version: 1,
      displayName: t.name,
      shortName: null,
      accentHex: DEFAULT_ACCENT,
      accentUsed: DEFAULT_ACCENT,
      accentVariants: accentVariants(DEFAULT_ACCENT),
      terms: {},
      menu: { items: {}, order: [] },
      poweredBy: true,
    },
    assets: [],
  });
}

/**
 * Тема для оболочки (TenantContext.branding → BrandingTheme, возврат 2 W4.07): действующее оформление без автора
 * и момента сохранения — id аккаунта владельца не уходит каждому участнику.
 */
export function brandingTheme(s: ScenarioState, t: TenantRow): S['BrandingTheme'] {
  const theme: Partial<Branding> = structuredClone(brandingOf(s, t).current);
  delete theme.updatedAt;
  delete theme.updatedBy;
  return theme as S['BrandingTheme'];
}

/** Знак организации для списков оператора (TenantBrandMark). */
export function brandMark(s: ScenarioState, t: TenantRow): S['TenantBrandMark'] {
  const b = brandingOf(s, t).current;
  const mark: S['TenantBrandMark'] = { accentUsed: b.accentUsed };
  if (b.shortName) mark.shortName = b.shortName;
  if (b.mark) mark.markUrl = b.mark.url;
  return mark;
}

// ---------------------------------------------------------------------------------------------
// Файлы

const MiB = 1024 * 1024;
const EXT: Readonly<Record<Asset['contentType'], string>> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Размер файла по base64 без декодирования. */
const decodedSize = (b64: string): number =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

function decode(b64: string): Uint8Array<ArrayBuffer> {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return fail('malformed_request', 'Файл не в base64.');
  }
}

/** Настоящий тип файла по первым байтам. */
function sniff(bytes: Uint8Array): Asset['contentType'] | undefined {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return undefined;
}

interface Size {
  width: number;
  height: number;
}

/** Размеры PNG (заголовок IHDR). */
function pngSize(bytes: Uint8Array): Size | undefined {
  if (bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Размеры JPEG: первый маркер SOFn (кроме DHT C4, JPG C8, DAC CC) до начала данных скана (SOS). */
function jpegSize(bytes: Uint8Array): Size | undefined {
  const u16 = (i: number): number => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const m = bytes[i + 1] ?? 0;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xda || m === 0xd9) return undefined;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 8 >= bytes.length) return undefined;
      return { height: u16(i + 5), width: u16(i + 7) };
    }
    i += 2 + u16(i + 2);
  }
  return undefined;
}

/** Размеры WebP по первому чанку: VP8X (холст), VP8L (без потерь) или «VP8 » (ключевой кадр). */
function webpSize(bytes: Uint8Array): Size | undefined {
  const at = (i: number): number => bytes[i] ?? 0;
  const u24 = (i: number): number => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && at(20) === 0x2f) {
    const bits = (at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && at(23) === 0x9d && at(24) === 0x01) {
    if (at(25) !== 0x2a) return undefined;
    return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
  }
  return undefined;
}

/** Размеры растрового файла (PNG, JPEG, WebP); SVG — без размеров. */
function rasterSize(type: Asset['contentType'], bytes: Uint8Array): Size | undefined {
  if (type === 'image/png') return pngSize(bytes);
  if (type === 'image/jpeg') return jpegSize(bytes);
  if (type === 'image/webp') return webpSize(bytes);
  return undefined;
}

// Санитайзер SVG по allowlist (контракт uploadBrandingAsset, возврат 1 W4.07): только элементы рисунка; без
// DOCTYPE и сущностей, обработчиков событий, javascript:/data: URI; href, xlink:href, src и url() — только на
// локальный #фрагмент. Файл не чистится, а отклоняется: владелец видит причину и загружает другой.
const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'metadata',
]);
const SVG_FORBIDDEN_TEXT =
  /<!doctype|<!entity|<\?xml-stylesheet|javascript:|vbscript:|data:|@import/i;
const LINK_ATTRS = new Set(['href', 'xlink:href', 'src']);
const NAME_CHAR = /[\w:.-]/;
const SPACE = /\s/;

interface SvgTag {
  name: string;
  attrs: [string, string][];
}

/**
 * Теги SVG с учётом кавычек (возврат 2 W4.07): «>» внутри значения атрибута не обрывает тег, а атрибуты после него
 * проверяются. Комментарии и пролог пропускаются, CDATA, незакрытый тег или кавычка — небезопасный файл (undefined).
 */
function svgTags(text: string): SvgTag[] | undefined {
  const tags: SvgTag[] = [];
  let i = text.indexOf('<');
  while (i !== -1) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) return undefined;
      i = text.indexOf('<', end + 3);
      continue;
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) return undefined;
      i = text.indexOf('<', end + 2);
      continue;
    }
    if (text[i + 1] === '!') return undefined; // CDATA, DOCTYPE и прочие объявления
    let j = i + 1;
    const closing = text[j] === '/';
    if (closing) j++;
    while (j < text.length && SPACE.test(text[j] ?? '')) j++;
    let name = '';
    while (j < text.length && NAME_CHAR.test(text[j] ?? '')) name += text[j++];
    if (!name) return undefined;
    const attrs: [string, string][] = [];
    for (;;) {
      while (j < text.length && SPACE.test(text[j] ?? '')) j++;
      const c = text[j];
      if (c === undefined) return undefined;
      if (c === '>') break;
      if (c === '/') {
        j++;
        continue;
      }
      let attr = '';
      while (j < text.length && !/[\s=/>]/.test(text[j] ?? '')) attr += text[j++];
      if (!attr) return undefined;
      while (j < text.length && SPACE.test(text[j] ?? '')) j++;
      let value = '';
      if (text[j] === '=') {
        j++;
        while (j < text.length && SPACE.test(text[j] ?? '')) j++;
        const q = text[j];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, j + 1);
          if (end === -1) return undefined;
          value = text.slice(j + 1, end);
          j = end + 1;
        } else {
          while (j < text.length && !/[\s>]/.test(text[j] ?? '')) value += text[j++];
        }
      }
      attrs.push([attr, value]);
    }
    if (!closing) tags.push({ name, attrs });
    i = text.indexOf('<', j + 1);
  }
  return tags;
}

/** SVG небезопасен: элемент вне allowlist, обработчик события, внешняя ссылка или запрещённая конструкция. */
export function unsafeSvg(text: string): boolean {
  // Числовые ссылки на символы раскрываются («&#x6A;avascript:»), пробелы внутри схемы («java&#9;script:») не прячут её.
  const decoded = text.replace(/&#(x?)([0-9a-f]+);?/gi, (_, hex: string, n: string) => {
    const code = parseInt(n, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  if (SVG_FORBIDDEN_TEXT.test(decoded.replace(/\s+/g, ''))) return true;
  const tags = svgTags(decoded);
  if (!tags) return true;
  for (const { name: rawName, attrs } of tags) {
    const name = rawName.toLowerCase().replace(/^svg:/, '');
    if (!SVG_ELEMENTS.has(name)) return true;
    for (const [rawAttr, rawValue] of attrs) {
      const attr = rawAttr.toLowerCase();
      const value = rawValue.trim();
      if (attr.startsWith('on')) return true;
      if (LINK_ATTRS.has(attr) && !value.startsWith('#')) return true;
      if (/url\(\s*(?!['"]?#)/i.test(value)) return true;
    }
  }
  return false;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const violation = (field: string, code: string, message: string) => ({
  violations: [{ field, code, message }],
});

// ---------------------------------------------------------------------------------------------
// Сохранение

function checkTerms(terms: S['BrandingTerms']): void {
  for (const [key, term] of Object.entries(terms)) {
    for (const form of FORMS) {
      if (!term?.[form]?.trim()) {
        fail(
          'validation_failed',
          undefined,
          violation(
            `terms.${key}.${form}`,
            'required',
            `Термин «${TERM_LABEL[key] ?? key}»: заполните все четыре формы`,
          ),
        );
      }
    }
  }
}

function assetOf(tb: TenantBranding, id: string | null, kind: Asset['kind']): Asset | undefined {
  if (id === null) return undefined;
  const a = tb.assets.find((x) => x.id === id.toLowerCase() && x.kind === kind);
  return (
    a ??
    fail(
      'validation_failed',
      'Проверьте оформление.',
      violation(`${kind}AssetId`, 'unknown', 'Файл не найден: загрузите его снова'),
    )
  );
}

function menuOf(menu: S['BrandingMenu']): S['BrandingMenu'] {
  const items: S['BrandingMenu']['items'] = {};
  for (const [id, item] of Object.entries(menu.items)) {
    const out: S['BrandingMenuItem'] = {};
    const label = item.label?.trim();
    if (label) out.label = label;
    if (item.icon) out.icon = item.icon;
    if (item.hidden && !LOCKED.has(id)) out.hidden = true;
    if (Object.keys(out).length) items[id] = out;
  }
  return { items, order: [...menu.order] };
}

const tenantOf = (ctx: HandlerContext): TenantRow => ctx.org().tenant;

export const brandingHandlers: Registry = {
  getTenantBranding: (ctx) => {
    const b = brandingOf(ctx.s, tenantOf(ctx)).current;
    return { body: structuredClone(b), etag: b.version };
  },

  updateTenantBranding: {
    messages: {
      displayName: 'От 1 до 60 символов',
      shortName: 'Не длиннее 16 символов',
      accentHex: 'Цвет в формате #RRGGBB',
    },
    run: (ctx) => {
      const t = tenantOf(ctx);
      const tb = brandingOf(ctx.s, t);
      ctx.revision(tb.current.version);
      const b = ctx.body as S['BrandingUpdate'];
      const displayName = b.displayName.trim();
      if (!displayName) {
        fail(
          'validation_failed',
          'Проверьте оформление.',
          violation('displayName', 'required', 'Укажите название'),
        );
      }
      checkTerms(b.terms);
      const logo = assetOf(tb, b.logoAssetId, 'logo');
      const mark = assetOf(tb, b.markAssetId, 'mark');
      const used = fixAccent(b.accentHex);
      const user = ctx.user();
      const next: Branding = {
        version: tb.current.version + 1,
        displayName,
        shortName: b.shortName?.trim() ? b.shortName.trim() : null,
        accentHex: b.accentHex,
        accentUsed: used,
        accentVariants: accentVariants(used),
        terms: structuredClone(b.terms),
        menu: menuOf(b.menu),
        poweredBy: b.poweredBy,
        updatedAt: ctx.now(),
        updatedBy: { accountId: user.id, displayName: user.displayName },
      };
      if (logo) next.logo = structuredClone(logo);
      if (mark) next.mark = structuredClone(mark);
      tb.current = next;
      if (t.name !== displayName) {
        t.name = displayName;
        t.revision++;
      }
      return { body: structuredClone(next), etag: next.version };
    },
  },

  uploadBrandingAsset: {
    before: (ctx) => {
      const raw = (ctx.body as { contentBase64?: unknown } | undefined)?.contentBase64;
      if (typeof raw === 'string' && decodedSize(raw) > MiB) fail('payload_too_large');
    },
    run: async (ctx) => {
      const t = tenantOf(ctx);
      const b = ctx.body as S['BrandingAssetUpload'];
      const bytes = decode(b.contentBase64);
      if (bytes.length > MiB) fail('payload_too_large');
      const real = sniff(bytes);
      if (!real || real !== b.contentType) {
        fail(
          'validation_failed',
          undefined,
          violation('contentType', 'content_type', 'Нужен PNG, SVG, JPG или WebP'),
        );
      }
      if (real === 'image/svg+xml' && unsafeSvg(new TextDecoder().decode(bytes))) {
        fail(
          'validation_failed',
          'SVG небезопасен.',
          violation(
            'contentBase64',
            'unsafe_svg',
            'В SVG не должно быть скриптов и внешних ссылок',
          ),
        );
      }
      // Возврат 2: размеры читаются у PNG, JPEG и WebP; растровый знак без читаемых размеров отклоняется.
      const size = rasterSize(real, bytes);
      const raster = real !== 'image/svg+xml';
      if (
        b.kind === 'mark' &&
        raster &&
        (!size || size.width !== size.height || size.width < 512)
      ) {
        fail(
          'validation_failed',
          'Знак — квадрат не меньше 512×512.',
          violation('contentBase64', 'mark_size', 'Знак — квадрат не меньше 512×512'),
        );
      }
      const sha = await sha256(bytes);
      const asset: Asset = {
        id: ctx.newId(),
        kind: b.kind,
        url: `/brand-assets/${sha}.${EXT[real]}`,
        contentType: real,
        sizeBytes: bytes.length,
        sha256: sha,
      };
      if (size) {
        asset.width = size.width;
        asset.height = size.height;
      }
      brandingOf(ctx.s, t).assets.push(asset);
      return { status: 201, body: structuredClone(asset) };
    },
  },
};
