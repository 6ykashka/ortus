// W1.20 · Акцент организации (applyBrand :2928–2933, brandVars :2324–2330; 01-shell.md §17.1): эталон после
// загрузки перезаписывает --ox-accent* формулой (контраст ≥ 4,5:1, hover +18 % чёрного, soft/tint 86/93 %
// белого). Без оформления (оператор, стенд до W4.60) — акцент по умолчанию #1F6B52.
// W4.62 · Оформление организации в оболочке (эталон design-2026-10-19: brandNav :2939–2953, шапка :96–100,
// shellVM :3041–3042; 18-branding.md): подписи, иконки, порядок и видимость пунктов меню, знак шапки.
import type { NavGroup, NavItem } from '@ortus/domain/nav';
import { format, shell } from '@ortus/texts';

import { navLabel } from './labels.ts';

const DEFAULT_ACCENT = '#1F6B52';

const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (r: number[]): string =>
  `#${r
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
const lum = (h: string): number => {
  const [r = 0, g = 0, b = 0] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Контраст цвета `#RRGGBB` с белым текстом (contrastW :2331). */
export const contrastWhite = (h: string): number => 1.05 / (lum(h) + 0.05);
const mix = (h: string, w: string, t: number): string => {
  const a = rgb(h);
  const b = rgb(w);
  return hex(a.map((x, i) => x + ((b[i] ?? 0) - x) * t));
};

/** Цвет, затемнённый шагами по 4 % к чёрному до контраста 4,5:1 (fixAccent :2333). */
export function fixAccent(accent: string): string {
  let a = accent.toUpperCase();
  for (let n = 0; contrastWhite(a) < 4.5 && n < 60; n++) a = mix(a, '#000000', 0.04);
  return a;
}

export interface BrandVars {
  accent: string;
  hover: string;
  soft: string;
  tint: string;
}

export function brandVars(accent: string | null | undefined): BrandVars {
  const a = fixAccent(/^#[0-9a-f]{6}$/i.test(accent ?? '') ? (accent as string) : DEFAULT_ACCENT);
  return {
    accent: a,
    hover: mix(a, '#000000', 0.18),
    soft: mix(a, '#FFFFFF', 0.86),
    tint: mix(a, '#FFFFFF', 0.93),
  };
}

let applied = '';

/** Ставит --ox-accent* на :root (повтор того же акцента не трогает style). */
export function applyBrand(
  accent: string | null | undefined,
  root = document.documentElement,
): void {
  const v = brandVars(accent);
  if (applied === v.accent && root.style.getPropertyValue('--ox-accent')) return;
  applied = v.accent;
  root.style.setProperty('--ox-accent', v.accent);
  root.style.setProperty('--ox-accent-hover', v.hover);
  root.style.setProperty('--ox-accent-soft', v.soft);
  root.style.setProperty('--ox-accent-tint', v.tint);
}

// ---------------------------------------------------------------------------------------------
// Меню и шапка по оформлению (TenantContext.branding — BrandingTheme контракта)

interface TermLike {
  one: string;
  plural: string;
  few: string;
  many: string;
}

/** Участок оформления, который читает меню. */
export interface BrandMenuTheme {
  terms: Partial<Record<string, TermLike>>;
  menu: {
    items: Record<string, { label?: string; icon?: string; hidden?: boolean }>;
    order: readonly string[];
  };
}

/** Пункты меню, которые не скрываются (разделы управления, BR_LOCK :2327). */
export const LOCKED_ITEMS: ReadonlySet<string> = new Set([
  'home',
  'modules',
  'users',
  'billing',
  'branding',
]);

/** Пункт меню с подписью оформления (`text` важнее ключа словаря `label`). */
export type BrandedItem = NavItem & { text?: string };
export type BrandedGroup = Omit<NavGroup, 'items'> & { items: BrandedItem[] };

/** Подпись пункта: своя (оформление) или из словаря. */
export const itemText = (it: BrandedItem): string => it.text ?? navLabel(it.label);

/** Подписи оболочки, производные от терминов оформления (эталон :2943). */
export const BRAND_TEXT = {
  review: 'Приёмка {many}',
} as const;

const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Подпись из термина каталога (derived :2942–2947); `undefined` — стандартная. */
function derived(key: string, terms: BrandMenuTheme['terms']): string | undefined {
  if (key === 'review' && terms.shift) return format(BRAND_TEXT.review, { many: terms.shift.many });
  if (key === 'cars' && terms.vehicle) return capFirst(terms.vehicle.plural);
  if (key === 'repair' && terms.object) return capFirst(terms.object.plural);
  return undefined;
}

/**
 * Меню по оформлению: скрытые пункты (кроме разделов управления) убираются, пустые группы — тоже; подпись —
 * своя, затем из термина, затем стандартная; иконка — своя; порядок внутри группы — по `order`, остальные
 * пункты — на своих местах после перечисленных.
 */
export function brandNav<G extends { items: readonly { key: string; icon: string }[] }>(
  groups: readonly G[],
  theme: BrandMenuTheme | null | undefined,
): (Omit<G, 'items'> & { items: (G['items'][number] & { text?: string })[] })[];
export function brandNav(
  groups: readonly NavGroup[],
  theme: BrandMenuTheme | null | undefined,
): BrandedGroup[];
export function brandNav<G extends { items: readonly { key: string; icon: string }[] }>(
  groups: readonly G[],
  theme: BrandMenuTheme | null | undefined,
): (Omit<G, 'items'> & { items: (G['items'][number] & { text?: string })[] })[] {
  type I = G['items'][number] & { text?: string };
  if (!theme) return groups.map((g) => ({ ...g, items: [...g.items] }));
  const { items, order } = theme.menu;
  const rank = (key: string, i: number): number => {
    const k = order.indexOf(key);
    return k < 0 ? 1000 + i : k;
  };
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((it) => LOCKED_ITEMS.has(it.key) || !items[it.key]?.hidden)
        .map((it, i) => {
          const o = items[it.key];
          const text = o?.label?.trim() || derived(it.key, theme.terms);
          const out: I = { ...it, icon: o?.icon || it.icon };
          if (text) out.text = text;
          return { it: out, r: rank(it.key, i) };
        })
        .sort((a, b) => a.r - b.r)
        .map((x) => x.it),
    }))
    .filter((g) => g.items.length > 0);
}

/** Участок оформления, который читает шапка. */
export interface BrandHeaderTheme {
  shortName: string | null;
  logo?: { url: string } | undefined;
  mark?: { url: string } | undefined;
}

export interface BrandHeader {
  /** Слева в шапке: короткое имя или «ортус». */
  name: string;
  /** Буква знака без файла: первая буква короткого имени или «о». */
  letter: string;
  logoUrl?: string;
  markUrl?: string;
}

/** Знак шапки (shellVM :3041–3042): логотип, иначе знак или буква на акценте и короткое имя. */
export function brandHeader(theme: BrandHeaderTheme | null | undefined): BrandHeader {
  const short = (theme?.shortName ?? '').trim();
  const out: BrandHeader = {
    name: short || shell.header.brandName,
    letter: short ? short.charAt(0).toUpperCase() : shell.header.brandLetter,
  };
  if (theme?.logo) out.logoUrl = theme.logo.url;
  if (theme?.mark) out.markUrl = theme.mark.url;
  return out;
}

/** Заголовок «Приёмки» (top.reviewTitle :3042): своя подпись пункта, затем термин «смена», затем стандартный. */
export function reviewTitle(theme: BrandMenuTheme | null | undefined): string {
  return (
    theme?.menu.items.review?.label?.trim() ||
    derived('review', theme?.terms ?? {}) ||
    navLabel('items.review')
  );
}
