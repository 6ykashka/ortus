// W4.62 · Оформление организации в оболочке (эталон design-2026-10-19: brandNav :2939–2953, шапка :96–100,
// shellVM :3041–3042; 18-branding.md «Меню», «Термины»): пункты меню по оформлению и знак шапки.
import type { NavGroup } from '@ortus/domain/nav';
import { describe, expect, it } from 'vitest';

import { brandHeader, brandNav, itemText, reviewTitle } from './brand.ts';

const GROUPS: NavGroup[] = [
  {
    key: 'overview',
    title: 'groups.overview',
    items: [{ key: 'home', segment: '', label: 'items.home', icon: 'home' }],
  },
  {
    key: 'company',
    title: 'groups.company',
    items: [
      { key: 'modules', segment: 'modules', label: 'items.modules', icon: 'extension' },
      { key: 'users', segment: 'users', label: 'items.users', icon: 'group' },
      { key: 'billing', segment: 'billing', label: 'items.billing', icon: 'workspace_premium' },
      { key: 'branding', segment: 'branding', label: 'items.branding', icon: 'palette' },
    ],
  },
  {
    key: 'logistics',
    title: 'groups.logistics',
    items: [
      { key: 'fleet', segment: 'fleet', label: 'items.fleet', icon: 'local_shipping' },
      { key: 'review', segment: 'review', label: 'items.review', icon: 'fact_check', badge: 2 },
    ],
  },
  {
    key: 'industries',
    title: 'groups.industries',
    items: [{ key: 'spa', segment: 'spa', label: 'items.spa', icon: 'spa' }],
  },
];

const theme = (o: {
  terms?: Record<string, { one: string; plural: string; few: string; many: string }>;
  items?: Record<string, { label?: string; icon?: string; hidden?: boolean }>;
  order?: string[];
}) => ({ terms: o.terms ?? {}, menu: { items: o.items ?? {}, order: o.order ?? [] } });

const labels = (g: ReturnType<typeof brandNav>) => g.map((x) => x.items.map(itemText));

describe('меню по оформлению организации (brandNav)', () => {
  it('без оформления — меню как есть', () => {
    expect(labels(brandNav(GROUPS, null))).toEqual([
      ['Главная'],
      ['Модули и место', 'Пользователи и роли', 'Подписка и места', 'Оформление'],
      ['Рабочее место логиста', 'Приёмка смен'],
      ['Салон и SPA'],
    ]);
  });

  it('скрытый пункт пропадает, пустая группа — тоже; разделы управления не скрываются', () => {
    const g = brandNav(
      GROUPS,
      theme({ items: { spa: { hidden: true }, users: { hidden: true } } }),
    );
    expect(g.map((x) => x.key)).toEqual(['overview', 'company', 'logistics']);
    expect(g[1]?.items.map((i) => i.key)).toEqual(['modules', 'users', 'billing', 'branding']);
  });

  it('свои подпись и иконка; порядок внутри группы по order', () => {
    const g = brandNav(
      GROUPS,
      theme({
        items: { billing: { label: ' Тариф ' }, home: { icon: 'dashboard' } },
        order: ['users', 'modules'],
      }),
    );
    expect(labels(g)[1]).toEqual(['Пользователи и роли', 'Модули и место', 'Тариф', 'Оформление']);
    expect(g[0]?.items[0]?.icon).toBe('dashboard');
    expect(g[2]?.items[1]?.badge).toBe(2);
  });

  it('подпись из термина: «Приёмка рейсов»; ручная подпись важнее термина', () => {
    const terms = { shift: { one: 'рейс', plural: 'рейсы', few: 'рейса', many: 'рейсов' } };
    expect(labels(brandNav(GROUPS, theme({ terms })))[2]?.[1]).toBe('Приёмка рейсов');
    expect(
      labels(brandNav(GROUPS, theme({ terms, items: { review: { label: 'Контроль' } } })))[2]?.[1],
    ).toBe('Контроль');
  });
});

describe('знак шапки (shellVM :3041–3042)', () => {
  it('без оформления и без короткого имени — «ортус», буква «о»', () => {
    expect(brandHeader(null)).toEqual({ name: 'ортус', letter: 'о' });
    expect(brandHeader({ shortName: null })).toEqual({ name: 'ортус', letter: 'о' });
  });

  it('короткое имя — в шапке, буква — его первая; логотип и знак — адреса файлов', () => {
    expect(
      brandHeader({
        shortName: 'лотос',
        logo: { url: '/brand-assets/l.png' },
        mark: { url: '/brand-assets/m.png' },
      }),
    ).toEqual({
      name: 'лотос',
      letter: 'Л',
      logoUrl: '/brand-assets/l.png',
      markUrl: '/brand-assets/m.png',
    });
  });
});

describe('заголовок «Приёмки» по оформлению (top.reviewTitle :3042)', () => {
  it('стандартный, из термина «смена» и своя подпись пункта', () => {
    const terms = { shift: { one: 'рейс', plural: 'рейсы', few: 'рейса', many: 'рейсов' } };
    expect(reviewTitle(null)).toBe('Приёмка смен');
    expect(reviewTitle(theme({ terms }))).toBe('Приёмка рейсов');
    expect(reviewTitle(theme({ terms, items: { review: { label: ' Контроль ' } } }))).toBe(
      'Контроль',
    );
  });
});
