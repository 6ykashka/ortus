// Импорт CSV машин (W2.52, контракт 0.6.1-stage2; ответ владельца 17.10 на D-11 комплекта — «импорт CSV сотрудников
// и машин»): предпросмотр по строкам → применение, по образцу импорта людей (access/imports.ts, S1-10). Колонки —
// описание createVehicleImport; не больше 1 МБ и 2000 строк (413). Совпадение по госномеру — обновление машины в
// области fleet.vehicles.manage; вне области — ошибка строки без раскрытия машины; перемещение — moveVehicle.
import type { components } from '@ortus/api-client';

import { parseCsv } from '../access/imports.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { addMs, DAY } from '../core/time.ts';
import {
  covers,
  fleetOf,
  type ParsedVehicle,
  unitsFor,
  type VehicleImportRow,
  type VehicleRow,
} from './state.ts';

type S = components['schemas'];
type Row = S['VehicleImportRow'];
type Violation = S['ProblemViolation'];

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const TOO_LARGE = 'Файл больше 1 МБ или 2000 строк. Разделите его на части.';

/** Обязательные колонки и их подписи для ошибки заголовка. */
const REQUIRED: readonly (readonly [string, string])[] = [
  ['registration_number', 'госномер'],
  ['display_name', 'название'],
  ['body_type', 'кузов'],
  ['payload_kg', 'грузоподъёмность, кг'],
  ['volume_m3', 'объём, м³'],
  ['cargo_length_m', 'длина кузова, м'],
  ['cargo_width_m', 'ширина кузова, м'],
  ['cargo_height_m', 'высота кузова, м'],
  ['odometer_km', 'пробег, км'],
];
const OPTIONAL = ['temperature_min_c', 'temperature_max_c', 'equipment', 'depot', 'org_unit'];
const BODY: Readonly<Record<string, S['Vehicle']['bodyType']>> = {
  van: 'van',
  box: 'box',
  flatbed: 'flatbed',
  refrigerated: 'refrigerated',
  tent: 'tent',
  фургон: 'van',
  борт: 'flatbed',
  рефрижератор: 'refrigerated',
  тент: 'tent',
};
const EQUIPMENT = new Set(['tail_lift', 'side_loading', 'pallet_jack', 'refrigerator']);
const QUANTITY = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
/** Одинаковый текст для строки вне области актора: ответ не раскрывает машину и её фирму. */
/** Фирма строки неизвестна или вне области актора — одна ошибка (как у импорта людей W1.05). */
const NO_UNIT: Violation = {
  field: 'org_unit',
  code: 'unknown',
  message: 'Подразделение не найдено.',
};
const UNAVAILABLE: Violation = {
  field: 'registration_number',
  code: 'unavailable',
  message: 'Строку нельзя импортировать',
};

const plate = (s: string): string => s.trim().replace(/\s+/g, ' ').toUpperCase();
const lower = (s: string | undefined): string => (s ?? '').toLowerCase();

/** Поля строки в порядке примера createVehicleImport/ok. */
const reorder = (r: Row): Row => {
  const keys = [
    'line',
    'action',
    'registrationNumber',
    'displayName',
    'orgUnitId',
    'vehicleId',
    'errors',
  ];
  return Object.fromEntries(
    keys.filter((k) => k in r).map((k) => [k, (r as Record<string, unknown>)[k]]),
  ) as Row;
};

const totalsOf = (rows: Row[]): S['VehicleImportTotals'] => ({
  rows: rows.length,
  create: rows.filter((r) => r.action === 'create').length,
  update: rows.filter((r) => r.action === 'update').length,
  skip: rows.filter((r) => r.action === 'skip').length,
  error: rows.filter((r) => r.action === 'error').length,
});

export function vehicleImportDto(i: VehicleImportRow): S['VehicleImport'] {
  return {
    id: i.id,
    state: i.state,
    fileName: i.fileName,
    defaultOrgUnitId: i.defaultOrgUnitId,
    totals: { ...i.totals },
    rows: structuredClone(i.rows),
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    ...(i.committedAt ? { committedAt: i.committedAt } : {}),
    revision: i.revision,
  };
}

/** Строки предпросмотра и разобранные значения по номеру строки. */
function preview(
  ctx: HandlerContext,
  csv: string[][],
  defaultUnit: string,
): { rows: Row[]; parsed: Record<number, ParsedVehicle> } {
  const t = ctx.org();
  const f = fleetOf(t.org);
  const manage = unitsFor(t, 'fleet.vehicles.manage', ctx.now());
  const [header = [], ...data] = csv;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const seen = new Set<string>();
  const parsed: Record<number, ParsedVehicle> = {};
  const rows = data.map((cells, i): Row => {
    const line = i + 2;
    const get = (name: string) => {
      const j = col(name);
      return j >= 0 ? (cells[j] ?? '').trim() : '';
    };
    const errors: Violation[] = [];
    const need = (name: string): string => {
      const v = get(name);
      if (!v) errors.push({ field: name, code: 'required', message: 'Обязательное поле' });
      return v;
    };
    const quantity = (name: string, required = true): string | undefined => {
      const raw = required ? need(name) : get(name);
      if (!raw) return undefined;
      const v = raw.replace(',', '.');
      if (!(name.startsWith('temperature') ? DECIMAL : QUANTITY).test(v)) {
        errors.push({ field: name, code: 'format', message: 'Число с точкой или запятой' });
        return undefined;
      }
      return v;
    };
    const registrationNumber = need('registration_number');
    const displayName = need('display_name');
    const bodyRaw = need('body_type');
    const bodyType = BODY[bodyRaw.toLowerCase()];
    if (bodyRaw && !bodyType) {
      errors.push({ field: 'body_type', code: 'unknown', message: 'Неизвестный тип кузова' });
    }
    const capacity = {
      payloadKg: quantity('payload_kg'),
      volumeM3: quantity('volume_m3'),
      cargoLengthM: quantity('cargo_length_m'),
      cargoWidthM: quantity('cargo_width_m'),
      cargoHeightM: quantity('cargo_height_m'),
    };
    const odometerKm = quantity('odometer_km');
    const tMin = quantity('temperature_min_c', false);
    const tMax = quantity('temperature_max_c', false);
    if ((tMin === undefined) !== (tMax === undefined)) {
      errors.push({
        field: 'temperature_min_c',
        code: 'pair',
        message: 'Укажите обе температуры или ни одной',
      });
    }
    const equipment = get('equipment')
      .split('|')
      .map((e) => e.trim())
      .filter(Boolean);
    if (equipment.some((e) => !EQUIPMENT.has(e))) {
      errors.push({ field: 'equipment', code: 'unknown', message: 'Неизвестное оборудование' });
    }
    const unitRaw = get('org_unit');
    const unit = unitRaw
      ? t.org.units.find((u) => u.id === unitRaw.toLowerCase() || u.name === unitRaw)
      : t.org.units.find((u) => u.id === defaultUnit);
    // Фирма строки вне области — та же ошибка, что несуществующая: по названиям фирмы не перебрать.
    if (unitRaw && (!unit || !covers(manage, unit.id))) errors.push(NO_UNIT);
    const key = plate(registrationNumber);
    if (key && seen.has(key)) {
      errors.push({
        field: 'registration_number',
        code: 'duplicate',
        message: 'Номер повторяется в файле',
      });
    }
    if (key) seen.add(key);
    const existing = key ? f.vehicles.find((v) => plate(v.registrationNumber) === key) : undefined;
    if (existing && !errors.length) {
      if (!covers(manage, existing.orgUnitId)) errors.push(UNAVAILABLE);
      else if (unit && unit.id !== existing.orgUnitId) {
        errors.push({
          field: 'org_unit',
          code: 'move',
          message: 'Перемещение машины — отдельной командой',
        });
      } else if (odometerKm !== undefined && Number(odometerKm) < Number(existing.odometerKm)) {
        errors.push({
          field: 'odometer_km',
          code: 'odometer_decrease',
          message: 'Пробег не может уменьшиться',
        });
      }
    }
    if (errors.length) {
      return reorder({
        line,
        action: 'error',
        ...(registrationNumber ? { registrationNumber } : {}),
        ...(displayName ? { displayName } : {}),
        errors,
      });
    }
    const orgUnitId = existing?.orgUnitId ?? (unit?.id as string);
    parsed[line] = {
      registrationNumber,
      displayName,
      bodyType: bodyType as S['Vehicle']['bodyType'],
      capacity: capacity as S['VehicleCapacity'],
      ...(tMin !== undefined && tMax !== undefined
        ? { temperatureMinC: tMin, temperatureMaxC: tMax }
        : {}),
      equipment: equipment as S['Vehicle']['equipment'],
      odometerKm: odometerKm as string,
      ...(get('depot') ? { depot: get('depot') } : {}),
      orgUnitId,
    };
    return reorder({
      line,
      action: existing ? 'update' : 'create',
      registrationNumber,
      displayName,
      orgUnitId,
      ...(existing ? { vehicleId: existing.id } : {}),
      errors: [],
    });
  });
  return { rows, parsed };
}

function importOr404(ctx: HandlerContext): VehicleImportRow {
  const t = ctx.org();
  const imp = fleetOf(t.org).vehicleImports.find((i) => i.id === lower(ctx.params.importId));
  const visible =
    !!imp && covers(unitsFor(t, 'fleet.vehicles.manage', ctx.now()), imp.defaultOrgUnitId);
  if (!imp || !visible || (imp.state === 'previewed' && ctx.now() >= imp.expiresAt)) {
    fail('not_found', 'Импорт не найден.');
  }
  return imp;
}

export const vehicleImportHandlers: Registry = {
  createVehicleImport: {
    before: (ctx) => {
      const csv = (ctx.body as { csv?: unknown } | undefined)?.csv;
      if (typeof csv !== 'string') return;
      const lines = csv.split('\n').filter((l) => l.trim() !== '').length - 1;
      if (new TextEncoder().encode(csv).length > MAX_BYTES || lines > MAX_ROWS) {
        fail('payload_too_large', TOO_LARGE);
      }
    },
    run: (ctx) => {
      const t = ctx.org();
      const b = ctx.body as S['VehicleImportCreate'];
      const defaultUnit = b.defaultOrgUnitId.toLowerCase();
      const now = ctx.now();
      const manage = unitsFor(t, 'fleet.vehicles.manage', now);
      // Неизвестная и невидимая фирма — один 422; видимая без права — 403 (описание createVehicleImport).
      const seen =
        covers(unitsFor(t, 'org_units.read', now), defaultUnit) || covers(manage, defaultUnit);
      if (!t.org.units.some((u) => u.id === defaultUnit) || !seen) {
        fail('validation_failed', 'Подразделение не найдено.', {
          violations: [
            { field: 'defaultOrgUnitId', code: 'unknown', message: 'Подразделение не найдено' },
          ],
        });
      }
      if (!covers(manage, defaultUnit)) fail('forbidden_action');
      const csv = parseCsv(b.csv);
      const header = (csv[0] ?? []).map((h) => h.trim().toLowerCase());
      const missing = REQUIRED.find(([name]) => !header.includes(name));
      if (missing) {
        fail('validation_failed', `В файле нет обязательной колонки ${missing[0]}.`, {
          violations: [
            {
              field: 'csv',
              code: 'missing_column',
              message: `Нет колонки ${missing[0]} (${missing[1]})`,
            },
          ],
        });
      }
      const known = new Set([...REQUIRED.map(([n]) => n), ...OPTIONAL]);
      const unknown = header.find((h) => h && !known.has(h));
      if (unknown) {
        fail('validation_failed', `Неизвестная колонка ${unknown}.`, {
          violations: [
            { field: 'csv', code: 'unknown_column', message: `Неизвестная колонка ${unknown}` },
          ],
        });
      }
      const { rows, parsed } = preview(ctx, csv, defaultUnit);
      const row: VehicleImportRow = {
        id: ctx.newId(),
        state: 'previewed',
        fileName: b.fileName,
        defaultOrgUnitId: defaultUnit,
        totals: totalsOf(rows),
        rows,
        createdAt: ctx.now(),
        expiresAt: addMs(ctx.now(), DAY),
        revision: 1,
        parsed,
      };
      fleetOf(t.org).vehicleImports.push(row);
      return { status: 201, body: vehicleImportDto(row) };
    },
  },

  getVehicleImport: (ctx) => ({ body: vehicleImportDto(importOr404(ctx)) }),

  commitVehicleImport: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const now = ctx.now();
    const imp = importOr404(ctx);
    ctx.revision(imp.revision);
    if (imp.state !== 'previewed') fail('invalid_transition', 'Импорт уже применён.');
    const b = ctx.body as S['VehicleImportCommit'];
    const errors = imp.rows.filter((r) => r.action === 'error');
    if (errors.length && !b.skipInvalidRows) {
      fail('validation_failed', 'В файле есть строки с ошибками: исправьте их или пропустите.', {
        violations: errors.map((r) => ({
          field: `rows[${r.line}]`,
          code: 'invalid',
          message: r.errors[0]?.message ?? 'Ошибка в строке',
        })),
      });
    }
    const manage = unitsFor(t, 'fleet.vehicles.manage', now);
    imp.rows = imp.rows.map((r): Row => {
      const p = imp.parsed[r.line];
      if (r.action === 'error' || !p) return { ...r, action: 'skip' };
      if (r.action === 'create') {
        const v: VehicleRow = {
          id: ctx.newId(),
          proto: '',
          orgUnitId: p.orgUnitId,
          registrationNumber: p.registrationNumber,
          displayName: p.displayName,
          bodyType: p.bodyType,
          capacity: { ...p.capacity },
          ...(p.temperatureMinC !== undefined ? { temperatureMinC: p.temperatureMinC } : {}),
          ...(p.temperatureMaxC !== undefined ? { temperatureMaxC: p.temperatureMaxC } : {}),
          equipment: [...p.equipment],
          odometerKm: p.odometerKm,
          depot: p.depot ?? '',
          vstate: 'free',
          revision: 1,
        };
        f.vehicles.push(v);
        f.assignments.push({
          id: ctx.newId(),
          vehicleId: v.id,
          orgUnitId: v.orgUnitId,
          validFrom: now,
          validTo: null,
        });
        return reorder({ ...r, vehicleId: v.id });
      }
      const v = f.vehicles.find((x) => x.id === r.vehicleId);
      // Повторная проверка области при применении: машина ушла из области — строка не применяется.
      if (!v || !covers(manage, v.orgUnitId)) {
        return reorder({ line: r.line, action: 'skip', errors: [UNAVAILABLE] });
      }
      const next = {
        registrationNumber: p.registrationNumber,
        displayName: p.displayName,
        bodyType: p.bodyType,
        capacity: { ...p.capacity },
        equipment: [...p.equipment],
        odometerKm: Number(p.odometerKm) > Number(v.odometerKm) ? p.odometerKm : v.odometerKm,
        depot: p.depot ?? v.depot,
      };
      const changed =
        JSON.stringify(next) !==
        JSON.stringify({
          registrationNumber: v.registrationNumber,
          displayName: v.displayName,
          bodyType: v.bodyType,
          capacity: v.capacity,
          equipment: v.equipment,
          odometerKm: v.odometerKm,
          depot: v.depot,
        });
      if (changed) {
        Object.assign(v, next);
        v.revision++;
      }
      return r;
    });
    imp.totals = totalsOf(imp.rows);
    imp.state = 'committed';
    imp.committedAt = now;
    imp.revision++;
    return { body: vehicleImportDto(imp) };
  },
};
