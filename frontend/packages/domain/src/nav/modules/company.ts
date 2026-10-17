// W1.20 · Манифест «Компания» (navForBase :2978): только владелец бизнеса; гейт эталона пропускает владельца
// без проверки (:3056). «Хранилище» (S1-22, no-reference) — маршрут без пункта меню (W1.24).
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
