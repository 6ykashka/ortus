// W2.26 · Модель страницы «Данные» (`core-data`, S2-16; эталон design-stage-2 «Ортус CRM.dc.html» dataVM :4179–4208,
// 06 §7): набор по умолчанию и иконки вкладок (W4.80 — наборы «Форм» и «Задач» эталона design-2026-10-19), ячейки по типу значения контракта (FieldValue), колонки и сортировка,
// подвал, имя личного вида, тост выгрузки, переход строки в карточку модуля («Изменения — в карточке модуля»).
import type { components } from '@ortus/api-client';
import { ALL_MODULES, int, rub } from '@ortus/domain';
import { MANIFESTS } from '@ortus/domain/nav';
import { data as T, format } from '@ortus/texts';

type S = components['schemas'];

export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: string;
  dir: SortDir;
}
export type SortIcon = 'unfold_more' | 'arrow_upward' | 'arrow_downward';
export interface Column {
  key: string;
  label: string;
  sortable: boolean;
  icon: SortIcon;
}
/**
 * Куда ведёт строка: страница модуля и рейс (`?trip=`) или номер рейса расхода (id ищется по номеру); W4.80 — ответ в
 * редакторе формы (`?form=&tab=responses&resp=`) и карточка задачи (`?task=`).
 */
export type Target =
  | { page: 'fleet' | 'review'; trip?: string }
  | { page: 'review'; tripNumber: string }
  | { page: 'forms'; form: string; resp: string }
  | { page: 'tasks'; task: string };

/** Набор по умолчанию — «Поездки» (`s.dtSet || 'trips'`, :4191). */
export const DEFAULT_SET = 'fleet.trips';

/** Иконки вкладок эталона (:4185–4189); набор без иконки эталона — иконка пункта меню «Данные». */
const ICONS: Readonly<Record<string, string>> = {
  'fleet.vehicles': 'local_shipping',
  'fleet.trips': 'route',
  'fleet.expenses': 'receipt_long',
  // W4.80 (design-2026-10-19 dataVM :4189): SETS.responses, SETS.tasks.
  'forms.responses': 'dynamic_form',
  tasks: 'task_alt',
};
export const setIcon = (id: string): string => ICONS[id] ?? 'table_view';

/** Набор `?set=`, если он виден участнику; иначе «Поездки»; нет и их — первый набор каталога. */
export function pickSet(sets: readonly S['Dataset'][], param?: string): S['Dataset'] | undefined {
  return sets.find((d) => d.id === param) ?? sets.find((d) => d.id === DEFAULT_SET) ?? sets[0];
}

/** Число `ru-RU` (M.num / M.int эталона): «16», «10,5», «1 234». */
const decimal = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : s;
};

/** Ячейка по типу значения; пусто — «—» (:4186). */
export function cellText(v: S['FieldValue'] | undefined, f?: S['FieldDescriptor']): string {
  if (!v) return T.none;
  switch (v.type) {
    case 'null':
      return T.none;
    case 'text':
      return v.value || T.none;
    case 'decimal':
      return decimal(v.value);
    case 'money':
      return rub(v.value.amountMinor / 100);
    case 'date':
      return v.value.split('-').reverse().join('.');
    case 'choices':
      return v.value.length
        ? v.value.map((k) => f?.options?.find((o) => o.key === k)?.label ?? k).join(', ')
        : T.none;
    case 'files':
      return v.value.length ? int(v.value.length) : T.none;
    case 'reference':
      return v.value.entityId;
    default:
      return String(v.value);
  }
}

export function columns(ds: S['Dataset'], sort: Sort | null): Column[] {
  return ds.fields.map((f) => ({
    key: f.key,
    label: f.label,
    sortable: f.sortable,
    icon:
      sort?.key === f.key
        ? sort.dir === 'asc'
          ? 'arrow_upward'
          : 'arrow_downward'
        : 'unfold_more',
  }));
}

/** Клик по заголовку: другая колонка — по возрастанию, та же — обратное направление (:4204). */
export function nextSort(sort: Sort | null, key: string): Sort {
  return { key, dir: sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc' };
}

/** Без выбранной колонки — `[]`: порядок сервера (`Dataset.defaultSort`). */
export const querySort = (sort: Sort | null): S['QuerySort'][] =>
  sort ? [{ fieldKey: sort.key, direction: sort.dir }] : [];

/** Ячейки строки в порядке полей набора. */
export function rowCells(row: S['DatasetRow'], ds: S['Dataset']): string[] {
  return ds.fields.map((f) => cellText(row.cells.find((c) => c.fieldKey === f.key)?.value, f));
}

/** Счётчик вкладки — строки области набора (`visibleCount`); предел сервера — «10 000+». */
export function countLabel(n: number | undefined, capped?: boolean): string {
  if (n === undefined) return '';
  return capped ? `${int(n)}+` : int(n);
}

/** Имя модуля набора: ключ API модуля (`fleet`) → модуль домена (`logistics`) → «Логистика». */
function moduleTitle(moduleKey: string): string {
  const domain = MANIFESTS.find((m) => m.moduleKey === moduleKey)?.domainModule ?? moduleKey;
  return (ALL_MODULES as Record<string, { name: string } | undefined>)[domain]?.name ?? moduleKey;
}

export const sourceText = (ds: S['Dataset']): string =>
  format(T.source, {
    source: format(T.sourceOf, { module: moduleTitle(ds.moduleKey), dataset: ds.id }),
  });

/** Поле, скрытое правами (`hiddenFieldLabels`), — подпись эталона; иначе — об области доступа (:4206). */
export function noteText(ds: S['Dataset']): string {
  const hidden = ds.hiddenFieldLabels ?? [];
  if (!hidden.length) return T.scopeNote;
  return hidden.map((label) => format(T.hiddenField, { label })).join(' ');
}

export const emptyText = (q: string): string => (q.trim() ? T.emptyFiltered : T.emptyScope);

export const viewName = (set: string, q: string): string => format(T.viewName, { set, q });

/** Тост «Выгрузить» — задание поставлено (W4.50: без «В демо файл не создаётся»). */
export const exportText = (set: string, n: number): string => format(T.exportQueued, { set, n });

/** Состояния рейса, которые открывает «Приёмка смен» (:4186). */
const REVIEW = new Set(['submitted', 'accepted', 'rework', 'defect_review']);

const valueOf = (row: S['DatasetRow'], key: string) =>
  row.cells.find((c) => c.fieldKey === key)?.value;

/**
 * Карточка модуля строки (:4185–4189); вид записи без своей страницы — строка не открывается. Ответ на осмотр
 * адресуется внутри формы: `recordId` — «{formId}:{responseId}» (контракт 0.11.1-stage4, W4.80).
 */
export function openTarget(ds: S['Dataset'], row: S['DatasetRow']): Target | null {
  switch (ds.entityType) {
    case 'vehicle':
      return { page: 'fleet' };
    case 'trip': {
      const state = valueOf(row, 'state');
      const code = state?.type === 'choices' ? state.value[0] : undefined;
      return { page: code && REVIEW.has(code) ? 'review' : 'fleet', trip: row.recordId };
    }
    case 'expense': {
      const trip = valueOf(row, 'trip');
      return trip?.type === 'text' && trip.value
        ? { page: 'review', tripNumber: trip.value }
        : { page: 'review' };
    }
    case 'form_response': {
      const [form, resp, ...rest] = row.recordId.split(':');
      return form && resp && !rest.length ? { page: 'forms', form, resp } : null;
    }
    case 'task':
      return { page: 'tasks', task: row.recordId };
    default:
      return null;
  }
}
