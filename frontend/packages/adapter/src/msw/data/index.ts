// Тег Data сценарного сервера (W2.51, контракт 0.6.0-stage2; S2-16, AC-14): каталог наборов и типизированная
// выборка «Данных» — фильтры только AND, поиск по видимым полям, сортировка, курсор, число видимых строк,
// группировка с count/sum/avg/min/max. Скрытое правами поле отвечает как неизвестное (422, без подтверждения
// существования). Тексты ошибок — пример queryDataset/validation_failed.
import type { components } from '@ortus/api-client';

import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { unitsFor } from '../fleet/state.ts';
import { type Cell, DATASET_KEYS, type DatasetDef, type DataRow, datasetsFor } from './catalog.ts';

type S = components['schemas'];

/** Предел подсчёта видимых строк (DatasetQueryResult.visibleCount). */
const COUNT_CAP = 10_000;

/**
 * Привязка курсора (DatasetQuery.cursor): набор, участник, permissionVersion, фильтры, поиск, сортировка и
 * группировка; select и limit между страницами менять можно. FNV-1a 32 — сценарному серверу хватает.
 */
function bindingOf(ctx: HandlerContext, ds: S['Dataset'], q: S['DatasetQuery']): string {
  const key = JSON.stringify([
    ds.id,
    ctx.org().member?.id ?? '',
    ds.permissionVersion,
    q.filters,
    q.search?.trim().toLowerCase() ?? '',
    q.sort,
    q.groupBy ?? [],
    q.aggregates ?? [],
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const encode = (n: number, bind: string): string => btoa(`q${n}.${bind}`).replace(/=+$/, '');
function decode(cursor: string, bind: string): number {
  let m: RegExpExecArray | null = null;
  try {
    m = /^q(\d+)\.([0-9a-z]+)$/.exec(atob(cursor));
  } catch {
    // ниже — 400
  }
  if (!m) return fail('malformed_request', 'Неверный курсор выборки.');
  if (m[2] !== bind) return fail('malformed_request', 'Курсор не подходит к выборке.');
  return Number(m[1]);
}

function unknownField(key: string, path: string): never {
  return fail('validation_failed', `Поле недоступно: ${key}.`, {
    violations: [{ field: path, code: 'unknown_field', message: 'Поле недоступно' }],
  });
}

/** Примитивы значения фильтра: строка, число или коды выбора. */
function primitives(v: S['FieldValue']): (string | number)[] {
  switch (v.type) {
    case 'decimal':
      return [Number(v.value)];
    case 'money':
      return [v.value.amountMinor];
    case 'choices':
      return [...v.value];
    case 'null':
      return [];
    case 'files':
      return [...v.value];
    case 'reference':
      return [v.value.entityId];
    case 'boolean':
      return [String(v.value)];
    default:
      return [String(v.value)];
  }
}

/** Значение ячейки для сравнения с фильтром. */
function cellValues(c: Cell): (string | number)[] {
  if (c.value.type === 'null') return [];
  if (c.num !== null) return [c.num];
  if (c.value.type === 'choices') return [...c.value.value];
  return [String(c.value.value)];
}

function matches(c: Cell, f: S['QueryFilter']): boolean {
  if (f.operator === 'is_null') return c.value.type === 'null';
  const have = cellValues(c);
  const want = f.values.flatMap(primitives);
  if (!have.length) return f.operator === 'ne';
  const eq = (a: string | number, b: string | number) => a === b;
  switch (f.operator) {
    case 'eq':
      return have.some((a) => want.length > 0 && eq(a, want[0] as string | number));
    case 'ne':
      return !have.some((a) => want.some((b) => eq(a, b)));
    case 'in':
      return have.some((a) => want.some((b) => eq(a, b)));
    case 'contains': {
      const needle = String(want[0] ?? '').toLowerCase();
      return have.some((a) => String(a).toLowerCase().includes(needle));
    }
    default: {
      const a = have[0] as string | number;
      const b = want[0] as string | number;
      if (b === undefined) return false;
      if (f.operator === 'lt') return a < b;
      if (f.operator === 'lte') return a <= b;
      if (f.operator === 'gt') return a > b;
      return a >= b;
    }
  }
}

function compare(a: Cell | undefined, b: Cell | undefined): number {
  const an = !a || a.value.type === 'null';
  const bn = !b || b.value.type === 'null';
  if (an || bn) return an === bn ? 0 : an ? 1 : -1; // пустые — в конце
  if (a.num !== null && b.num !== null) return a.num - b.num;
  return a.text.localeCompare(b.text, 'ru', { numeric: true });
}

export const datasetOr404 = (ctx: HandlerContext): DatasetDef => {
  const id = ctx.params.datasetId ?? '';
  const def = datasetsFor(ctx).find((d) => d.dataset.id === id);
  if (def) return def;
  const key = DATASET_KEYS[id];
  if (key && ctx.org().org.modules.fleet?.state === 'active') {
    const units = unitsFor(ctx.org(), key, ctx.now());
    if (units !== 'all' && units.size === 0) fail('forbidden_action');
  }
  return fail('not_found', 'Набор не найден.');
};

/** Строки агрегата: группы по groupBy, ячейки — поля группы и псевдонимы агрегатов (count — decimal). */
function aggregate(rows: DataRow[], q: S['DatasetQuery'], ds: S['Dataset']): DataRow[] {
  const groupBy = q.groupBy ?? [];
  const groups = new Map<string, DataRow[]>();
  for (const r of rows) {
    const k = JSON.stringify(groupBy.map((g) => r.cells[g]?.value));
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((list, i) => {
    const first = list[0] as DataRow;
    const cells: Record<string, Cell> = {};
    for (const g of groupBy) cells[g] = first.cells[g] as Cell;
    for (const a of q.aggregates ?? []) {
      if (a.function === 'count') {
        const n = String(list.length);
        cells[a.alias] = { value: { type: 'decimal', value: n }, text: n, num: list.length };
        continue;
      }
      const nums = list.flatMap((r) => {
        const c = a.fieldKey ? r.cells[a.fieldKey] : undefined;
        return c && c.num !== null ? [c.num] : [];
      });
      const sum = nums.reduce((s, x) => s + x, 0);
      const of = {
        sum,
        avg: Math.round(sum / nums.length),
        min: Math.min(...nums),
        max: Math.max(...nums),
      };
      const v = nums.length ? of[a.function] : null;
      const isMoney = ds.fields.find((f) => f.key === a.fieldKey)?.valueType === 'money';
      cells[a.alias] =
        v === null
          ? { value: { type: 'null', value: null }, text: '', num: null }
          : isMoney
            ? {
                value: { type: 'money', value: { amountMinor: v, currency: 'RUB' } },
                text: String(v / 100),
                num: v,
              }
            : { value: { type: 'decimal', value: String(v) }, text: String(v), num: v };
    }
    return { recordId: `group-${i + 1}`, cells };
  });
}

/** Предел строк одной выгрузки (DatasetExport.rowLimit, W2.52). */
const EXPORT_LIMIT = 10_000;

/** «01.10.2026» из «2026-10-01». */
const ruDate = (d: string): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
/** Момент по Москве (часовой пояс организации сида): «01.10.2026 10:30». */
function ruInstant(at: string): string {
  const msk = new Date(Date.parse(at) + 3 * 3600_000).toISOString();
  return `${ruDate(msk.slice(0, 10))} ${msk.slice(11, 16)}`;
}
const comma = (s: string): string => s.replace('.', ',');
/** Начало формулы Excel: = + - @ (и после ведущих пробелов), TAB, CR. */
const FORMULA = /^(?:[\t\r]|\s*[=+\-@])/;

/**
 * Ячейка CSV выгрузки (описание exportDataset): подписи вариантов, деньги в рублях и числа с запятой, даты
 * ДД.ММ.ГГГГ; текстовая ячейка (текст, варианты, ссылки, файлы), начинающаяся с = + - @ TAB CR, в том числе после
 * ведущих пробелов, — с апострофом (CSV formula injection, OWASP); деньги и числа — без него («-1234,50» остаётся
 * числом); «;», кавычки и переводы строк — в кавычках RFC 4180.
 */
export function csvCell(c: Cell | undefined): string {
  if (!c || c.value.type === 'null') return '';
  let out: string;
  switch (c.value.type) {
    case 'money':
      out = comma((c.value.value.amountMinor / 100).toFixed(2));
      break;
    case 'decimal':
      out = comma(c.value.value);
      break;
    case 'date':
      out = ruDate(c.value.value);
      break;
    case 'instant':
      out = ruInstant(c.value.value);
      break;
    default:
      out = FORMULA.test(c.text) ? `'${c.text}` : c.text;
  }
  return /[;"\r\n]/.test(out) ? `"${out.replaceAll('"', '""')}"` : out;
}

/** Спецификация выборки без пагинации и группировки: выгрузка, вид, задание выгрузки (W2.52, W4.06). */
export interface SpecLike {
  select?: string[];
  filters: S['QueryFilter'][];
  search?: string;
  sort: S['QuerySort'][];
}

/**
 * Поля спецификации — видимые поля набора (скрытое и неизвестное — одинаковый 422 unknown_field), операторы фильтров
 * — допустимые для поля (как exportDataset W2.52).
 */
export function checkSpec(ds: S['Dataset'], q: SpecLike): void {
  const fields = new Map(ds.fields.map((f) => [f.key, f]));
  const known = (key: string, path: string) => {
    if (!fields.has(key)) unknownField(key, path);
    return fields.get(key) as S['FieldDescriptor'];
  };
  (q.select ?? []).forEach((k, i) => known(k, `select[${i}]`));
  q.filters.forEach((f, i) => {
    if (!known(f.fieldKey, `filters[${i}].fieldKey`).filterOperators.includes(f.operator)) {
      fail('validation_failed', `Оператор недоступен: ${f.operator}.`, {
        violations: [
          { field: `filters[${i}].operator`, code: 'operator', message: 'Оператор недоступен' },
        ],
      });
    }
  });
  q.sort.forEach((s, i) => known(s.fieldKey, `sort[${i}].fieldKey`));
}

/** Строки спецификации: фильтры, поиск по видимым полям, сортировка (без пагинации). */
function specRows(def: DatasetDef, q: SpecLike): DataRow[] {
  let rows = def
    .rows()
    .filter((r) => q.filters.every((f) => matches(r.cells[f.fieldKey] as Cell, f)));
  const needle = q.search?.trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) =>
      Object.values(r.cells).some((c) => c.text.toLowerCase().includes(needle)),
    );
  }
  const sort = q.sort.length ? q.sort : (def.dataset.defaultSort ?? []);
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const c = compare(a.cells[s.fieldKey], b.cells[s.fieldKey]);
      if (c) return s.direction === 'asc' ? c : -c;
    }
    return 0;
  });
}

/** CSV выгрузки (описание exportDataset): заголовок — подписи колонок, «;», CRLF; первые `limit` строк. */
export function exportCsv(
  def: DatasetDef,
  q: SpecLike & { select: string[] },
  limit: number,
  now: string,
): { content: string; rowCount: number; truncated: boolean; fileName: string; labels: string[] } {
  const ds = def.dataset;
  const fields = new Map(ds.fields.map((f) => [f.key, f]));
  const rows = specRows(def, q);
  const slice = rows.slice(0, limit);
  const labels = q.select.map((k) => fields.get(k)?.label ?? k);
  const lines = [
    labels.map((l) => csvCell({ value: { type: 'text', value: '' }, text: l, num: null })),
    ...slice.map((r) => q.select.map((k) => csvCell(r.cells[k]))),
  ];
  const day = new Date(Date.parse(now) + 3 * 3600_000).toISOString().slice(0, 10);
  return {
    content: lines.map((l) => `${l.join(';')}\r\n`).join(''),
    rowCount: slice.length,
    truncated: rows.length > limit,
    fileName: `${ds.name}-${day}.csv`,
    labels,
  };
}
export const dataHandlers: Registry = {
  listDatasets: (ctx) => ({ body: { items: datasetsFor(ctx).map((d) => d.dataset) } }),

  // W2.52 (0.6.1-stage2, D-11 комплекта): синхронная выгрузка видимых строк набора в CSV (до 10 000 строк).
  exportDataset: (ctx) => {
    const def = datasetOr404(ctx);
    if (!def.dataset.exportAllowed) fail('forbidden_action');
    const q = ctx.body as S['DatasetExportCreate'];
    checkSpec(def.dataset, q);
    const csv = exportCsv(def, q, EXPORT_LIMIT, ctx.now());
    const body: S['DatasetExport'] = {
      datasetId: def.dataset.id,
      fileName: csv.fileName,
      contentType: 'text/csv; charset=utf-8',
      content: csv.content,
      rowCount: csv.rowCount,
      rowLimit: EXPORT_LIMIT,
      truncated: csv.truncated,
      generatedAt: ctx.now(),
    };
    return { body };
  },
  queryDataset: (ctx) => {
    const def = datasetOr404(ctx);
    const ds = def.dataset;
    const q = ctx.body as S['DatasetQuery'];
    const fields = new Map(ds.fields.map((f) => [f.key, f]));
    const aliases = new Set((q.aggregates ?? []).map((a) => a.alias));
    const grouped = (q.groupBy?.length ?? 0) > 0 || aliases.size > 0;
    const known = (key: string, path: string) => {
      if (!fields.has(key)) unknownField(key, path);
      return fields.get(key) as S['FieldDescriptor'];
    };
    q.select.forEach((k, i) => {
      if (grouped && aliases.has(k)) return;
      known(k, `select[${i}]`);
      if (grouped && !(q.groupBy ?? []).includes(k)) {
        fail('validation_failed', `Поле вне группировки: ${k}.`, {
          violations: [
            { field: `select[${i}]`, code: 'not_grouped', message: 'Поле не входит в группировку' },
          ],
        });
      }
    });
    q.filters.forEach((f, i) => {
      const d = known(f.fieldKey, `filters[${i}].fieldKey`);
      if (!d.filterOperators.includes(f.operator)) {
        fail('validation_failed', `Оператор недоступен: ${f.operator}.`, {
          violations: [
            { field: `filters[${i}].operator`, code: 'operator', message: 'Оператор недоступен' },
          ],
        });
      }
    });
    q.sort.forEach((s, i) => {
      if (!(grouped && aliases.has(s.fieldKey))) known(s.fieldKey, `sort[${i}].fieldKey`);
    });
    (q.groupBy ?? []).forEach((g, i) => known(g, `groupBy[${i}]`));
    (q.aggregates ?? []).forEach((a, i) => {
      if (a.function === 'count') return;
      const d = a.fieldKey ? known(a.fieldKey, `aggregates[${i}].fieldKey`) : undefined;
      if (!d?.aggregatable) unknownField(a.fieldKey ?? '', `aggregates[${i}].fieldKey`);
    });

    let rows = def
      .rows()
      .filter((r) => q.filters.every((f) => matches(r.cells[f.fieldKey] as Cell, f)));
    const needle = q.search?.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((r) =>
        Object.values(r.cells).some((c) => c.text.toLowerCase().includes(needle)),
      );
    }
    const visible = rows.length;
    if (grouped) rows = aggregate(rows, q, ds);
    const sort = q.sort.length ? q.sort : grouped ? [] : (ds.defaultSort ?? []);
    rows = [...rows].sort((a, b) => {
      for (const s of sort) {
        const c = compare(a.cells[s.fieldKey], b.cells[s.fieldKey]);
        if (c) return s.direction === 'asc' ? c : -c;
      }
      return 0;
    });
    const bind = bindingOf(ctx, ds, q);
    const from = q.cursor ? decode(q.cursor, bind) : 0;
    const slice = rows.slice(from, from + q.limit);
    const body: S['DatasetQueryResult'] = {
      rows: slice.map((r) => ({
        recordId: r.recordId,
        cells: q.select.map((k) => ({
          fieldKey: k,
          value: (r.cells[k] ?? { value: { type: 'null', value: null } }).value,
        })),
      })),
      nextCursor: from + q.limit < rows.length ? encode(from + q.limit, bind) : null,
      schemaVersion: ds.permissionVersion,
      ...(q.includeCount
        ? {
            visibleCount: Math.min(visible, COUNT_CAP),
            ...(visible > COUNT_CAP ? { visibleCountCapped: true } : {}),
          }
        : {}),
    };
    return { body };
  },
};
