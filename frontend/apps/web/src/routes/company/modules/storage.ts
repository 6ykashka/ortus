// W1.24 · Место организации (omVM :3123–3135, filesVM :4228–4230): числа «ГБ», доля и тон полосы, перебор,
// варианты лимита, разбивка по группам эталона и модулям (getStorageUsage, getStorageBreakdown).
// «Занято» — единственный оплачиваемый итог контракта: committedBytes + reservedBytes (StorageUsage).
import type { components } from '@ortus/api-client';
import { ALL_MODULES, INDUSTRY, num, rub } from '@ortus/domain';
import { company, toast as TOAST } from '@ortus/texts';

import { MOD_TEXT, t } from './texts.ts';

type S = components['schemas'];
type GroupKey = S['StorageBreakdownGroup']['key'];

export const GiB = 1024 ** 3;
/** Варианты «Лимит места» (:3133). */
export const QUOTA_OPTIONS = [25, 50, 100, 250, 500] as const;
const GROUPS: readonly GroupKey[] = ['photos', 'documents', 'attachments', 'other'];

export type BarTone = 'accent' | 'warn' | 'danger';

export interface StorageView {
  usedNum: number;
  quotaNum: number;
  /** «46,2 ГБ». */
  used: string;
  /** «100 ГБ». */
  quota: string;
  /** «46.2%» — ширина заливки. */
  pct: string;
  tone: BarTone;
  over: boolean;
  overText: string;
  reserved: string;
  options: { value: string; label: string }[];
}

export interface BreakdownRow {
  key: string;
  label: string;
  gb: string;
  files: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const MSK_MS = 3 * 3_600_000;
const two = (n: number): string => String(n).padStart(2, '0');

/** «13.10.2026» — московская дата момента (мс от эпохи). */
export function mskDate(ms: number): string {
  const d = new Date(ms + MSK_MS);
  return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** «10:30» — московское время момента. */
export function mskTime(ms: number): string {
  const d = new Date(ms + MSK_MS);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** ГБ (ГиБ) с одной цифрой после запятой. */
export const gbNum = (bytes: number): number => round1(bytes / GiB);

/** «46,2», «100». */
export const gbText = (bytes: number): string => num(gbNum(bytes));

const gbLabel = (bytes: number): string => t(company.modules.storage.gb, { gb: gbText(bytes) });

/** Занято: файлы, оценка базы и резерв начатых загрузок. */
export const usedBytes = (u: S['StorageUsage']): number => u.committedBytes + u.reservedBytes;

export function storageView(u: S['StorageUsage']): StorageView {
  const used = usedBytes(u);
  const usedNum = gbNum(used);
  const quotaNum = gbNum(u.quotaBytes);
  const ratio = u.quotaBytes > 0 ? (used / u.quotaBytes) * 100 : 100;
  const pct = Math.min(100, ratio);
  const over = used >= u.quotaBytes || u.writeStatus === 'blocked';
  const lack = round1(Math.max(0, usedNum - quotaNum));
  return {
    usedNum,
    quotaNum,
    used: gbLabel(used),
    quota: gbLabel(u.quotaBytes),
    pct: pct.toFixed(1) + '%',
    tone: over ? 'danger' : pct > 85 ? 'warn' : 'accent',
    over,
    overText: t(company.modules.storage.overText, { gb: num(lack) }),
    reserved: gbText(u.reservedBytes),
    options: QUOTA_OPTIONS.map((n) => ({
      value: String(n),
      label: t(company.modules.storage.option, { gb: n, below: String(n < usedNum) }),
    })),
  };
}

/** Лимит смены в целых ГБ. */
const changeGb = (c: S['StorageChange']): number => Math.round(c.requestedQuotaBytes / GiB);

/** Строка расчёта «Хранилища»: с ценой в месяц, если расчёт её дал; без `recurringCharge` — без цены. */
export function quoteLine(c: S['StorageChange']): string {
  const gb = changeGb(c);
  const charge = c.recurringCharge;
  if (!charge) return t(MOD_TEXT.storage.quoteLineFree, { gb });
  return t(MOD_TEXT.storage.quoteLine, { gb, price: rub(charge.amountMinor / 100) });
}

/** Тост после подтверждения: `applied` — лимит применён; `scheduled` — уменьшение вступит позже. */
export function changeDoneText(c: S['StorageChange']): string {
  const gb = changeGb(c);
  if (c.state !== 'scheduled') return t(TOAST.company.quota, { gb });
  return c.effectiveAt
    ? t(MOD_TEXT.storage.pending, { gb, at: mskDate(Date.parse(c.effectiveAt)) })
    : t(MOD_TEXT.storage.pendingNoDate, { gb });
}

export function breakdownRows(b: S['StorageBreakdown']): BreakdownRow[] {
  return GROUPS.map((key) => {
    const g = b.groups.find((x) => x.key === key);
    return {
      key,
      label: MOD_TEXT.groups[key],
      gb: gbLabel(g?.bytes ?? 0),
      files: g?.fileCount ?? 0,
    };
  });
}

/**
 * Подпись модуля-источника: отраслевые — по ключу контракта, базовые — по CORE, `core` — служебные данные;
 * неизвестный ключ — `null` (код API пользователю не выводится).
 */
function moduleLabel(key: string): string | null {
  if (key === 'core') return MOD_TEXT.storage.coreModule;
  if (key === 'fleet') return INDUSTRY.logistics.name;
  if (key === 'repairs') return INDUSTRY.repair.name;
  return (ALL_MODULES as Record<string, { name: string } | undefined>)[key]?.name ?? null;
}

/** Разбивка «По модулям»: модули с неизвестным ключом — одна строка «Прочее» в конце. */
export function moduleRows(b: S['StorageBreakdown']): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const unknown = b.modules.filter((m) => moduleLabel(m.moduleKey) === null);
  for (const m of b.modules) {
    const label = moduleLabel(m.moduleKey);
    if (label !== null) {
      rows.push({ key: m.moduleKey, label, gb: gbLabel(m.bytes), files: m.fileCount });
    }
  }
  if (unknown.length > 0) {
    rows.push({
      key: 'other',
      label: MOD_TEXT.groups.other,
      gb: gbLabel(unknown.reduce((n, m) => n + m.bytes, 0)),
      files: unknown.reduce((n, m) => n + m.fileCount, 0),
    });
  }
  return rows;
}
