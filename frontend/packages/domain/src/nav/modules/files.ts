// W1.20 · Манифест «Файлы» (модуль ядра `files`; CORE_ITEMS :2964; страница — W1.24).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'files',
  kind: 'core',
  moduleKey: 'files',
  domainModule: 'files',
  availability: 'catalog',
  stage: 1,
  area: 'tenant',
  pages: [
    {
      key: 'files',
      segment: 'files',
      icon: 'folder_open',
      view: ['files.read'],
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.files' },
        office: { group: 'core', label: 'items.files' },
      },
    },
  ],
};
