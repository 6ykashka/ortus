// Рабочий календарь графика (design/Ремонт и стройка.dc.html:936–954). День — целое число от
// даты старта (`D0` эталона), пн–пт рабочие, праздники заданы номерами дней. Всё считается по UTC,
// поэтому результат не зависит от пояса машины; «сегодня» берётся из часов домена (Q-W4.00-repair-15).
import { ddmmyyyy, type Clock } from '../../core/clock.ts';
import { plural } from '../../core/format.ts';

export interface CalendarConfig {
  /** Дата дня 0, `ГГГГ-ММ-ДД`. */
  start: string;
  /** Номера нерабочих праздничных дней. */
  holidays: readonly number[];
  /** Номер «сегодня». */
  today: number;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const two = (n: number): string => String(n).padStart(2, '0');
const mod = (n: number, m: number): number => ((n % m) + m) % m;

function parseIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('Дата календаря должна быть в виде ГГГГ-ММ-ДД: «' + iso + '»');
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Дней от `from` до `to` (обе — `ГГГГ-ММ-ДД`); отрицательно, если `to` раньше. */
export const dayCount = (from: string, to: string): number =>
  Math.round((parseIso(to) - parseIso(from)) / DAY_MS);

/** Номер дня «сегодня» по часам домена: календарная дата в Москве, не в поясе машины. */
export function todayIndex(start: string, clock: Clock): number {
  const [d, m, y] = ddmmyyyy(clock).split('.');
  return dayCount(start, `${y}-${m}-${d}`);
}

export interface WorkCalendar {
  readonly cfg: CalendarConfig;
  /** День недели: 0 — пн … 6 — вс. */
  weekday(d: number): number;
  isHoliday(d: number): boolean;
  isW(d: number): boolean;
  /** Ближайший рабочий день вперёд (включая `d`). */
  fw(d: number): number;
  /** Ближайший рабочий день назад (включая `d`). */
  pw(d: number): number;
  /** Последний день этапа, который начинается в `s` и идёт `n` рабочих дней. */
  addW(s: number, n: number): number;
  /** Первый день этапа, который заканчивается в `e` и идёт `n` рабочих дней. */
  subW(e: number, n: number): number;
  /** День через `n` рабочих дней после `d`. */
  shW(d: number, n: number): number;
  /** Рабочих дней после `a` по `b` включительно. */
  wdIn(a: number, b: number): number;
  /** Понедельник недели, в которую входит день. */
  weekStart(d: number): number;
  /** Год, месяц (0–11) и число дня. */
  dateParts(d: number): { year: number; month: number; day: number };
  dt(d: number): string;
  dtw(d: number): string;
  /** «4 ноября». */
  dayMonth(d: number): string;
  /** «19–23 октября» или «29 октября – 9 ноября». */
  range(a: number, b: number): string;
  /** Номер дня по дате `ДД.ММ` года старта (или следующего года), иначе `null`. */
  indexOf(ddmm: string): number | null;
  wdn(n: number): string;
  dn(n: number): string;
  lagTxt(v: number): string;
}

export function createCalendar(cfg: CalendarConfig): WorkCalendar {
  const t0 = parseIso(cfg.start);
  const dow0 = mod(new Date(t0).getUTCDay() + 6, 7);
  const hol = new Set(cfg.holidays);
  const date = (d: number): Date => new Date(t0 + d * DAY_MS);

  const weekday = (d: number): number => mod(d + dow0, 7);
  const isHoliday = (d: number): boolean => hol.has(d);
  const isW = (d: number): boolean => weekday(d) < 5 && !isHoliday(d);
  const fw = (d: number): number => {
    let x = d;
    while (!isW(x)) x++;
    return x;
  };
  const pw = (d: number): number => {
    let x = d;
    while (!isW(x)) x--;
    return x;
  };
  const addW = (s: number, n: number): number => {
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
  const shW = (d: number, n: number): number => {
    let x = d;
    let k = n;
    while (k > 0) {
      x++;
      if (isW(x)) k--;
    }
    return x;
  };
  const wdIn = (a: number, b: number): number => {
    let c = 0;
    for (let d = a + 1; d <= b; d++) if (isW(d)) c++;
    return c;
  };
  const dt = (d: number): string =>
    two(date(d).getUTCDate()) + '.' + two(date(d).getUTCMonth() + 1);
  const dayMonth = (d: number): string =>
    String(date(d).getUTCDate()) + ' ' + MONTHS_GEN[date(d).getUTCMonth()];
  const wdn = (n: number): string => n + ' раб. ' + plural(n, 'день', 'дня', 'дней');
  const dn = (n: number): string => n + ' ' + plural(n, 'день', 'дня', 'дней');

  return {
    cfg,
    weekday,
    isHoliday,
    isW,
    fw,
    pw,
    addW,
    subW,
    shW,
    wdIn,
    weekStart: (d) => d - weekday(d),
    dateParts: (d) => ({
      year: date(d).getUTCFullYear(),
      month: date(d).getUTCMonth(),
      day: date(d).getUTCDate(),
    }),
    dt,
    dtw: (d) => dt(d) + ', ' + WEEKDAYS[weekday(d)],
    dayMonth,
    range(a, b) {
      const x = date(a);
      const z = date(b);
      return x.getUTCMonth() === z.getUTCMonth()
        ? x.getUTCDate() + '–' + z.getUTCDate() + ' ' + MONTHS_GEN[x.getUTCMonth()]
        : dayMonth(a) + ' – ' + dayMonth(b);
    },
    indexOf(ddmm) {
      const m = /^(\d{2})\.(\d{2})$/.exec(ddmm);
      if (!m) return null;
      const y = date(0).getUTCFullYear();
      const first = Date.UTC(y, Number(m[2]) - 1, Number(m[1]));
      const at = first >= t0 ? first : Date.UTC(y + 1, Number(m[2]) - 1, Number(m[1]));
      return Math.round((at - t0) / DAY_MS);
    },
    wdn,
    dn,
    lagTxt: (v) => (v < 0 ? 'раньше на ' + dn(-v) : v === 0 ? 'сразу' : 'пауза ' + dn(v)),
  };
}

/** Календарь объекта ремонта 20.10.2026: `D0` = 05.10, праздник 04.11 (день 30), сегодня — день 15. */
export const REPAIR_CALENDAR: WorkCalendar = createCalendar({
  start: '2026-10-05',
  holidays: [30],
  today: 15,
});
