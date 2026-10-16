// W1.20 · Манифест «Данные» (модуль ядра `data`; CORE_ITEMS :2964; страница — W2.26).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'data',
  kind: 'core',
  moduleKey: 'data',
  domainModule: 'data',
  availability: 'catalog',
  stage: 2,
  area: 'tenant',
  pages: [
    {
      key: 'data',
      segment: 'data',
      icon: 'table_view',
      view: ['data.catalog.read', 'data.query'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.data' },
        office: { group: 'core', label: 'items.data' },
      },
    },
  ],
};
