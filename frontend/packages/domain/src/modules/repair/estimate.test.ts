// Замер, смета, версии и допработы (design/Ремонт и стройка.dc.html:845–912, 1313–1488).
// Контрольные числа — раздел 2.6 разбора DoR (прогон логики макета на стартовом состоянии).
import { describe, expect, it } from 'vitest';
import {
  addPriceItem,
  approveDraft,
  compareVersions,
  copyTemplate,
  createDraftFromTemplate,
  currentVersion,
  dropDraft,
  effectiveChangeStatus,
  fval,
  lineFrom,
  lineQty,
  measOf,
  parseNumber,
  readinessByActs,
  recallDraft,
  rq,
  sendDraft,
  startChange,
  templateStats,
  totals,
  FORMULAS,
  type EstimateLine,
  type ObjectEstimate,
} from './estimate.ts';
import { CATALOG, ESTIMATE_42, ROOMS, TEMPLATES } from './estimate-seed.ts';
import type { ChangeOrder } from './types.ts';

const m42 = measOf(ROOMS['obj-42']);
const m50 = measOf(ROOMS['obj-50']);
/** Суммы форматируются с неразрывными пробелами: в проверках — обычные. */
const ws = (s: string | null): string =>
  (s ?? '').replace(new RegExp('[\\u00a0\\u202f]', 'g'), ' ');
const tpl = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};
const est42 = (): ObjectEstimate => ESTIMATE_42();
const dr1 = (): ChangeOrder => ({
  id: 'ДР-1',
  obj: 'obj-42',
  at: '02.10',
  by: 'Алексей Соколов',
  title: 'Перенос розеток на кухне',
  volume: 6,
  unit: 'шт',
  note: '',
  photos: 2,
  status: 'proposed',
  suggest: [
    ['p-el-move', 6],
    ['p-chase', 9],
  ],
});

describe('замер', () => {
  it('кв. 42: пол 46,82 м², стены 134,24 м², периметр 53,2 м; санузел 3,74 / 19,66', () => {
    expect(m42.F).toBeCloseTo(46.82, 6);
    expect(m42.W).toBeCloseTo(134.24, 6);
    expect(m42.P).toBeCloseTo(53.2, 6);
    expect(m42.bf).toBeCloseTo(3.74, 6);
    expect(m42.bw).toBeCloseTo(19.66, 6);
    expect(m42.bp).toBeCloseTo(7.8, 6);
  });

  it('формулы: пол без санузлов, стены без санузлов, санузлы, периметр без санузлов', () => {
    expect(fval('floorDry', m42)).toBeCloseTo(43.08, 6);
    expect(fval('wallsDry', m42)).toBeCloseTo(114.58, 6);
    expect(fval('bath', m42)).toBeCloseTo(23.4, 6);
    expect(fval('perimDry', m42)).toBeCloseTo(45.4, 6);
    expect(fval('floor', m42)).toBeCloseTo(46.82, 6);
    expect(fval('unknown' as never, m42)).toBe(0);
    expect(Object.keys(FORMULAS)).toEqual([
      'floor',
      'floorDry',
      'walls',
      'wallsDry',
      'bath',
      'perim',
      'perimDry',
    ]);
  });

  it('нечисловые и пустые поля — ноль; проёмы больше стен не дают минус; «Санузел 2» — тоже санузел', () => {
    const m = measOf([
      { name: 'Комната', l: '', w: 'x', h: '2.7', o: '' },
      { name: 'Кладовая', l: '1', w: '1', h: '1', o: '99' },
      { name: 'Санузел 2', l: '2', w: '2', h: '2', o: '0' },
    ]);
    expect(m.F).toBe(5);
    expect(m.W).toBe(16);
    expect(m.bf).toBe(4);
    expect(measOf(undefined)).toEqual({ F: 0, W: 0, P: 0, bf: 0, bw: 0, bp: 0 });
  });

  it('дом в Истре: 8 помещений, два санузла', () => {
    expect(ROOMS['obj-50']).toHaveLength(8);
    expect(m50.bf).toBeCloseTo(2.8 * 2 + 2.2 * 1.8, 6);
  });

  it('округление объёма: штуки, мешки, рейсы, комплекты и литры — вверх; остальное — до 0,1', () => {
    expect(rq(1.2345, 'м²')).toBe(1.2);
    expect(rq(1.25, 'м')).toBe(1.3);
    expect(rq(2.0000000001, 'шт')).toBe(2);
    expect(rq(2.1, 'шт')).toBe(3);
    expect(rq(0.2, 'л')).toBe(1);
    expect(rq(4.01, 'меш')).toBe(5);
    expect(rq(3.2, 'рейс')).toBe(4);
    expect(rq(1.01, 'компл')).toBe(2);
  });

  it('parseNumber: пробелы, запятая, мусор', () => {
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('')).toBe(0);
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber('abc')).toBe(0);
    expect(parseNumber(7)).toBe(7);
  });
});

describe('справочник и шаблоны', () => {
  it('23 позиции расценок в 6 разделах, цены по эталону', () => {
    expect(CATALOG).toHaveLength(23);
    const by = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
    expect(by['p-el-move']).toMatchObject({
      name: 'Перенос розетки или выключателя',
      unit: 'шт',
      price: 1500,
    });
    expect(by['m-cable']).toMatchObject({ unit: 'компл', kind: 'material', price: 28500 });
    expect([...new Set(CATALOG.map((c) => c.cat))]).toEqual([
      'Демонтаж',
      'Электрика',
      'Стены',
      'Полы',
      'Сантехника',
      'Материалы',
    ]);
  });

  it('четыре шаблона: капитальный, косметический, дом, коммерческое помещение', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['tpl-cap', 'tpl-cosm', 'tpl-house', 'tpl-comm']);
    expect(TEMPLATES.map((t) => t.lines.length)).toEqual([14, 6, 16, 10]);
    expect(TEMPLATES.map((t) => [t.src, t.used])).toEqual([
      ['ortus', 2],
      ['ortus', 1],
      ['own', 1],
      ['ortus', 1],
    ]);
  });

  it('шаблон «Ремонт под ключ · дом» сохранён из объекта; технология и документы продолжают капитальный', () => {
    const t = tpl('tpl-house');
    expect(t.from).toBe('Дом на Лесной · Мытищи');
    expect(t.tech).toHaveLength(10);
    expect(t.tech[7]).toEqual(['Сантехника · чистовая', '3 прибора/день', 'после плитки']);
    expect(t.docs).toHaveLength(8);
  });

  it('сводка шаблона: разделы, строки, строки из замера', () => {
    expect(templateStats(tpl('tpl-cap'))).toEqual({ sections: 5, lines: 14, fromMeasure: 10 });
    expect(templateStats(tpl('tpl-cosm'))).toEqual({ sections: 4, lines: 6, fromMeasure: 5 });
  });

  it('копия шаблона: «· копия», свой, без «из объекта», счётчик объектов с нуля', () => {
    const c = copyTemplate(tpl('tpl-cap'), 'tpl-x', '20.10');
    expect(c).toMatchObject({
      id: 'tpl-x',
      name: 'Капитальный ремонт квартиры · копия',
      src: 'own',
      from: null,
      copyOf: 'Капитальный ремонт квартиры',
      upd: '20.10',
      used: 0,
    });
    expect(c.lines).toEqual(tpl('tpl-cap').lines);
    expect(c.lines).not.toBe(tpl('tpl-cap').lines);
  });

  it('новая позиция справочника: тексты ошибок дословно, дубль без учёта регистра', () => {
    const base = {
      name: 'Грунтовка стен',
      unit: 'м²',
      kind: 'work' as const,
      cat: 'Стены',
      price: '120',
    };
    expect(addPriceItem(CATALOG, { ...base, name: ' ab ' }, 'c-1')).toEqual({
      error: 'Укажите название позиции',
    });
    expect(addPriceItem(CATALOG, { ...base, price: '0' }, 'c-1')).toEqual({
      error: 'Укажите цену больше нуля',
    });
    expect(addPriceItem(CATALOG, { ...base, price: '' }, 'c-1')).toEqual({
      error: 'Укажите цену больше нуля',
    });
    expect(addPriceItem(CATALOG, { ...base, name: 'штукатурка по маякам' }, 'c-1')).toEqual({
      error: 'Такая позиция уже есть в справочнике',
    });
    expect(addPriceItem(CATALOG, base, 'c-1')).toEqual({
      item: {
        id: 'c-1',
        cat: 'Стены',
        name: 'Грунтовка стен',
        unit: 'м²',
        kind: 'work',
        price: 120,
      },
    });
  });
});

describe('строка и суммы сметы', () => {
  it('строка из шаблона: объём из замера × коэффициент, округление по единице', () => {
    const l = lineFrom(
      CATALOG,
      { sec: 'Материалы', item: 'm-laminate', f: 'floorDry', k: 1.07, q: 1 },
      m42,
      'x',
    );
    expect(l).toMatchObject({
      name: 'Ламинат 33 класс',
      unit: 'м²',
      price: 1350,
      qty: 46.1,
      f: 'floorDry',
      k: 1.07,
      man: false,
    });
    const f = lineFrom(
      CATALOG,
      { sec: 'Электрика', item: 'p-el-point', f: null, k: 1, q: 30 },
      m42,
      'y',
    );
    expect(f.qty).toBe(30);
    const roundUp = lineFrom(
      CATALOG,
      { sec: 'Материалы', item: 'm-plaster', f: 'wallsDry', k: 0.4, q: 1 },
      m42,
      'z',
    );
    expect(roundUp).toMatchObject({ unit: 'меш', qty: 46 });
  });

  it('позиции нет в справочнике: «шт», цена 0, работа', () => {
    expect(
      lineFrom(CATALOG, { sec: 'Прочее', item: 'p-none', f: null, k: 1, q: 2 }, m42, 'n'),
    ).toMatchObject({
      name: 'p-none',
      unit: 'шт',
      kind: 'work',
      price: 0,
      qty: 2,
    });
  });

  it('объём строки: пересчёт из замера только у «живой» строки без ручной правки и без базы', () => {
    const l: EstimateLine = lineFrom(
      CATALOG,
      { sec: 'Полы', item: 'p-screed', f: 'floor', k: 1, q: 1 },
      m42,
      'a',
    );
    const m2 = measOf([{ name: 'Зал', l: '10', w: '10', h: '3', o: '0' }]);
    expect(lineQty(l, m2, true)).toBe(100);
    expect(lineQty(l, m2, false)).toBe(l.qty);
    expect(lineQty({ ...l, man: true }, m2, true)).toBe(l.qty);
    expect(lineQty({ ...l, base: true }, m2, true)).toBe(l.qty);
    expect(lineQty({ ...l, f: null }, m2, true)).toBe(l.qty);
  });

  it('суммы: подытог, скидка в процентах, итог', () => {
    const lines = [
      { ...lineFrom(CATALOG, { sec: 'Демонтаж', item: 'p-trash', f: null, k: 1, q: 2 }, m42, 'a') },
      {
        ...lineFrom(CATALOG, { sec: 'Электрика', item: 'p-shield', f: null, k: 1, q: 1 }, m42, 'b'),
      },
    ];
    expect(totals(lines, 0)).toEqual({ sub: 22_500, d: 0, tot: 22_500 });
    expect(totals(lines, 10)).toEqual({ sub: 22_500, d: 2_250, tot: 20_250 });
    expect(totals([], 5)).toEqual({ sub: 0, d: 0, tot: 0 });
  });
});

describe('смета кв. 42: контрольные суммы', () => {
  it('версия 1 — 404 418 ₽ (заменена), версия 2 — 438 175 ₽ (договор № 42)', () => {
    const e = est42();
    expect(e.vers.map((v) => [v.n, v.st, v.at, v.contract ?? null])).toEqual([
      [1, 'replaced', '25.09', null],
      [2, 'approved', '29.09', 42],
    ]);
    expect(totals(e.vers[0]?.lines ?? [], 0).tot).toBe(404_418);
    expect(totals(e.vers[1]?.lines ?? [], 0).tot).toBe(438_175);
    expect(currentVersion(e)?.n).toBe(2);
  });

  it('финансы от версии 2: аванс 30 % — 131 453 ₽, маржа 27 % — 118 307 ₽', () => {
    const t = totals(currentVersion(est42())?.lines ?? [], 0).tot;
    expect(Math.round(t * 0.3)).toBe(131_453);
    expect(Math.round(t * 0.27)).toBe(118_307);
  });

  it('шаблоны на замере дома в Истре (по умолчанию «под ключ · дом»): 1 078 533 ₽', () => {
    const sum = (id: string) =>
      totals(
        tpl(id).lines.map((t, i) => lineFrom(CATALOG, t, m50, 'p' + i)),
        0,
      ).tot;
    expect(sum('tpl-house')).toBe(1_078_533);
    expect(sum('tpl-cap')).toBe(857_713);
    expect(sum('tpl-cosm')).toBe(308_600);
    expect(sum('tpl-comm')).toBe(830_345);
  });

  it('готовность для заказчика — по подписанным актам разделов (Q-W4.00-repair-4)', () => {
    const lines = currentVersion(est42())?.lines ?? [];
    expect(readinessByActs(lines, 0, [])).toBe(0);
    expect(readinessByActs(lines, 0, ['Демонтаж'])).toBe(5);
    expect(readinessByActs(lines, 0, ['Демонтаж', 'Электрика', 'Стены', 'Полы', 'Материалы'])).toBe(
      100,
    );
    expect(readinessByActs([], 0, ['Демонтаж'])).toBe(0);
  });
});

describe('сравнение версий', () => {
  it('v1 → v2: добавлены щиток и ламинат 33, убран ламинат 32, изменены точки 32 → 38; +33 757 ₽', () => {
    const e = est42();
    const [v1, v2] = e.vers;
    if (!v1 || !v2) throw new Error('нет версий');
    const c = compareVersions(v1.lines, v1.disc, v2.lines, v2.disc, m42, false);
    const by = (k: string) => c.rows.filter((r) => r.kind === k).map((r) => r.line.name);
    expect(by('add')).toEqual(['Сборка щитка', 'Ламинат 33 класс']);
    expect(by('del')).toEqual(['Ламинат 32 класс']);
    expect(by('chg')).toEqual(['Электромонтаж, точка']);
    expect(c.rows.filter((r) => r.kind === 'same')).toHaveLength(11);
    expect(c.rows.find((r) => r.kind === 'chg')).toMatchObject({
      qtyChanged: true,
      priceChanged: false,
    });
    expect(c.aTotal).toBe(404_418);
    expect(c.bTotal).toBe(438_175);
    expect(c.delta).toBe(33_757);
  });

  it('убранная строка стоит после последней строки своего раздела', () => {
    const e = est42();
    const [v1, v2] = e.vers;
    if (!v1 || !v2) throw new Error('нет версий');
    const c = compareVersions(v1.lines, 0, v2.lines, 0, m42, false);
    const i = c.rows.findIndex((r) => r.kind === 'del');
    expect(c.rows[i - 1]?.line.sec).toBe('Материалы');
    expect(c.rows[i]?.line.sec).toBe('Материалы');
  });

  it('суммы строк: до и после, разница; убранная — «после» 0', () => {
    const e = est42();
    const [v1, v2] = e.vers;
    if (!v1 || !v2) throw new Error('нет версий');
    const c = compareVersions(v1.lines, 0, v2.lines, 0, m42, false);
    const del = c.rows.find((r) => r.kind === 'del');
    expect(del).toMatchObject({ sumA: 46.1 * 980, sumB: 0 });
    const chg = c.rows.find((r) => r.kind === 'chg');
    expect((chg?.sumB ?? 0) - (chg?.sumA ?? 0)).toBe(6 * 1200);
  });

  it('смена цены строки — «изменено: цена»', () => {
    const base = lineFrom(
      CATALOG,
      { sec: 'Полы', item: 'p-screed', f: null, k: 1, q: 10 },
      m42,
      'a',
    );
    const c = compareVersions([base], 0, [{ ...base, price: 800 }], 0, m42, false);
    expect(c.rows[0]).toMatchObject({ kind: 'chg', qtyChanged: false, priceChanged: true });
  });
});

describe('допработы: состояние в смете', () => {
  it('допработа в черновике: «priced», у заказчика: «sent»; без черновика — как в учёте', () => {
    const c = dr1();
    expect(effectiveChangeStatus(c, null)).toBe('proposed');
    const { estimate } = startChange(est42(), dr1(), CATALOG, { isDraftObject: false });
    expect(effectiveChangeStatus(c, estimate.draft)).toBe('priced');
    const sent = sendDraft(estimate, m42);
    expect(effectiveChangeStatus(c, sent.estimate.draft)).toBe('sent');
    expect(effectiveChangeStatus({ ...c, status: 'signed' }, null)).toBe('signed');
    expect(effectiveChangeStatus({ ...c, status: 'rejected' }, null)).toBe('rejected');
    expect(effectiveChangeStatus({ ...c, status: 'sent' }, null)).toBe('proposed');
  });
});

describe('жизненный цикл сметы', () => {
  it('черновик по шаблону: строки n1…, «first», до 1 078 533 ₽, объёмы из замера', () => {
    const e = createDraftFromTemplate(tpl('tpl-house'), CATALOG, m50);
    expect(e.tpl).toBe('tpl-house');
    expect(e.vers).toEqual([]);
    expect(e.draft).toMatchObject({
      n: 1,
      kind: 'first',
      st: 'draft',
      base: null,
      disc: 0,
      secs: [],
      co: [],
    });
    expect(e.draft?.lines[0]?.id).toBe('n1');
    expect(e.draft?.lines).toHaveLength(16);
    expect(totals(e.draft?.lines ?? [], 0).tot).toBe(1_078_533);
  });

  it('допсоглашение по ДР-1: версия 3 «change» от действующей, +9 000 ₽ и +4 050 ₽ строками допработы', () => {
    const r = startChange(est42(), dr1(), CATALOG, { isDraftObject: false });
    const d = r.estimate.draft;
    expect(d).toMatchObject({
      n: 3,
      kind: 'change',
      st: 'draft',
      base: 2,
      disc: 0,
      secs: [],
      co: ['ДР-1'],
    });
    expect(d?.lines).toHaveLength(14 + 2);
    expect(d?.lines.slice(0, 14).every((l) => l.base === true && l.qty0 === l.qty)).toBe(true);
    const extra = d?.lines.slice(14) ?? [];
    expect(extra.map((l) => [l.id, l.sec, l.name, l.qty, l.price])).toEqual([
      ['ДР-1-0', 'Допработы · ДР-1', 'Перенос розетки или выключателя', 6, 1500],
      ['ДР-1-1', 'Допработы · ДР-1', 'Штробление бетона', 9, 450],
    ]);
    expect(totals(d?.lines ?? [], 0).tot - 438_175).toBe(13_050);
    expect(r.effects).toEqual([{ ids: ['ДР-1'], status: 'priced', extra: {} }]);
    expect(r.note).toBe(
      'ДР-1 «Перенос розеток на кухне» в черновике версии 3: строки подставлены по описанию прораба. Проверьте объёмы и цены, затем отправьте допсоглашение заказчику.',
    );
  });

  it('до договора новая версия — «revision»; допработа без подсказки открывает пустой раздел', () => {
    const r = startChange(est42(), { ...dr1(), suggest: [] }, CATALOG, { isDraftObject: true });
    expect(r.estimate.draft).toMatchObject({ kind: 'revision', secs: ['Допработы · ДР-1'] });
    expect(r.pick).toBe('Допработы · ДР-1');
    expect(r.note).toContain('добавьте строки из справочника');
    const plain = startChange(est42(), null, CATALOG, { isDraftObject: false });
    expect(plain.estimate.draft).toMatchObject({ n: 3, kind: 'change', secs: [], co: [] });
    expect(plain.effects).toEqual([]);
    expect(plain.note).toBeNull();
  });

  it('уже есть черновик: допработа добавляется в него, версия не растёт', () => {
    const a = startChange(est42(), null, CATALOG, { isDraftObject: false });
    const b = startChange(a.estimate, dr1(), CATALOG, { isDraftObject: false });
    expect(b.estimate.draft?.n).toBe(3);
    expect(b.estimate.draft?.co).toEqual(['ДР-1']);
    expect(b.estimate.draft?.lines).toHaveLength(16);
  });

  it('отправка допсоглашения: объёмы фиксируются, допработа — «sent» с номером 1, документ допсоглашения', () => {
    const { estimate } = startChange(est42(), dr1(), CATALOG, { isDraftObject: false });
    const r = sendDraft(estimate, m42);
    expect(r.estimate.draft?.st).toBe('sent');
    expect(r.effects).toEqual([{ ids: ['ДР-1'], status: 'sent', extra: { agreement: 1 } }]);
    expect(r.agreement).toBe(1);
    expect(r.delta).toBe(13_050);
    expect(ws(r.note)).toBe(
      'Допсоглашение № 1 отправлено в кабинет заказчика: +13 050 ₽ к договору. Подпись — кодом из SMS.',
    );
  });

  it('отправка первой версии: без допсоглашения, текст про согласование в кабинете', () => {
    const e = createDraftFromTemplate(tpl('tpl-cosm'), CATALOG, m50);
    const r = sendDraft(e, m50);
    expect(r.agreement).toBeNull();
    expect(r.effects).toEqual([]);
    expect(r.note).toBe('Версия 1 отправлена в кабинет заказчика на согласование.');
  });

  it('отзыв отправки: черновик снова правится, допработа возвращается в «priced»', () => {
    const sent = sendDraft(
      startChange(est42(), dr1(), CATALOG, { isDraftObject: false }).estimate,
      m42,
    );
    const r = recallDraft(sent.estimate);
    expect(r.estimate.draft?.st).toBe('draft');
    expect(r.effects).toEqual([{ ids: ['ДР-1'], status: 'priced', extra: {} }]);
    expect(r.note).toBe(
      'Отправка отозвана: заказчик больше не видит эту версию. Черновик снова можно править.',
    );
  });

  it('подпись заказчика: версия 3 действует, 451 225 ₽, допработа — «signed» (допсоглашение № 1)', () => {
    const sent = sendDraft(
      startChange(est42(), dr1(), CATALOG, { isDraftObject: false }).estimate,
      m42,
    );
    const r = approveDraft(sent.estimate, m42, { at: '20.10', by: 'Дарья Зимина' });
    expect(r.estimate.draft).toBeNull();
    expect(r.estimate.agr).toBe(1);
    expect(r.estimate.vers.map((v) => [v.n, v.st])).toEqual([
      [1, 'replaced'],
      [2, 'replaced'],
      [3, 'approved'],
    ]);
    expect(r.estimate.vers[2]).toMatchObject({
      kind: 'change',
      agr: 1,
      at: '20.10',
      note: 'Допсоглашение № 1 подписано заказчиком кодом из SMS. Допработы: ДР-1',
    });
    expect(totals(r.estimate.vers[2]?.lines ?? [], 0).tot).toBe(451_225);
    expect(r.effects).toEqual([
      { ids: ['ДР-1'], status: 'signed', extra: { agreement: 1, ver: 3 } },
    ]);
    expect(ws(r.note)).toBe(
      'Допсоглашение № 1 подписано. Действует версия 3: 451 225 ₽ (+13 050 ₽). Работы добавлены прорабу во вкладку «Работы».',
    );
    expect(
      r.estimate.vers[2]?.lines.every((l) => l.base === undefined && l.qty0 === undefined),
    ).toBe(true);
  });

  it('согласование первой версии: без допсоглашения, следующий шаг — договор', () => {
    const e = createDraftFromTemplate(tpl('tpl-house'), CATALOG, m50);
    const r = approveDraft(sendDraft(e, m50).estimate, m50, { at: '20.10', by: 'Дарья Зимина' });
    expect(r.estimate.vers).toHaveLength(1);
    expect(r.estimate.agr).toBe(0);
    expect(r.estimate.vers[0]).toMatchObject({
      st: 'approved',
      note: 'Согласована заказчиком в кабинете',
    });
    expect(r.effects).toEqual([]);
    expect(ws(r.note)).toBe(
      'Смета согласована заказчиком: 1 078 533 ₽. Следующий шаг — договор на этапе заявки «Договор».',
    );
  });

  it('удаление черновика: допработа снова ждёт оценки; у сметы без версий — смета исчезает', () => {
    const started = startChange(est42(), dr1(), CATALOG, { isDraftObject: false }).estimate;
    const r = dropDraft(started);
    expect(r.estimate?.draft).toBeNull();
    expect(r.estimate?.vers).toHaveLength(2);
    expect(r.effects).toEqual([{ ids: ['ДР-1'], status: 'proposed', extra: {} }]);
    expect(r.note).toBe('Черновик удалён. ДР-1 снова ждёт оценки.');
    const first = dropDraft(createDraftFromTemplate(tpl('tpl-cosm'), CATALOG, m50));
    expect(first.estimate).toBeNull();
    expect(first.note).toBe('Черновик удалён.');
  });

  it('операции без черновика — ошибка', () => {
    expect(() => sendDraft(est42(), m42)).toThrow(/черновик/i);
    expect(() => approveDraft(est42(), m42, { at: '1', by: 'x' })).toThrow(/черновик/i);
    expect(() => recallDraft(est42())).toThrow(/черновик/i);
    expect(() => dropDraft(est42())).toThrow(/черновик/i);
  });

  it('смета без согласованной версии: изменение невозможно', () => {
    const e = createDraftFromTemplate(tpl('tpl-cosm'), CATALOG, m50);
    const none: ObjectEstimate = { ...e, draft: null };
    expect(currentVersion(none)).toBeNull();
    expect(() => startChange(none, null, CATALOG, { isDraftObject: true })).toThrow(/согласованн/i);
  });
});
