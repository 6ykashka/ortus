// W4.62 · Модель «Оформления» (brandingVM :3681–3749 эталона design-2026-10-19; 18-branding.md): черновик по
// действующей версии (getTenantBranding), контраст и автокоррекция цвета, буква и имя, ошибки черновика,
// термины, строки меню, предпросмотр, версия, проверка файла и тело updateTenantBranding. Без React и DOM.
import type { components } from '@ortus/api-client';

import {
  brandNav,
  brandVars,
  contrastWhite,
  fixAccent,
  LOCKED_ITEMS,
} from '../../../shell/brand.ts';
import { BR_TEXT, PALETTE, type TermKey, TERMS, t } from './texts.ts';

type S = components['schemas'];
type Branding = S['Branding'];

export interface AssetRef {
  id: string;
  url: string;
}
export interface MenuOverride {
  label?: string;
  icon?: string;
  hidden?: boolean;
}
export interface TermForms {
  one: string;
  plural: string;
  few: string;
  many: string;
}

/** Черновик страницы (brDraft эталона): то, что уйдёт в updateTenantBranding. */
export interface Draft {
  name: string;
  short: string;
  /** Цвет как введён (палитра или свой HEX). */
  accent: string;
  logo: AssetRef | null;
  mark: AssetRef | null;
  terms: Partial<Record<TermKey, TermForms>>;
  items: Record<string, MenuOverride>;
  order: string[];
  poweredBy: boolean;
}

/** Пункт меню владельца для редактора и предпросмотра (navForBase с подписью). */
export interface BaseItem {
  id: string;
  label: string;
  icon: string;
}
export interface BaseGroup {
  title: string;
  items: BaseItem[];
}

export type DraftAction =
  | { type: 'name'; value: string }
  | { type: 'short'; value: string }
  | { type: 'accent'; value: string }
  | { type: 'logo'; value: AssetRef | null }
  | { type: 'mark'; value: AssetRef | null }
  | { type: 'term'; key: TermKey; form: keyof TermForms; value: string }
  | { type: 'termReset'; key: TermKey }
  | { type: 'item'; id: string; patch: MenuOverride }
  | { type: 'order'; value: string[] }
  | { type: 'powered' }
  | { type: 'standard' };

export const DEFAULT_ACCENT = '#1F6B52';
const HEX = /^#[0-9a-f]{6}$/i;
const MiB = 1024 * 1024;
export const FILE_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'] as const;

/** Наборы иконок пунктов меню (BR_ICONS :2320–2326); пункт без набора — только своя иконка. */
export const ICONS: Readonly<Record<string, readonly string[]>> = {
  home: ['home', 'dashboard', 'space_dashboard'],
  spa: ['spa', 'self_care', 'content_cut', 'hot_tub', 'health_and_beauty'],
  repair: [
    'home_work',
    'construction',
    'home_repair_service',
    'handyman',
    'engineering',
    'foundation',
  ],
  fleet: ['local_shipping', 'directions_car', 'route', 'airport_shuttle', 'warehouse'],
  pool: ['person_search', 'groups', 'diversity_3', 'badge'],
  review: ['fact_check', 'rule', 'task', 'verified'],
  tasks: ['task_alt', 'checklist', 'assignment', 'view_kanban'],
  forms: ['dynamic_form', 'quiz', 'edit_note', 'assignment'],
  calendar: ['calendar_month', 'event', 'schedule', 'date_range'],
  knowledge: ['menu_book', 'school', 'library_books', 'help_center'],
  docs: ['description', 'article', 'draft', 'folder_shared'],
  data: ['table_view', 'analytics', 'bar_chart', 'dataset'],
  files: ['folder_open', 'cloud', 'attach_file', 'photo_library'],
  cash: ['account_balance_wallet', 'payments', 'point_of_sale', 'savings'],
  modules: ['extension', 'apps', 'widgets'],
  users: ['group', 'manage_accounts', 'badge'],
  billing: ['workspace_premium', 'receipt_long', 'credit_card'],
  branding: ['palette', 'brush', 'format_paint'],
};

// ---------------------------------------------------------------------------------------------
// Черновик

/** Действующая версия → черновик (clean :3683: без версии и автора). */
export function draftOf(b: Branding): Draft {
  const items: Record<string, MenuOverride> = {};
  for (const [id, o] of Object.entries(b.menu.items)) items[id] = { ...o };
  const terms: Draft['terms'] = {};
  for (const [k, v] of Object.entries(b.terms) as [TermKey, TermForms | undefined][]) {
    if (v) terms[k] = { one: v.one, plural: v.plural, few: v.few, many: v.many };
  }
  return {
    name: b.displayName,
    short: b.shortName ?? '',
    accent: b.accentHex,
    logo: b.logo ? { id: b.logo.id, url: b.logo.url } : null,
    mark: b.mark ? { id: b.mark.id, url: b.mark.url } : null,
    terms,
    items,
    order: [...b.menu.order],
    poweredBy: b.poweredBy,
  };
}

/** Есть несохранённые изменения (сравнение как в эталоне — JSON черновика и сохранённого, :3684). */
export function isDirty(draft: Draft | null, saved: Branding): boolean {
  return !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
}

/** «Стандартное оформление» (:3747): значения Ортуса, название остаётся. */
export function standardDraft(name: string): Draft {
  return {
    name,
    short: '',
    accent: DEFAULT_ACCENT,
    logo: null,
    mark: null,
    terms: {},
    items: {},
    order: [],
    poweredBy: true,
  };
}

/** Свой HEX: пробелы снимаются, без «#» — с «#» (onAccent :3731). */
const normalizeHex = (v: string): string => {
  const s = v.trim();
  return s.startsWith('#') ? s : `#${s}`;
};

function termDefaults(key: TermKey): TermForms {
  const d = TERMS.find((x) => x.key === key);
  return { one: d?.one ?? '', plural: d?.plural ?? '', few: d?.few ?? '', many: d?.many ?? '' };
}

export function reduceDraft(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'name':
      return { ...d, name: a.value };
    case 'short':
      return { ...d, short: a.value };
    case 'accent':
      return { ...d, accent: normalizeHex(a.value) };
    case 'logo':
      return { ...d, logo: a.value };
    case 'mark':
      return { ...d, mark: a.value };
    case 'term': {
      const cur = d.terms[a.key] ?? termDefaults(a.key);
      return { ...d, terms: { ...d.terms, [a.key]: { ...cur, [a.form]: a.value } } };
    }
    case 'termReset': {
      const terms = Object.fromEntries(
        Object.entries(d.terms).filter(([k]) => k !== a.key),
      ) as Draft['terms'];
      return { ...d, terms };
    }
    case 'item':
      return { ...d, items: { ...d.items, [a.id]: { ...d.items[a.id], ...a.patch } } };
    case 'order':
      return { ...d, order: a.value };
    case 'powered':
      return { ...d, poweredBy: !d.poweredBy };
    case 'standard':
      return standardDraft(d.name);
  }
}

// ---------------------------------------------------------------------------------------------
// Цвет

/** Контраст «6,4:1» (fmtRatio :2335). */
export const fmtRatio = (x: number): string =>
  `${(Math.round(x * 10) / 10).toString().replace('.', ',')}:1`;

export interface AccentView {
  /** ok — подходит, fix — будет исправлен, bad — не #RRGGBB. */
  state: 'ok' | 'fix' | 'bad';
  /** Цвет черновика заглавными (или Ортус, если HEX неверный). */
  acc: string;
  fixed: string;
  text: string;
  /** Значение `input[type=color]`. */
  picker: string;
  /** Цвета предпросмотра (из применяемого цвета). */
  vars: { accent: string; hover: string; soft: string; tint: string };
}

export function accentView(hex: string): AccentView {
  const ok = HEX.test(hex);
  const acc = ok ? hex.toUpperCase() : DEFAULT_ACCENT;
  const ratio = contrastWhite(acc);
  const fixed = fixAccent(acc);
  const state = !ok ? 'bad' : ratio >= 4.5 ? 'ok' : 'fix';
  const text =
    state === 'bad'
      ? BR_TEXT.accent.bad
      : state === 'ok'
        ? t(BR_TEXT.accent.ok, { ratio: fmtRatio(ratio) })
        : t(BR_TEXT.accent.fix, {
            ratio: fmtRatio(ratio),
            fixed,
            fixedRatio: fmtRatio(contrastWhite(fixed)),
          });
  return { state, acc, fixed, text, picker: acc, vars: brandVars(acc) };
}

export interface PaletteColor {
  hex: string;
  label: string;
  selected: boolean;
}

export function paletteView(accent: string): PaletteColor[] {
  const acc = HEX.test(accent) ? accent.toUpperCase() : DEFAULT_ACCENT;
  return PALETTE.map(([hex, label]) => ({ hex, label, selected: hex.toUpperCase() === acc }));
}

// ---------------------------------------------------------------------------------------------
// Название и буква

export interface IdentityView {
  /** Короткое имя или первое слово названия (или «ортус»). */
  shown: string;
  letter: string;
  nameText: string;
  count: string;
  over: boolean;
}

export function identity(d: Draft): IdentityView {
  const short = d.short.trim();
  const name = d.name.trim();
  const shown = short || name.split(/\s+/)[0] || 'ортус';
  const letter = (shown.replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').charAt(0) || 'о').toUpperCase();
  return {
    shown,
    letter,
    nameText: name || BR_TEXT.preview.nameFallback,
    count: t(BR_TEXT.name.count, { n: short.length }),
    over: short.length > 16,
  };
}

/** Ошибки черновика (:3696–3701) — в порядке эталона. */
export function draftErrors(d: Draft): string[] {
  const E = BR_TEXT.errors;
  const name = d.name.trim();
  const errs: string[] = [];
  if (!name) errs.push(E.name);
  if (name.length > 60) errs.push(E.nameLength);
  if (d.short.trim().length > 16) errs.push(E.shortLength);
  if (!HEX.test(d.accent)) errs.push(E.hex);
  for (const [key, f] of Object.entries(d.terms) as [TermKey, TermForms][]) {
    if ([f.one, f.plural, f.few, f.many].some((x) => !x.trim())) {
      errs.push(t(E.term, { label: TERMS.find((z) => z.key === key)?.label ?? key }));
    }
  }
  return errs;
}

export const cantSave = (dirty: boolean, errs: readonly string[], busy: boolean): boolean =>
  !dirty || errs.length > 0 || busy;

// ---------------------------------------------------------------------------------------------
// Термины

export interface TermRow extends TermForms {
  key: TermKey;
  label: string;
  where: string;
  example: string;
  custom: boolean;
}

export function termRows(d: Draft): TermRow[] {
  return TERMS.map((tm) => {
    const cur = d.terms[tm.key] ?? termDefaults(tm.key);
    return {
      key: tm.key,
      label: tm.label,
      where: tm.where,
      ...cur,
      example: t(BR_TEXT.terms.example, { ...cur }),
      custom: !!d.terms[tm.key],
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Меню

/** Id пунктов каждой группы в порядке черновика (rank :3709–3710). */
export function groupIds(base: readonly BaseGroup[], order: readonly string[]): string[][] {
  const rank = (id: string, i: number): number => {
    const k = order.indexOf(id);
    return k < 0 ? 1000 + i : k;
  };
  return base.map((g) =>
    g.items
      .map((it, i) => ({ id: it.id, r: rank(it.id, i) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.id),
  );
}

/** «Выше» / «Ниже»: обмен с соседом в группе, новый общий порядок (move :3711). */
export function moveItem(ids: readonly string[][], gi: number, j: number, dir: 1 | -1): string[] {
  const next = ids.map((g) => [...g]);
  const g = next[gi];
  const a = g?.[j];
  const b = g?.[j + dir];
  if (!g || a === undefined || b === undefined) return next.flat();
  g[j] = b;
  g[j + dir] = a;
  return next.flat();
}

export interface MenuRow {
  id: string;
  /** Стандартная подпись пункта. */
  def: string;
  /** Своя подпись (пусто — стандартная). */
  label: string;
  icon: string;
  locked: boolean;
  hidden: boolean;
  open: boolean;
  cantUp: boolean;
  cantDown: boolean;
  icons: string[];
}

export interface MenuGroupView {
  title: string;
  rows: MenuRow[];
}

export function menuRows(
  base: readonly BaseGroup[],
  d: Draft,
  open: string | null,
): MenuGroupView[] {
  const ids = groupIds(base, d.order);
  return base.map((g, gi) => {
    const list = ids[gi] ?? [];
    return {
      title: g.title,
      rows: list.flatMap((id, j) => {
        const it = g.items.find((z) => z.id === id);
        if (!it) return [];
        const o = d.items[id] ?? {};
        const locked = LOCKED_ITEMS.has(id);
        return [
          {
            id,
            def: it.label,
            label: o.label ?? '',
            icon: o.icon || it.icon,
            locked,
            hidden: !locked && !!o.hidden,
            open: open === id,
            cantUp: j === 0,
            cantDown: j === list.length - 1,
            icons: [...(ICONS[id] ?? [it.icon])],
          },
        ];
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Предпросмотр

export interface PreviewView {
  nav: { id: string; label: string; icon: string }[];
  reviewTitle: string;
  count: string;
}

const shiftOf = (d: Draft): TermForms => d.terms.shift ?? termDefaults('shift');

/** Предпросмотр приложения (:3722, :3740–3742): первые 7 пунктов меню черновика, заголовок приёмки. */
export function previewView(base: readonly BaseGroup[], d: Draft): PreviewView {
  const groups = brandNav(
    base.map((g) => ({
      items: g.items.map((it) => ({ key: it.id, label: it.label, icon: it.icon })),
    })),
    { terms: d.terms, menu: { items: d.items, order: d.order } },
  );
  const nav = groups
    .flatMap((g) => g.items)
    .slice(0, 7)
    .map((it) => ({ id: it.key, label: it.text ?? it.label, icon: it.icon }));
  const own = d.items.review?.label?.trim();
  return {
    nav,
    reviewTitle:
      own ||
      (d.terms.shift
        ? t(BR_TEXT.preview.reviewTerm, { many: shiftOf(d).many })
        : BR_TEXT.preview.review),
    count: t(BR_TEXT.preview.count, { few: shiftOf(d).few }),
  };
}

// ---------------------------------------------------------------------------------------------
// Версия, файлы, сохранение

const MSK = 'Europe/Moscow';
const dayOf = (d: Date): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, day: '2-digit', month: '2-digit' }).format(d);
const timeOf = (d: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
const yearDayOf = (d: Date): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, dateStyle: 'short' }).format(d);

/**
 * «Версия N · изменено …, Имя» (:3743). Момент сохранения — время «10:30», если сохранено сегодня (эталон пишет
 * hhmm() при сохранении), иначе «24.09 12:10» (так записан сид «Лотоса»).
 */
export function versionText(b: Branding, now: Date): string {
  const V = BR_TEXT.version;
  let s = t(V.base, { v: b.version });
  if (!b.updatedAt) return s + V.standard;
  const at = new Date(b.updatedAt);
  const when = yearDayOf(at) === yearDayOf(now) ? timeOf(at) : `${dayOf(at)} ${timeOf(at)}`;
  s += t(V.changed, { at: when });
  if (b.updatedBy?.displayName) s += t(V.by, { by: b.updatedBy.displayName });
  return s;
}

/** Файл до загрузки (:3690–3693): сначала тип, затем размер (до 1 МБ включительно). */
export function fileProblem(f: { type: string; size: number }): string | null {
  if (!(FILE_TYPES as readonly string[]).includes(f.type)) return BR_TEXT.logo.badType;
  if (f.size > MiB) return BR_TEXT.logo.tooBig;
  return null;
}

/** Тело updateTenantBranding (onSave :3745): обрезка, выбранный цвет заглавными, пустые подписи — без подписи. */
export function updateBody(d: Draft): S['BrandingUpdate'] {
  const items: S['BrandingMenu']['items'] = {};
  for (const [id, o] of Object.entries(d.items)) {
    const out: S['BrandingMenuItem'] = {};
    const label = o.label?.trim();
    if (label) out.label = label;
    if (o.icon) out.icon = o.icon;
    if (o.hidden && !LOCKED_ITEMS.has(id)) out.hidden = true;
    if (Object.keys(out).length) items[id] = out;
  }
  const terms: S['BrandingTerms'] = {};
  for (const [k, f] of Object.entries(d.terms) as [TermKey, TermForms][]) {
    terms[k] = {
      one: f.one.trim(),
      plural: f.plural.trim(),
      few: f.few.trim(),
      many: f.many.trim(),
    };
  }
  return {
    displayName: d.name.trim(),
    shortName: d.short.trim() || null,
    accentHex: HEX.test(d.accent) ? d.accent.toUpperCase() : DEFAULT_ACCENT,
    logoAssetId: d.logo?.id ?? null,
    markAssetId: d.mark?.id ?? null,
    terms,
    menu: { items, order: [...d.order] },
    poweredBy: d.poweredBy,
  };
}
