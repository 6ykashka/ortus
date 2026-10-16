// W1.20 · Манифест «База знаний» (модуль ядра `knowledge`; CORE_ITEMS :2964, рабочие места :3000–3002).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'knowledge',
  kind: 'core',
  moduleKey: 'knowledge',
  domainModule: 'knowledge',
  availability: 'catalog',
  stage: 4,
  area: 'tenant',
  pages: [
    {
      key: 'knowledge',
      segment: 'knowledge',
      icon: 'menu_book',
      view: ['knowledge.read'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.knowledge' },
        office: { group: 'core', label: 'items.knowledge' },
        driver: { group: 'work', label: 'items.knowledge' },
        practitioner: { group: 'work', label: 'items.knowledge' },
        foreman: { group: 'core', label: 'items.knowledge' },
      },
    },
  ],
};
