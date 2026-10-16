// W1.20 · Манифест «Задачи» (модуль ядра `tasks`; CORE_ITEMS :2964). Легаси-канбан «Заявки» — маршрут без пункта
// меню (ADR-0001, W4.13).
import type { NavManifest } from '../types.ts';

const VIEW = ['tasks.read', 'tasks.projects.read'] as const;

export const manifest: NavManifest = {
  id: 'tasks',
  kind: 'core',
  moduleKey: 'tasks',
  domainModule: 'tasks',
  availability: 'catalog',
  stage: 4,
  area: 'tenant',
  pages: [
    {
      key: 'tasks',
      segment: 'tasks',
      icon: 'task_alt',
      view: VIEW,
      gate: 'A',
      nav: {
        owner: { group: 'core', label: 'items.tasks' },
        office: { group: 'core', label: 'items.tasks' },
        foreman: { group: 'core', label: 'items.tasks' },
      },
    },
    { key: 'leads', segment: 'leads', icon: 'view_kanban', view: VIEW, gate: 'A' },
  ],
};
