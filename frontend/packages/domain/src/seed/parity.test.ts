// Паритет домена пилота с эталоном `design/` (с W2.70 — снимок 19.10b; против 14.10 в моделях и сиде
// добавлен только модуль «Обучение»): одинаковые входы → одинаковые выходы.
// Эталон (`models.js`, `mock-data.js`, `api.js`) только импортируется — см. `reference.ts`.
// Намеренные расхождения: модуль «Обучение» снимка 19.10b исключён из сравнения сида
// (W2.70, см. `withoutLearning` ниже). Утечки «Альты» в «Лотос» (Q-31, PD-27) воспроизводятся
// `createSeed()` по умолчанию и проверяются здесь же; без них — `compose.test.ts`.
import { beforeAll, describe, expect, it } from 'vitest';
import { bookingConflicts, busySpan, freeSlots } from '../modules/calendar/rules.ts';
import type { Booking } from '../modules/calendar/types.ts';
import { calendarView } from '../modules/calendar/view.ts';
import {
  DEFECT_ZONES,
  DEP_CHECKS,
  EXPENSE_CAT,
  FUEL,
  PHOTO_SIDES,
  RET_CHECKS,
  TRIP_STATE,
  VEHICLE_STATE,
} from '../modules/logistics/dictionaries.ts';
import {
  compat,
  inspMissing,
  legs,
  odoError,
  tempLabel,
  validateExpense,
} from '../modules/logistics/rules.ts';
import type {
  ExpenseDraft,
  InspectionDraft,
  PhotoState,
  TempRange,
  Trip,
  Vehicle,
} from '../modules/logistics/types.ts';
import { logisticsView } from '../modules/logistics/view.ts';
import { MEMBER_STATE } from '../modules/people/dictionaries.ts';
import { BRAND_DEFAULT, TENANT_STATE } from '../modules/platform/dictionaries.ts';
import { platformView } from '../modules/platform/view.ts';
import { createSeed } from './compose.ts';
import { importReference, referenceModels } from './reference.ts';
import type { Assignment, Scope } from '../core/types/index.ts';
import type { PilotDb, SeedState } from './types.ts';

type Fn = (...a: never[]) => unknown;
type RefModels = Record<string, unknown> & {
  compat: Fn;
  legs: Fn;
  inspMissing: Fn;
  odoError: Fn;
  validateExpense: Fn;
  tempLabel: Fn;
  busySpan: Fn;
  bookingConflicts: Fn;
  freeSlots: Fn;
};
type RefDb = Record<string, unknown> & { platform: unknown };
interface RefMockData {
  seed(): RefDb;
  seedLotos(platform: unknown): RefDb;
  BRAND_DEFAULT: unknown;
}
interface RefAdapter {
  setActor(memberId: string | null, tenantId?: string): void;
  load(ms?: number): Promise<Record<string, unknown>>;
}

let M: RefModels;
let D: RefMockData;
let S: SeedState;

beforeAll(async () => {
  M = await referenceModels<RefModels>();
  D = await importReference<RefMockData>('mock-data.js');
  S = createSeed();
});

const call = <T>(f: Fn, ...args: unknown[]): T => (f as (...a: unknown[]) => T)(...args);
const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;

describe('справочники пилота = models.js', () => {
  it.each([
    ['VEHICLE_STATE', VEHICLE_STATE],
    ['TRIP_STATE', TRIP_STATE],
    ['MEMBER_STATE', MEMBER_STATE],
    ['TENANT_STATE', TENANT_STATE],
    ['PHOTO_SIDES', PHOTO_SIDES],
    ['DEP_CHECKS', DEP_CHECKS],
    ['RET_CHECKS', RET_CHECKS],
    ['DEFECT_ZONES', DEFECT_ZONES],
    ['FUEL', FUEL],
    ['EXPENSE_CAT', EXPENSE_CAT],
  ])('%s', (name, ours) => {
    expect(ours).toEqual(M[name]);
  });

  it('BRAND_DEFAULT = mock-data.js', () => {
    expect(BRAND_DEFAULT).toEqual(D.BRAND_DEFAULT);
  });
});

describe('правила логистики на сгенерированных входах', () => {
  const fleet = () => S.dbs['t-alta'];
  const variants = (v: Vehicle, trips: readonly Trip[]): Vehicle[] => [
    v,
    ...trips.map((t): Vehicle => ({ ...v, state: 'reserved', heldBy: t.id })),
    { ...v, temp: [0, 4] },
    { ...v, temp: [-25, 25] },
  ];

  it('compat: 7 машин (+ бронь и охлаждение) × 2 рейса (+ без охлаждения)', () => {
    const { vehicles, trips } = fleet();
    const allTrips = [
      ...trips,
      ...trips.map((t): Trip => ({ ...t, id: t.id + '*', cargo: { ...t.cargo, temp: null } })),
    ];
    let n = 0;
    for (const v0 of vehicles)
      for (const v of variants(v0, trips))
        for (const t of allTrips) {
          expect(compat(v, t)).toEqual(call(M.compat, v, t));
          n++;
        }
    expect(n).toBe(7 * 5 * 4);
  });

  it('legs и tempLabel', () => {
    const { vehicles, trips } = fleet();
    for (const t of trips) {
      expect(legs(t)).toEqual(call(M.legs, t));
      for (const v of vehicles) expect(legs(t, v)).toEqual(call(M.legs, t, v));
    }
    const temps: TempRange[] = [
      [-18, 8],
      [2, 6],
      [0, 4],
      [-5, -1],
      [0, 0],
    ];
    for (const t of temps) expect(tempLabel(t)).toBe(call(M.tempLabel, t));
  });

  it('inspMissing: фото × пробег × топливо × чек-листы × вид осмотра', () => {
    const states: (PhotoState | undefined)[] = [undefined, 'empty', 'queued', 'uploading', 'ready'];
    const sides = ['front', 'back', 'left', 'right', 'odo'];
    const odos: (string | number)[] = ['', '84000', '84 370', '90000', 'abc', 84370];
    const fuels = [null, '', 'h'];
    const checkSets = [
      {},
      { body: true },
      { body: true, tires: true, docs: true },
      { cargo: true, keys: true },
    ];
    let n = 0;
    for (let k = 0; k < states.length * 3; k++) {
      const photos: InspectionDraft['photos'] = {};
      sides.forEach((s, i) => {
        const st = states[(k + i) % states.length];
        if (st) photos[s] = { state: st };
      });
      for (const odometer of odos)
        for (const fuel of fuels)
          for (const checks of checkSets)
            for (const kind of ['dep', 'ret'] as const) {
              const d: InspectionDraft = { photos, odometer, fuel, checks };
              expect(inspMissing(d, kind, 84370)).toEqual(call(M.inspMissing, d, kind, 84370));
              n++;
            }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('odoError: 84 370 + [−5000, 0, 1, 3000, 3001, 5630] и строки с пробелами', () => {
    const vals = [-5000, 0, 1, 3000, 3001, 5630].map((d) => String(84370 + d));
    for (const v of [...vals, '', 'abc', '84 500', '1e5', ' 87 371 '])
      expect(odoError(v, 84370)).toBe(call(M.odoError, v, 84370));
  });

  it('validateExpense: суммы × даты × чеки', () => {
    const amounts = [
      '',
      null,
      undefined,
      '0',
      '-1',
      '1 500,50',
      '200000',
      '200000,01',
      'abc',
      250,
      0,
    ];
    const receipts: ExpenseDraft['receipt'][] = [
      undefined,
      null,
      { state: 'empty' },
      { state: 'uploading' },
      { state: 'queued' },
      { state: 'ready' },
      { state: 'error' },
    ];
    for (const amount of amounts)
      for (const date of ['', '2026-10-01', null])
        for (const receipt of receipts) {
          const e: ExpenseDraft = { amount, date, receipt };
          expect(validateExpense(e)).toEqual(call(M.validateExpense, e));
        }
  });
});

describe('правила календаря на сгенерированных входах', () => {
  it('busySpan, bookingConflicts и freeSlots для каждой брони и сдвигов на 15 минут', () => {
    const { resources, bookings } = S.dbs['t-alta'].calendar;
    for (const b of bookings) {
      expect(busySpan(b)).toEqual(call(M.busySpan, b));
      for (let start = 8; start <= 19; start += 0.25) {
        const cand: Booking = { ...b, start, end: start + (b.end - b.start) };
        expect(bookingConflicts(bookings, cand, resources)).toEqual(
          call(M.bookingConflicts, bookings, cand, resources),
        );
        expect(bookingConflicts(bookings, cand)).toEqual(call(M.bookingConflicts, bookings, cand));
      }
      for (const n of [0, 1, 3, 50])
        expect(freeSlots(bookings, b, n)).toEqual(call(M.freeSlots, bookings, b, n));
      expect(freeSlots(bookings, b, 5, 9, 18)).toEqual(call(M.freeSlots, bookings, b, 5, 9, 18));
    }
  });
});

const TENANT_KEYS = [
  'tenantId',
  'seq',
  'units',
  'modules',
  'storage',
  'members',
  'groups',
  'roles',
  'assignments',
  'vehicles',
  'trips',
  'pool',
  'earnings',
  'events',
  'calendar',
] as const;

// Намеренное расхождение (W2.70, снимок 19.10b): модуль «Обучение» (`learning`) в эталоне появился,
// а в плане места пока нет (`docs/plan/v2/analysis/dor/learning.md`). Сид пилота его не содержит, поэтому
// из сравнения убираются действия `learning` у ролей, шаблоны «для программы» (`program: true`) и
// назначения с областью `program`. Остальной сид сравнивается без изменений.
type Row = Record<string, unknown>;
const withoutLearning = (src: Row): Row => {
  const roles = (src['roles'] as Row[] | undefined)
    ?.filter((r) => r['program'] !== true)
    .map((r) => {
      const actions = r['actions'] as Row | undefined;
      if (!actions || !('learning' in actions)) return r;
      const rest = Object.fromEntries(Object.entries(actions).filter(([k]) => k !== 'learning'));
      return { ...r, actions: rest };
    });
  const assignments = (src['assignments'] as Row[] | undefined)?.filter(
    (a) => (a['scope'] as Row | undefined)?.['type'] !== 'program',
  );
  return { ...src, roles, assignments };
};

const pick = (db: object): Record<string, unknown> => {
  const src = withoutLearning(db as Row);
  return Object.fromEntries(TENANT_KEYS.map((k) => [k, src[k]]));
};

describe('сид = seed() / seedLotos() эталона по JSON (срезы этапа 0)', () => {
  it('control DB: организации с оформлением, сетка, заявки, 58 аккаунтов, операторы, журнал', () => {
    expect(json(S.platform)).toEqual(json(D.seed().platform));
  });

  it('«Альта Групп»', () => {
    expect(json(pick(S.dbs['t-alta']))).toEqual(json(pick(D.seed())));
  });

  it('SPA «Лотос» (с утечками календаря, как в эталоне)', () => {
    const ref = D.seedLotos(D.seed().platform);
    expect(json(pick(S.dbs['t-lotos']))).toEqual(json(pick(ref)));
  });
});

describe('проекции = view() createMockAdapter эталона', () => {
  let A: RefAdapter;
  beforeAll(async () => {
    const api = await importReference<{ createMockAdapter(): RefAdapter }>('api.js');
    A = api.createMockAdapter();
  });

  const ours = (db: PilotDb, actor: string) => ({
    platform: platformView(S.platform, db.tenantId, actor),
    ...logisticsView(db, actor),
    calendar: calendarView(db, actor),
    storage: db.storage,
  });
  const theirs = (v: Record<string, unknown>) => ({
    platform: v['platform'],
    vehicles: v['vehicles'],
    trips: v['trips'],
    pool: v['pool'],
    earnings: v['earnings'],
    calendar: v['calendar'],
    storage: v['storage'],
  });

  it('оператор платформы видит control DB целиком', async () => {
    A.setActor(null, 't-alta');
    const v = await A.load(0);
    expect(json(platformView(S.platform, 't-alta', null))).toEqual(json(v['platform']));
  });

  it.each([
    ['t-alta', 'm-owner'],
    ['t-alta', 'm-kotova'],
    ['t-alta', 'm-vasiliev'],
    ['t-alta', 'm-morozova'],
    ['t-alta', 'm-sokolov'],
    ['t-alta', 'm-petrova'],
    ['t-alta', 'm-gromov'],
    ['t-alta', 'm-kotelnikova'],
    ['t-alta', 'm-akhmedov'],
    ['t-alta', 'm-ilyin'],
    ['t-lotos', 'm-owner'],
    ['t-lotos', 'm-morozova'],
    ['t-lotos', 'm-l1'],
    ['t-lotos', 'm-l4'],
  ] as const)('%s · %s', async (org, actor) => {
    A.setActor(actor, org);
    const v = await A.load(0);
    expect(json(ours(S.dbs[org], actor))).toEqual(json(theirs(v)));
  });

  it('после команд эталона: логистика включена, логисту — менеджер региона Москва', async () => {
    const api = await importReference<{
      createMockAdapter(): RefAdapter & {
        setModule(key: string, on: boolean): Promise<unknown>;
        assign(a: { memberId: string; roleId: string; scope: Scope }): Promise<unknown>;
      };
    }>('api.js');
    const B = api.createMockAdapter();
    B.setActor('m-owner', 't-alta');
    await B.setModule('logistics', true);
    await B.assign({
      memberId: 'm-kotova',
      roleId: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    const refOwner = (await B.load(0)) as {
      modules: PilotDb['modules'];
      assignments: Assignment[];
      platform: { tenants: { modules: string[] }[] };
    };
    // Те же изменения в нашем сиде: модуль, новое назначение, список модулей организации.
    const S2 = createSeed();
    const db = S2.dbs['t-alta'];
    db.modules = structuredClone(refOwner.modules);
    db.assignments.push(
      ...refOwner.assignments.filter((a) => a.member === 'm-kotova' && a.role === 'r-manager'),
    );
    const t = S2.platform.tenants.find((x) => x.id === 't-alta');
    if (t) t.modules = [...(refOwner.platform.tenants[0]?.modules ?? [])];
    for (const actor of ['m-owner', 'm-kotova', 'm-vasiliev', 'm-akhmedov', 'm-morozova']) {
      B.setActor(actor, 't-alta');
      const v = await B.load(0);
      const mine = {
        platform: platformView(S2.platform, 't-alta', actor),
        ...logisticsView(db, actor),
        calendar: calendarView(db, actor),
        storage: db.storage,
      };
      expect(json(mine)).toEqual(json(theirs(v)));
    }
    expect(logisticsView(db, 'm-kotova').vehicles).toHaveLength(6);
  });
});
