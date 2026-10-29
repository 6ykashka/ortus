// W6.22 · Модель «Шаблонов и расценок» (`catVM`, `tplMeta`, `srcChip`, `pickList`, :1327–1329, :1490–1542
// `Ремонт и стройка.dc.html`, снимок design-2026-10-19) поверх DTO контракта 0.12.0-stage6 (Template, PriceItem).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  copyNote,
  documentLabels,
  draftOf,
  formulaLabel,
  kText,
  linesOf,
  matRows,
  newItemError,
  newItemNote,
  pickList,
  priceGroups,
  ruleText,
  srcChip,
  stageRows,
  tplFrom,
  tplMeta,
  tplMetaLine,
} from './model.ts';

type S = components['schemas'];

const item = (o: Partial<S['PriceItem']> & { id: string; name: string }): S['PriceItem'] => ({
  section: 'Электрика',
  unit: 'piece',
  kind: 'work',
  price: { amountMinor: 120_000, currency: 'RUB' },
  usedInTemplates: 2,
  archived: false,
  revision: 1,
  ...o,
});

const prices: S['PriceItem'][] = [
  item({
    id: 'p-dem',
    name: 'Демонтаж напольного покрытия',
    section: 'Демонтаж',
    unit: 'm2',
    price: { amountMinor: 18_000, currency: 'RUB' },
  }),
  item({ id: 'p-el', name: 'Электромонтаж, точка' }),
  item({
    id: 'm-lam',
    name: 'Ламинат 33 класс',
    section: 'Материалы',
    unit: 'm2',
    kind: 'material',
    price: { amountMinor: 135_000, currency: 'RUB' },
    usedInTemplates: 4,
  }),
];

const tpl = (o: Partial<S['Template']> = {}): S['Template'] => ({
  id: 't-cap',
  name: 'Капитальный ремонт квартиры',
  kind: 'капитальный ремонт',
  source: 'ortus',
  usedByObjects: 2,
  updatedAt: '2026-09-12T08:00:00Z',
  lines: [
    { priceItemId: 'p-dem', section: 'Демонтаж', formula: 'floor' },
    { priceItemId: 'p-el', section: 'Электрика', quantity: '30' },
    { priceItemId: 'p-el', section: 'Электрика', formula: 'perimeter_dry', coef: '1.07' },
  ],
  stages: [
    { name: 'Демонтаж', ratePerDay: '12', pauseDays: 0 },
    { name: 'Штукатурка стен', ratePerDay: '12', pauseDays: -3 },
    { name: 'Укладка ламината', ratePerDay: '15', pauseDays: 10 },
    { name: 'Уборка и сдача объекта', pauseDays: 0 },
  ],
  documents: ['contract', 'act', 'act', 'handover_act', 'warranty'],
  checklist: ['Стены: отклонение не больше 2 мм на 2 м'],
  materials: [
    { priceItemId: 'm-lam', section: 'Материалы', formula: 'floor_dry', coef: '1.07' },
    { priceItemId: 'm-lam', section: 'Материалы', quantity: '1' },
  ],
  warrantyMonths: 24,
  revision: 3,
  ...o,
});

describe('подписи шаблона', () => {
  it('формулы объёма — подписи эталона FML', () => {
    expect(formulaLabel('floor')).toBe('площадь пола');
    expect(formulaLabel('floor_dry')).toBe('пол без санузлов');
    expect(formulaLabel('wet')).toBe('санузлы: пол и стены');
    expect(formulaLabel('perimeter_dry')).toBe('периметр без санузлов');
  });

  it('коэффициент: « × 1,07», единица не пишется', () => {
    expect(kText('1.07')).toBe(' × 1,07');
    expect(kText('1')).toBe('');
    expect(kText(undefined)).toBe('');
  });

  it('«2 раздела · 3 строки · 2 из замера» (tplMeta)', () => {
    expect(tplMeta(tpl())).toBe('2 раздела · 3 строки · 2 из замера');
    expect(tplMeta(tpl({ lines: [{ priceItemId: 'p-el', section: 'А', quantity: '1' }] }))).toBe(
      '1 раздел · 1 строка · 0 из замера',
    );
    expect(
      tplMeta(
        tpl({
          lines: Array.from({ length: 5 }, (_, i) => ({
            priceItemId: 'p',
            section: `С${i}`,
            quantity: '1',
          })),
        }),
      ),
    ).toBe('5 разделов · 5 строк · 0 из замера');
  });

  it('строка списка: «… · объектов: N»', () => {
    expect(tplMetaLine(tpl())).toBe('2 раздела · 3 строки · 2 из замера · объектов: 2');
  });

  it('метка источника: Ортус, копия, из объекта', () => {
    expect(srcChip(tpl())).toEqual({
      label: 'Ортус · копия организации',
      tone: 'neutral',
      icon: 'verified',
    });
    expect(srcChip(tpl({ source: 'own', copiedFromId: 't-x' }))).toEqual({
      label: 'Свой · копия',
      tone: 'info',
      icon: 'bookmark',
    });
    expect(srcChip(tpl({ source: 'own', sourceProjectId: 'p-1' }))).toEqual({
      label: 'Свой · из объекта',
      tone: 'info',
      icon: 'bookmark',
    });
  });

  it('происхождение: стартовый, копия «…», объект «…»', () => {
    expect(tplFrom(tpl(), [], [])).toBe(
      'Стартовый шаблон Ортуса, скопирован в организацию. Правки остаются у вас и не меняют уже созданные объекты.',
    );
    const base = tpl({ id: 't-base', name: 'Косметический ремонт' });
    expect(tplFrom(tpl({ source: 'own', copiedFromId: 't-base' }), [base], [])).toBe(
      'Копия шаблона «Косметический ремонт». Правки не меняют уже созданные объекты.',
    );
    expect(
      tplFrom(
        tpl({ source: 'own', sourceProjectId: 'p-1' }),
        [],
        [{ id: 'p-1', name: 'ЖК Речной · квартира 42' }],
      ),
    ).toBe(
      'Сохранён из объекта «ЖК Речной · квартира 42». Правки не меняют уже созданные объекты.',
    );
  });

  it('правило строки: из замера или фиксированно', () => {
    const t = tpl();
    expect(ruleText(t.lines[0] as S['TemplateLine'], prices)).toEqual({
      text: 'из замера: площадь пола',
      formula: true,
    });
    expect(ruleText(t.lines[1] as S['TemplateLine'], prices)).toEqual({
      text: 'фиксированно: 30 шт',
      formula: false,
    });
    expect(ruleText(t.lines[2] as S['TemplateLine'], prices)).toEqual({
      text: 'из замера: периметр без санузлов × 1,07',
      formula: true,
    });
  });

  it('технология графика: номер, выработка, пауза и опережение', () => {
    expect(stageRows(tpl())).toEqual([
      { n: '1', name: 'Демонтаж', rate: '12/день', pause: '' },
      { n: '2', name: 'Штукатурка стен', rate: '12/день', pause: 'раньше на 3 дня' },
      { n: '3', name: 'Укладка ламината', rate: '15/день', pause: 'пауза 10 дней' },
      { n: '4', name: 'Уборка и сдача объекта', rate: '1 день', pause: '' },
    ]);
  });

  it('комплект документов: договор, акты по разделам, сдача, гарантия', () => {
    expect(documentLabels(tpl())).toEqual([
      'Договор подряда — из согласованной версии сметы',
      'Акт по разделу «Демонтаж»',
      'Акт по разделу «Электрика»',
      'Акт сдачи объекта',
      'Гарантийный паспорт · 24 месяца',
    ]);
    expect(documentLabels(tpl({ documents: ['warranty'], warrantyMonths: 12 }))).toEqual([
      'Гарантийный паспорт · 12 месяцев',
    ]);
  });

  it('материалы для снабжения: название и правило', () => {
    expect(matRows(tpl(), prices)).toEqual([
      { name: 'Ламинат 33 класс', rule: 'пол без санузлов × 1,07' },
      { name: 'Ламинат 33 класс', rule: 'фиксированно: 1 м²' },
    ]);
  });
});

describe('справочник расценок', () => {
  it('группы по разделам в порядке справочника, подписи типа, цена в рублях, число шаблонов', () => {
    const g = priceGroups(prices, '', 'all');
    expect(g.count).toBe('3 из 3');
    expect(g.groups.map((x) => x.section)).toEqual(['Демонтаж', 'Электрика', 'Материалы']);
    expect(g.groups[2]?.items[0]).toEqual({
      id: 'm-lam',
      name: 'Ламинат 33 класс',
      kind: 'Материал',
      unit: 'м²',
      price: '1350',
      used: '4',
      revision: 1,
    });
  });

  it('поиск без регистра и фильтр по типу, счётчик «N из M»', () => {
    expect(priceGroups(prices, 'лами', 'all').count).toBe('1 из 3');
    expect(priceGroups(prices, '', 'work').count).toBe('2 из 3');
    expect(priceGroups(prices, '', 'material').groups.map((x) => x.section)).toEqual(['Материалы']);
    expect(priceGroups(prices, 'нет такого', 'all').groups).toEqual([]);
  });

  it('выбор строки в шаблон: до 8 позиций, раздел шаблона первым, подпись «ед. · цена · тип»', () => {
    const list = pickList(prices, '', 'Электрика');
    expect(list[0]).toEqual({
      id: 'p-el',
      name: 'Электромонтаж, точка',
      meta: 'шт · 1 200 ₽ · работа',
    });
    expect(pickList(prices, 'лами', 'Электрика').map((x) => x.id)).toEqual(['m-lam']);
    const many = Array.from({ length: 12 }, (_, i) => item({ id: `x${i}`, name: `Позиция ${i}` }));
    expect(pickList(many, '', 'Электрика')).toHaveLength(8);
  });

  it('ошибки новой позиции дословно (:1536–1538)', () => {
    expect(newItemError('ab', '100', prices)).toBe('Укажите название позиции');
    expect(newItemError('Монтаж двери', '0', prices)).toBe('Укажите цену больше нуля');
    expect(newItemError('Монтаж двери', '', prices)).toBe('Укажите цену больше нуля');
    expect(newItemError('  ламинат 33 класс ', '100', prices)).toBe(
      'Такая позиция уже есть в справочнике',
    );
    expect(newItemError('Монтаж двери', '4 500,5', prices)).toBeNull();
  });

  it('заметка о добавленной позиции', () => {
    expect(newItemNote('Монтаж дверного блока')).toBe(
      '«Монтаж дверного блока» добавлена в справочник: её можно выбрать в сметах и шаблонах.',
    );
  });
});

describe('правка шаблона', () => {
  it('черновик и сборка строк: формула с коэффициентом или фиксированное количество', () => {
    const d = draftOf(tpl());
    expect(d.map((x) => [x.formula, x.coefIn, x.qtyIn])).toEqual([
      ['floor', '1', '1'],
      ['', '1', '30'],
      ['perimeter_dry', '1,07', '1'],
    ]);
    expect(linesOf(d)).toEqual([
      { priceItemId: 'p-dem', section: 'Демонтаж', formula: 'floor' },
      { priceItemId: 'p-el', section: 'Электрика', quantity: '30' },
      { priceItemId: 'p-el', section: 'Электрика', formula: 'perimeter_dry', coef: '1.07' },
    ]);
  });

  it('пустой или нулевой ввод: коэффициент 1, количество 1', () => {
    const [a, b] = draftOf(tpl());
    expect(
      linesOf([
        { ...(a as NonNullable<typeof a>), coefIn: '' },
        { ...(b as NonNullable<typeof b>), qtyIn: '0' },
      ]),
    ).toEqual([
      { priceItemId: 'p-dem', section: 'Демонтаж', formula: 'floor' },
      { priceItemId: 'p-el', section: 'Электрика', quantity: '1' },
    ]);
  });

  it('заметка о копии', () => {
    expect(copyNote('Капитальный ремонт квартиры')).toBe(
      'Копия «Капитальный ремонт квартиры» создана — настройте её под свой вид работ.',
    );
  });
});
