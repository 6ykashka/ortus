// Экспорт-лист точки входа `@ortus/domain/modules`. Расширяется только добавлением в список.
import { describe, expect, it } from 'vitest';

const MODULES_EXPORTS = [
  // реестр
  'createPilotModules',
  'PILOT_MODULES',
  // logistics
  'logisticsModule',
  'VEHICLE_STATE',
  'TRIP_STATE',
  'PHOTO_SIDES',
  'DEP_CHECKS',
  'RET_CHECKS',
  'DEFECT_ZONES',
  'FUEL',
  'EXPENSE_CAT',
  'compat',
  'tempLabel',
  'legs',
  'inspMissing',
  'odoError',
  'validateExpense',
  'fleetCan',
  'logisticsView',
  'logisticsSeed',
  // calendar
  'createCalendarModule',
  'busySpan',
  'bookingConflicts',
  'freeSlots',
  'calendarView',
  'calendarSeed',
  // files
  'filesModule',
  'QUOTA_TEXT',
  'storageTotal',
  'addUsage',
  'uploadQuotaError',
  'filesSeed',
  // people
  'MEMBER_STATE',
  'seatsUsed',
  'owners',
  'altaPeople',
  'lotosPeople',
  // platform
  'TENANT_STATE',
  'BRAND_DEFAULT',
  'platformView',
  'platformSeed',
  'fillAccounts',
  'applyBrands',
];

describe('экспорт-лист @ortus/domain/modules', () => {
  it('модули пилота и их функции, ничего лишнего', async () => {
    const pkg = await import('./index.ts');
    expect(Object.keys(pkg).sort()).toEqual([...MODULES_EXPORTS].sort());
    expect(MODULES_EXPORTS).toHaveLength(43);
  });
});
