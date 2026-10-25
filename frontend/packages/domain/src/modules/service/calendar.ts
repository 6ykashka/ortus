// Рабочий календарь направления (service.js 19.10:20–43 `addWork`, `workBetween`).
// Отличия от эталона (Q-W4.00-service-10): время считается по поясу календаря (по умолчанию Москва),
// а не по часовому поясу браузера; праздники — список дат `YYYY-MM-DD`, нерабочие как выходные.
// В эталоне функция называется `addWork`; в карточке W7.30 — `addWorkMinutes`.

export const MSK_OFFSET_MIN = 180;

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export interface WorkCalendar {
  /** Рабочие дни недели: 0 — понедельник … 6 — воскресенье. */
  days: readonly number[];
  /** Начало и конец рабочего дня, минуты от полуночи. */
  from: number;
  to: number;
  label: string;
  /** Смещение пояса направления от UTC, минуты; по умолчанию Москва. */
  utcOffsetMin?: number;
  /** Праздники и нерабочие дни, `YYYY-MM-DD` по поясу календаря. */
  holidays?: readonly string[];
}

/** Календари сида (`serviceSeed().CAL`). */
export const CAL = {
  spa: { days: [0, 1, 2, 3, 4, 5, 6], from: 600, to: 1260, label: 'ежедневно 10:00–21:00' },
  rep: { days: [0, 1, 2, 3, 4], from: 540, to: 1140, label: 'пн–пт 9:00–19:00' },
  log: { days: [0, 1, 2, 3, 4, 5, 6], from: 480, to: 1200, label: 'ежедневно 8:00–20:00' },
} as const satisfies Record<string, WorkCalendar>;

/** Смещение пояса календаря в миллисекундах. */
export const offsetMs = (cal?: Pick<WorkCalendar, 'utcOffsetMin'>): number =>
  (cal?.utcOffsetMin ?? MSK_OFFSET_MIN) * MINUTE_MS;

const localDay = (ms: number, off: number): number => Math.floor((ms + off) / DAY_MS);

/** Полночь локального дня, миллисекунды UTC. */
export const dayStartMs = (ms: number, off: number = MSK_OFFSET_MIN * MINUTE_MS): number =>
  localDay(ms, off) * DAY_MS - off;

/** День недели локального времени: 0 — понедельник. 1 января 1970 — четверг. */
export const weekdayOf = (ms: number, off: number = MSK_OFFSET_MIN * MINUTE_MS): number =>
  (((localDay(ms, off) + 3) % 7) + 7) % 7;

const isoDay = (ms: number, off: number): string => new Date(ms + off).toISOString().slice(0, 10);

/** Рабочий ли день: день недели входит в `days` и дата не в списке праздников. */
export function isWorkDay(cal: WorkCalendar, ms: number): boolean {
  const off = offsetMs(cal);
  return cal.days.includes(weekdayOf(ms, off)) && !(cal.holidays ?? []).includes(isoDay(ms, off));
}

/** Предел обхода суток: календарь без рабочих дней не зависает. */
const MAX_DAYS = 500;

/** Конец срока: `start` + `mins` рабочих минут по календарю направления. */
export function addWorkMinutes(start: number, mins: number, cal: WorkCalendar): number {
  const off = offsetMs(cal);
  let t = start;
  let left = mins;
  for (let i = 0; i < MAX_DAYS; i++) {
    const d0 = dayStartMs(t, off);
    const open = d0 + cal.from * MINUTE_MS;
    const close = d0 + cal.to * MINUTE_MS;
    if (isWorkDay(cal, d0) && t < close) {
      const s = Math.max(t, open);
      const avail = (close - s) / MINUTE_MS;
      if (avail >= left) return s + left * MINUTE_MS;
      left -= avail;
    }
    t = d0 + DAY_MS;
  }
  return t;
}

/** Рабочие минуты между `a` и `b`, округлённые до минуты. */
export function workBetween(a: number, b: number, cal: WorkCalendar): number {
  if (b <= a) return 0;
  const off = offsetMs(cal);
  let t = a;
  let sum = 0;
  for (let i = 0; i < MAX_DAYS && t < b; i++) {
    const d0 = dayStartMs(t, off);
    if (isWorkDay(cal, d0)) {
      const s = Math.max(t, d0 + cal.from * MINUTE_MS);
      const e = Math.min(b, d0 + cal.to * MINUTE_MS);
      if (e > s) sum += (e - s) / MINUTE_MS;
    }
    t = d0 + DAY_MS;
  }
  return Math.round(sum);
}
