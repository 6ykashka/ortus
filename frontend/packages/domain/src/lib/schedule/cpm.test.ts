// Расчёт графика (прямой и обратный проход, запас, bind) и правки плана — `gsched`, `gnorm`
// и обработчики перетаскивания эталона (design/Ремонт и стройка.dc.html:975–997, 1066–1083).
// Ожидаемые числа сняты прогоном дословной копии расчёта эталона (`.claude/tmp/W6.10/ref.mjs`).
import { describe, expect, it } from 'vitest';
import { REPAIR_CALENDAR as cal } from './calendar.ts';
import {
  bumpDuration,
  bumpLag,
  bumpOffset,
  criticalIds,
  draftAfter,
  dragMinEnd,
  dragResize,
  dragMove,
  EMPTY_PLAN,
  isStageDone,
  lagOf,
  linkKey,
  minDuration,
  normalizePlan,
  planEquals,
  schedule,
  topoOrder,
} from './cpm.ts';
import { OBJ42_MODEL, OBJ42_PLAN } from './obj42.ts';
import type { Plan, ScheduleModel } from './types.ts';

// [es, start, end, lf, ls, fl, bind]
type Row = [number, number, number, number, number, number, string | null];
const BASE: Record<string, Row> = {
  s1: [0, 0, 4, 4, 0, 0, null],
  s2: [7, 7, 16, 16, 7, 0, 's1'],
  s3: [14, 14, 25, 25, 14, 0, 's2'],
  s4: [28, 28, 29, 38, 37, 6, 's3'],
  s5: [31, 31, 46, 46, 31, 0, 's3'],
  s6: [35, 35, 39, 51, 45, 8, 's4'],
  s7: [49, 49, 51, 51, 49, 0, 's5'],
  s8: [49, 49, 50, 51, 50, 1, 's5'],
  s9: [52, 52, 52, 52, 52, 0, 's7'],
  s10: [53, 53, 53, 53, 53, 0, 's9'],
};
const CUR: Record<string, Row> = {
  s1: [0, 0, 4, 4, 0, 0, null],
  s2: [7, 7, 18, 18, 7, 0, 's1'],
  s3: [16, 16, 29, 29, 16, 0, 's2'],
  s4: [31, 31, 32, 39, 38, 5, 's3'],
  s5: [35, 35, 50, 50, 35, 0, 's3'],
  s6: [36, 36, 42, 53, 49, 9, 's4'],
  s7: [51, 51, 53, 53, 51, 0, 's5'],
  s8: [51, 51, 52, 53, 52, 1, 's5'],
  s9: [56, 56, 56, 56, 56, 0, 's7'],
  s10: [57, 57, 57, 57, 57, 0, 's9'],
};
const S5_PLUS3: Record<string, Row> = {
  s1: [0, 0, 4, 4, 0, 0, null],
  s2: [7, 7, 18, 18, 7, 0, 's1'],
  s3: [16, 16, 29, 29, 16, 0, 's2'],
  s4: [31, 31, 32, 45, 44, 9, 's3'],
  s5: [35, 35, 53, 53, 35, 0, 's3'],
  s6: [36, 36, 42, 58, 52, 12, 's4'],
  s7: [56, 56, 58, 58, 56, 0, 's5'],
  s8: [56, 56, 57, 58, 57, 1, 's5'],
  s9: [59, 59, 59, 59, 59, 0, 's7'],
  s10: [60, 60, 60, 60, 60, 0, 's9'],
};
const S6_OFF4: Record<string, Row> = {
  ...CUR,
  s6: [36, 42, 46, 53, 49, 5, 's4'],
};
const LAG_S3_S5: Record<string, Row> = {
  ...S5_PLUS3,
  s5: [38, 38, 53, 53, 38, 0, 's3'],
};
const S3_SHORTER: Record<string, Row> = {
  s1: [0, 0, 4, 4, 0, 0, null],
  s2: [7, 7, 18, 18, 7, 0, 's1'],
  s3: [14, 14, 22, 22, 14, 0, 's2'],
  s4: [23, 23, 24, 32, 31, 5, 's3'],
  s5: [28, 28, 44, 44, 28, 0, 's3'],
  s6: [28, 28, 35, 49, 43, 10, 's4'],
  s7: [45, 45, 49, 49, 45, 0, 's5'],
  s8: [45, 45, 46, 49, 46, 1, 's5'],
  s9: [50, 50, 50, 50, 50, 0, 's7'],
  s10: [51, 51, 51, 51, 51, 0, 's9'],
};

const plan = (p: Partial<Plan>): Plan => ({ ...EMPTY_PLAN(), ...p });
const rows = (t: ReturnType<typeof schedule>): Record<string, Row> =>
  Object.fromEntries(
    Object.entries(t).map(([id, r]) => [id, [r.es, r.start, r.end, r.lf, r.ls, r.fl, r.bind]]),
  );

describe('schedule: прямой и обратный проход', () => {
  it.each([
    ['базовый план (без правок)', null, BASE],
    ['действующий план: электрика 10 дней', OBJ42_PLAN, CUR],
    ['покраска 15 дней', plan({ dur: { s2: 10, s5: 15 } }), S5_PLUS3],
    ['плитка отложена на 4 раб. дня', plan({ dur: { s2: 10 }, off: { s6: 4 } }), S6_OFF4],
    [
      'пауза штукатурка → покраска 8 дней',
      plan({ dur: { s2: 10 }, lag: { 's3>s5': 8 } }),
      LAG_S3_S5,
    ],
    [
      'штукатурка 7 дней, опережение 5',
      plan({ dur: { s2: 10, s3: 7 }, lag: { 's2>s3': -5 } }),
      S3_SHORTER,
    ],
  ])('%s', (_name, p, expected) => {
    expect(rows(schedule(cal, OBJ42_MODEL, p))).toEqual(expected);
  });

  it('фактическое начало идущего этапа в плане не сдвигается (as), в базовом плане — считается', () => {
    const t = schedule(cal, OBJ42_MODEL, plan({ off: { s2: 3 } }));
    expect(t['s2']?.start).toBe(7);
    expect(schedule(cal, OBJ42_MODEL, null)['s2']?.start).toBe(7);
  });

  it('у вехи длительность 1 и конец = началу, сколько бы ни правили', () => {
    const t = schedule(cal, OBJ42_MODEL, plan({ dur: { s10: 9 } }));
    expect(t['s10']).toMatchObject({ dur: 1, start: t['s10']?.end });
  });

  it('прогноз сдачи: по договору 27.11 (день 53), по плану 01.12 (день 57), +2 раб. дня', () => {
    const base = schedule(cal, OBJ42_MODEL, null);
    const cur = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);
    expect([cal.dt(base['s10']?.end ?? 0), cal.dt(cur['s10']?.end ?? 0)]).toEqual([
      '27.11',
      '01.12',
    ]);
    expect(cal.wdIn(base['s10']?.end ?? 0, cur['s10']?.end ?? 0)).toBe(2);
  });
});

describe('связи и порядок', () => {
  it('lagOf: правка плана или значение связи; linkKey = «от>к»', () => {
    const link = OBJ42_MODEL.links[3];
    if (!link) throw new Error('нет связи');
    expect(linkKey(link)).toBe('s3>s5');
    expect(lagOf(null, link)).toBe(5);
    expect(lagOf(EMPTY_PLAN(), link)).toBe(5);
    expect(lagOf(plan({ lag: { 's3>s5': 0 } }), link)).toBe(0);
  });

  it('topoOrder сохраняет порядок входа, если он уже допустим', () => {
    expect(topoOrder(OBJ42_MODEL).map((s) => s.id)).toEqual(OBJ42_MODEL.stages.map((s) => s.id));
  });

  it('topoOrder переставляет этапы, заданные не по порядку', () => {
    const m: ScheduleModel = {
      stages: [
        { id: 'b', name: 'B', dur: 1 },
        { id: 'a', name: 'A', dur: 1 },
      ],
      links: [{ from: 'a', to: 'b', lag: 0 }],
    };
    expect(topoOrder(m).map((s) => s.id)).toEqual(['a', 'b']);
    expect(Object.keys(schedule(cal, m, null)).sort()).toEqual(['a', 'b']);
  });

  it('цикл и связь с неизвестным этапом — ошибка', () => {
    const cyc: ScheduleModel = {
      stages: [
        { id: 'a', name: 'A', dur: 1 },
        { id: 'b', name: 'B', dur: 1 },
      ],
      links: [
        { from: 'a', to: 'b', lag: 0 },
        { from: 'b', to: 'a', lag: 0 },
      ],
    };
    expect(() => topoOrder(cyc)).toThrow(/цикл/i);
    const bad: ScheduleModel = {
      stages: [{ id: 'a', name: 'A', dur: 1 }],
      links: [{ from: 'a', to: 'zz', lag: 0 }],
    };
    expect(() => topoOrder(bad)).toThrow(/zz/);
  });

  it('график без этапов пуст', () => {
    expect(schedule(cal, { stages: [], links: [] }, null)).toEqual({});
  });
});

describe('normalizePlan (`gnorm`) и сравнение планов', () => {
  it('убирает значения по умолчанию, сортирует ключи', () => {
    const n = normalizePlan(
      OBJ42_MODEL,
      plan({
        off: { s6: 0, s5: 2, s4: -1 },
        dur: { s2: 10, s3: 10, s1: 5 },
        lag: { 's3>s5': 5, 's2>s3': -4 },
      }),
    );
    expect(n).toEqual({ off: { s5: 2 }, dur: { s2: 10 }, lag: { 's2>s3': -4 } });
    expect(Object.keys(n.dur)).toEqual(['s2']);
  });

  it('planEquals: одинаковые после нормализации', () => {
    expect(planEquals(OBJ42_MODEL, plan({ dur: { s2: 10, s3: 10 } }), OBJ42_PLAN)).toBe(true);
    expect(planEquals(OBJ42_MODEL, plan({ dur: { s2: 11 } }), OBJ42_PLAN)).toBe(false);
  });
});

describe('критический путь', () => {
  const crit = (p: Plan | null): string[] =>
    criticalIds(OBJ42_MODEL, schedule(cal, OBJ42_MODEL, p), (s) => isStageDone(s));

  it('действующий план: s2 → s3 → s5 → s7 → s9 → s10 (s1 закрыт)', () => {
    expect(crit(OBJ42_PLAN)).toEqual(['s2', 's3', 's5', 's7', 's9', 's10']);
  });

  it('у s8 запас 1 день, у s4 и s6 — 5 и 9', () => {
    const t = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);
    expect([t['s8']?.fl, t['s4']?.fl, t['s6']?.fl]).toEqual([1, 5, 9]);
  });

  it('isStageDone: принято 100 % (acc ≥ 1)', () => {
    expect(isStageDone({ id: 'x', name: 'X', dur: 1, acc: 1 })).toBe(true);
    expect(isStageDone({ id: 'x', name: 'X', dur: 1, acc: 0.97 })).toBe(false);
    expect(isStageDone({ id: 'x', name: 'X', dur: 1 })).toBe(false);
  });
});

describe('правки этапа кнопками (панель этапа)', () => {
  const stage = (id: string) => {
    const s = OBJ42_MODEL.stages.find((x) => x.id === id);
    if (!s) throw new Error(id);
    return s;
  };

  it('начало: ±1 раб. день, не раньше готовности предшественников', () => {
    expect(bumpOffset(EMPTY_PLAN(), 's6', 1).off).toEqual({ s6: 1 });
    expect(bumpOffset(plan({ off: { s6: 2 } }), 's6', -1).off).toEqual({ s6: 1 });
    expect(bumpOffset(EMPTY_PLAN(), 's6', -1).off).toEqual({ s6: 0 });
  });

  it('длительность: ±1, не меньше минимума; у идущего этапа минимум — прошедшие дни', () => {
    expect(minDuration(cal, stage('s6'), cal.cfg.today)).toBe(1);
    expect(minDuration(cal, stage('s2'), cal.cfg.today)).toBe(8);
    expect(bumpDuration(EMPTY_PLAN(), stage('s6'), 1, 1).dur).toEqual({ s6: 6 });
    expect(bumpDuration(EMPTY_PLAN(), stage('s6'), 1, -1).dur).toEqual({ s6: 4 });
    expect(bumpDuration(plan({ dur: { s6: 1 } }), stage('s6'), 1, -1).dur).toEqual({ s6: 1 });
    expect(bumpDuration(OBJ42_PLAN, stage('s2'), 7, -1).dur).toEqual({ s2: 9 });
  });

  it('пауза по связи: ±1 в пределах −5…30', () => {
    const link = OBJ42_MODEL.links[1];
    if (!link) throw new Error('нет связи');
    expect(bumpLag(EMPTY_PLAN(), link, -1).lag).toEqual({ 's2>s3': -4 });
    expect(bumpLag(plan({ lag: { 's2>s3': -5 } }), link, -1).lag).toEqual({ 's2>s3': -5 });
    expect(bumpLag(plan({ lag: { 's2>s3': 30 } }), link, 1).lag).toEqual({ 's2>s3': 30 });
  });

  it('черновик после правки: нормализован; равный действующему плану — null', () => {
    expect(
      draftAfter(OBJ42_MODEL, OBJ42_PLAN, plan({ dur: { s2: 10, s3: 10 }, off: { s6: 0 } })),
    ).toBeNull();
    expect(draftAfter(OBJ42_MODEL, OBJ42_PLAN, plan({ dur: { s2: 10, s3: 11 } }))).toEqual({
      off: {},
      dur: { s2: 10, s3: 11 },
      lag: {},
    });
  });

  it('правки не меняют исходный план', () => {
    const p = plan({ off: { s6: 1 } });
    bumpOffset(p, 's6', 1);
    expect(p.off).toEqual({ s6: 1 });
  });
});

describe('перетаскивание полосы', () => {
  const t = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);
  const at = (id: string) => {
    const r = t[id];
    if (!r) throw new Error(id);
    return r;
  };

  it('сдвиг начала на dx дней: не раньше раннего начала, до рабочего дня', () => {
    expect(dragMove(cal, OBJ42_PLAN, 's6', at('s6'), 8).off).toEqual({ s6: 6 });
    expect(dragMove(cal, OBJ42_PLAN, 's6', at('s6'), -9).off).toEqual({ s6: 0 });
    expect(dragMove(cal, OBJ42_PLAN, 's6', at('s6'), 0).off).toEqual({ s6: 0 });
  });

  it('длительность: правый край на dx, не меньше минимального окончания', () => {
    const s6 = at('s6');
    expect(dragResize(cal, OBJ42_PLAN, 's6', s6, 7, s6.start).dur).toEqual({ s2: 10, s6: 10 });
    expect(dragResize(cal, OBJ42_PLAN, 's6', s6, -20, s6.start).dur).toEqual({ s2: 10, s6: 1 });
  });

  it('идущий этап: минимум окончания — завтрашний рабочий день', () => {
    const s2 = at('s2');
    expect(dragMinEnd(cal, true, s2.start, cal.cfg.today)).toBe(16);
    expect(dragMinEnd(cal, false, 40, cal.cfg.today)).toBe(40);
    expect(dragResize(cal, OBJ42_PLAN, 's2', s2, -20, 16).dur).toEqual({ s2: 8 });
  });
});
