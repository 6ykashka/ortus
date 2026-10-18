// Значение ячейки Базы знаний из ответа формы (models.js:106–115, B факт 12).
import { describe, expect, it } from 'vitest';
import { formVal } from './form-val.ts';
import type { Form, FormField, FormResponse } from './types.ts';

const FIELDS: FormField[] = [
  { id: 'q-photos', label: 'Фото', type: 'photo', required: true },
  { id: 'q-odo', label: 'Пробег по одометру, км', type: 'number', required: true },
  { id: 'q-fuel', label: 'Уровень топлива', type: 'choice', required: true },
  { id: 'q-checks', label: 'Чек-лист', type: 'multi', required: true },
  { id: 'q-note', label: 'Комментарий', type: 'longtext', required: false },
];

const FORM: Form = {
  id: 'fm-insp',
  name: 'Осмотр машины',
  module: 'logistics',
  owner: 'Дарья Зимина',
  status: 'published',
  published: 3,
  versions: [{ v: 3, at: '24.09.2026', by: 'Дарья Зимина', fields: FIELDS }],
  automations: [],
};

const R1012: FormResponse = {
  id: 'R-1012',
  formId: 'fm-insp',
  version: 3,
  at: '27.09 09:05',
  author: 'Илья Васильев',
  object: 'Рейс Р-196',
  status: 'Принят',
  values: {
    'q-photos': '5 фото',
    'q-odo': '84 210',
    'q-fuel': '¾',
    'q-checks': 'кузов, шины, документы',
    'q-defect': 'нет',
  },
};

describe('formVal: служебные переменные', () => {
  it.each([
    ['$at', '27.09 09:05'],
    ['$author', 'Илья Васильев'],
    ['$object', 'Рейс Р-196'],
    ['$id', 'R-1012'],
    ['$form', 'Осмотр машины'],
    ['$ver', 'v3'],
  ])('%s → %s', (src, want) => {
    expect(formVal(FORM, R1012, src, FIELDS)).toBe(want);
  });

  it('без формы $form — пустая строка', () => {
    expect(formVal(null, R1012, '$form', FIELDS)).toBe('');
    expect(formVal(undefined, R1012, '$form')).toBe('');
  });

  it('переменная без значения — пустая строка', () => {
    const r = { ...R1012, object: undefined as unknown as string };
    expect(formVal(FORM, r, '$object', FIELDS)).toBe('');
  });
});

describe('formVal: ответы на вопросы', () => {
  it('пробег R-1012 → «84 210»', () => {
    expect(formVal(FORM, R1012, 'q-odo', FIELDS)).toBe('84 210');
  });

  it('фото — ссылка на ответ, файлы не копируются', () => {
    expect(formVal(FORM, R1012, 'q-photos', FIELDS)).toBe('5 фото · файлы в ответе R-1012');
  });

  it('без списка вопросов фото — обычное значение', () => {
    expect(formVal(FORM, R1012, 'q-photos')).toBe('5 фото');
  });

  it.each([
    ['нет ответа', undefined],
    ['null', null],
    ['пустая строка', ''],
  ])('%s — пустая строка', (_n, v) => {
    const r = { ...R1012, values: { 'q-note': v } };
    expect(formVal(FORM, r, 'q-note', FIELDS)).toBe('');
  });

  it('вопроса нет в версии — значение как есть', () => {
    expect(formVal(FORM, R1012, 'q-defect', FIELDS)).toBe('нет');
  });

  it('у ответа нет values — пустая строка', () => {
    const r = { ...R1012, values: undefined as unknown as FormResponse['values'] };
    expect(formVal(FORM, r, 'q-odo', FIELDS)).toBe('');
  });

  it('несколько вариантов — через «, »', () => {
    const r = { ...R1012, values: { 'q-checks': ['Кузов', 'Шины', 'Свет'] } };
    expect(formVal(FORM, r, 'q-checks', FIELDS)).toBe('Кузов, Шины, Свет');
  });

  it('длинный ответ обрезается до 500 символов', () => {
    const long = 'а'.repeat(620);
    const r = { ...R1012, values: { 'q-note': long } };
    expect(formVal(FORM, r, 'q-note', FIELDS)).toBe('а'.repeat(500));
  });

  it('длинный список тоже обрезается до 500', () => {
    const r = { ...R1012, values: { 'q-checks': Array.from({ length: 200 }, () => 'Шины') } };
    expect(formVal(FORM, r, 'q-checks', FIELDS)).toHaveLength(500);
  });

  it('id вопроса похож на служебное имя объекта — не путается с переменными', () => {
    const r = { ...R1012, values: { toString: 'ответ' } };
    expect(formVal(FORM, r, 'toString', FIELDS)).toBe('ответ');
  });
});
