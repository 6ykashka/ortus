// W6.21 · Выбор строки из справочника расценок в смете (эталон design-2026-10-19 «Ремонт и стройка.dc.html»
// pickList :1329): поиск по названию, позиции своего раздела первыми, не больше восьми, подпись «ед. · цена · вид».
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { pickList } from './picker.ts';

type S = components['schemas'];

const item = (
  id: string,
  section: string,
  name: string,
  o: Partial<S['PriceItem']> = {},
): S['PriceItem'] => ({
  id,
  section,
  name,
  unit: 'm2',
  kind: 'work',
  price: { amountMinor: 65000, currency: 'RUB' },
  usedInTemplates: 0,
  archived: false,
  revision: 1,
  ...o,
});

const items = [
  item('a', 'Демонтаж', 'Демонтаж перегородок'),
  item('b', 'Стены', 'Штукатурка по маякам'),
  item('c', 'Материалы', 'Штукатурка гипсовая 30 кг', { unit: 'mesh', kind: 'material' }),
  item('d', 'Полы', 'Стяжка пола'),
];

describe('pickList', () => {
  it('без запроса — все позиции, раздел «Стены» первым', () => {
    expect(pickList(items, '', 'Стены').map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('запрос — по подстроке названия без учёта регистра', () => {
    expect(pickList(items, ' ШТУКАТУРКА ', 'Материалы').map((x) => x.id)).toEqual(['c', 'b']);
    expect(pickList(items, 'zzz', 'Стены')).toEqual([]);
  });
  it('подпись: «ед. · цена · вид»', () => {
    const [w, m] = pickList(items, 'штукатурка', 'Стены');
    expect(w?.meta).toBe('м² · 650 ₽ · работа');
    expect(m?.meta).toBe('меш · 650 ₽ · материал');
  });
  it('не больше восьми; архивные не показываются', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`x${i}`, 'Стены', `Позиция ${i}`));
    expect(pickList(many, '', 'Стены')).toHaveLength(8);
    expect(pickList([item('z', 'Стены', 'Архив', { archived: true })], '', 'Стены')).toEqual([]);
  });
});
