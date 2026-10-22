// W4.61 · Форматирование страниц шага 4.6: рубли и гигабайты (models.js rub, usageVM gb), склонение (M.plural),
// даты по Москве (контракт — Instant UTC, эталон — даты МСК), сокращённое имя автора, буква знака организации
// (accountsVM :3634), чип статуса организации (TENANT_STATE; Q-W1.25-4) и цвет полос заполнения (usageVM barC,
// billingVM :3930).
import type { components } from '@ortus/api-client';

import { KIT_TEXT as T } from './texts.ts';

export type TenantStatus = components['schemas']['Tenant']['status'];
export type ChipTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
export interface Chip {
  label: string;
  tone: ChipTone;
  icon: string;
}

const GiB = 1024 ** 3;
const DAY = 86_400_000;
const MSK_OFFSET = 3 * 3_600_000;

/** «3 900 ₽» — разряды неразрывным пробелом (toLocaleString ru-RU, M.rub). */
export const rub = (rubles: number): string =>
  `${rubles.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

/** Сумма контракта в копейках → «11 920 ₽». */
export const rubMinor = (minor: number): string => rub(minor / 100);

/** Байты → «46,2» ГБ (один знак, целые без дробной части). */
export const gb = (bytes: number): string =>
  String(Math.round((bytes / GiB) * 10) / 10).replace('.', ',');

/** Склонение по числу: один, несколько (2–4), много (M.plural). */
export function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return one;
  if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return few;
  return many;
}

const day = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const stamp = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** День начала по Москве: «01.10.2026». */
export const mskDate = (iso: string): string => day.format(new Date(iso));

/** Последний день периода: конец — исключающая граница (полночь следующего дня по Москве). */
export const mskLastDay = (iso: string): string => day.format(new Date(Date.parse(iso) - 1));

/** «29.09 16:40» по Москве. */
export const mskStamp = (iso: string): string => stamp.format(new Date(iso)).replace(', ', ' ');

/** Номер московских суток момента. */
const mskDayIndex = (iso: string): number => Math.floor((Date.parse(iso) + MSK_OFFSET) / DAY);

/** Календарные дни от `from` до `to` по Москве, не меньше 0 (usageVM days: даты без времени). */
export const calendarDays = (from: string, to: string): number =>
  Math.max(0, mskDayIndex(to) - mskDayIndex(from));

/** «Евгения Лаптева» → «Е. Лаптева» (автор версии и решения в эталоне). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (!first) return T.dash;
  if (rest.length === 0) return first;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}

/** Буква знака: короткое имя оформления или название, только буквы и цифры (accountsVM :3634). */
export function markLetter(name: string, short?: string): string {
  const letter = (short || name).replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').charAt(0);
  return letter ? letter.toUpperCase() : '·';
}

const CHIPS: Readonly<Record<TenantStatus, Chip>> = {
  trial: { label: T.status.trial, tone: 'info', icon: 'hourglass_top' },
  active: { label: T.status.active, tone: 'ok', icon: 'check_circle' },
  grace: { label: T.status.restricted, tone: 'warn', icon: 'lock_clock' },
  read_only: { label: T.status.restricted, tone: 'warn', icon: 'lock_clock' },
  suspended: { label: T.status.suspended, tone: 'danger', icon: 'pause_circle' },
  provisioning: { label: T.status.provisioning, tone: 'neutral', icon: 'hourglass_empty' },
  closing: { label: T.status.closing, tone: 'neutral', icon: 'schedule' },
  closed: { label: T.status.closed, tone: 'neutral', icon: 'block' },
};

/** Чип статуса организации (TENANT_STATE эталона; grace и read_only — «Ограничен», Q-W1.25-4). */
export const tenantChip = (status: TenantStatus): Chip => CHIPS[status];

/**
 * Цвет полосы заполнения: 100 % и больше — danger, от порога `warnAt` (включительно; `strict` — строго больше)
 * — warn, иначе акцент (usageVM barC: ≥ 85; billingVM: > 80).
 */
export function barTone(
  percent: number,
  warnAt: number,
  strict = false,
): 'accent' | 'warn' | 'danger' {
  if (percent >= 100) return 'danger';
  if (strict ? percent > warnAt : percent >= warnAt) return 'warn';
  return 'accent';
}
