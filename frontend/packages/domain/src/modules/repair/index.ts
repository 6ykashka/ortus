// Модуль «Ремонт и стройка» (W6.10, P1i repair-delta): отметки прораба, приёмка, назначение прораба,
// допработы, проекция, сводка и список объектов, замер и смета. График работ — `lib/schedule`.
export type * from './types.ts';
export type { RepairApi, WorkLogInput, ProposeChangeInput, SetChangeExtra } from './commands.ts';
export { REPAIR_DELAYS, REPAIR_METHODS, repairCommands } from './commands.ts';
export { repairModule } from './module.ts';
export { emptyRepairSlice, repairSeed } from './seed.ts';
export { repairView } from './view.ts';
export { EMPTY_LIST_TEXT, daysUntil, repairContext, repairList, repairSum } from './summary.ts';
export type {
  ChildStatus,
  ListEmpty,
  ListRow,
  ObjectSummary,
  RepairContext,
  RepairListFilter,
  RepairListInput,
  RepairListResult,
  TodoAction,
  TodoItem,
} from './summary.ts';
export {
  CHANGE_CHIPS,
  CHANGE_REJECT_REASONS,
  CHANGE_STATUSES,
  CHANGE_UNITS,
  ESTIMATE_LABEL,
  LOG_CHIPS,
  MOVEMENT_KINDS,
  SUPPLY_CHIPS,
} from './dictionaries.ts';
export type { StatusChip } from './dictionaries.ts';
export * from './estimate.ts';
export { CATALOG, CATALOG_SECTIONS, ESTIMATE_42, ROOMS, TEMPLATES } from './estimate-seed.ts';
export {
  MOVEMENTS,
  OBJECT_SHORT_NAMES,
  ON_OBJECT,
  PURCHASES,
  STOCK,
  SUPPLIERS,
  SUPPLY_REQUESTS,
  WAREHOUSES,
  stageSupply,
} from './supply-seed.ts';
export type {
  Movement,
  MovementKind,
  OnObjectRow,
  Purchase,
  PurchaseLine,
  StockRow,
  SupplyRequest,
  SupplyState,
  Warehouse,
} from './supply-seed.ts';
