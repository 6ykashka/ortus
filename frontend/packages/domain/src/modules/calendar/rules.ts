// Правила календаря 14.10 (models.js:391–410): занятость ресурса = [начало − подготовка,
// конец + уборка]; бронь занимает все свои ресурсы одновременно.
import type { Booking, Conflict, Resource } from './types.ts';

export const busySpan = (b: Booking): [number, number] => [
  b.start - (b.prep ?? 0),
  b.end + (b.clean ?? 0),
];

/** Пересечения кандидата с другими бронями по общим ресурсам (по одной строке на ресурс). */
export function bookingConflicts(
  bookings: readonly Booking[],
  cand: Booking,
  resources: readonly Resource[] = [],
): Conflict[] {
  const [a0, a1] = busySpan(cand);
  const out: Conflict[] = [];
  for (const b of bookings) {
    if (b.id === cand.id) continue;
    const [b0, b1] = busySpan(b);
    if (!(a0 < b1 && b0 < a1)) continue;
    for (const r of b.res) {
      if (!cand.res.includes(r)) continue;
      out.push({ res: r, resName: resources.find((x) => x.id === r)?.name ?? r, title: b.title });
    }
  }
  return out;
}

/** До `n` свободных начал брони с шагом 15 минут в пределах дня `[from, to]`, кроме текущего. */
export function freeSlots(
  bookings: readonly Booking[],
  b: Booking,
  n: number,
  from = 8,
  to = 20,
): number[] {
  const dur = b.end - b.start;
  const out: number[] = [];
  for (let t = from + (b.prep ?? 0); t + dur + (b.clean ?? 0) <= to && out.length < n; t += 0.25) {
    if (t === b.start) continue;
    if (!bookingConflicts(bookings, { ...b, start: t, end: t + dur }).length) out.push(t);
  }
  return out;
}
