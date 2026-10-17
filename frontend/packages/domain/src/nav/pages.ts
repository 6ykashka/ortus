// W1.20 · Порядок страниц и групп меню. Порядок пунктов внутри группы — порядок эталона (navForBase :2950–3003):
// водитель «Сегодня», «Автомобили», «Подотчёт», «Чаты», «База знаний», «Документы»; «Общие модули» —
// CORE_ITEMS :2964; «Отключены · только чтение» — «Логистика», «Ремонт и стройка», «Салон и SPA».
import type { GroupKey, PageKey } from './types.ts';

export const PAGE_ORDER: readonly PageKey[] = [
  'home',
  'modules',
  'users',
  'structure',
  'billing',
  'branding',
  'storage',
  'fleet',
  'pool',
  'review',
  'defects',
  'earnings',
  'today',
  'cars',
  'repair',
  'repairSupply',
  'repairCatalog',
  'spa',
  'cashSelf',
  'chat',
  'tasks',
  'leads',
  'service',
  'forms',
  'calendar',
  'knowledge',
  'docs',
  'data',
  'files',
  'cash',
  'tenants',
  'usage',
  'requests',
  'accounts',
  'plans',
];

export const GROUP_ORDER: readonly GroupKey[] = [
  'overview',
  'company',
  'logistics',
  'repair',
  'industries',
  'work',
  'core',
  'readonly',
  'platform',
];
