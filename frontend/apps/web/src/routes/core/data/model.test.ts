// W2.26 · Модель «Данных» (эталон design-stage-2 dataVM :4179–4208; 06 §7): выбор набора, ячейки по типу значения,
// колонки и сортировка, счётчик вкладки, подвал, имя вида, тост выгрузки, переход строки в карточку модуля.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  cellText,
  columns,
  countLabel,
  DEFAULT_SET,
  emptyText,
  exportText,
  nextSort,
  noteText,
  openTarget,
  pickSet,
  querySort,
  rowCells,
  setIcon,
  sourceText,
  viewName,
} from './model.ts';

type S = components['schemas'];

const field = (
  key: string,
  label: string,
  valueType: S['FieldDescriptor']['valueType'],
  extra: Partial<S['FieldDescriptor']> = {},
): S['FieldDescriptor'] => ({
  key,
  label,
  valueType,
  nullable: true,
  filterOperators: ['eq'],
  sortable: true,
  aggregatable: false,
  sensitivity: 'standard',
  ...extra,
});

const dataset = (id: string, name: string, fields: S['FieldDescriptor'][], extra = {}) =>
  ({
    id,
    moduleKey: 'fleet',
    name,
    fields,
    allowedAggregations: ['count'],
    permissionVersion: '2',
    entityType: { 'fleet.vehicles': 'vehicle', 'fleet.trips': 'trip', 'fleet.expenses': 'expense' }[
      id
    ],
    exportAllowed: true,
    hiddenFieldLabels: [],
    ...extra,
  }) as S['Dataset'];

const STATES = [
  { key: 'planned', label: 'Запланирован' },
  { key: 'submitted', label: 'Сдан, ждёт приёмки' },
];
const vehicles = dataset('fleet.vehicles', 'Автомобили', [
  field('displayName', 'Машина', 'text'),
  field('volumeM3', 'Объём, м³', 'decimal'),
]);
const trips = dataset('fleet.trips', 'Поездки', [
  field('trip', 'Рейс', 'text'),
  field('driverName', 'Водитель', 'text'),
  field('state', 'Статус', 'choices', { options: STATES }),
  field('mileageKm', 'Пробег, км', 'decimal'),
  field('earnings', 'Начисление', 'money', { sortable: false }),
]);
const expenses = dataset('fleet.expenses', 'Расходы', [
  field('trip', 'Рейс', 'text'),
  field('occurredOn', 'Дата', 'date'),
  field('amount', 'Сумма', 'money'),
]);

const row = (recordId: string, cells: Record<string, S['FieldValue']>): S['DatasetRow'] => ({
  recordId,
  cells: Object.entries(cells).map(([fieldKey, value]) => ({ fieldKey, value })),
});
const NULL: S['FieldValue'] = { type: 'null', value: null };
/** Разряды ru-RU — неразрывный пробел (перед «₽» — обычный, как M.rub). */
const nb = (s: string) => s.replace(/(\d) (\d{3})/g, '$1\u00a0$2');

describe('набор: вкладки', () => {
  it('по умолчанию — «Поездки» (dtSet || trips), параметр ?set= — если такой набор есть', () => {
    expect(DEFAULT_SET).toBe('fleet.trips');
    const sets = [vehicles, trips, expenses];
    expect(pickSet(sets)?.id).toBe('fleet.trips');
    expect(pickSet(sets, 'fleet.expenses')?.id).toBe('fleet.expenses');
    expect(pickSet(sets, 'tasks')?.id).toBe('fleet.trips');
    expect(pickSet([vehicles, expenses])?.id).toBe('fleet.vehicles');
    expect(pickSet([])).toBeUndefined();
  });
  it('иконки эталона: local_shipping, route, receipt_long; иначе — иконка пункта меню', () => {
    expect(setIcon('fleet.vehicles')).toBe('local_shipping');
    expect(setIcon('fleet.trips')).toBe('route');
    expect(setIcon('fleet.expenses')).toBe('receipt_long');
    // W4.80: наборы этапа 4 (dataVM :4189) — иконки эталона; набор без иконки эталона — пункт меню «Данные».
    expect(setIcon('forms.responses')).toBe('dynamic_form');
    expect(setIcon('tasks')).toBe('task_alt');
    expect(setIcon('cash.operations')).toBe('table_view');
  });
  it('счётчик: число строк области; больше 10 000 — «10 000+»; пока не пришёл — пусто', () => {
    expect(countLabel(7)).toBe('7');
    expect(countLabel(0)).toBe('0');
    expect(countLabel(10_000, true)).toBe(nb('10 000+'));
    expect(countLabel(undefined)).toBe('');
  });
});

describe('ячейки по типу значения', () => {
  it('текст, пусто — «—»', () => {
    expect(cellText({ type: 'text', value: 'Илья Васильев' })).toBe('Илья Васильев');
    expect(cellText(NULL)).toBe('—');
    expect(cellText(undefined)).toBe('—');
    expect(cellText({ type: 'text', value: '' })).toBe('—');
  });
  it('число — ru-RU (M.num, M.int): «16», «10,5», «1 234»', () => {
    expect(cellText({ type: 'decimal', value: '16' })).toBe('16');
    expect(cellText({ type: 'decimal', value: '10.5' })).toBe('10,5');
    expect(cellText({ type: 'decimal', value: '1234' })).toBe(nb('1 234'));
  });
  it('деньги — M.rub: «4 500 ₽», копейки', () => {
    expect(cellText({ type: 'money', value: { amountMinor: 450000, currency: 'RUB' } })).toBe(
      nb('4 500 ₽'),
    );
    expect(cellText({ type: 'money', value: { amountMinor: 250050, currency: 'RUB' } })).toBe(
      nb('2 500,5 ₽'),
    );
  });
  it('дата — дд.мм.гггг (:4187)', () => {
    expect(cellText({ type: 'date', value: '2026-10-01' })).toBe('01.10.2026');
  });
  it('выбор — подпись варианта поля, без варианта — код', () => {
    const state = trips.fields[2];
    expect(cellText({ type: 'choices', value: ['planned'] }, state)).toBe('Запланирован');
    expect(cellText({ type: 'choices', value: ['unknown'] }, state)).toBe('unknown');
    expect(cellText({ type: 'choices', value: [] }, state)).toBe('—');
  });
  it('логическое — «Да» / «Нет» не нужно эталону: значение строкой', () => {
    expect(cellText({ type: 'boolean', value: true })).toBe('true');
  });
  it('строка — ячейки в порядке полей набора, отсутствующая — «—»', () => {
    const r = row('t1', {
      state: { type: 'choices', value: ['planned'] },
      trip: { type: 'text', value: 'Р-208 · Северный маршрут' },
      driverName: { type: 'text', value: 'Илья Васильев' },
      mileageKm: NULL,
    });
    expect(rowCells(r, trips)).toEqual([
      'Р-208 · Северный маршрут',
      'Илья Васильев',
      'Запланирован',
      '—',
      '—',
    ]);
  });
});

describe('колонки и сортировка', () => {
  it('без сортировки — unfold_more у всех; выбранная — arrow_upward / arrow_downward', () => {
    expect(columns(trips, null).map((c) => [c.label, c.icon])).toEqual([
      ['Рейс', 'unfold_more'],
      ['Водитель', 'unfold_more'],
      ['Статус', 'unfold_more'],
      ['Пробег, км', 'unfold_more'],
      ['Начисление', 'unfold_more'],
    ]);
    expect(columns(trips, { key: 'trip', dir: 'asc' })[0]?.icon).toBe('arrow_upward');
    expect(columns(trips, { key: 'trip', dir: 'desc' })[0]?.icon).toBe('arrow_downward');
    expect(columns(trips, null)[4]?.sortable).toBe(false);
  });
  it('клик: новая колонка — по возрастанию, та же — меняет направление (:4204)', () => {
    expect(nextSort(null, 'trip')).toEqual({ key: 'trip', dir: 'asc' });
    expect(nextSort({ key: 'trip', dir: 'asc' }, 'trip')).toEqual({ key: 'trip', dir: 'desc' });
    expect(nextSort({ key: 'trip', dir: 'desc' }, 'trip')).toEqual({ key: 'trip', dir: 'asc' });
    expect(nextSort({ key: 'trip', dir: 'desc' }, 'state')).toEqual({ key: 'state', dir: 'asc' });
  });
  it('сортировка запроса: нет — [] (порядок сервера defaultSort), есть — одно поле', () => {
    expect(querySort(null)).toEqual([]);
    expect(querySort({ key: 'volumeM3', dir: 'desc' })).toEqual([
      { fieldKey: 'volumeM3', direction: 'desc' },
    ]);
  });
});

describe('подвал, пусто, вид, выгрузка', () => {
  it('«Источник: Логистика · fleet.trips»', () => {
    expect(sourceText(trips)).toBe('Источник: Логистика · fleet.trips');
    expect(sourceText(vehicles)).toBe('Источник: Логистика · fleet.vehicles');
    // W4.80 (dataVM :4189): «Формы · forms.responses», «Задачи · tasks».
    expect(sourceText({ ...vehicles, id: 'forms.responses', moduleKey: 'forms' })).toBe(
      'Источник: Формы · forms.responses',
    );
    expect(sourceText({ ...vehicles, id: 'tasks', moduleKey: 'tasks' })).toBe(
      'Источник: Задачи · tasks',
    );
  });
  it('скрытое правами поле — подпись эталона, иначе — «Строки ограничены вашей областью доступа»', () => {
    expect(noteText(trips)).toBe('Строки ограничены вашей областью доступа');
    expect(noteText({ ...trips, hiddenFieldLabels: ['Начисление'] })).toBe(
      'Поле «Начисление» скрыто правами и не участвует в фильтре, сортировке и выгрузке',
    );
  });
  it('пусто: с фильтром — «По фильтру ничего не найдено», без — «В вашей области записей нет»', () => {
    expect(emptyText('zzz')).toBe('По фильтру ничего не найдено');
    expect(emptyText('  ')).toBe('В вашей области записей нет');
  });
  it('имя вида «Поездки: «211»» и тост выгрузки', () => {
    expect(viewName('Поездки', '211')).toBe('Поездки: «211»');
    expect(exportText('Поездки', 2)).toBe(
      'Выгрузка «Поездки»: 2 строк, фильтр и права зафиксированы.',
    );
  });
});

describe('строка открывает карточку модуля (:4185–4187)', () => {
  it('машина — «Рабочее место логиста»', () => {
    expect(openTarget(vehicles, row('v1', {}))).toEqual({ page: 'fleet' });
  });
  it('рейс на приёмке — «Приёмка смен», иначе — рабочее место с рейсом', () => {
    const st = (s: string) => row('t1', { state: { type: 'choices', value: [s] } });
    for (const s of ['submitted', 'accepted', 'rework', 'defect_review']) {
      expect(openTarget(trips, st(s))).toEqual({ page: 'review', trip: 't1' });
    }
    expect(openTarget(trips, st('planned'))).toEqual({ page: 'fleet', trip: 't1' });
    expect(openTarget(trips, row('t1', {}))).toEqual({ page: 'fleet', trip: 't1' });
  });
  it('расход — «Приёмка смен» рейса по номеру', () => {
    expect(openTarget(expenses, row('e1', { trip: { type: 'text', value: 'Р-208' } }))).toEqual({
      page: 'review',
      tripNumber: 'Р-208',
    });
    expect(openTarget(expenses, row('e1', {}))).toEqual({ page: 'review' });
  });
  // W4.80 (dataVM :4189): ответ — «Формы и опросы», ответы формы с выбранным ответом (formSel, formTab, respSel);
  // задача — карточка задачи (taskSel, ?task=).
  it('ответ на осмотр — ответ в редакторе формы: recordId «{formId}:{responseId}»', () => {
    const responses = { ...vehicles, id: 'forms.responses', entityType: 'form_response' };
    expect(openTarget(responses, row('f1:r1', {}))).toEqual({
      page: 'forms',
      form: 'f1',
      resp: 'r1',
    });
    expect(openTarget(responses, row('r1', {}))).toBeNull();
  });
  it('задача — карточка задачи', () => {
    const tasks = { ...vehicles, id: 'tasks', entityType: 'task' };
    expect(openTarget(tasks, row('t1', {}))).toEqual({ page: 'tasks', task: 't1' });
  });
  it('другой вид записи — строка не открывается', () => {
    expect(openTarget({ ...vehicles, entityType: 'cash_operation' }, row('x', {}))).toBeNull();
  });
});
