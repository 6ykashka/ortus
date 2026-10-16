// W1.20 · Страницы из реестра манифестов: ключ ↔ сегмент маршрута ADR-0001 в своём контуре.
import { MANIFESTS } from './registry.gen.ts';
import type { Area, LabelKey, NavManifest, PageKey, PageManifest } from './types.ts';

export interface PageEntry extends PageManifest {
  area: Area;
  manifest: NavManifest;
}

function index(manifests: readonly NavManifest[]): Map<PageKey, PageEntry> {
  const out = new Map<PageKey, PageEntry>();
  for (const manifest of manifests) {
    for (const page of manifest.pages) {
      if (out.has(page.key)) throw new Error(`nav: страница «${page.key}» в двух манифестах`);
      out.set(page.key, { ...page, area: manifest.area, manifest });
    }
  }
  return out;
}

export const PAGES: ReadonlyMap<PageKey, PageEntry> = index(MANIFESTS);

const BY_SEGMENT = new Map([...PAGES.values()].map((p) => [`${p.area}/${p.segment}`, p]));

/** Сегмент маршрута страницы (`repairCatalog` → `repair-catalog`). */
export function segmentOf(key: PageKey): string | undefined {
  return PAGES.get(key)?.segment;
}

/** Страница по сегменту маршрута своего контура; неизвестная — `undefined` (404). */
export function pageBySegment(area: Area, segment: string): PageEntry | undefined {
  return BY_SEGMENT.get(`${area}/${segment}`);
}

/** Подпись страницы: первое размещение в меню (у страниц вне меню — нет). */
export function pageLabel(key: PageKey): LabelKey | null {
  const nav = PAGES.get(key)?.nav;
  const first = nav ? Object.values(nav)[0] : undefined;
  return first?.label ?? null;
}
