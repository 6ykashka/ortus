// W4.41 · Время «Календаря» (CAL-05: моменты UTC и пояс IANA ресурса). Сутки и неделя — местная полночь пояса
// (с переходами времени), ЧЧ:ММ — как M.hm эталона (models.js:411), строка даты «Четверг, 1 октября 2026» — по
// часам (эталон пишет «Среда» строкой, Q-61, Q-W2.25-1), подписи недели — no-reference (Q-W4.06-4).
import { calendar, format } from '@ortus/texts';

import { CAL_TEXT } from './texts.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;

const fieldFormats = new Map<string, Intl.DateTimeFormat>();

/** Поля местного времени момента в поясе (год, месяц, день, часы 00–23, минуты, секунды). */
function fields(ms: number, tz: string): Record<string, string> {
  let f = fieldFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    fieldFormats.set(tz, f);
  }
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

/** Смещение пояса в момент `ms`, мс (местное время − UTC). */
function offsetMs(tz: string, ms: number): number {
  const p = fields(ms, tz);
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

const ymd = (date: string): [number, number, number] => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return [y, m, d];
};
const utcOf = (date: string): number => {
  const [y, m, d] = ymd(date);
  return Date.UTC(y, m - 1, d);
};
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Местная дата момента в поясе: «ГГГГ-ММ-ДД». */
export function localDate(ms: number, tz: string): string {
  const p = fields(ms, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Момент местной полуночи даты в поясе (переход времени учтён). */
export function dayStart(date: string, tz: string): number {
  const wall = utcOf(date);
  const first = wall - offsetMs(tz, wall);
  return wall - offsetMs(tz, first);
}

export const addDays = (date: string, n: number): string => isoOf(utcOf(date) + n * DAY);

/** Сколько мс от момента до следующей местной полуночи пояса (смена «сегодня» на открытой странице). */
export const msToNextDay = (ms: number, tz: string): number =>
  dayStart(addDays(localDate(ms, tz), 1), tz) - ms;

/** Понедельник недели даты. */
export function mondayOf(date: string): string {
  const dow = new Date(utcOf(date)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** Параметр `?date=`: «ГГГГ-ММ-ДД» существующего дня. */
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoOf(utcOf(v)) === v;
}

/** M.hm эталона: дробные часы → «ЧЧ:ММ». */
export const hm = (t: number): string =>
  `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;

/** Местное время момента: «ЧЧ:ММ». */
export function clock(ms: number, tz: string): string {
  const p = fields(ms, tz);
  return `${p.hour}:${p.minute}`;
}

const ru = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...o });
const WEEKDAY = ru({ weekday: 'long' });
const WEEKDAY_SHORT = ru({ weekday: 'short' });
const DAY_MONTH = ru({ day: 'numeric', month: 'long' });
const DD_MM = ru({ day: '2-digit', month: '2-digit' });

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const year = (date: string): number => ymd(date)[0];

/** «Четверг, 1 октября 2026». */
export function dateTitle(date: string): string {
  const d = new Date(utcOf(date));
  return `${capital(WEEKDAY.format(d))}, ${DAY_MONTH.format(d)} ${year(date)}`;
}

/** Смещение пояса для «(UTC+3)»: «+3», «+5:30», «+0». */
export function offsetLabel(tz: string, ms: number): string {
  const min = Math.round(offsetMs(tz, ms) / MINUTE);
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${min < 0 ? '-' : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Город пояса строки даты: Москва — подпись эталона; неизвестный пояс — его имя IANA. */
export function cityOf(tz: string): string {
  if (tz === 'Europe/Moscow') return calendar.city.moscow;
  return CAL_TEXT.cities[tz] ?? tz;
}

/** Неделя (no-reference): «28 сентября — 4 октября 2026», через год — с годом у обеих дат. */
export function weekTitle(monday: string): string {
  const sunday = addDays(monday, 6);
  const a = DAY_MONTH.format(new Date(utcOf(monday)));
  const b = DAY_MONTH.format(new Date(utcOf(sunday)));
  const same = year(monday) === year(sunday);
  return format(CAL_TEXT.weekTitle, {
    from: same ? a : `${a} ${year(monday)}`,
    to: `${b} ${year(sunday)}`,
  });
}

/** Столбец недели: «Пн, 28.09». */
export function dayHead(date: string): string {
  const d = new Date(utcOf(date));
  return format(CAL_TEXT.dayHead, { wd: capital(WEEKDAY_SHORT.format(d)), date: DD_MM.format(d) });
}

/** День брони в подписи недели: «чт 01.10». */
export function dayShort(date: string): string {
  const d = new Date(utcOf(date));
  return `${WEEKDAY_SHORT.format(d)} ${DD_MM.format(d)}`;
}
