// W1.20 · Манифест «Документы» (CORE_ITEMS :2964). Модуль этапа 7 (W7.25): доступности в каталоге этапа 1 нет.
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'docs',
  kind: 'core',
  moduleKey: null,
  domainModule: 'docs',
  availability: 'future',
  stage: 7,
  area: 'tenant',
  pages: [
    {
      key: 'docs',
      segment: 'docs',
      icon: 'description',
      view: [],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.docs' },
        office: { group: 'core', label: 'items.docs' },
        driver: { group: 'work', label: 'items.docs' },
        foreman: { group: 'core', label: 'items.docs' },
      },
    },
  ],
};
