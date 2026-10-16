// W1.20 · Манифест «Формы и опросы» (модуль ядра `forms`; CORE_ITEMS :2964; страница — W4.22).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'forms',
  kind: 'core',
  moduleKey: 'forms',
  domainModule: 'forms',
  availability: 'catalog',
  stage: 4,
  area: 'tenant',
  pages: [
    {
      key: 'forms',
      segment: 'forms',
      icon: 'dynamic_form',
      view: ['forms.read', 'forms.responses.read'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.forms' },
        office: { group: 'core', label: 'items.forms' },
      },
    },
  ],
};
