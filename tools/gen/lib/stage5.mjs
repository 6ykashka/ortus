// W5.00 (0.12.0-stage5): что контрактный PR этапа 5 добавил к реестрам. Инварианты прежних стюардов считают «свои»
// ключи и коды без них (раньше они сравнивали точные числа реестра на момент своего PR).

/** Ключи прав, добавленные W5.00: касса (15 новых из 17; cash.read и cash.post — из 0.1) и два ключа склада. */
export const W5_ADDED_KEYS = [
  'cash.balance.read',
  'cash.proposals.post',
  'cash.shift.operate',
  'cash.refund',
  'cash.transfer',
  'cash.advance.issue',
  'cash.approve',
  'cash.reconcile',
  'cash.reverse',
  'cash.payroll.post',
  'cash.reports.finance',
  'cash.accounts.manage',
  'cash.period.close',
  'cash.advance.self',
  'cash.export',
  'inventory.warehouses.manage',
  'inventory.consumption.override',
];

/** Ключ 0.1, который W5.00 переименовал в cash.accounts.manage (prototype_renames): из каталога его уже нет. */
export const W5_REMOVED_KEYS = ['cash.manage'];

/** Коды ошибок, добавленные W5.00 (в конец реестра). */
export const W5_CODES = [
  'shift_closed',
  'duplicate_source',
  'duplicate_receipt',
  'self_approval',
  'insufficient_funds',
];
