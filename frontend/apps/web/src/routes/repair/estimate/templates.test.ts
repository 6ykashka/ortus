// W6.21 · Выбор шаблона для черновика сметы (эталон design-2026-10-19 «Ремонт и стройка.dc.html» estVM :1390–1408,
// tplMeta :1327, srcChip :1328; lineFrom/fval/rq :845–848, :1332). Контрольная сумма — DoR repair.md §2.6.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { measureOf } from '../measure/calc.ts';
import {
  defaultTemplateId,
  measureLine,
  sourceChip,
  templateMeta,
  templateParts,
  templateTotal,
  volumeOf,
} from './templates.ts';

type S = components['schemas'];

const m = (rub: number): S['Money'] => ({ amountMinor: Math.round(rub * 100), currency: 'RUB' });
const price = (id: string, unit: S['RepairUnit'], rub: number): S['PriceItem'] => ({
  id,
  section: 'Полы',
  name: id,
  unit,
  kind: 'work',
  price: m(rub),
  usedInTemplates: 0,
  archived: false,
  revision: 1,
});

const tpl = (o: Partial<S['Template']> = {}): S['Template'] => ({
  id: 't1',
  name: 'Капитальный ремонт квартиры',
  kind: 'капитальный ремонт',
  source: 'ortus',
  usedByObjects: 2,
  updatedAt: '2026-09-12T08:00:00Z',
  lines: [
    { priceItemId: 'dem', section: 'Демонтаж', quantity: '1' },
    { priceItemId: 'wall', section: 'Стены', formula: 'walls_dry' },
    { priceItemId: 'floor', section: 'Полы', formula: 'floor_dry' },
    { priceItemId: 'skirt', section: 'Полы', formula: 'perimeter_dry' },
    { priceItemId: 'lam', section: 'Полы', formula: 'floor_dry', coef: '1.07' },
  ],
  stages: [{ name: 'Демонтаж' }, { name: 'Электрика' }],
  documents: ['contract', 'act', 'act', 'handover_act', 'warranty'],
  checklist: ['a', 'b', 'c'],
  materials: [{ priceItemId: 'lam', section: 'Материалы', formula: 'floor_dry' }],
  warrantyMonths: 24,
  revision: 1,
  ...o,
});

describe('templateMeta: «N разделов · K строк · F из замера»', () => {
  it('разделы считаются по названию, формы слов — по числу', () => {
    expect(templateMeta(tpl())).toBe('3 раздела · 5 строк · 4 из замера');
    expect(
      templateMeta(tpl({ lines: [{ priceItemId: 'a', section: 'Один', quantity: '1' }] })),
    ).toBe('1 раздел · 1 строка · 0 из замера');
  });
});

describe('sourceChip', () => {
  it('Ортус, свой из объекта, свой копия', () => {
    expect(sourceChip(tpl())).toEqual({
      label: 'Ортус · копия организации',
      tone: 'neutral',
      icon: 'verified',
    });
    expect(sourceChip(tpl({ source: 'own' }))).toEqual({
      label: 'Свой · из объекта',
      tone: 'info',
      icon: 'bookmark',
    });
    expect(sourceChip(tpl({ source: 'own', copiedFromId: 'x' }))).toEqual({
      label: 'Свой · копия',
      tone: 'info',
      icon: 'bookmark',
    });
  });
});

describe('defaultTemplateId: шаблон по виду ремонта, иначе первый', () => {
  const list = [tpl({ id: 'a', kind: 'косметический ремонт' }), tpl({ id: 'b' })];
  it('по виду объекта', () => {
    expect(defaultTemplateId(list, 'капитальный ремонт')).toBe('b');
  });
  it('нет подходящего — первый; список пуст — undefined', () => {
    expect(defaultTemplateId(list, 'дача')).toBe('a');
    expect(defaultTemplateId([], 'дача')).toBeUndefined();
  });
});

describe('templateParts: «Что получит объект»', () => {
  it('шесть частей с подписями эталона', () => {
    const p = templateParts(tpl());
    expect(p.map((x) => x.title)).toEqual([
      'Разделы и работы сметы',
      'Формулы объёмов из замера',
      'Технология графика',
      'Комплект документов',
      'Чек-лист приёмки',
      'Материалы для снабжения',
    ]);
    expect(p.map((x) => x.icon)).toEqual([
      'request_quote',
      'straighten',
      'view_timeline',
      'draw',
      'checklist',
      'inventory_2',
    ]);
    expect(p[0]?.text).toBe('3 раздела, 5 строк · цены из справочника на сегодня');
    expect(p[1]?.text).toBe(
      '4 строки считаются из замера: стены без санузлов, пол без санузлов, периметр без санузлов',
    );
    expect(p[2]?.text).toBe(
      '2 этапа с выработкой и паузами на сушку · график соберётся после согласования сметы',
    );
    expect(p[3]?.text).toBe(
      'договор подряда, акты по разделам, акт сдачи объекта, гарантийный паспорт',
    );
    expect(p[4]?.text).toBe('3 пункта для прораба и заказчика при сдаче');
    expect(p[5]?.text).toBe('1 позиция с количеством из замера');
  });
});

describe('volumeOf: объём строки (fval, rq эталона)', () => {
  const meas = measureOf([
    { name: 'Комната', l: '5', w: '4', h: '2.5', o: '0' },
    { name: 'Санузел', l: '2', w: '1.5', h: '2.5', o: '0' },
  ]);
  it('семь формул', () => {
    const f = (formula: NonNullable<S['TemplateLine']['formula']>): number =>
      volumeOf({ priceItemId: 'x', section: 's', formula }, 'm2', meas);
    expect(f('floor')).toBe(23);
    expect(f('floor_dry')).toBe(20);
    expect(f('walls')).toBe(62.5);
    expect(f('walls_dry')).toBe(45);
    expect(f('wet')).toBe(20.5);
    expect(f('perimeter')).toBe(25);
    expect(f('perimeter_dry')).toBe(18);
  });
  it('коэффициент; округление: штучные — вверх, прочие — до десятых', () => {
    const line = { priceItemId: 'x', section: 's', formula: 'floor_dry' as const, coef: '1.07' };
    expect(volumeOf(line, 'm2', meas)).toBe(21.4);
    expect(volumeOf(line, 'piece', meas)).toBe(22);
    expect(volumeOf({ priceItemId: 'x', section: 's', quantity: '2.2' }, 'liter', meas)).toBe(3);
  });
});

describe('templateTotal: сумма черновика по замеру и ценам справочника', () => {
  it('сумма объём × цена по строкам шаблона', () => {
    const prices = new Map([
      ['dem', price('dem', 'trip', 6500)],
      ['wall', price('wall', 'm2', 100)],
      ['floor', price('floor', 'm2', 200)],
      ['skirt', price('skirt', 'm', 10)],
      ['lam', price('lam', 'm2', 1000)],
    ]);
    const meas = measureOf([{ name: 'Комната', l: '5', w: '4', h: '2.5', o: '0' }]);
    // 6500 + 45×100 + 20×200 + 18×10 + 21,4×1000 = 6500 + 4500 + 4000 + 180 + 21400
    expect(templateTotal(tpl(), prices, meas)).toBe(3_658_000);
  });
  it('позиции нет в справочнике — строка не считается', () => {
    expect(templateTotal(tpl(), new Map(), measureOf([]))).toBe(0);
  });
});

describe('measureLine: «Замер …»', () => {
  it('дата, помещения, пол, стены, санузлы', () => {
    expect(
      measureLine('2026-10-03T08:00:00Z', [
        { name: 'Комната', l: '5', w: '4', h: '2.5', o: '0' },
        { name: 'Санузел', l: '2', w: '1.5', h: '2.5', o: '0' },
      ]),
    ).toBe('Замер 03.10: 2 помещения · пол 23 м² · стены 62,5 м² · санузлы 20,5 м²');
  });
  it('без даты и помещений', () => {
    expect(measureLine(undefined, [])).toBe(
      'Замер: 0 помещений · пол 0 м² · стены 0 м² · санузлы 0 м²',
    );
  });
});
