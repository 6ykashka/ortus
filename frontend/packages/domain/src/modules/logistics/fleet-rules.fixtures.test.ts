// W2.01 · Тест паритета: общие табличные фикстуры `testdata/fleet-rules/*.json` (их же читает
// Go-пакет `backend/internal/domain/fleetrules`) = правила этого модуля = эталон models.js 14.10.
// Только тест: модуль не меняется. Новый кейс добавляется в JSON; расхождение любой стороны роняет тест.
import { beforeAll, describe, expect, it } from 'vitest';
import compatFx from '../../../../../../testdata/fleet-rules/compat.json';
import dictFx from '../../../../../../testdata/fleet-rules/dictionaries.json';
import fleetFx from '../../../../../../testdata/fleet-rules/fleet.json';
import formatFx from '../../../../../../testdata/fleet-rules/format.json';
import inspFx from '../../../../../../testdata/fleet-rules/inspMissing.json';
import legsFx from '../../../../../../testdata/fleet-rules/legs.json';
import odoFx from '../../../../../../testdata/fleet-rules/odoError.json';
import tempFx from '../../../../../../testdata/fleet-rules/tempLabel.json';
import expenseFx from '../../../../../../testdata/fleet-rules/validateExpense.json';
import { int, num, plural } from '../../core/format.ts';
import { referenceModels } from '../../seed/reference.ts';
import {
  DEFECT_ZONES,
  DEP_CHECKS,
  EXPENSE_CAT,
  FUEL,
  PHOTO_SIDES,
  RET_CHECKS,
  TRIP_STATE,
  VEHICLE_STATE,
} from './dictionaries.ts';
import { compat, inspMissing, legs, odoError, tempLabel, validateExpense } from './rules.ts';
import { logisticsSeed } from './seed.ts';
import type {
  CompatResult,
  ExpenseDraft,
  ExpenseErrors,
  InspectionDraft,
  Leg,
  TempRange,
  Trip,
  Vehicle,
} from './types.ts';

interface Named {
  name: string;
}
interface CompatCase extends Named {
  vehicle: string;
  trip: string;
  want: CompatResult;
}
interface LegsCase extends Named {
  trip: string;
  vehicle: string | null;
  want: Leg[];
}
interface TempCase extends Named {
  temp: TempRange;
  want: string;
}
interface InspCase extends Named {
  draft: InspectionDraft;
  kind: 'dep' | 'ret';
  minOdo: number;
  want: string[];
}
interface OdoCase extends Named {
  value: string;
  minOdo: number;
  want: string | null;
}
interface ExpenseCase extends Named {
  expense: ExpenseDraft;
  want: ExpenseErrors;
}

const cast = <T>(x: unknown): T => x as T;
const cases = <T extends Named>(fx: { cases: unknown[] }): [string, T][] =>
  cast<T[]>(fx.cases).map((c) => [c.name, c]);

const fleet = cast<{ vehicles: Record<string, Vehicle>; trips: Record<string, Trip> }>(fleetFx);
const vehicle = (id: string): Vehicle => {
  const v = fleet.vehicles[id];
  if (!v) throw new Error('нет машины ' + id + ' в fleet.json');
  return v;
};
const trip = (id: string): Trip => {
  const t = fleet.trips[id];
  if (!t) throw new Error('нет рейса ' + id + ' в fleet.json');
  return t;
};

const compatCases = cases<CompatCase>(compatFx);
const legsCases = cases<LegsCase>(legsFx);
const tempCases = cases<TempCase>(tempFx);
const inspCases = cases<InspCase>(inspFx);
const odoCases = cases<OdoCase>(odoFx);
const expenseCases = cases<ExpenseCase>(expenseFx);

const entries = <T extends object>(o: Readonly<Record<string, T>>) =>
  Object.entries(o).map(([key, s]) => ({ key, ...s }));

const dictionaries = (d: {
  VEHICLE_STATE: Readonly<Record<string, object>>;
  TRIP_STATE: Readonly<Record<string, object>>;
  PHOTO_SIDES: unknown;
  DEP_CHECKS: unknown;
  RET_CHECKS: unknown;
  DEFECT_ZONES: unknown;
  FUEL: unknown;
  EXPENSE_CAT: Readonly<Record<string, object>>;
}) => ({
  vehicleState: entries(d.VEHICLE_STATE),
  tripState: entries(d.TRIP_STATE),
  photoSides: d.PHOTO_SIDES,
  depChecks: d.DEP_CHECKS,
  retChecks: d.RET_CHECKS,
  defectZones: d.DEFECT_ZONES,
  fuel: d.FUEL,
  expenseCat: entries(d.EXPENSE_CAT),
});

const dictWant: Record<string, unknown> = { ...dictFx };
delete dictWant['$comment'];

describe('фикстуры testdata/fleet-rules: состав', () => {
  it('машины и рейсы сида «Альты» в fleet.json = logisticsSeed', () => {
    const seed = logisticsSeed('t-alta');
    for (const v of seed.vehicles) expect(vehicle(v.id)).toEqual(v);
    for (const t of seed.trips) {
      const { id, unit, title, cargo, stops } = t;
      expect(trip(t.id)).toEqual({ id, unit, title, cargo, stops });
    }
  });

  it('compat покрывает 7 машин сида × 2 рейса', () => {
    const seen = new Set(compatCases.map(([, c]) => c.vehicle + '|' + c.trip));
    for (const v of logisticsSeed('t-alta').vehicles)
      for (const t of ['Р-208', 'Р-211']) expect(seen.has(v.id + '|' + t)).toBe(true);
  });

  it.each([
    ['compat', compatCases],
    ['legs', legsCases],
    ['tempLabel', tempCases],
    ['inspMissing', inspCases],
    ['odoError', odoCases],
    ['validateExpense', expenseCases],
  ] as const)('%s: имена кейсов уникальны и кейсов не меньше 8', (_rule, list) => {
    const names = list.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(8);
  });
});

describe('фикстуры = правила @ortus/domain', () => {
  it('справочники', () => {
    expect(
      dictionaries({
        VEHICLE_STATE,
        TRIP_STATE,
        PHOTO_SIDES,
        DEP_CHECKS,
        RET_CHECKS,
        DEFECT_ZONES,
        FUEL,
        EXPENSE_CAT,
      }),
    ).toEqual(dictWant);
  });

  it('num, int, plural', () => {
    for (const [n, want] of cast<[number, string][]>(formatFx.num)) expect(num(n)).toBe(want);
    for (const [n, want] of cast<[number, string][]>(formatFx.int)) expect(int(n)).toBe(want);
    for (const [n, want] of cast<[number, string][]>(formatFx.plural))
      expect(plural(n, 'пункт', 'пункта', 'пунктов')).toBe(want);
  });

  it.each(tempCases)('tempLabel: %s', (_n, c) => {
    expect(tempLabel(c.temp)).toBe(c.want);
  });

  it.each(compatCases)('compat: %s', (_n, c) => {
    expect(compat(vehicle(c.vehicle), trip(c.trip))).toEqual(c.want);
  });

  it.each(legsCases)('legs: %s', (_n, c) => {
    expect(legs(trip(c.trip), c.vehicle ? vehicle(c.vehicle) : undefined)).toEqual(c.want);
  });

  it.each(inspCases)('inspMissing: %s', (_n, c) => {
    expect(inspMissing(c.draft, c.kind, c.minOdo)).toEqual(c.want);
  });

  it.each(odoCases)('odoError: %s', (_n, c) => {
    expect(odoError(c.value, c.minOdo)).toBe(c.want);
  });

  it.each(expenseCases)('validateExpense: %s', (_n, c) => {
    expect(validateExpense(c.expense)).toEqual(c.want);
  });
});

type Fn = (...a: never[]) => unknown;
type RefModels = Record<string, Fn> & {
  VEHICLE_STATE: Readonly<Record<string, object>>;
  TRIP_STATE: Readonly<Record<string, object>>;
  PHOTO_SIDES: unknown;
  DEP_CHECKS: unknown;
  RET_CHECKS: unknown;
  DEFECT_ZONES: unknown;
  FUEL: unknown;
  EXPENSE_CAT: Readonly<Record<string, object>>;
};
const call = (f: Fn | undefined, ...args: unknown[]): unknown => {
  if (!f) throw new Error('в эталоне нет функции');
  return (f as (...a: unknown[]) => unknown)(...args);
};

describe('фикстуры = эталон models.js 14.10', () => {
  let M: RefModels;
  beforeAll(async () => {
    M = await referenceModels<RefModels>();
  });

  it('справочники', () => {
    expect(dictionaries(M)).toEqual(dictWant);
  });

  it('num, int, plural', () => {
    for (const [n, want] of cast<[number, string][]>(formatFx.num))
      expect(call(M.num, n)).toBe(want);
    for (const [n, want] of cast<[number, string][]>(formatFx.int))
      expect(call(M.int, n)).toBe(want);
    for (const [n, want] of cast<[number, string][]>(formatFx.plural))
      expect(call(M.plural, n, 'пункт', 'пункта', 'пунктов')).toBe(want);
  });

  it('правила на всех кейсах', () => {
    for (const [, c] of tempCases) expect(call(M.tempLabel, c.temp)).toBe(c.want);
    for (const [, c] of compatCases)
      expect(call(M.compat, vehicle(c.vehicle), trip(c.trip))).toEqual(c.want);
    for (const [, c] of legsCases)
      expect(call(M.legs, trip(c.trip), c.vehicle ? vehicle(c.vehicle) : undefined)).toEqual(
        c.want,
      );
    for (const [, c] of inspCases)
      expect(call(M.inspMissing, c.draft, c.kind, c.minOdo)).toEqual(c.want);
    for (const [, c] of odoCases) expect(call(M.odoError, c.value, c.minOdo)).toBe(c.want);
    for (const [, c] of expenseCases) expect(call(M.validateExpense, c.expense)).toEqual(c.want);
  });
});
