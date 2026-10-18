// Модуль логистики сценарного сервера (W2.00, контракт 0.5.0-stage2): теги Fleet, Earnings и Home — операции
// экранов этапа 2 (api/openapi/screens.yaml, stage: 2) и смежные операции 0.1 (Trip, бронь, осмотр, расход).
import type { Registry } from '../core/registry.ts';
import { earningsHandlers } from './earnings.ts';
import { expenseHandlers } from './expenses.ts';
import { homeHandlers } from './home.ts';
import { vehicleImportHandlers } from './imports.ts';
import { inspectionHandlers } from './inspections.ts';
import { poolHandlers } from './pool.ts';
import { tripHandlers } from './trips.ts';
import { vehicleHandlers } from './vehicles.ts';

export { seedFleet } from './state.ts';

export const fleetHandlers: Registry = {
  ...vehicleHandlers,
  ...tripHandlers,
  ...inspectionHandlers,
  ...expenseHandlers,
  ...poolHandlers,
  ...earningsHandlers,
  ...homeHandlers,
  // W2.52 (0.6.1-stage2): импорт CSV машин (D-11 комплекта).
  ...vehicleImportHandlers,
};
