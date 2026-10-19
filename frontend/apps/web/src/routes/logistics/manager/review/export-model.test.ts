// W2.50 · Модель кнопок «Выгрузить расходы» и «Выгрузить рейсы» (exportDataset, D-11 комплекта — заменитель
// интеграции учёта): кнопки только у наборов с Dataset.exportAllowed, тело выгрузки (все видимые поля, порядок по
// умолчанию набора), файл UTF-8 с BOM (как ждёт Excel), текст тоста.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { exportBody, exportButtons, exportToast, fileParts } from './export-model.ts';

type S = components['schemas'];

const ds = (id: string, name: string, exportAllowed: boolean): S['Dataset'] =>
  ({
    id,
    moduleKey: 'fleet',
    name,
    fields: [
      { key: 'date', label: 'Дата', valueType: 'date', filterOperators: [] },
      { key: 'amount', label: 'Сумма', valueType: 'money', filterOperators: [] },
    ],
    allowedAggregations: [],
    permissionVersion: '1',
    permissionKey: 'fleet.expenses.read',
    entityType: 'expense',
    exportAllowed,
    hiddenFieldLabels: [],
    defaultSort: [{ fieldKey: 'date', direction: 'desc' }],
  }) as unknown as S['Dataset'];

describe('кнопки выгрузки', () => {
  it('«Выгрузить расходы» и «Выгрузить рейсы» — в этом порядке, только с exportAllowed', () => {
    const sets = [
      ds('fleet.vehicles', 'Автомобили', true),
      ds('fleet.trips', 'Поездки', true),
      ds('fleet.expenses', 'Расходы', true),
    ];
    expect(exportButtons(sets)).toEqual([
      { id: 'fleet.expenses', label: 'Выгрузить расходы', dataset: sets[2] },
      { id: 'fleet.trips', label: 'Выгрузить рейсы', dataset: sets[1] },
    ]);
    expect(
      exportButtons([
        ds('fleet.trips', 'Поездки', false),
        ds('fleet.expenses', 'Расходы', true),
      ]).map((b) => b.id),
    ).toEqual(['fleet.expenses']);
    expect(exportButtons([])).toEqual([]);
  });

  it('тело: все видимые поля набора, без фильтров, порядок по умолчанию', () => {
    expect(exportBody(ds('fleet.expenses', 'Расходы', true))).toEqual({
      select: ['date', 'amount'],
      filters: [],
      sort: [{ fieldKey: 'date', direction: 'desc' }],
    });
  });

  it('файл: BOM UTF-8 перед содержимым сервера', () => {
    const [bom, body] = fileParts('Дата;Сумма\r\n');
    expect(bom?.charCodeAt(0)).toBe(0xfeff);
    expect(body).toBe('Дата;Сумма\r\n');
  });

  it('тост: строки и имя файла; больше предела — первые 10000', () => {
    const r = {
      datasetId: 'fleet.expenses',
      fileName: 'Расходы-2026-10-01.csv',
      contentType: 'text/csv; charset=utf-8',
      content: '',
      rowCount: 3,
      rowLimit: 10_000,
      truncated: false,
      generatedAt: '2026-10-01T07:00:00Z',
    } as const;
    expect(exportToast(r)).toBe('Выгружено строк: 3 · Расходы-2026-10-01.csv');
    expect(exportToast({ ...r, rowCount: 10_000, truncated: true })).toBe(
      'Выгружены первые 10000 строк · Расходы-2026-10-01.csv. Остальные — сузьте выборку в «Данных».',
    );
  });
});
