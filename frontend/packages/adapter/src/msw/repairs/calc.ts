// Расчёты «Ремонта и стройки» сценарного сервера (W6.00, контракт 0.12.0-stage6): замер (measOf), объёмы по формулам
// шаблона (fval, rq), строки и итоги сметы (lineFrom, tot), рабочий календарь и график по этапам (gsched: прямой и
// обратный проход, запас) — порт логики «Ремонт и стройка.dc.html» (design-2026-10-19). Чистые функции без состояния;
// настоящие реализации — домен W6.10 (смета) и W6.17 (график), backend W6.12 и W6.14.
import { type CatItem, type Formula, type LineSpec, type RoomSeed, type Unit } from './data.ts';

export interface Meas {
  F: number;
  W: number;
  P: number;
  bf: number;
  bw: number;
  bp: number;
}

/** Замер: площади пола и стен, периметр; «санузел…» считается отдельно (формулы «без санузлов», «санузлы»). */
export function measOf(rooms: readonly RoomSeed[]): Meas {
  const m: Meas = { F: 0, W: 0, P: 0, bf: 0, bw: 0, bp: 0 };
  for (const r of rooms) {
    const fl = r.l * r.w;
    const pe = 2 * (r.l + r.w);
    const wa = Math.max(0, pe * r.h - r.o);
    m.F += fl;
    m.W += wa;
    m.P += pe;
    if (/^санузел/i.test(r.name)) {
      m.bf += fl;
      m.bw += wa;
      m.bp += pe;
    }
  }
  return m;
}

export function fval(f: Formula, m: Meas): number {
  switch (f) {
    case 'floor':
      return m.F;
    case 'floor_dry':
      return m.F - m.bf;
    case 'walls':
      return m.W;
    case 'walls_dry':
      return m.W - m.bw;
    case 'wet':
      return m.bf + m.bw;
    case 'perimeter':
      return m.P;
    case 'perimeter_dry':
      return m.P - m.bp;
  }
}

/** Штуки, мешки, рейсы, комплекты и литры округляются вверх; остальное — до десятых. */
const CEIL: readonly Unit[] = ['piece', 'mesh', 'trip', 'set', 'liter'];
export const rq = (v: number, unit: Unit): number =>
  CEIL.includes(unit) ? Math.ceil(v - 1e-9) : Math.round(v * 10) / 10;

/** Количество как Quantity контракта: без экспоненты и лишних нулей. */
export const fmtQty = (n: number): string => {
  const s = (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
};

export interface Line {
  id: string;
  section: string;
  item: string;
  name: string;
  unit: Unit;
  kind: 'work' | 'material';
  /** Рубли целыми. */
  price: number;
  formula: Formula | null;
  coef: number;
  qty: number;
  manual: boolean;
}

/** Строки сметы из строк шаблона на замере `m` (lineFrom эталона); цена — справочника на дату сборки. */
export function buildLines(cat: readonly CatItem[], specs: readonly LineSpec[], m: Meas): Line[] {
  return specs.map((t, i) => {
    const it = cat.find((c) => c.id === t.item);
    const unit: Unit = it?.unit ?? 'piece';
    return {
      id: t.id ?? `n${i + 1}`,
      section: t.section,
      item: t.item,
      name: it?.name ?? t.item,
      unit,
      kind: it?.kind ?? 'work',
      price: it?.price ?? 0,
      formula: t.formula,
      coef: t.coef,
      qty: t.formula ? rq(fval(t.formula, m) * t.coef, unit) : t.quantity,
      manual: false,
    };
  });
}

export interface Totals {
  /** Копейки. */
  sub: number;
  discount: number;
  total: number;
}

/** Итоги: сумма строк, скидка в процентах (любой, кто правит смету), итог — в копейках. */
export function estimateTotals(
  lines: readonly { price: number; qty: number }[],
  discountPct: number,
): Totals {
  const sub = lines.reduce((a, l) => a + Math.round(l.price * 100 * l.qty), 0);
  const discount = Math.round((sub * discountPct) / 100);
  return { sub, discount, total: sub - discount };
}

// ---------------------------------------------------------------------------------------------
// Рабочий календарь: день 0 — понедельник 05.10.2026, пн–пт и праздник 04.11 (HOL = [30]).
const D0 = Date.UTC(2026, 9, 5);
const DAY = 86_400_000;
export const HOLIDAYS = [30];

export const dayIso = (d: number): string => new Date(D0 + d * DAY).toISOString().slice(0, 10);
export const isoDay = (iso: string): number =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - D0) / DAY);

export const isW = (d: number): boolean => ((d % 7) + 7) % 7 < 5 && !HOLIDAYS.includes(d);
const fw = (d: number): number => {
  while (!isW(d)) d++;
  return d;
};
const pw = (d: number): number => {
  while (!isW(d)) d--;
  return d;
};
/** Последний день этапа, который начинается в `s` и идёт `n` рабочих дней. */
export const addW = (s: number, n: number): number => {
  let d = s;
  let c = 1;
  while (c < n) {
    d++;
    if (isW(d)) c++;
  }
  return d;
};
const subW = (e: number, n: number): number => {
  let d = e;
  let c = 1;
  while (c < n) {
    d--;
    if (isW(d)) c++;
  }
  return d;
};
/** Сдвиг дня `d` на `n` рабочих дней вперёд. */
export const shW = (d: number, n: number): number => {
  while (n > 0) {
    d++;
    if (isW(d)) n--;
  }
  return d;
};
/** Рабочих дней в интервале (a, b]. */
export const wdIn = (a: number, b: number): number => {
  let c = 0;
  for (let d = a + 1; d <= b; d++) if (isW(d)) c++;
  return c;
};

export interface StageIn {
  id: string;
  durationWd: number;
  milestone?: boolean;
  /** Фактическое начало (день от 05.10) — начавшийся этап не сдвигается. */
  actualStart?: number | null;
}
export interface LinkIn {
  from: string;
  to: string;
  lag: number;
}
export interface Overrides {
  off: Record<string, number>;
  dur: Record<string, number>;
  /** Пауза связи «от>к». */
  lag: Record<string, number>;
}
export interface StageCalc {
  es: number;
  bind: string | null;
  dur: number;
  start: number;
  end: number;
  lf: number;
  ls: number;
  /** Запас в рабочих днях; 0 — критический путь. */
  slack: number;
}

export const linkKey = (l: { from: string; to: string }): string => `${l.from}>${l.to}`;
const lagOf = (o: Overrides, l: LinkIn): number => o.lag[linkKey(l)] ?? l.lag;

/** gsched эталона: этапы идут в топологическом порядке (связи — только от предыдущих к следующим). */
export function scheduleOf(
  stages: readonly StageIn[],
  links: readonly LinkIn[],
  o: Overrides,
): Record<string, StageCalc> {
  const R: Record<string, StageCalc> = {};
  for (const st of stages) {
    let es = 0;
    let bind: string | null = null;
    for (const l of links.filter((x) => x.to === st.id)) {
      const prev = R[l.from];
      if (!prev) continue;
      const v = fw(prev.end + 1 + lagOf(o, l));
      if (bind === null || v > es) {
        es = v;
        bind = l.from;
      }
    }
    es = fw(es);
    const dur = st.milestone ? 1 : (o.dur[st.id] ?? st.durationWd);
    const start =
      st.actualStart !== undefined && st.actualStart !== null
        ? st.actualStart
        : shW(es, o.off[st.id] ?? 0);
    R[st.id] = {
      es,
      bind,
      dur,
      start,
      end: st.milestone ? start : addW(start, dur),
      lf: 0,
      ls: 0,
      slack: 0,
    };
  }
  const last = stages[stages.length - 1];
  const fin = last ? (R[last.id]?.end ?? 0) : 0;
  for (const st of [...stages].reverse()) {
    const r = R[st.id];
    if (!r) continue;
    const outs = links.filter((l) => l.from === st.id);
    r.lf = outs.length
      ? Math.min(...outs.map((l) => pw((R[l.to]?.ls ?? fin) - 1 - lagOf(o, l))))
      : fin;
    r.ls = st.milestone ? r.lf : subW(r.lf, r.dur);
    r.slack = wdIn(r.end, r.lf);
  }
  return R;
}
