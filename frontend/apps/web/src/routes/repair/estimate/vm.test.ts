// W6.21 · Модель вкладки «Смета» (эталон design-2026-10-19 «Ремонт и стройка.dc.html» estVM :1384–1488, версии и
// сравнение :1411–1440, допработы :1456–1472, шаблоны :1390–1408). Данные — формы ответов контракта 0.12.0-stage6.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  changeOrdersView,
  compareBase,
  compareView,
  defaultSelected,
  headChip,
  nextAgreementNo,
  sectionsView,
  splitEstimates,
  versionNote,
  versionTiles,
} from './vm.ts';

type S = components['schemas'];

function nn<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('нет элемента');
  return x;
}

const m = (rub: number): S['Money'] => ({ amountMinor: Math.round(rub * 100), currency: 'RUB' });

function line(
  id: string,
  sectionId: string,
  name: string,
  price: number,
  qty: number,
  o: Partial<S['EstimateLine']> = {},
): S['EstimateLine'] {
  return {
    id,
    sectionId,
    name,
    unit: 'm2',
    kind: 'work',
    price: m(price),
    quantity: String(qty),
    sum: m(price * qty),
    manual: false,
    isNew: false,
    ...o,
  };
}

function est(
  version: number,
  state: S['Estimate']['state'],
  lines: S['EstimateLine'][],
  o: Partial<S['Estimate']> = {},
): S['Estimate'] {
  const sub = lines.reduce((a, l) => a + l.sum.amountMinor, 0);
  const disc = o.discountPct ?? 0;
  return {
    projectId: 'p1',
    version,
    kind: 'first',
    state,
    sections: [
      { id: 's-dem', name: 'Демонтаж' },
      { id: 's-el', name: 'Электрика' },
    ],
    lines,
    discountPct: disc,
    total: { amountMinor: Math.round((sub * (100 - disc)) / 100), currency: 'RUB' },
    changeOrderIds: [],
    revision: 1,
    ...o,
  };
}

const v1 = est(1, 'replaced', [line('a', 's-dem', 'Демонтаж пола', 180, 40)], {
  approvedAt: '2026-09-25T08:00:00Z',
});
const v2 = est(
  2,
  'approved',
  [line('a', 's-dem', 'Демонтаж пола', 180, 40), line('b', 's-el', 'Точка', 1200, 38)],
  { kind: 'revision', baseVersion: 1, approvedAt: '2026-09-29T08:00:00Z' },
);
const project = { status: 'active' as const, contractNo: 'договор № 42' };
const draftProject = { status: 'draft' as const };

describe('splitEstimates / nextAgreementNo / defaultSelected', () => {
  it('версии по возрастанию; открытая — черновик или отправленная; действующая — последняя согласованная', () => {
    const d = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    const s = splitEstimates([d, v2, v1]);
    expect(s.versions.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(s.open?.version).toBe(3);
    expect(s.current?.version).toBe(2);
    expect(splitEstimates([v1, v2]).open).toBeUndefined();
  });
  it('номер допсоглашения — следующий за наибольшим', () => {
    expect(nextAgreementNo([v1, v2])).toBe(1);
    expect(nextAgreementNo([v1, est(3, 'approved', [], { kind: 'change', agreementNo: 1 })])).toBe(
      2,
    );
  });
  it('открыта версия по умолчанию — открытая, иначе действующая, иначе последняя', () => {
    expect(defaultSelected([v1, v2])).toBe(2);
    expect(defaultSelected([v1, v2, est(3, 'draft', [])])).toBe(3);
    expect(defaultSelected([v1])).toBe(1);
  });
});

describe('headChip: чип состояния сметы', () => {
  it('действует (после договора) и согласована (до договора)', () => {
    expect(headChip([v1, v2], false)).toEqual({
      label: 'Версия 2 · действует',
      tone: 'ok',
      icon: 'verified',
    });
    expect(headChip([v1, v2], true).label).toBe('Версия 2 · согласована');
  });
  it('черновик, версия у заказчика, допсоглашение у заказчика', () => {
    expect(headChip([v1, v2, est(3, 'draft', [])], false)).toEqual({
      label: 'Версия 3 · черновик',
      tone: 'neutral',
      icon: 'edit_note',
    });
    expect(headChip([est(1, 'sent', [])], true)).toEqual({
      label: 'Версия 1 у заказчика',
      tone: 'warn',
      icon: 'schedule_send',
    });
    expect(
      headChip(
        [v1, v2, est(3, 'sent', [], { kind: 'change', agreementNo: 1, baseVersion: 2 })],
        false,
      ),
    ).toEqual({ label: 'Допсоглашение № 1 у заказчика', tone: 'warn', icon: 'sms' });
  });
});

describe('versionTiles: плитки версий', () => {
  it('согласованные: чип, дата, сумма, договор; заменённая — «заменена»', () => {
    const t = versionTiles([v1, v2], project, 2);
    expect(t.map((x) => x.title)).toEqual(['Версия 1', 'Версия 2']);
    expect(t[0]?.chip).toEqual({ label: 'заменена', tone: 'neutral', icon: 'history' });
    expect(t[0]?.meta).toBe('25.09 · 7 200 ₽');
    expect(t[1]?.chip.label).toBe('действует');
    expect(t[1]?.meta).toBe('29.09 · 52 800 ₽ · договор № 42');
    expect(t.map((x) => x.selected)).toEqual([false, true]);
  });
  it('до договора согласованная версия — «согласована», договора в подписи нет', () => {
    const t = versionTiles([v2], draftProject, 2);
    expect(t[0]?.chip.label).toBe('согласована');
    expect(t[0]?.meta).toBe('29.09 · 52 800 ₽');
  });
  it('допсоглашение: подпись «допсоглашение № k»', () => {
    const v3 = est(3, 'approved', [line('a', 's-dem', 'Демонтаж пола', 180, 40)], {
      kind: 'change',
      agreementNo: 1,
      baseVersion: 2,
      approvedAt: '2026-10-10T08:00:00Z',
    });
    const t = versionTiles([v1, { ...v2, state: 'replaced' }, v3], project, 3);
    expect(t[2]?.meta).toBe('10.10 · 7 200 ₽ · допсоглашение № 1');
    expect(t[1]?.chip.label).toBe('заменена');
  });
  it('открытая версия: черновик из шаблона, новая версия, допсоглашение на подписи', () => {
    const d1 = versionTiles([est(1, 'draft', [])], draftProject, 1)[0];
    expect(d1?.chip).toEqual({ label: 'черновик', tone: 'neutral', icon: 'edit_note' });
    expect(d1?.meta).toBe('из шаблона · 0 ₽');
    const rev = est(3, 'draft', [], { kind: 'revision', baseVersion: 2 });
    expect(versionTiles([v1, v2, rev], draftProject, 3)[2]?.meta).toBe('новая версия · 0 ₽');
    const chg = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    expect(versionTiles([v1, v2, chg], project, 3)[2]?.meta).toBe('допсоглашение № 1 · 0 ₽');
    const sent = est(3, 'sent', [], { kind: 'change', baseVersion: 2, agreementNo: 1 });
    const tile = versionTiles([v1, v2, sent], project, 3)[2];
    expect(tile?.chip).toEqual({ label: 'на подписи', tone: 'warn', icon: 'schedule_send' });
    const sentRev = est(3, 'sent', [], { kind: 'revision', baseVersion: 2 });
    expect(versionTiles([v1, v2, sentRev], draftProject, 3)[2]?.chip.label).toBe('у заказчика');
  });
});

describe('versionNote: пояснение под плитками', () => {
  it('черновик из шаблона', () => {
    expect(
      versionNote([est(1, 'draft', [])], draftProject, 1, {
        template: 'Капитальный ремонт квартиры',
      }),
    ).toBe(
      'Собрана по шаблону «Капитальный ремонт квартиры». Объёмы с пометкой «из замера» пересчитываются при изменении замера.',
    );
  });
  it('новая версия до договора; отправленная — с припиской про объёмы', () => {
    const rev = est(2, 'draft', [], { kind: 'revision', baseVersion: 1 });
    expect(versionNote([v1, rev], draftProject, 2, {})).toBe(
      'Новая версия до договора: после отправки заказчик согласует её в кабинете.',
    );
    const sent = est(2, 'sent', [], { kind: 'revision', baseVersion: 1 });
    expect(versionNote([v1, sent], draftProject, 2, {})).toBe(
      'Новая версия до договора: после отправки заказчик согласует её в кабинете. Объёмы зафиксированы на момент отправки.',
    );
  });
  it('черновик допсоглашения: строки версии и допработы', () => {
    const chg = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    expect(versionNote([v1, v2, chg], project, 3, { orders: ['ДР-1', 'ДР-2'] })).toBe(
      'Черновик допсоглашения: строки версии 2 и допработы ДР-1, ДР-2. Заказчик увидит изменения после отправки.',
    );
    expect(versionNote([v1, v2, chg], project, 3, {})).toBe(
      'Черновик допсоглашения: строки версии 2. Заказчик увидит изменения после отправки.',
    );
  });
  it('согласованные версии: из данных версии, без автора (в контракте его нет, Q-W6.21-3)', () => {
    expect(versionNote([v1, v2], project, 2, {})).toBe(
      'Согласована заказчиком в кабинете и стала основой договора № 42 · 29.09',
    );
    expect(versionNote([v1, v2], draftProject, 2, {})).toBe(
      'Согласована заказчиком в кабинете · 29.09',
    );
    expect(versionNote([v1, v2], project, 1, {})).toBe('Заменена версией 2 · 25.09');
    const v3 = est(3, 'approved', [], {
      kind: 'change',
      agreementNo: 1,
      baseVersion: 2,
      approvedAt: '2026-10-10T08:00:00Z',
    });
    expect(versionNote([v1, v2, v3], project, 3, {})).toBe(
      'Допсоглашение № 1 подписано заказчиком кодом из SMS · 10.10',
    );
  });
});

describe('compareBase / compareView: сравнение версий', () => {
  it('база сравнения: у открытой — baseVersion, у прочих — предыдущая', () => {
    const d = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    expect(compareBase([v1, v2, d], 3)?.version).toBe(2);
    expect(compareBase([v1, v2], 2)?.version).toBe(1);
    expect(compareBase([v1, v2], 1)).toBeUndefined();
  });

  const a = est(1, 'replaced', [
    line('a', 's-dem', 'Демонтаж пола', 180, 40),
    line('c', 's-el', 'Щиток', 9500, 1),
    line('d', 's-el', 'Розетка', 1200, 10),
  ]);
  const b = est(2, 'approved', [
    line('a', 's-dem', 'Демонтаж пола', 180, 40),
    line('d', 's-el', 'Розетка', 1200, 12),
    line('e', 's-el', 'Кабель', 28500, 1, { unit: 'set' }),
  ]);
  const diff: S['EstimateDiff'] = {
    projectId: 'p1',
    from: 1,
    to: 2,
    rows: [
      {
        change: 'same',
        name: 'Демонтаж пола',
        lineId: 'a',
        quantityA: '40',
        quantityB: '40',
        priceA: m(180),
        priceB: m(180),
        delta: { amountMinor: 0, currency: 'RUB' },
      },
      {
        change: 'removed',
        name: 'Щиток',
        lineId: 'c',
        quantityA: '1',
        priceA: m(9500),
        delta: { amountMinor: -950000, currency: 'RUB' },
      },
      {
        change: 'changed',
        name: 'Розетка',
        lineId: 'd',
        quantityA: '10',
        quantityB: '12',
        priceA: m(1200),
        priceB: m(1200),
        delta: { amountMinor: 240000, currency: 'RUB' },
      },
      {
        change: 'added',
        name: 'Кабель',
        lineId: 'e',
        quantityB: '1',
        priceB: m(28500),
        delta: { amountMinor: 2850000, currency: 'RUB' },
      },
    ],
    totalFrom: a.total,
    totalTo: b.total,
    delta: { amountMinor: b.total.amountMinor - a.total.amountMinor, currency: 'RUB' },
  };

  it('строки без изменений скрыты; порядок как в версии B, убранная — после строк своего раздела', () => {
    const v = compareView(a, b, diff, false);
    expect(v.aLabel).toBe('Версия 1');
    expect(v.bLabel).toBe('Версия 2');
    expect(v.rows.map((r) => r.name)).toEqual(['Розетка', 'Кабель', 'Щиток']);
    expect(v.sameCount).toBe(1);
    expect(v.sameLabel).toBe('Показать строки без изменений · 1');
    expect(v.noRows).toBe(false);
  });
  it('чипы, суммы строки и разница', () => {
    const [soc, cable, panel] = compareView(a, b, diff, false).rows;
    expect(soc?.chip).toEqual({ label: 'изменено: объём', tone: 'warn', icon: 'edit' });
    expect(soc?.aSum).toBe('12 000 ₽');
    expect(soc?.aCalc).toBe('10 м² × 1 200 ₽');
    expect(soc?.bSum).toBe('14 400 ₽');
    expect(soc?.d).toBe('+2 400 ₽');
    expect(soc?.dTone).toBe('ok');
    expect(soc?.section).toBe('Электрика');
    expect(panel?.chip).toEqual({ label: 'убрано', tone: 'danger', icon: 'remove' });
    expect(panel?.strike).toBe(true);
    expect(panel?.bSum).toBe('—');
    expect(panel?.d).toBe('−9 500 ₽');
    expect(panel?.dTone).toBe('danger');
    expect(cable?.chip).toEqual({ label: 'добавлено', tone: 'ok', icon: 'add' });
    expect(cable?.aSum).toBe('—');
    expect(cable?.bCalc).toBe('1 компл × 28 500 ₽');
  });
  it('«изменено: объём и цена», «изменено: цена»', () => {
    const both: S['EstimateDiff'] = {
      ...diff,
      rows: [
        { ...nn(diff.rows[2]), priceB: m(1300) },
        { ...nn(diff.rows[0]), change: 'changed', priceB: m(200) },
      ],
    };
    const rows = compareView(a, b, both, false).rows;
    expect(rows[0]?.chip.label).toBe('изменено: цена');
    expect(rows[1]?.chip.label).toBe('изменено: объём и цена');
  });
  it('показать без изменений; подпись кнопки меняется', () => {
    const v = compareView(a, b, diff, true);
    expect(v.rows.map((r) => r.name)).toEqual(['Демонтаж пола', 'Розетка', 'Кабель', 'Щиток']);
    expect(v.rows[0]?.chip).toEqual({ label: 'без изменений', tone: 'neutral', icon: 'check' });
    expect(v.sameLabel).toBe('Скрыть строки без изменений');
  });
  it('нет изменённых строк — «Строки не менялись.», нет и кнопки без одинаковых', () => {
    const same: S['EstimateDiff'] = { ...diff, rows: [nn(diff.rows[0])] };
    const v = compareView(a, b, same, false);
    expect(v.noRows).toBe(true);
    expect(v.sameCount).toBe(1);
    expect(compareView(a, b, { ...diff, rows: [] }, false).sameCount).toBe(0);
  });
  it('итого: версии A и B, разница; открытая версия B — «· черновик»', () => {
    const d = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    const v = compareView(a, d, { ...diff, to: 3, totalTo: d.total }, false);
    expect(v.bLabel).toBe('Версия 3 · черновик');
    const t = compareView(a, b, diff, false);
    expect(t.aTotal).toBe(rubOf(a));
    expect(t.bTotal).toBe(rubOf(b));
    expect(t.dTotal).toBe('+21 400 ₽');
    expect(t.dTone).toBe('ok');
  });
});

const rubOf = (e: S['Estimate']): string =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(e.total.amountMinor / 100))} ₽`;

describe('sectionsView: таблица сметы', () => {
  const lines = [
    line('a', 's-dem', 'Демонтаж пола', 180, 40.4),
    line('b', 's-el', 'Точка', 1200, 38, { formula: 'floor_dry', coef: '1.07', isNew: true }),
    line('c', 's-el', 'Щиток', 9500, 1, { formula: 'floor', manual: true }),
    line('d', 's-el', 'Вручную без формулы', 100, 2, { manual: true }),
  ];
  const e = est(2, 'draft', lines, {
    kind: 'revision',
    baseVersion: 1,
    sections: [
      { id: 's-dem', name: 'Демонтаж' },
      { id: 's-el', name: 'Электрика' },
      { id: 's-new', name: 'Двери' },
    ],
  });
  it('разделы в порядке версии, суммы раздела, пустой раздел', () => {
    const v = sectionsView(e, { editable: true });
    expect(v.map((s) => s.title)).toEqual(['Демонтаж', 'Электрика', 'Двери']);
    expect(v[0]?.sum).toBe('7 272 ₽');
    expect(v[2]?.empty).toBe(true);
    expect(v[2]?.lines).toEqual([]);
  });
  it('строка: подписи, значки «из замера», «объём вручную», «новая»', () => {
    const l = nn(sectionsView(e, { editable: true })[1]).lines;
    expect(l[0]).toMatchObject({
      name: 'Точка',
      unit: 'м²',
      qty: '38',
      qtyInput: '38',
      priceInput: '1200',
      price: '1 200 ₽',
      sum: '45 600 ₽',
      isNew: true,
      formula: 'из замера · пол без санузлов × 1,07',
      formulaTitle: 'Пересчитывается при изменении замера',
      manualBadge: false,
      canReset: false,
    });
    expect(l[1]).toMatchObject({ formula: undefined, manualBadge: true, canReset: true });
    expect(l[2]).toMatchObject({ manualBadge: false, formula: undefined, canReset: false });
  });
  it('«новая» только в версиях после первой; без правки «вернуть из замера» нет', () => {
    const first = { ...e, kind: 'first' as const };
    expect(nn(sectionsView(first, { editable: true })[1]).lines[0]?.isNew).toBe(false);
    expect(nn(sectionsView(e, { editable: false })[1]).lines[1]?.canReset).toBe(false);
    expect(
      nn(sectionsView({ ...e, state: 'approved' }, { editable: false })[1]).lines[0]?.isNew,
    ).toBe(false);
  });
  it('объём 40,4 — одна цифра после запятой', () => {
    expect(nn(sectionsView(e, { editable: true })[0]).lines[0]?.qty).toBe('40,4');
  });
  it('зафиксированная версия: подсказка «Объём зафиксирован в версии»', () => {
    const sent = { ...e, state: 'sent' as const };
    expect(nn(sectionsView(sent, { editable: false })[1]).lines[0]?.formulaTitle).toBe(
      'Объём зафиксирован в версии',
    );
  });
});

describe('changeOrdersView: допработы от прораба', () => {
  const order = (
    n: number,
    status: S['ChangeOrder']['status'],
    o: Partial<S['ChangeOrder']> = {},
  ): S['ChangeOrder'] => ({
    id: `co${n}`,
    projectId: 'p1',
    number: `ДР-${n}`,
    title: n === 1 ? 'Перенос розетки' : 'Штробление',
    quantity: '6',
    unit: 'piece',
    note: n === 1 ? 'Кухня, у окна' : '',
    photoFileIds: ['f1', 'f2', 'f3', 'f4'],
    status,
    createdAt: '2026-10-18T08:00:00Z',
    revision: 1,
    ...o,
  });
  const base = { canEdit: true, list: [v1, v2], selected: 2, projectDraft: false };

  it('нет допработ до договора — блока нет', () => {
    expect(changeOrdersView([order(1, 'proposed')], { ...base, projectDraft: true }).visible).toBe(
      false,
    );
    expect(changeOrdersView([], base).visible).toBe(false);
  });
  it('ждёт оценки: чип, подпись, фото (до трёх), можно оценить и отклонить', () => {
    const v = changeOrdersView([order(1, 'proposed')], base);
    expect(v.visible).toBe(true);
    const c = nn(v.items[0]);
    expect(c.number).toBe('ДР-1');
    expect(c.chip).toEqual({ label: 'Ждёт оценки офиса', tone: 'warn', icon: 'pending' });
    expect(c.meta).toBe('18.10 · 6 шт · фото: 4');
    expect(c.note).toBe('Кухня, у окна');
    expect(c.photos).toEqual([
      'Фото 1 к допработе ДР-1',
      'Фото 2 к допработе ДР-1',
      'Фото 3 к допработе ДР-1',
    ]);
    expect(c.canPrice).toBe(true);
    expect(c.canReject).toBe(true);
    expect(c.canOpen).toBe(false);
    expect(c.hint).toBeUndefined();
    expect(v.noActive).toBe(false);
  });
  it('без права правки кнопок нет', () => {
    const c = nn(changeOrdersView([order(1, 'proposed')], { ...base, canEdit: false }).items[0]);
    expect(c.canPrice).toBe(false);
    expect(c.canReject).toBe(false);
  });
  it('допсоглашение у заказчика: подсказка, оценить нельзя', () => {
    const sent = est(3, 'sent', [], { kind: 'change', baseVersion: 2, agreementNo: 1 });
    const c = nn(
      changeOrdersView([order(1, 'proposed')], { ...base, list: [v1, v2, sent] }).items[0],
    );
    expect(c.canPrice).toBe(false);
    expect(c.hint).toBe('Оценить можно после подписи или отзыва отправленного допсоглашения.');
  });
  it('открыт черновик без допработы — оценить в нём нельзя (Q-W6.21-2)', () => {
    const d = est(3, 'draft', [], { kind: 'change', baseVersion: 2 });
    const c = nn(changeOrdersView([order(1, 'proposed')], { ...base, list: [v1, v2, d] }).items[0]);
    expect(c.canPrice).toBe(false);
    expect(c.hint).toBe(
      'Допработу можно оценить в новом черновике: отправьте или удалите текущий.',
    );
  });
  it('в черновике версии N: чип, «Открыть черновик», отклонить нельзя', () => {
    const d = est(3, 'draft', [], { kind: 'change', baseVersion: 2, changeOrderIds: ['co1'] });
    const c = nn(changeOrdersView([order(1, 'priced')], { ...base, list: [v1, v2, d] }).items[0]);
    expect(c.chip).toEqual({ label: 'В черновике версии 3', tone: 'info', icon: 'edit_note' });
    expect(c.canOpen).toBe(true);
    expect(c.canReject).toBe(false);
    expect(c.canPrice).toBe(false);
    const open = nn(
      changeOrdersView([order(1, 'priced')], { ...base, list: [v1, v2, d], selected: 3 }).items[0],
    );
    expect(open.canOpen).toBe(false);
  });
  it('в допсоглашении у заказчика', () => {
    const sent = est(3, 'sent', [], {
      kind: 'change',
      baseVersion: 2,
      agreementNo: 1,
      changeOrderIds: ['co1'],
    });
    const c = nn(changeOrdersView([order(1, 'sent')], { ...base, list: [v1, v2, sent] }).items[0]);
    expect(c.chip).toEqual({ label: 'В допсоглашении · у заказчика', tone: 'warn', icon: 'sms' });
  });
  it('закрытые — строкой внизу; активных нет — «Новых допработ нет.»', () => {
    const v = changeOrdersView(
      [
        order(1, 'signed', { agreementNo: 1 }),
        order(2, 'rejected', { rejectReason: 'client_refused' }),
      ],
      base,
    );
    expect(v.items).toEqual([]);
    expect(v.noActive).toBe(true);
    expect(v.done).toBe(
      'ДР-1 «Перенос розетки»: подписана в допсоглашении № 1 · ДР-2 «Штробление»: отклонена — заказчик отказался',
    );
  });
  it('подписана без допсоглашения', () => {
    expect(changeOrdersView([order(1, 'signed')], base).done).toBe(
      'ДР-1 «Перенос розетки»: подписана',
    );
  });
});
