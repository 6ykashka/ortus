// W1.20 · Манифест «Ремонт и стройка» (модуль `repairs`, домен `repair`; navForBase :2984, :3002): у владельца
// группа из трёх пунктов только при подключённом модуле, у прораба — «Объекты». Страницы `PAGE_MOD` (ветка A).
import type { NavManifest } from '../types.ts';

export const manifest: NavManifest = {
  id: 'repairs',
  kind: 'industry',
  moduleKey: 'repairs',
  domainModule: 'repair',
  availability: 'catalog',
  stage: 6,
  area: 'tenant',
  readonlyItem: { page: 'repair', label: 'groups.repair', icon: 'construction' },
  pages: [
    {
      key: 'repair',
      segment: 'repair',
      icon: 'home_work',
      view: ['repairs.projects.read', 'repairs.work_logs.submit'],
      gate: 'A',
      nav: {
        owner: { group: 'repair', label: 'items.repair' },
        office: { group: 'repair', label: 'items.repair' },
        foreman: { group: 'repair', label: 'items.repair' },
      },
    },
    {
      key: 'repairSupply',
      segment: 'repair-supply',
      icon: 'warehouse',
      view: ['repairs.supply.manage'],
      gate: 'A',
      nav: {
        owner: { group: 'repair', label: 'items.repairSupply' },
        office: { group: 'repair', label: 'items.repairSupply' },
      },
    },
    {
      key: 'repairCatalog',
      segment: 'repair-catalog',
      icon: 'library_books',
      view: ['repairs.catalog.manage'],
      gate: 'A',
      nav: {
        owner: { group: 'repair', label: 'items.repairCatalog' },
        office: { group: 'repair', label: 'items.repairCatalog' },
      },
    },
  ],
};
