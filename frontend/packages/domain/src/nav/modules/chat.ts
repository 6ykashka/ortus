// W1.20 · Манифест «Чаты» (CORE_ITEMS :2964). Модуль этапа 7 (W7.13): доступности в каталоге этапа 1 нет —
// пункт по рабочему месту, как в эталоне; страница — заглушка до своего этапа (out-of-stage).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'chat',
  kind: 'core',
  moduleKey: null,
  domainModule: 'chat',
  availability: 'future',
  stage: 7,
  area: 'tenant',
  pages: [
    {
      key: 'chat',
      segment: 'chat',
      icon: 'forum',
      view: [],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.chat' },
        office: { group: 'core', label: 'items.chat' },
        driver: { group: 'work', label: 'items.chat' },
        practitioner: { group: 'work', label: 'items.chat' },
        foreman: { group: 'core', label: 'items.chat' },
      },
    },
  ],
};
