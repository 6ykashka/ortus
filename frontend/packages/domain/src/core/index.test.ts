// Экспорт-лист @ortus/domain (ядро). Расширяется только добавлением в этот список.
import { describe, expect, it } from 'vitest';

const CORE_EXPORTS = [
  // clock
  'TZ',
  'DEMO',
  'fixedClock',
  'manualClock',
  'systemClock',
  'driftClock',
  'demoClock',
  'hhmm',
  'ddmm',
  'ddmmyyyy',
  'ddmmHHMM',
  'plusDaysDdMm',
  'minutesSince',
  'chatMinutes',
  // ids
  'createIdGen',
  // format
  'num',
  'int',
  'rub',
  'signRub',
  'gb',
  'plural',
  'pluralN',
  'hm',
  'shortName',
  'initials',
  'emailOk',
  'maskPhone',
  'maskPdn',
  'hasPdn',
  // errors
  'PROTOTYPE_CODES',
  'CANON_CODES',
  'CLIENT_CODES',
  'ApiError',
  'denyAccess',
  'isModuleStyleOp',
  'toPrototypeCode',
  'toCanonCode',
  'toCanonCodes',
  // dictionaries
  'TONES',
  'VERBS',
  'INDUSTRY',
  'CORE',
  'ALL_MODULES',
  'isIndustry',
  'REASON',
  // access
  'OBJECT_SCOPE_TYPES',
  'isObjectScope',
  'scopeIsObject',
  'unit',
  'unitLabel',
  'firmsOf',
  'scopeCovers',
  'scopeLabel',
  'moduleOn',
  'grants',
  'can',
  'canAny',
  'canEarnings',
  'assertCan',
  'rolePermKeys',
  // entries
  'objOf',
  'foremanIdOf',
  'relationHas',
  'entryHas',
  'entryKey',
  'entryIcon',
  'entryPeople',
  // events
  'createEmitter',
  // module
  'ACCESS',
  'createModuleCtx',
  'composeCommands',
  'composeDelays',
  // task-port
  'DEFAULT_STATUS',
  // seed-hooks
  'SEED_STAGES',
  'seedStagesFor',
  'runSeedHooks',
];

describe('экспорт-лист пакета', () => {
  it('@ortus/domain отдаёт ядро целиком и ничего лишнего', async () => {
    const pkg = await import('../index.ts');
    expect(Object.keys(pkg).sort()).toEqual([...CORE_EXPORTS].sort());
    expect(CORE_EXPORTS).toHaveLength(76);
  });

  it('тестовые помощники — отдельной точкой входа', async () => {
    const testing = await import('./testing/index.ts');
    expect(Object.keys(testing).sort()).toEqual([
      'altaFixture',
      'altaWithLogistics',
      'createFakeTaskPort',
    ]);
  });
});
