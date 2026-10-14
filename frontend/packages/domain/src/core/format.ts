// Общие форматтеры домена (B §5.2 `format.ts`). Источники 14.10: `models.js:237–240, 411–414`,
// `cash.js:13–15`, `chats.js:14–15, 276–278`, `documents.js:16–17`, `service.js:64`.
// Варианты эталона сохранены как есть: `rub` из models.js (обычный пробел перед ₽),
// `signRub` из cash.js (NBSP и знак «−»), `plural` — только форма, `pluralN` — число и форма.

type Opt = string | null | undefined;

export const num = (n: number): string => String(n).replace('.', ',');

export const int = (n: number): string => Number(n).toLocaleString('ru-RU');

export const rub = (n: number): string =>
  Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

const rubNbsp = (n: number): string =>
  Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

export const signRub = (n: number): string =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + rubNbsp(Math.abs(n));

export const gb = (mb: number): string =>
  mb >= 1000
    ? String(Math.round(mb / 100) / 10).replace('.', ',') + ' ГБ'
    : String(Math.round(mb * 10) / 10).replace('.', ',') + ' МБ';

export function plural(n: number, a: string, b: string, c: string): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return a;
  if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return b;
  return c;
}

export const pluralN = (n: number, a: string, b: string, c: string): string =>
  n + ' ' + plural(n, a, b, c);

/** Часы дробным числом (календарь): 8.25 → «08:15». */
export const hm = (t: number): string =>
  String(Math.floor(t)).padStart(2, '0') + ':' + String(Math.round((t % 1) * 60)).padStart(2, '0');

export const shortName = (n: Opt): string => {
  const p = String(n ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const [first, ...rest] = p;
  if (first && rest.length) return first.charAt(0) + '. ' + rest.join(' ');
  return n || '—';
};

export const initials = (name: string): string =>
  name
    .split(' ')
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const emailOk = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

export const maskPhone = (p: Opt): string => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length < 4 ? '•••' : '+7 ••• •••-••-' + d.slice(-2);
};

const PHONE = /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*(\d{2})/g;

export const maskPdn = (t: Opt): string =>
  String(t ?? '').replace(
    PHONE,
    (_m: string, _code: string, last: string) => '+7 ••• •••-••-' + last,
  );

export const hasPdn = (t: Opt): boolean => {
  PHONE.lastIndex = 0;
  const r = PHONE.test(String(t ?? ''));
  PHONE.lastIndex = 0;
  return r;
};
