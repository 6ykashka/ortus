// Утилиты документов (documents.js 14.10:6–19): дата `дд.мм.гггг`, рабочие дни с праздником 04.11,
// слепок содержимого версии. `plural` и `shortName` — в ядре (`core/format.ts`).
// `addWork` эталона конфликтует по имени с `service.addWork`, поэтому здесь `addWorkDays` (B §5.2).

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Нерабочие праздники организации (эталон знает один — 04.11.2026). */
export const HOLIDAYS: ReadonlySet<string> = new Set(['04.11.2026']);

/** `дд.мм.гггг` как число для сравнения; не разобранная дата — 0. */
export function dval(s: string | undefined): number {
  const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s ?? '');
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}

function toDate(s: string): Date {
  const [d, m, y] = s.split('.').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(x: Date): string {
  return p2(x.getUTCDate()) + '.' + p2(x.getUTCMonth() + 1) + '.' + x.getUTCFullYear();
}

/** Срок через `n` рабочих дней: без суббот, воскресений и праздников. Расчёт в UTC — не зависит от TZ. */
export function addWorkDays(
  from: string,
  n: number,
  holidays: ReadonlySet<string> = HOLIDAYS,
): string {
  const x = toDate(from);
  let k = 0;
  while (k < n) {
    x.setUTCDate(x.getUTCDate() + 1);
    const w = x.getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(fmtDate(x))) k++;
  }
  return fmtDate(x);
}

/** Короткий слепок содержимого версии для листа согласования: `xxxx…xxxx`. */
export function shaOf(o: unknown): string {
  // `|| ''`, как в эталоне: 0, false и null слепятся как пустая строка.
  const s = JSON.stringify(o || '');
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b + c, 2246822519) >>> 0;
  }
  const h = (a.toString(16) + b.toString(16)).padStart(16, '0');
  return h.slice(0, 4) + '…' + h.slice(-4);
}
