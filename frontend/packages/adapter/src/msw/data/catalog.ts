// Наборы «Данных» этапа 2 (W2.51, контракт 0.6.0-stage2; S2-16, AC-14): «Автомобили», «Поездки», «Расходы» эталона
// (dataVM, Ортус CRM.dc.html :4183) поверх логистики сценарного сервера. Набор виден при подключённой «Логистике» и
// праве набора; строки — в области права набора; «Начисление» — только с fleet.earnings.read и без функции
// «Водитель» (AC-05). Описание полей — как в примере listDatasets/ok (tools/gen/examples-w251.mjs).
import type { components } from '@ortus/api-client';
import { EXPENSE_CAT, TRIP_STATE, VEHICLE_STATE } from '@ortus/domain/modules';

import type { TenantAccess } from '../core/access.ts';
import type { HandlerContext } from '../core/registry.ts';
import { categoriesOf } from '../fleet/expenses.ts';
import {
  asDriver,
  type CategoryRow,
  covers,
  fleetOf,
  tripVisible,
  unitsFor,
  vehicleDto,
} from '../fleet/state.ts';
import { coreDatasetsFor } from './core.ts';

type S = components['schemas'];

/** Ячейка: значение контракта и текст для поиска и сортировки (подпись выбора, число, дата). */
export interface Cell {
  value: S['FieldValue'];
  text: string;
  /** Число для сравнения (decimal — значение, money — копейки); null — не число. */
  num: number | null;
}

export interface DataRow {
  recordId: string;
  cells: Record<string, Cell>;
}

export interface DatasetDef {
  dataset: S['Dataset'];
  rows: () => DataRow[];
}

const TEXT_OPS = ['eq', 'ne', 'in', 'contains'] as const;
const CHOICE_OPS = ['eq', 'ne', 'in'] as const;
const NUMBER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

/**
 * Варианты «Категории»: справочник тенанта (W2.52, fleet.expense_categories) в порядке каталога, архивные тоже —
 * у прежних расходов. Подписи посева — EXPENSE_CAT эталона и W2.40 (ответ на D-12 комплекта).
 */
const expenseKinds = (categories: readonly CategoryRow[]): [string, string][] =>
  categoriesOf(categories).map((c) => [
    c.code,
    c.code === 'fuel' || c.code === 'wash' ? EXPENSE_CAT[c.code].label : c.label,
  ]);
/** Vehicle.status ↔ VEHICLE_STATE эталона (fleet/state.ts). */
const VEHICLE_STATUS: readonly [S['Vehicle']['status'], string][] = [
  ['available', VEHICLE_STATE.free.label],
  ['reserved', VEHICLE_STATE.reserved.label],
  ['in_use', VEHICLE_STATE.on_route.label],
  ['blocked', VEHICLE_STATE.review.label],
  ['maintenance', VEHICLE_STATE.unavailable.label],
];
const TRIP_STATES = Object.entries(TRIP_STATE).map(([k, v]) => [k, v.label] as [string, string]);
/** Статус расхода эталона: «Принят» после приёмки смены, иначе «Заявлен водителем». */
const EXPENSE_STATUS: readonly [string, string][] = [
  ['claimed', 'Заявлен водителем'],
  ['accepted', 'Принят'],
];

interface FieldOpts {
  nullable?: boolean;
  sensitivity?: S['FieldDescriptor']['sensitivity'];
  options?: readonly (readonly [string, string])[];
}

function field(
  key: string,
  label: string,
  valueType: S['FieldDescriptor']['valueType'],
  o: FieldOpts = {},
): S['FieldDescriptor'] {
  const ops: readonly S['FieldDescriptor']['filterOperators'][number][] =
    valueType === 'text' ? TEXT_OPS : valueType === 'choices' ? CHOICE_OPS : NUMBER_OPS;
  const nullable = o.nullable ?? false;
  return {
    key,
    label,
    valueType,
    nullable,
    filterOperators: nullable ? [...ops, 'is_null'] : [...ops],
    sortable: true,
    aggregatable: valueType === 'decimal' || valueType === 'money',
    sensitivity: o.sensitivity ?? 'standard',
    ...(o.options ? { options: o.options.map(([k, l]) => ({ key: k, label: l })) } : {}),
  };
}

const NULL: Cell = { value: { type: 'null', value: null }, text: '', num: null };
const text = (v: string | undefined): Cell =>
  v ? { value: { type: 'text', value: v }, text: v, num: null } : NULL;
const decimal = (v: string | undefined): Cell =>
  v === undefined ? NULL : { value: { type: 'decimal', value: v }, text: v, num: Number(v) };
const money = (m: S['Money'] | undefined): Cell =>
  m
    ? {
        value: { type: 'money', value: { ...m } },
        text: String(m.amountMinor / 100),
        num: m.amountMinor,
      }
    : NULL;
const choice = (code: string, list: readonly (readonly [string, string])[]): Cell => ({
  value: { type: 'choices', value: [code] },
  text: list.find(([k]) => k === code)?.[1] ?? code,
  num: null,
});
const date = (v: string): Cell => ({ value: { type: 'date', value: v }, text: v, num: null });

/** Дата события по Москве (UTC+3) — «Дата» расхода эталона. */
const mskDate = (at: string): string =>
  new Date(Date.parse(at) + 3 * 3600_000).toISOString().slice(0, 10);

const has = (units: Set<string> | 'all'): boolean => units === 'all' || units.size > 0;

/** Наборы, видимые участнику (в порядке эталона), с их строками; W4.80 — после логистики наборы модулей ядра. */
export function datasetsFor(ctx: HandlerContext): DatasetDef[] {
  return [...fleetDatasetsFor(ctx), ...coreDatasetsFor(ctx, baseOf(ctx))];
}

/** Описание набора участника: агрегаты, версия прав, выгрузка (data.export и право набора). */
function baseOf(ctx: HandlerContext) {
  const t: TenantAccess = ctx.org();
  const units = (key: string) => unitsFor(t, key, ctx.now());
  return (
    id: string,
    moduleKey: string,
    name: string,
    permissionKey: string,
    entityType: string,
    fields: S['FieldDescriptor'][],
    defaultSort: S['QuerySort'][],
  ): S['Dataset'] => ({
    id,
    moduleKey,
    name,
    fields,
    allowedAggregations: ['count', 'sum', 'avg', 'min', 'max'],
    permissionVersion: String(t.org.policyVersion),
    permissionKey,
    entityType,
    exportAllowed: has(units('data.export')),
    hiddenFieldLabels: [],
    defaultSort,
  });
}

/** Наборы логистики (при подключённой «Логистике»). */
function fleetDatasetsFor(ctx: HandlerContext): DatasetDef[] {
  const t: TenantAccess = ctx.org();
  if (t.org.modules.fleet?.state !== 'active') return [];
  const now = ctx.now();
  const f = fleetOf(t.org);
  const units = (key: string) => unitsFor(t, key, now);
  const earnings = asDriver(t, now) ? new Set<string>() : units('fleet.earnings.read');
  const exportAllowed = has(units('data.export'));
  const unitName = (id: string) => t.org.units.find((u) => u.id === id)?.name ?? '';
  const base = (
    id: string,
    name: string,
    permissionKey: string,
    entityType: string,
    fields: S['FieldDescriptor'][],
    defaultSort: S['QuerySort'][],
    hidden: string[] = [],
  ): S['Dataset'] => ({
    id,
    moduleKey: 'fleet',
    name,
    fields,
    allowedAggregations: ['count', 'sum', 'avg', 'min', 'max'],
    permissionVersion: String(t.org.policyVersion),
    permissionKey,
    entityType,
    exportAllowed: exportAllowed && has(units(permissionKey)),
    hiddenFieldLabels: hidden,
    defaultSort,
  });
  const out: DatasetDef[] = [];

  const vehicles = units('fleet.vehicles.read');
  if (has(vehicles)) {
    out.push({
      dataset: base(
        'fleet.vehicles',
        'Автомобили',
        'fleet.vehicles.read',
        'vehicle',
        [
          field('displayName', 'Машина', 'text'),
          field('registrationNumber', 'Номер', 'text'),
          field('orgUnitName', 'Фирма', 'text'),
          field('status', 'Состояние', 'choices', { options: VEHICLE_STATUS }),
          field('volumeM3', 'Объём, м³', 'decimal'),
        ],
        [{ fieldKey: 'displayName', direction: 'asc' }],
      ),
      rows: () =>
        f.vehicles
          .filter((v) => covers(vehicles, v.orgUnitId))
          .map((v) => ({
            recordId: v.id,
            cells: {
              displayName: text(v.displayName),
              registrationNumber: text(v.registrationNumber),
              orgUnitName: text(unitName(v.orgUnitId)),
              status: choice(vehicleDto(v).status, VEHICLE_STATUS),
              volumeM3: decimal(v.capacity.volumeM3),
            },
          })),
    });
  }

  if (has(units('fleet.trips.read'))) {
    const showEarnings = has(earnings);
    const fields = [
      field('trip', 'Рейс', 'text'),
      field('driverName', 'Водитель', 'text', { nullable: true }),
      field('state', 'Статус', 'choices', { options: TRIP_STATES }),
      field('mileageKm', 'Пробег, км', 'decimal', { nullable: true }),
      ...(showEarnings
        ? [
            field('earnings', 'Начисление', 'money', {
              nullable: true,
              sensitivity: 'financial',
            }),
          ]
        : []),
    ];
    const odometer = (id: string | undefined) =>
      id ? f.inspections.find((i) => i.id === id)?.odometerKm : undefined;
    out.push({
      dataset: base(
        'fleet.trips',
        'Поездки',
        'fleet.trips.read',
        'trip',
        fields,
        [{ fieldKey: 'trip', direction: 'asc' }],
        showEarnings ? [] : ['Начисление'],
      ),
      rows: () =>
        f.trips
          .filter((x) => tripVisible(ctx, x))
          .map((x) => {
            const dep = odometer(x.departureInspectionId);
            const ret = odometer(x.returnInspectionId);
            const cells: Record<string, Cell> = {
              trip: text(`${x.number} · ${x.title}`),
              driverName: text(x.driverDisplayName),
              state: choice(x.state, TRIP_STATES),
              mileageKm: decimal(
                dep !== undefined && ret !== undefined
                  ? String(Number(ret) - Number(dep))
                  : undefined,
              ),
            };
            if (showEarnings) {
              cells.earnings =
                covers(earnings, x.orgUnitId) && x.earningsMinor !== undefined
                  ? money({ amountMinor: x.earningsMinor, currency: 'RUB' })
                  : NULL;
            }
            return { recordId: x.id, cells };
          }),
    });
  }

  if (has(units('fleet.expenses.read'))) {
    const EXPENSE_KIND = expenseKinds(f.categories);
    out.push({
      dataset: base(
        'fleet.expenses',
        'Расходы',
        'fleet.expenses.read',
        'expense',
        [
          field('trip', 'Рейс', 'text'),
          field('kind', 'Категория', 'choices', { options: EXPENSE_KIND }),
          field('occurredOn', 'Дата', 'date'),
          field('amount', 'Сумма', 'money'),
          field('status', 'Статус', 'choices', { options: EXPENSE_STATUS }),
        ],
        [{ fieldKey: 'occurredOn', direction: 'desc' }],
      ),
      rows: () =>
        f.expenses.flatMap((e) => {
          const trip = f.trips.find((x) => x.id === e.tripId);
          if (!trip || !tripVisible(ctx, trip, 'fleet.expenses.read')) return [];
          return [
            {
              recordId: e.id,
              cells: {
                trip: text(trip.number),
                kind: choice(e.kind, EXPENSE_KIND),
                occurredOn: date(mskDate(e.occurredAt)),
                amount: money(e.amount),
                status: choice(trip.state === 'accepted' ? 'accepted' : 'claimed', EXPENSE_STATUS),
              },
            },
          ];
        }),
    });
  }
  return out;
}

/** Ключи наборов логистики (известный набор без права — 403, неизвестный — 404); модулей ядра — CORE_KEYS. */
export const DATASET_KEYS: Readonly<Record<string, string>> = {
  'fleet.vehicles': 'fleet.vehicles.read',
  'fleet.trips': 'fleet.trips.read',
  'fleet.expenses': 'fleet.expenses.read',
};
