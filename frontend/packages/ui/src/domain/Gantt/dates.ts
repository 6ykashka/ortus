// Даты диаграммы: ISO-дата ↔ номер дня (UTC), рабочий календарь по выходным и праздникам из пропсов.
// Часов и часового пояса здесь нет: «сегодня» и даты приходят строками `ГГГГ-ММ-ДД`.

const DAY_MS = 86_400_000;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;
const MONTHS_SHORT = [
  'янв.',
  'февр.',
  'март',
  'апр.',
  'май',
  'июнь',
  'июль',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;

const two = (n: number): string => String(n).padStart(2, '0');

/** Номер дня от 1970-01-01 по ISO-дате. */
export const dayNum = (iso: string): number => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY_MS);

export const isoOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** День недели `Date.getUTCDay()`: 0 — вс … 6 — сб. */
export const weekdayOf = (n: number): number => new Date(n * DAY_MS).getUTCDay();

/** «12.10». */
export const ddmm = (n: number): string => {
  const d = new Date(n * DAY_MS);
  return two(d.getUTCDate()) + '.' + two(d.getUTCMonth() + 1);
};

/** «12.10, пн». */
export const ddmmWd = (n: number): string => ddmm(n) + ', ' + WEEKDAYS[weekdayOf(n)];

export const dayOfMonth = (n: number): number => new Date(n * DAY_MS).getUTCDate();

export const monthOf = (n: number): { month: number; year: number } => {
  const d = new Date(n * DAY_MS);
  return { month: d.getUTCMonth(), year: d.getUTCFullYear() };
};

/** Подпись месяца шкалы: «Ноябрь» / «нояб.»; год — только когда `withYear` («Октябрь 2026», как в эталоне). */
export const monthName = (month: number, year: number, short: boolean, withYear = false): string =>
  short ? (MONTHS_SHORT[month] ?? '') : (MONTHS[month] ?? '') + (withYear ? ' ' + year : '');

function plural(n: number, a: string, b: string, c: string): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return a;
  if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return b;
  return c;
}

/** «3 раб. дня». */
export const workDays = (n: number): string => n + ' раб. ' + plural(n, 'день', 'дня', 'дней');

export interface WorkCal {
  isW(n: number): boolean;
  isHoliday(n: number): boolean;
  isWeekend(n: number): boolean;
  /** Ближайший рабочий день вперёд (включая день) и назад. */
  fw(n: number): number;
  pw(n: number): number;
  /** Последний день этапа, начинающегося в `s` и идущего `k` рабочих дней. */
  addW(s: number, k: number): number;
  /** Рабочих дней в отрезке `a`…`b` включительно. */
  count(a: number, b: number): number;
}

export function workCal(weekends: readonly number[], holidays: readonly string[] = []): WorkCal {
  const hol = new Set(holidays.map(dayNum));
  const end = new Set(weekends);
  const isWeekend = (n: number): boolean => end.has(weekdayOf(n));
  const isHoliday = (n: number): boolean => hol.has(n);
  const isW = (n: number): boolean => !isWeekend(n) && !isHoliday(n);
  // Календарь без рабочих дней не зацикливает поиск.
  const LIMIT = 400;
  const fw = (n: number): number => {
    let x = n;
    for (let i = 0; i < LIMIT && !isW(x); i++) x++;
    return x;
  };
  const pw = (n: number): number => {
    let x = n;
    for (let i = 0; i < LIMIT && !isW(x); i++) x--;
    return x;
  };
  const addW = (s: number, k: number): number => {
    let d = s;
    let c = 1;
    for (let i = 0; c < k && i < LIMIT * 4; i++) {
      d++;
      if (isW(d)) c++;
    }
    return d;
  };
  const count = (a: number, b: number): number => {
    let c = 0;
    for (let d = a; d <= b; d++) if (isW(d)) c++;
    return c;
  };
  return { isW, isHoliday, isWeekend, fw, pw, addW, count };
}
