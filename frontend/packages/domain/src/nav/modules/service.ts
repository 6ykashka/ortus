// W1.20 · Манифест «Обращения» (CORE_ITEMS :2964). Модуль этапа 7 (W7.32): доступности в каталоге этапа 1 нет.
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'service',
  kind: 'core',
  moduleKey: null,
  domainModule: 'service',
  availability: 'future',
  stage: 7,
  area: 'tenant',
  pages: [
    {
      key: 'service',
      segment: 'service',
      icon: 'support_agent',
      view: [],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.service' },
        office: { group: 'core', label: 'items.service' },
      },
    },
  ],
};
