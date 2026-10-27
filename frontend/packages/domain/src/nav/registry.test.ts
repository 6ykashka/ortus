// W1.20 · Реестр манифестов навигации: генерируется по modules/*.ts (план v2 §3.5), покрывает маршруты
// ADR-0001 (каждый ключ страницы — один маршрут, сегменты уникальны, `planned` не реализуется — PD-24).
import { describe, expect, it } from 'vitest';

import { PAGE_ORDER } from './pages.ts';
import { PAGES, pageBySegment, pageLabel, segmentOf } from './registry.ts';
import { MANIFESTS } from './registry.gen.ts';
import source from './registry.gen.ts?raw';
import { renderRegistry } from './registry-render.ts';

const files = Object.keys(import.meta.glob('./modules/*.ts')).map((f) =>
  f.replace('./modules/', '').replace(/\.ts$/, ''),
);

/** Маршруты таблицы ADR-0001 «Маршруты» (контур организации и оператора). */
const ADR_0001: Record<string, string> = {
  home: 'home',
  modules: 'modules',
  users: 'users',
  structure: 'structure',
  billing: 'billing',
  branding: 'branding',
  storage: 'storage',
  fleet: 'fleet',
  pool: 'pool',
  review: 'review',
  defects: 'defects',
  earnings: 'earnings',
  expenseCategories: 'expense-categories',
  today: 'today',
  cars: 'cars',
  chat: 'chat',
  tasks: 'tasks',
  leads: 'leads',
  service: 'service',
  forms: 'forms',
  calendar: 'calendar',
  knowledge: 'knowledge',
  docs: 'docs',
  data: 'data',
  files: 'files',
  cash: 'cash',
  cashSelf: 'cash-self',
  inventory: 'inventory',
  inventoryMovements: 'inventory-movements',
  spa: 'spa',
  repair: 'repair',
  repairSupply: 'repair-supply',
  repairCatalog: 'repair-catalog',
  tenants: 'tenants',
  usage: 'usage',
  requests: 'requests',
  accounts: 'accounts',
  plans: 'plans',
};

describe('реестр манифестов', () => {
  it('registry.gen.ts свежий: совпадает с выводом генератора по modules/*.ts', () => {
    expect(source).toBe(renderRegistry(files));
  });

  it('id манифеста совпадает с именем файла', () => {
    expect(MANIFESTS.map((m) => m.id)).toEqual([...files].sort());
  });

  it('у каждого ключа ADR-0001 ровно один маршрут с сегментом из таблицы', () => {
    for (const [key, segment] of Object.entries(ADR_0001)) {
      expect(segmentOf(key as never), key).toBe(segment);
      expect(pageBySegment(PAGES.get(key as never)?.area ?? 'tenant', segment)?.key).toBe(key);
    }
    expect(PAGES.size).toBe(Object.keys(ADR_0001).length);
  });

  it('`planned` и неизвестные сегменты не реализуются (PD-24)', () => {
    expect(pageBySegment('tenant', 'planned')).toBeUndefined();
    expect(pageBySegment('tenant', 'nope')).toBeUndefined();
    expect(pageBySegment('platform', 'home')).toBeUndefined();
    expect(pageBySegment('tenant', 'tenants')).toBeUndefined();
  });

  it('порядок страниц меню покрывает все страницы реестра', () => {
    expect([...PAGE_ORDER].sort()).toEqual([...PAGES.keys()].sort());
  });
});

describe('подпись страницы (pageLabel)', () => {
  it('страница меню — подпись первого размещения', () => {
    expect(pageLabel('modules')).toBe('items.modules');
    expect(pageLabel('today')).toBe('items.today');
  });

  it('страница вне меню — своя подпись манифеста: «Хранилище» (W1.24, Q-W1.24-17)', () => {
    expect(PAGES.get('storage')?.nav).toBeUndefined();
    expect(pageLabel('storage')).toBe('items.storage');
  });

  it('«Структура» (W1.54, Q-W1.54-1): пункт меню владельца в «Компании», сегмент structure', () => {
    expect(pageLabel('structure')).toBe('items.structure');
    expect(pageBySegment('tenant', 'structure')?.key).toBe('structure');
    expect(PAGES.get('structure')?.nav?.owner).toEqual({
      group: 'company',
      label: 'items.structure',
    });
  });

  it('очередь дефектов и начисления (W2.21): страницы «Логистики» вне меню со своей подписью и правом', () => {
    expect(PAGES.get('defects')?.nav).toBeUndefined();
    expect(pageLabel('defects')).toBe('items.defects');
    expect(PAGES.get('defects')?.view).toEqual(['fleet.inspections.review']);
    expect(PAGES.get('earnings')?.nav).toBeUndefined();
    expect(pageLabel('earnings')).toBe('items.earnings');
    expect(PAGES.get('earnings')?.view).toEqual(['fleet.earnings.read']);
    expect(PAGES.get('earnings')?.manifest.id).toBe('fleet');
  });

  it('«Категории расходов» (W2.41, Q-W2.41-2): страница «Логистики» вне меню, право настроек модуля', () => {
    const p = PAGES.get('expenseCategories');
    expect(p?.nav).toBeUndefined();
    expect(pageLabel('expenseCategories')).toBe('items.expenseCategories');
    expect(p?.view).toEqual(['modules.settings.manage']);
    expect(p?.manifest.id).toBe('fleet');
    expect(pageBySegment('tenant', 'expense-categories')?.key).toBe('expenseCategories');
  });

  it('«Склад» (W5.11, Q-W5.11-4): модуль ядра inventory, две страницы вне меню (в эталоне пункта нет), права чтения', () => {
    for (const [key, view, label] of [
      ['inventory', ['inventory.items.read'], 'items.inventory'],
      ['inventoryMovements', ['inventory.movements.read'], 'items.inventoryMovements'],
    ] as const) {
      const p = PAGES.get(key);
      expect(p?.nav, key).toBeUndefined();
      expect(pageLabel(key), key).toBe(label);
      expect(p?.view, key).toEqual(view);
      expect(p?.gate, key).toBe('A');
      expect(p?.manifest.id, key).toBe('inventory');
      expect(p?.manifest.moduleKey, key).toBe('inventory');
      expect(p?.manifest.domainModule, key).toBe('inventory');
    }
    expect(pageBySegment('tenant', 'inventory-movements')?.key).toBe('inventoryMovements');
  });

  it('у каждой страницы «Компании» есть подпись (имя раздела в гейте не пустое)', () => {
    const missing = [...PAGES.values()]
      .filter((p) => p.manifest.id === 'company' && pageLabel(p.key) === null)
      .map((p) => p.key);
    expect(missing).toEqual([]);
  });
});
