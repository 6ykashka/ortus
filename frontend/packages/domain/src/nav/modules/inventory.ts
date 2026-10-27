// W5.11 · Манифест «Склад» (модуль ядра `inventory`, «Склад и материалы»; D-20 комплекта — остатки по партиям в порядке
// FEFO): две страницы вне меню — «Склад» (остатки, резервы) и «Движения склада». В эталоне пункта меню «Склад» нет
// (CORE_ITEMS :2970 без inventory; склад в эталоне — блоки «Остатки кабинета» и «Движения склада» на странице SPA),
// сверка меню ломалась бы: вход — прямой URL и «Связанные разделы» страниц-потребителей (SPA W5.21, снабжение W6.22),
// пункт меню — решение владельца продукта (Q-W5.11-4, по умолчанию вне меню).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'inventory',
  kind: 'core',
  moduleKey: 'inventory',
  domainModule: 'inventory',
  availability: 'catalog',
  stage: 5,
  area: 'tenant',
  pages: [
    {
      key: 'inventory',
      segment: 'inventory',
      icon: 'inventory_2',
      view: ['inventory.items.read'],
      gate: 'A',
      label: 'items.inventory',
    },
    {
      key: 'inventoryMovements',
      segment: 'inventory-movements',
      icon: 'swap_vert',
      view: ['inventory.movements.read'],
      gate: 'A',
      label: 'items.inventoryMovements',
    },
  ],
};
