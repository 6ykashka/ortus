// Геометрия диаграммы Ганта (design/Ремонт и стройка.dc.html:1091–1190): масштаб, полосы этапов,
// связи-«ступеньки», паузы, месяцы и недели. Числа сняты прогоном дословной копии расчёта эталона
// (`.claude/tmp/W6.10/ref5.mjs`): ширина 1000 px, «Весь объект», действующий план.
import { describe, expect, it } from 'vitest';
import { REPAIR_CALENDAR as cal } from './calendar.ts';
import { schedule } from './cpm.ts';
import { ganttLayout, type GanttInput, type GanttStageRow } from './gantt.ts';
import { OBJ42_MODEL, OBJ42_PHASES, OBJ42_PLAN } from './obj42.ts';

const base = schedule(cal, OBJ42_MODEL, null);
const plan = schedule(cal, OBJ42_MODEL, OBJ42_PLAN);

const input = (o: Partial<GanttInput> = {}): GanttInput => ({
  cal,
  model: OBJ42_MODEL,
  phases: OBJ42_PHASES,
  drawn: OBJ42_PLAN,
  R: plan,
  P: plan,
  B: base,
  width: 1000,
  fit: true,
  selected: null,
  critical: false,
  hasDraft: false,
  ...o,
});
const stageRow = (g: ReturnType<typeof ganttLayout>, id: string): GanttStageRow => {
  const r = g.rows.find((x): x is GanttStageRow => x.kind === 'stage' && x.id === id);
  if (!r) throw new Error(id);
  return r;
};

describe('масштаб', () => {
  it('1000 px, «Весь объект»: 63 дня по 7,17 px, колонка названий 210', () => {
    const g = ganttLayout(input());
    expect(g.days).toBe(63);
    expect(g.dayW).toBeCloseTo(7.174603174603175, 10);
    expect(g.nameW).toBe(210);
    expect(g.side).toBe(true);
    expect(g.narrow).toBe(false);
    expect(g.innerW).toBeCloseTo(210 + 63 * 7.174603174603175, 6);
    expect(g.height).toBe(530);
  });

  it('«По дням»: день 26 px; узкий экран < 640: колонка 128, без панели', () => {
    const g = ganttLayout(input({ fit: false }));
    expect(g.dayW).toBe(26);
    const n = ganttLayout(input({ width: 390 }));
    expect([n.narrow, n.side, n.nameW]).toEqual([true, false, 128]);
    expect(n.dayW).toBeGreaterThanOrEqual(7);
  });

  it('график длиннее 63 дней растягивает шкалу до целых недель + 6 дней', () => {
    const long = schedule(cal, OBJ42_MODEL, { off: {}, dur: { s2: 10, s5: 60 }, lag: {} });
    const g = ganttLayout(input({ R: long, P: long }));
    expect(g.days % 7).toBe(0);
    expect(g.days).toBeGreaterThan(63);
  });
});

describe('полосы этапов и разделов', () => {
  const g = ganttLayout(input());

  it('разделы: подпись, даты, позиция', () => {
    const phases = g.rows.filter((r) => r.kind === 'phase');
    expect(phases.map((p) => [p.label, p.dates, p.y])).toEqual([
      ['Черновые работы', '05.10–06.11', 0],
      ['Чистовые работы', '09.11–27.11', 206],
      ['Сдача', '30.11–01.12', 412],
    ]);
    expect(phases[0]?.left).toBeCloseTo(1, 5);
    expect(phases[0]?.width).toBeCloseTo(234.8, 1);
  });

  it('этапы: left/width/y как в эталоне', () => {
    const exp: Record<string, [number, number, number]> = {
      s1: [1, 33.9, 30],
      s2: [51.2, 84.1, 74],
      s3: [115.8, 98.4, 118],
      s6: [259.3, 48.2, 280],
      s10: [410, 5.2, 486],
    };
    for (const [id, [l, w, y]] of Object.entries(exp)) {
      const r = stageRow(g, id);
      expect(r.left).toBeCloseTo(l, 1);
      expect(r.width).toBeCloseTo(w, 1);
      expect(r.y).toBe(y);
    }
    expect(stageRow(g, 's1').msLeft).toBeCloseTo(-3.4, 1);
    expect(stageRow(g, 's2').msLeft).toBeCloseTo(46.8, 1);
  });

  it('метка этапа: даты и длительность; у вехи — «сдача …» и сравнение с договором', () => {
    expect(stageRow(g, 's2').meta).toBe('12.10–23.10 · 10 дн');
    expect(stageRow(g, 's10').meta).toBe('сдача 01.12, вт · по договору 27.11');
    const inTime = ganttLayout(input({ R: base, P: base, drawn: { off: {}, dur: {}, lag: {} } }));
    expect(stageRow(inTime, 's10').meta).toBe('сдача 27.11, пт · в срок');
  });

  it('отклонение от договора: «+2 дн» у s2, у выполненного и вехи нет', () => {
    expect(stageRow(g, 's2')).toMatchObject({ variance: 2, varText: '+2 дн', hasVar: true });
    expect(stageRow(g, 's1').hasVar).toBe(false);
    expect(stageRow(g, 's10').hasVar).toBe(false);
    expect(stageRow(g, 's5').varText).toBe('+2 дн');
  });

  it('что можно двигать и растягивать: идущий этап — только растягивать, веха — ничего', () => {
    expect(stageRow(g, 's2')).toMatchObject({ canMove: false, canResize: true, started: true });
    expect(stageRow(g, 's6')).toMatchObject({ canMove: true, canResize: true });
    expect(stageRow(g, 's10')).toMatchObject({ canMove: false, canResize: false, ms: true });
    expect(stageRow(g, 's1')).toMatchObject({ canMove: false, canResize: false, done: true });
  });

  it('прогресс: выполнено целиком, принято и на приёмке, не начат — без отрезков', () => {
    expect(stageRow(g, 's1').segments).toEqual([{ kind: 'full', pct: 100 }]);
    const s2 = stageRow(g, 's2').segments;
    expect(s2.map((s) => s.kind)).toEqual(['accepted', 'pending']);
    expect(s2[0]?.pct).toBeCloseTo(52.6, 1);
    expect(s2[1]?.pct).toBeCloseTo(7.9, 1);
    expect(stageRow(g, 's6').segments).toEqual([]);
  });

  it('базовый план: позиция полосы по договору', () => {
    const s2 = stageRow(g, 's2');
    expect(s2.baseLeft).toBeCloseTo(7 * g.dayW + 1, 1);
    expect(s2.baseWidth).toBeCloseTo((16 - 7 + 1) * g.dayW - 2, 1);
    expect(stageRow(g, 's10').baseMsLeft).toBeCloseTo((53 + 0.5) * g.dayW - 5, 1);
  });

  it('черновик: изменённые этапы помечены, «критический путь» гасит этапы с запасом', () => {
    const draft = schedule(cal, OBJ42_MODEL, { off: {}, dur: { s2: 10, s5: 15 }, lag: {} });
    const d = ganttLayout(input({ R: draft, hasDraft: true, critical: true }));
    expect(stageRow(d, 's5').changed).toBe(true);
    expect(stageRow(d, 's2').changed).toBe(false);
    expect(stageRow(d, 's6')).toMatchObject({ dimmed: true });
    expect(stageRow(d, 's5')).toMatchObject({ dimmed: false });
    expect(stageRow(d, 's1').dimmed).toBe(true);
  });

  it('выбранный этап подсвечен', () => {
    expect(stageRow(ganttLayout(input({ selected: 's3' })), 's3').selected).toBe(true);
    expect(stageRow(g, 's3').selected).toBe(false);
  });
});

describe('связи, стрелки и паузы', () => {
  const g = ganttLayout(input());

  it('12 связей; ступенька вперёд (s1 → s2): три отрезка, стрелка перед началом s2', () => {
    expect(g.links).toHaveLength(12);
    const l = g.links.find((x) => x.from === 's1' && x.to === 's2');
    expect(l?.segs).toEqual([
      { left: 34.9, top: 49.3, width: 5.8, height: 1.5 },
      { left: 39.1, top: 50, width: 1.5, height: 44 },
      { left: 39.9, top: 93.3, width: 6.1, height: 1.5 },
    ]);
    expect(l?.arrow).toEqual({ left: 45.2, top: 90 });
  });

  it('опережение (s2 → s3, −3 дня): пять отрезков с обходом', () => {
    const l = g.links.find((x) => x.from === 's2' && x.to === 's3');
    expect(l?.segs).toEqual([
      { left: 135.3, top: 93.3, width: 5.8, height: 1.5 },
      { left: 139.6, top: 94, width: 1.5, height: 22 },
      { left: 106.8, top: 115.3, width: 34.3, height: 1.5 },
      { left: 106, top: 116, width: 1.5, height: 22 },
      { left: 106.8, top: 137.3, width: 3.8, height: 1.5 },
    ]);
  });

  it('длинная связь (s3 → s5): вертикаль на 118 px', () => {
    const l = g.links.find((x) => x.from === 's3' && x.to === 's5');
    expect(l?.segs[1]).toEqual({ left: 218.5, top: 138, width: 1.5, height: 118 });
  });

  it('паузы: s3→s5 5 дней, s4→s6 3 дня, s4→s7 10 дней; подпись помещается не везде', () => {
    expect(g.pauses.map((p) => [p.from, p.to, p.label, p.showLabel])).toEqual([
      ['s3', 's5', 'сушка штукатурки · 5 дней', false],
      ['s4', 's6', 'стяжка набирает прочность · 3 дня', false],
      ['s4', 's7', 'сушка стяжки под ламинат · 10 дней', false],
    ]);
    expect(g.pauses[0]).toMatchObject({ top: 135, labelTop: 121 });
    expect(g.pauses[0]?.left).toBeCloseTo(215.2, 1);
    expect(g.pauses[0]?.width).toBeCloseTo(35.9, 1);
  });

  it('подпись паузы показана, если полоса достаточно широка («По дням»)', () => {
    const wide = ganttLayout(input({ fit: false }));
    expect(wide.pauses.filter((p) => p.showLabel).map((p) => p.to)).toEqual(['s7']);
  });

  it('состояния связей: выбранный этап подсвечивает свои, критический путь гасит остальные', () => {
    const sel = ganttLayout(input({ selected: 's3' }));
    expect(sel.links.filter((l) => l.state === 'hot').map((l) => l.from + '>' + l.to)).toEqual([
      's2>s3',
      's3>s4',
      's3>s5',
    ]);
    const crit = ganttLayout(input({ critical: true }));
    expect(crit.links.filter((l) => l.state === 'crit').map((l) => l.from + '>' + l.to)).toEqual([
      's2>s3',
      's3>s5',
      's5>s7',
      's7>s9',
      's9>s10',
    ]);
    expect(crit.links.find((l) => l.from === 's4' && l.to === 's6')?.state).toBe('dim');
    expect(g.links.every((l) => l.state === 'normal')).toBe(true);
  });
});

describe('шкала времени', () => {
  const g = ganttLayout(input());

  it('месяцы: октябрь, ноябрь, декабрь', () => {
    expect(g.months.map((m) => [m.month, m.from, m.to])).toEqual([
      [9, 0, 26],
      [10, 27, 56],
      [11, 57, 62],
    ]);
    expect(g.months[1]?.left).toBeCloseTo(193.7, 1);
    expect(g.months[1]?.width).toBeCloseTo(215.2, 1);
  });

  it('«сегодня» и праздник: линия 110,2; колонка 04.11', () => {
    expect(g.todayX).toBeCloseTo(110.2, 1);
    expect(g.holidays).toHaveLength(1);
    expect(g.holidays[0]).toMatchObject({ day: 30 });
    expect(g.holidays[0]?.left).toBeCloseTo(30 * g.dayW, 5);
  });

  it('недели: «Весь объект» — по неделям, «По дням» — по дням, сегодня выделено', () => {
    expect(g.ticks).toHaveLength(9);
    expect(g.ticks[0]).toMatchObject({ day: 0, label: '05.10', title: 'Неделя с 05.10, пн' });
    const days = ganttLayout(input({ fit: false }));
    expect(days.ticks).toHaveLength(63);
    expect(days.ticks[15]).toMatchObject({ label: '20', today: true });
    expect(days.ticks[30]).toMatchObject({ title: '4 ноября — выходной', holiday: true });
    expect(days.ticks[5]).toMatchObject({ workday: false, title: '10.10, сб' });
  });
});
