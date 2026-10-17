// W1.20 · Манифест «Логистика» (модуль `fleet`, домен `logistics`): группа логиста у владельца и офисных
// сотрудников (logItems :2954–2963), рабочее место водителя «Сегодня», «Автомобили» (:3000). D-23: у владельца
// группа только у подключённого модуля, отключённый с историей — пункт «Логистика» в «Отключены · только чтение».
import type { NavManifest } from '../types.ts';

const MANAGER = [
  'fleet.reservations.manage',
  'fleet.routes.manage',
  'fleet.vehicles.manage',
  'fleet.trips.review',
  'fleet.inspections.review',
  'fleet.expenses.review',
  'fleet.driver_transfers.approve',
] as const;

export const manifest: NavManifest = {
  id: 'fleet',
  kind: 'industry',
  moduleKey: 'fleet',
  domainModule: 'logistics',
  availability: 'catalog',
  stage: 2,
  area: 'tenant',
  readonlyItem: { page: 'fleet', label: 'groups.logistics', icon: 'local_shipping' },
  pages: [
    {
      key: 'fleet',
      segment: 'fleet',
      icon: 'local_shipping',
      view: MANAGER,
      gate: 'B',
      nav: {
        owner: { group: 'logistics', label: 'items.fleet' },
        office: { group: 'logistics', label: 'items.fleet' },
      },
    },
    {
      key: 'pool',
      segment: 'pool',
      icon: 'person_search',
      view: ['fleet.driver_transfers.request', 'fleet.driver_transfers.approve'],
      gate: 'B',
      nav: {
        owner: { group: 'logistics', label: 'items.pool' },
        office: { group: 'logistics', label: 'items.pool' },
      },
    },
    {
      key: 'review',
      segment: 'review',
      icon: 'fact_check',
      view: ['fleet.trips.review'],
      gate: 'B',
      denyTitle: 'review',
      nav: {
        owner: { group: 'logistics', label: 'items.review' },
        office: { group: 'logistics', label: 'items.review' },
      },
    },
    // W2.21 · Страницы вне меню (как «Хранилище», Q-W1.24-17): в меню эталона их нет (no-reference B-6 №7, S2-12);
    // вход — ссылки на «Приёмке смен» и уведомления. Подпись — имя раздела в гейте.
    {
      key: 'defects',
      segment: 'defects',
      icon: 'report',
      view: ['fleet.inspections.review'],
      gate: 'B',
      label: 'items.defects',
    },
    {
      key: 'earnings',
      segment: 'earnings',
      icon: 'payments',
      view: ['fleet.earnings.read'],
      gate: 'B',
      label: 'items.earnings',
    },
    {
      key: 'today',
      segment: 'today',
      icon: 'today',
      view: ['fleet.trips.start'],
      gate: 'B',
      nav: { driver: { group: 'work', label: 'items.today' } },
    },
    {
      key: 'cars',
      segment: 'cars',
      icon: 'local_shipping',
      view: ['fleet.reservations.create'],
      gate: 'B',
      nav: { driver: { group: 'work', label: 'items.cars' } },
    },
  ],
};
