// W1.20 · Манифест «Обзор»: «Главная» владельца и офисных сотрудников (01-shell.md §9.1, navForBase :2978, :2994).
// Страница «Главная» — W2.25; до неё оболочка показывает заглушку.
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'overview',
  kind: 'system',
  moduleKey: null,
  availability: 'catalog',
  stage: 2,
  area: 'tenant',
  pages: [
    {
      key: 'home',
      segment: 'home',
      icon: 'home',
      view: [],
      gate: 'none',
      nav: {
        owner: { group: 'overview', label: 'items.home' },
        office: { group: 'overview', label: 'items.home' },
      },
    },
  ],
};
