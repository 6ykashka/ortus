// W1.20 · Манифест «Салон и SPA» (модуль `spa`; navForBase :2986, :3001): «Отрасли» у владельца при подключённом
// модуле, «Мой день» на рабочем месте массажиста. Страница `PAGE_MOD` (ветка A).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'spa',
  kind: 'industry',
  moduleKey: 'spa',
  domainModule: 'spa',
  availability: 'catalog',
  stage: 5,
  area: 'tenant',
  readonlyItem: { page: 'spa', label: 'items.spa', icon: 'spa' },
  pages: [
    {
      key: 'spa',
      segment: 'spa',
      icon: 'spa',
      view: ['spa.appointments.read', 'spa.services.read'],
      gate: 'A',
      nav: {
        owner: { group: 'industries', label: 'items.spa' },
        office: { group: 'industries', label: 'items.spa' },
        practitioner: { group: 'work', label: 'items.mySpa' },
      },
    },
  ],
};
