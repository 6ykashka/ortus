// Место организации (api.js 14.10:970–985). Загрузка: резерв → передача → проверка → готов;
// здесь — чистые правила, сама сессия загрузки — W1.09 / MSW (W0.13).
import type { StorageRow, StorageUsage } from './types.ts';

export const QUOTA_TEXT = 'Место организации заполнено. Загрузка новых файлов недоступна.';

/** Статусы рейса, при которых смена уже начата: её фото пишутся во временный резерв. */
const STARTED = new Set(['inspection', 'on_route', 'returning', 'rework']);

/** Сумма разбивки занятого места, ГБ (с точностью до 0,1). */
export const storageTotal = (breakdown: readonly StorageRow[]): number =>
  Math.round(breakdown.reduce((s, [, gb]) => s + gb, 0) * 10) / 10;

/** Занятое место после загрузки `bytes` байт, ГБ (с точностью до мегабайта). */
export const addUsage = (usedGb: number, bytes: number): number =>
  Math.round((usedGb + bytes / 1e9) * 1000) / 1000;

/** Текст отказа `quota_exceeded` или `null`, если загрузку можно начать. */
export function uploadQuotaError(
  usage: StorageUsage,
  trips: readonly { status: string }[],
): string | null {
  if (usage.usedGb < usage.quotaGb) return null;
  return trips.some((t) => STARTED.has(t.status)) ? null : QUOTA_TEXT;
}
