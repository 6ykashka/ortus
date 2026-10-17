// W2.25 · Время и дата подписей «Главной» в часовом поясе (часы инжектируемые, Q-61).

const parts = (at: Date, timeZone: string, o: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('ru-RU', { timeZone, ...o })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** «14:00». */
export function hhmm(at: Date, timeZone: string): string {
  const p = parts(at, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** Час суток 0…23. */
export function hourOf(at: Date, timeZone: string): number {
  return Number(parts(at, timeZone, { hour: '2-digit', hourCycle: 'h23' }).hour);
}

/** «13.10.2026». */
export function ddmmyyyy(at: Date, timeZone: string): string {
  const p = parts(at, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}.${p.month}.${p.year}`;
}

/** Ключ календарного дня «2026-10-01» в часовом поясе. */
export function dayKey(at: Date, timeZone: string): string {
  const p = parts(at, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.year}-${p.month}-${p.day}`;
}
