// Время демо чатов: минуты от 01.10.2026 00:00, прошлые дни — отрицательные (chats.js 14.10:17–20).
const p2 = (n: number): string => String(n).padStart(2, '0');

export function tsDay(ts: number): string {
  const d = new Date(2026, 9, 1 + Math.floor(ts / 1440));
  return p2(d.getDate()) + '.' + p2(d.getMonth() + 1);
}

export function tsTime(ts: number): string {
  const m = ((ts % 1440) + 1440) % 1440;
  return p2(Math.floor(m / 60)) + ':' + p2(m % 60);
}

/** Тот же день, что и `now` — только время, иначе «ДД.ММ ЧЧ:ММ». */
export const tsLabel = (ts: number, now: number): string =>
  Math.floor(ts / 1440) === Math.floor(now / 1440) ? tsTime(ts) : tsDay(ts) + ' ' + tsTime(ts);
