// W2.50 · Модель выгрузки CSV (exportDataset, контракт 0.6.1-stage2; D-11 комплекта — заменитель интеграции учёта):
// кнопки «Выгрузить расходы» и «Выгрузить рейсы» только у наборов с Dataset.exportAllowed (data.export и право
// набора), тело выгрузки — все видимые поля набора в порядке по умолчанию, файл — UTF-8 с BOM (Excel и 1С русской
// локали), тост — число строк и имя файла сервера.
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';

import { REVIEW_TEXT } from './texts.ts';

type S = components['schemas'];

const T = REVIEW_TEXT.export;

/** Наборы выгрузки на экранах логистики — в порядке кнопок. */
const SETS = [
  ['fleet.expenses', T.expenses],
  ['fleet.trips', T.trips],
] as const;

export interface ExportButton {
  id: (typeof SETS)[number][0];
  label: string;
  dataset: S['Dataset'];
}

export function exportButtons(datasets: readonly S['Dataset'][]): ExportButton[] {
  return SETS.flatMap(([id, label]) => {
    const dataset = datasets.find((d) => d.id === id);
    return dataset?.exportAllowed ? [{ id, label, dataset }] : [];
  });
}

/** Тело выгрузки без фильтров: тип фильтра запроса у генератора уже, чем схема ответа (`value: null`). */
export type ExportBody = Pick<S['DatasetExportCreate'], 'select' | 'sort'> & { filters: [] };

export const exportBody = (ds: S['Dataset']): ExportBody => ({
  select: ds.fields.map((f) => f.key),
  filters: [],
  sort: ds.defaultSort ?? [],
});

const BOM = String.fromCharCode(0xfeff);

/** Части Blob файла: BOM UTF-8 и содержимое сервера как есть. */
export const fileParts = (content: string): [string, string] => [BOM, content];

export const exportToast = (r: S['DatasetExport']): string =>
  format(r.truncated ? T.truncated : T.done, { count: String(r.rowCount), file: r.fileName });
