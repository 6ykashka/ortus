// W6.21 · Форматы вкладки «Смета» (эталон design-2026-10-19 «Ремонт и стройка.dc.html»: rub :835, num :836,
// kTxt :848, plw :951). Деньги контракта — копейки (`Money.amountMinor`), на экране — рубли без копеек.
import type { components } from '@ortus/api-client';

type Unit = components['schemas']['RepairUnit'];

const grouped = new Intl.NumberFormat('ru-RU');

/** «438 175 ₽» из копеек; минус — «−» (U+2212). */
export function rub(minor: number): string {
  const r = Math.round(minor / 100);
  return `${r < 0 ? '−' : ''}${grouped.format(Math.abs(r))} ₽`;
}

/** Разница со знаком: меньше полрубля — «0 ₽» (sgn :1430). */
export function signed(minor: number): string {
  const r = minor / 100;
  if (Math.abs(r) < 0.5) return '0 ₽';
  return `${r > 0 ? '+' : '−'}${rub(Math.abs(minor))}`;
}

/** Форма слова по числу: 1 раздел, 2 раздела, 5 разделов. */
export function plw(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
});

/** «29.09» по Москве; нет даты — «—». */
export function dm(instant: string | undefined): string {
  if (!instant) return '—';
  const d = new Date(instant);
  return Number.isNaN(d.getTime()) ? '—' : dayMonth.format(d);
}

/** « × 1,07»; коэффициент 1 и пустой — без добавки. */
export function kTxt(coef: string | undefined): string {
  if (!coef) return '';
  const k = Number(coef);
  return k === 1 || !Number.isFinite(k) ? '' : ` × ${coef.replace('.', ',')}`;
}

const UNITS: Readonly<Record<Unit, string>> = {
  m2: 'м²',
  m: 'м',
  m3: 'м³',
  piece: 'шт',
  set: 'компл',
  trip: 'рейс',
  mesh: 'меш',
  liter: 'л',
  hour: 'ч',
};

export const unitLabel = (u: Unit): string => UNITS[u];
