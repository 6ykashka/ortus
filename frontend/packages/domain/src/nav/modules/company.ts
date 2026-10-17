// W1.20 · Манифест «Компания» (navForBase :2978): только владелец бизнеса; гейт эталона пропускает владельца
// без проверки (:3056). «Хранилище» (S1-22, no-reference) — маршрут без пункта меню (W1.24); «Структура» (S1-08,
// no-reference) — пункт меню без эталона (W1.54).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'company',
  kind: 'system',
  moduleKey: null,
  availability: 'catalog',
  stage: 1,
  area: 'tenant',
  pages: [
    {
      key: 'modules',
      segment: 'modules',
      icon: 'extension',
      view: ['modules.read'],
      gate: 'owner',
      nav: { owner: { group: 'company', label: 'items.modules' } },
    },
    {
      key: 'users',
      segment: 'users',
      icon: 'group',
      view: ['members.read', 'roles.read'],
      gate: 'owner',
      nav: { owner: { group: 'company', label: 'items.users' } },
    },
    {
      // W1.54 (S1-08, no-reference B-6, Q-W1.54-1): «Структура» — регионы, фирмы, подразделения; пункта в эталоне
      // нет. Гейт владельца: владелец или право org_units.read в любой области.
      key: 'structure',
      segment: 'structure',
      icon: 'account_tree',
      view: ['org_units.read'],
      gate: 'owner',
      nav: { owner: { group: 'company', label: 'items.structure' } },
    },
    {
      key: 'billing',
      segment: 'billing',
      icon: 'workspace_premium',
      view: ['billing.read'],
      gate: 'owner',
      nav: { owner: { group: 'company', label: 'items.billing' } },
    },
    {
      key: 'branding',
      segment: 'branding',
      icon: 'palette',
      view: ['modules.manage'],
      gate: 'owner',
      nav: { owner: { group: 'company', label: 'items.branding' } },
    },
    {
      key: 'storage',
      segment: 'storage',
      icon: 'storage',
      view: ['billing.read'],
      gate: 'owner',
      label: 'items.storage',
    },
  ],
};
