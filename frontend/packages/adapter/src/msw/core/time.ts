// Время сервера (W0.13): ISO-моменты без миллисекунд (`Instant` контракта, суффикс Z) и даты прототипа
// в Москве (UTC+3, без перехода на летнее время).

const MSK_OFFSET_H = 3;

/** ISO-момент без миллисекунд: `2026-10-01T07:30:00Z`. */
export const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Момент `at` плюс `ms` миллисекунд. */
export const addMs = (at: string, ms: number): string => iso(new Date(Date.parse(at) + ms));

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** «01.10 09:12» прототипа (2026 год, Москва) → момент UTC; пусто → undefined. */
export function mskStamp(s: string | null | undefined): string | undefined {
  const m = /^(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(s ?? '');
  if (!m) return undefined;
  const [, dd, mm, h, min] = m.map(Number) as [number, number, number, number, number];
  return iso(new Date(Date.UTC(2026, mm - 1, dd, h - MSK_OFFSET_H, min)));
}

/** «13.10.2026» → конец дня по Москве (`2026-10-13T21:00:00Z`); пусто → undefined. */
export function mskEndOfDay(s: string | null | undefined): string | undefined {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s ?? '');
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m.map(Number) as [number, number, number, number];
  return iso(new Date(Date.UTC(yyyy, mm - 1, dd + 1, -MSK_OFFSET_H)));
}

/** Начало московских суток момента `at`, сдвинутое на `months` месяцев (конец оплаченного периода). */
export function mskDayPlusMonths(at: string, months: number): string {
  const msk = new Date(Date.parse(at) + MSK_OFFSET_H * HOUR);
  return iso(
    new Date(
      Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() + months, msk.getUTCDate(), -MSK_OFFSET_H),
    ),
  );
}
