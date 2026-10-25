// Расчёты «Ремонта и стройки» сценарного сервера (W6.00, контракт 0.12.0-stage6): замер, объёмы по формулам шаблона,
// версии и итоги сметы, график по рабочему календарю. Контрольные числа — прогон логики макета «Ремонт и стройка.dc.html»
// (design-2026-10-19) на стартовом состоянии, разбор docs/plan/v2/analysis/dor/repair.md §2.6.
import { describe, expect, it } from 'vitest';

import {
  CAT0,
  e42Versions,
  GST0,
  GLK0,
  ROOMS0,
  TPL0,
  type TemplateSeed,
} from '../src/msw/repairs/data.ts';
import {
  buildLines,
  dayIso,
  estimateTotals,
  fmtQty,
  fval,
  isoDay,
  measOf,
  rq,
  scheduleOf,
  wdIn,
} from '../src/msw/repairs/calc.ts';

const rub = (minor: number) => Math.round(minor / 100);
const tpl = (id: string): TemplateSeed => TPL0.find((t) => t.id === id) as TemplateSeed;

describe('замер', () => {
  it('кв. 42: пол 46,82 м², стены 134,24 м², периметр 53,2 м; санузел — пол 3,74 и стены 19,66', () => {
    const m = measOf(ROOMS0['obj-42'] ?? []);
    expect(m.F).toBeCloseTo(46.82, 2);
    expect(m.W).toBeCloseTo(134.24, 2);
    expect(m.P).toBeCloseTo(53.2, 2);
    expect(m.bf).toBeCloseTo(3.74, 2);
    expect(m.bw).toBeCloseTo(19.66, 2);
  });

  it('формулы объёма: семь, «санузлы» — пол и стены вместе; штуки, мешки, рейсы, комплекты и литры — вверх', () => {
    const m = measOf(ROOMS0['obj-42'] ?? []);
    expect(fval('floor', m)).toBeCloseTo(46.82, 2);
    expect(fval('floor_dry', m)).toBeCloseTo(43.08, 2);
    expect(fval('walls', m)).toBeCloseTo(134.24, 2);
    expect(fval('walls_dry', m)).toBeCloseTo(114.58, 2);
    expect(fval('wet', m)).toBeCloseTo(23.4, 2);
    expect(fval('perimeter', m)).toBeCloseTo(53.2, 2);
    expect(fval('perimeter_dry', m)).toBeCloseTo(45.4, 2); // 53,2 − периметр санузла 7,8
    expect(rq(10.01, 'mesh')).toBe(11);
    expect(rq(10.04, 'm2')).toBe(10);
    expect(rq(12.34, 'm2')).toBe(12.3);
    expect(fmtQty(12)).toBe('12');
    expect(fmtQty(12.5)).toBe('12.5');
  });
});

describe('смета', () => {
  it('кв. 42: версия 1 — 404 418 ₽, версия 2 (действует, основа договора № 42) — 438 175 ₽', () => {
    const m = measOf(ROOMS0['obj-42'] ?? []);
    const { v1, v2 } = e42Versions();
    expect(rub(estimateTotals(buildLines(CAT0, v1, m), 0).total)).toBe(404418);
    expect(rub(estimateTotals(buildLines(CAT0, v2, m), 0).total)).toBe(438175);
  });

  it('финансы от версии 2: аванс 30 % — 131 453 ₽, маржа 27 % — 118 307 ₽', () => {
    const m = measOf(ROOMS0['obj-42'] ?? []);
    const total = rub(estimateTotals(buildLines(CAT0, e42Versions().v2, m), 0).total);
    expect(Math.round(total * 0.3)).toBe(131453);
    expect(Math.round(total * 0.27)).toBe(118307);
  });

  it('допработа ДР-1: перенос розетки 6 × 1 500 + штробление 9 × 450 = +13 050 ₽', () => {
    const lines = buildLines(
      CAT0,
      [
        { section: 'Допработы · ДР-1', item: 'p-el-move', formula: null, coef: 1, quantity: 6 },
        { section: 'Допработы · ДР-1', item: 'p-chase', formula: null, coef: 1, quantity: 9 },
      ],
      measOf([]),
    );
    expect(rub(estimateTotals(lines, 0).total)).toBe(13050);
  });

  it('черновик дома в Истре по шаблонам: «под ключ · дом» 1 078 533 ₽, капитальный 857 713, косметический 308 600, коммерческий 830 345', () => {
    const m = measOf(ROOMS0['obj-50'] ?? []);
    const total = (id: string) => rub(estimateTotals(buildLines(CAT0, tpl(id).lines, m), 0).total);
    expect(total('tpl-house')).toBe(1078533);
    expect(total('tpl-cap')).toBe(857713);
    expect(total('tpl-cosm')).toBe(308600);
    expect(total('tpl-comm')).toBe(830345);
  });

  it('скидка в процентах вычитается из суммы; разница версий считается по итогам', () => {
    const m = measOf(ROOMS0['obj-42'] ?? []);
    const lines = buildLines(CAT0, e42Versions().v2, m);
    const a = estimateTotals(lines, 0);
    const b = estimateTotals(lines, 10);
    expect(b.discount).toBe(Math.round(a.sub / 10));
    expect(b.total).toBe(a.sub - b.discount);
  });
});

describe('график', () => {
  const stages = GST0.map((s) => ({
    id: s.id,
    durationWd: s.dur,
    milestone: Boolean(s.ms),
    actualStart: s.as ?? null,
  }));
  const links = GLK0.map(([from, to, lag]) => ({ from, to, lag }));

  it('рабочий календарь: понедельник 05.10.2026 — день 0, 04.11 — праздник, неделя пн–пт', () => {
    expect(dayIso(0)).toBe('2026-10-05');
    expect(isoDay('2026-10-20')).toBe(15);
    // (02.11, 06.11]: вт 03.11, ср 04.11 — праздник, чт, пт — три рабочих дня
    expect(wdIn(isoDay('2026-11-02'), isoDay('2026-11-06'))).toBe(3);
  });

  it('прямой проход: «Электрика · черновая» начинается фактически на 7-й день, штукатурка — раньше конца электрики на 3 дня', () => {
    const base = scheduleOf(stages, links, { off: {}, dur: { s2: 10 }, lag: {} });
    expect(base.s2?.start).toBe(7);
    expect(base.s2?.dur).toBe(10);
    const s2end = base.s2?.end ?? 0;
    const s3 = base.s3;
    expect(s3 && s3.start).toBeLessThan(s2end);
    expect(base.s10?.end).toBeGreaterThan(base.s9?.end ?? 0);
  });

  it('перенос сдвигает следом идущие этапы и дату сдачи; запас считается в рабочих днях', () => {
    const before = scheduleOf(stages, links, { off: {}, dur: { s2: 10 }, lag: {} });
    const after = scheduleOf(stages, links, { off: { s4: 3 }, dur: { s2: 10 }, lag: {} });
    expect(after.s4?.start).toBeGreaterThan(before.s4?.start ?? 0);
    expect(after.s10?.end).toBeGreaterThanOrEqual(before.s10?.end ?? 0);
    for (const r of Object.values(after)) expect(r.slack).toBeGreaterThanOrEqual(0);
    expect(after.s10?.slack).toBe(0);
  });
});
