// W6.21 · Выбор строки из справочника расценок в смете (эталон design-2026-10-19 «Ремонт и стройка.dc.html»
// pickList :1329): поиск по названию, позиции раздела первыми, не больше восьми.
import type { components } from '@ortus/api-client';

import { rub, unitLabel } from './format.ts';

type PriceItem = components['schemas']['PriceItem'];

export interface PickItem {
  id: string;
  name: string;
  /** «м² · 650 ₽ · работа». */
  meta: string;
}

export function pickList(items: readonly PriceItem[], query: string, section: string): PickItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((p) => !p.archived && (!q || p.name.toLowerCase().includes(q)))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(b.p.section === section) - Number(a.p.section === section) || a.i - b.i)
    .slice(0, 8)
    .map(({ p }) => ({
      id: p.id,
      name: p.name,
      meta: `${unitLabel(p.unit)} · ${rub(p.price.amountMinor)} · ${p.kind === 'work' ? 'работа' : 'материал'}`,
    }));
}
