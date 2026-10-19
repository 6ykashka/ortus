// W2.50 · Модель экрана «Импорт машин» (`logistics-vehicle-import`, no-reference; D-11 комплекта): фирма по умолчанию
// по праву fleet.vehicles.manage, итоги предпросмотра, строки с ошибками по строкам, выбор применения, текст ошибки
// заголовка и размера файла — текстом сервера.
import { ProblemError } from '@ortus/api-client';
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  applyChoice,
  fileError,
  importUnits,
  isStale,
  resultText,
  rowView,
  splitRows,
  STALE_CODES,
  summary,
} from './import-model.ts';

type S = components['schemas'];

const units: S['OrgUnit'][] = [
  { id: 'r-msk', parentId: null, name: 'Москва', kind: 'region', status: 'active', revision: 1 },
  {
    id: 'f-sever',
    parentId: 'r-msk',
    name: 'Север Логистик',
    kind: 'company',
    status: 'active',
    revision: 1,
  },
  {
    id: 'f-yug',
    parentId: 'r-msk',
    name: 'Юг Логистик',
    kind: 'company',
    status: 'active',
    revision: 1,
  },
  {
    id: 'f-old',
    parentId: 'r-msk',
    name: 'Архив',
    kind: 'company',
    status: 'archived',
    revision: 1,
  },
];

const cap = (permission: string, ids: string[]) => ({
  permission,
  scope: { kind: 'org_unit' as const, resourceIds: ids, includeDescendants: false },
});

const imp = (o: Partial<S['VehicleImport']> = {}): S['VehicleImport'] => ({
  id: 'imp-1',
  state: 'previewed',
  fileName: 'машины.csv',
  defaultOrgUnitId: 'f-sever',
  totals: { rows: 3, create: 1, update: 1, skip: 0, error: 1 },
  rows: [
    {
      line: 2,
      action: 'create',
      registrationNumber: 'А 100 АА 77',
      displayName: 'ГАЗель Next',
      errors: [],
    },
    {
      line: 3,
      action: 'error',
      registrationNumber: 'В 200 ВВ 77',
      errors: [
        { field: 'body_type', code: 'unknown', message: 'Неизвестный тип кузова' },
        { field: 'odometer_km', code: 'required', message: 'Обязательное поле' },
      ],
    },
    {
      line: 4,
      action: 'update',
      registrationNumber: 'С 300 СС 77',
      displayName: 'Ford',
      errors: [],
    },
  ],
  createdAt: '2026-10-01T07:00:00Z',
  expiresAt: '2026-10-02T07:00:00Z',
  revision: 1,
  ...o,
});

describe('фирма по умолчанию', () => {
  it('владелец — все активные фирмы и филиалы без регионов, по алфавиту; по умолчанию первая', () => {
    const r = importUnits({ owner: true, caps: [], units });
    expect(r.options).toEqual([
      { value: 'f-sever', label: 'Москва / Север Логистик' },
      { value: 'f-yug', label: 'Москва / Юг Логистик' },
    ]);
    expect(r.defaultId).toBe('f-sever');
  });

  it('логист — только фирмы права fleet.vehicles.manage', () => {
    const r = importUnits({
      owner: false,
      caps: [cap('fleet.vehicles.manage', ['f-yug']), cap('fleet.routes.manage', ['f-sever'])],
      units,
    });
    expect(r.options.map((o) => o.value)).toEqual(['f-yug']);
    expect(r.defaultId).toBe('f-yug');
  });

  it('без названий подразделений (нет org_units.read) — подразделение права, без выбора', () => {
    const r = importUnits({
      owner: false,
      caps: [cap('fleet.vehicles.manage', ['f-sever'])],
      units: [],
    });
    expect(r.options).toEqual([]);
    expect(r.defaultId).toBe('f-sever');
  });
});

describe('предпросмотр', () => {
  it('итоги: строк, новых, обновить, с ошибками; после применения — обновлено и пропущено', () => {
    expect(summary(imp())).toEqual([
      { key: 'rows', label: 'Строк в файле', value: '3' },
      { key: 'create', label: 'Новых машин', value: '1' },
      { key: 'update', label: 'Обновить', value: '1' },
      { key: 'error', label: 'С ошибками', value: '1' },
    ]);
    const done = imp({
      state: 'committed',
      totals: { rows: 3, create: 1, update: 1, skip: 1, error: 0 },
    });
    // Ревью W2.50-r1: после применения — прошедшее время, как «Пропущено» и «обновлено: N» итога.
    expect(summary(done)).toEqual([
      { key: 'rows', label: 'Строк в файле', value: '3' },
      { key: 'create', label: 'Создано', value: '1' },
      { key: 'update', label: 'Обновлено', value: '1' },
      { key: 'skip', label: 'Пропущено', value: '1' },
    ]);
  });

  it('ошибка строки называет колонку: код заголовка и подпись (как ошибка заголовка сервера)', () => {
    const errors = (field: string, message: string): string[] =>
      rowView({ line: 5, action: 'error', errors: [{ field, code: 'x', message }] }).errors;
    expect(errors('payload_kg', 'Обязательное поле')).toEqual([
      'payload_kg (грузоподъёмность, кг): Обязательное поле',
    ]);
    expect(errors('volume_m3', 'Число с точкой или запятой')).toEqual([
      'volume_m3 (объём, м³): Число с точкой или запятой',
    ]);
    expect(errors('registration_number', 'Номер повторяется в файле')).toEqual([
      'registration_number (госномер): Номер повторяется в файле',
    ]);
    expect(errors('temperature_min_c', 'Укажите обе температуры или ни одной')).toEqual([
      'temperature_min_c (мин. температура, °C): Укажите обе температуры или ни одной',
    ]);
    expect(errors('org_unit', 'Подразделение не найдено.')).toEqual([
      'org_unit (фирма): Подразделение не найдено.',
    ]);
    expect(errors('equipment', 'Неизвестное оборудование')).toEqual([
      'equipment (оборудование): Неизвестное оборудование',
    ]);
    expect(errors('depot', 'Не длиннее 200 символов')).toEqual([
      'depot (стоянка): Не длиннее 200 символов',
    ]);
    // Вся строка (лишние значения) — «строка»; поле новее экрана — его код; без поля — только текст.
    expect(errors('line', 'Лишние значения в строке')).toEqual([
      'строка: Лишние значения в строке',
    ]);
    expect(errors('vin', 'Неизвестно')).toEqual(['vin: Неизвестно']);
    expect(errors('', 'Ошибка')).toEqual(['Ошибка']);
  });

  it('строка: «Строка N · госномер · название», действие и ошибки по полям', () => {
    const [a, b, c] = imp().rows.map(rowView);
    expect(a).toEqual({
      line: 2,
      title: 'Строка 2 · А 100 АА 77 · ГАЗель Next',
      action: 'Новая машина',
      tone: 'ok',
      errors: [],
    });
    expect(b).toEqual({
      line: 3,
      title: 'Строка 3 · В 200 ВВ 77',
      action: 'Ошибка',
      tone: 'danger',
      errors: [
        'body_type (кузов): Неизвестный тип кузова',
        'odometer_km (пробег, км): Обязательное поле',
      ],
    });
    expect(c?.action).toBe('Обновление');
    expect(rowView({ line: 9, action: 'skip', errors: [] })).toMatchObject({
      title: 'Строка 9',
      action: 'Пропущена',
      tone: 'neutral',
    });
  });

  it('строки: сначала с ошибками, затем к применению', () => {
    const r = splitRows(imp());
    expect(r.errors.map((x) => x.line)).toEqual([3]);
    expect(r.valid.map((x) => x.line)).toEqual([2, 4]);
  });

  it('применение: без ошибок — «Применить»; с ошибками — «Применить без строк с ошибками»; нечего — нет', () => {
    expect(applyChoice(imp({ totals: { rows: 2, create: 1, update: 1, skip: 0, error: 0 } }))).toBe(
      'apply',
    );
    expect(applyChoice(imp())).toBe('skip');
    expect(applyChoice(imp({ totals: { rows: 1, create: 0, update: 0, skip: 0, error: 1 } }))).toBe(
      'none',
    );
    expect(applyChoice(imp({ state: 'committed' }))).toBe('none');
  });

  it('итог применения', () => {
    const done = imp({
      state: 'committed',
      totals: { rows: 3, create: 1, update: 1, skip: 1, error: 0 },
    });
    expect(resultText(done)).toBe('Создано машин: 1 · обновлено: 1 · пропущено строк: 1.');
  });
});

describe('ошибка файла — текстом сервера', () => {
  it('422 заголовка: detail сервера', () => {
    const e = new ProblemError(422, {
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: 'В файле нет обязательной колонки odometer_km.',
      requestId: 'r',
      violations: [
        { field: 'csv', code: 'missing_column', message: 'Нет колонки odometer_km (пробег, км)' },
      ],
    } as never);
    expect(fileError(e)).toBe('В файле нет обязательной колонки odometer_km.');
  });

  it('413: detail сервера; без detail — текст словаря по коду', () => {
    const big = new ProblemError(413, {
      type: 'about:blank',
      title: 'Payload too large',
      status: 413,
      code: 'payload_too_large',
      detail: 'Файл больше 1 МБ или 2000 строк. Разделите его на части.',
      requestId: 'r',
    } as never);
    expect(fileError(big)).toBe('Файл больше 1 МБ или 2000 строк. Разделите его на части.');
    expect(fileError(new TypeError('Failed to fetch'))).toBe(
      'Нет связи с сервером. Операция не выполнена.',
    );
  });
});

describe('устаревший предпросмотр на «Применить» — те же коды, что без тоста', () => {
  const problem = (status: number, code: string): ProblemError =>
    new ProblemError(status, {
      type: 'about:blank',
      title: code,
      status,
      code,
      requestId: 'r',
    } as never);

  it('412 revision_mismatch и 409 invalid_transition — проверить файл заново', () => {
    expect(isStale(problem(412, 'revision_mismatch'))).toBe(true);
    expect(isStale(problem(409, 'invalid_transition'))).toBe(true);
    expect(STALE_CODES).toEqual(['revision_mismatch', 'invalid_transition']);
  });

  it('прочие 409 (повтор ключа), «нет связи» и 422 — не повторная проверка: их показывает тост', () => {
    expect(isStale(problem(409, 'idempotency_key_reused'))).toBe(false);
    expect(isStale(problem(422, 'validation_failed'))).toBe(false);
    expect(isStale(new TypeError('Failed to fetch'))).toBe(false);
  });
});
