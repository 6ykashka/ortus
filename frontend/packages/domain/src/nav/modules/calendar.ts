// W1.20 · Манифест «Календарь» (модуль ядра `calendar`; CORE_ITEMS :2964, рабочее место массажиста :3001).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'calendar',
  kind: 'core',
  moduleKey: 'calendar',
  domainModule: 'calendar',
  availability: 'catalog',
  stage: 4,
  area: 'tenant',
  pages: [
    {
      key: 'calendar',
      segment: 'calendar',
      icon: 'calendar_month',
      view: ['calendar.bookings.read', 'calendar.availability.read'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.calendar' },
        office: { group: 'core', label: 'items.calendar' },
        practitioner: { group: 'work', label: 'items.calendar' },
      },
    },
  ],
};
