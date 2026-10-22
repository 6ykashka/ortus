// W4.61 · Модель «Использования» оператора (usageVM «Ортус CRM.dc.html» :3751–3805, design-2026-10-19) по
// getPlatformUsage (W4.07): плитки сводки, сигналы «Требуют внимания», отраслевые модули, строки «По организациям» и
// их сортировки. Только метаданные control DB; «сегодня» — measuredAt ответа.
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';

import {
  barTone,
  calendarDays,
  type Chip,
  type ChipTone,
  gb,
  mskLastDay,
  tenantChip,
} from '../kit/format.ts';
import { KIT_TEXT } from '../kit/texts.ts';
import type { BarTone } from '../kit/ui.tsx';
import { USAGE_TEXT as T } from './texts.ts';

type Usage = components['schemas']['PlatformUsage'];
type Signal = components['schemas']['PlatformUsageSignal'];
type UsageTenant = components['schemas']['PlatformUsageTenant'];

export interface Tile {
  label: string;
  value: string;
  sub: string;
}

export interface SignalRow {
  key: string;
  tenantId: string;
  org: string;
  text: string;
  tone: ChipTone;
  icon: string;
  act: 'card' | 'request';
}

export interface ModuleCard {
  key: string;
  name: string;
  icon: string;
  n: string;
  percent: number;
  seats: string;
  orgs: { tenantId: string | undefined; name: string }[];
}

export type SortKey = 'seats' | 'storage' | 'activity' | 'name';

export interface TableRow {
  tenantId: string;
  name: string;
  chip: Chip;
  tier: string;
  seats: string;
  seatsPercent: number;
  seatsTone: BarTone;
  storage: string;
  storagePercent: number;
  storageTone: BarTone;
  modules: string;
  act: string;
  /** Доля входивших за 7 дней; `null` — нет активных участников (в конец сортировки «По активности»). */
  activity: number | null;
  last: string;
  lastLate: boolean;
}

/** Порог «места почти закончились» и жёлтой полосы (usageVM :3756, :3771). */
const WARN_PERCENT = 85;
/** «Никто не входил» дольше этого числа дней — красная подпись последнего входа (usageVM :3803). */
const LATE_DAYS = 7;

const pct = (a: number, b: number): number => (b ? Math.min(100, (a / b) * 100) : 0);

/** Отраслевые модули каталога в порядке INDUSTRY (models.js :24–60): ключ контракта → иконка. */
const MODULES: readonly { key: string; icon: string }[] = [
  { key: 'fleet', icon: 'local_shipping' },
  { key: 'spa', icon: 'spa' },
  { key: 'repairs', icon: 'construction' },
];

/** Плитки сводки (usageVM :3786–3791); статусы с одной подписью («Ограничен») — одной строкой. */
export function summaryTiles(u: Usage): Tile[] {
  const s = u.summary;
  const byLabel = new Map<string, number>();
  for (const x of s.tenantsByStatus) {
    const label = tenantChip(x.status).label;
    byLabel.set(label, (byLabel.get(label) ?? 0) + x.count);
  }
  const of = (a: number | string, b: number | string) => format(T.tiles.of, { a, b });
  return [
    {
      label: T.tiles.orgs,
      value: String(s.tenantCount),
      sub: [...byLabel].map(([label, n]) => format(T.tiles.byStatus, { label, n })).join(' · '),
    },
    {
      label: T.tiles.seats,
      value: of(s.seatsUsed, s.seatsSold),
      sub: format(T.tiles.seatsSub, { p: Math.round(pct(s.seatsUsed, s.seatsSold)) }),
    },
    {
      label: T.tiles.storage,
      value: format(T.tiles.storageValue, {
        used: gb(s.storageUsedBytes),
        quota: gb(s.storageQuotaBytes),
      }),
      sub: format(T.tiles.storageSub, {
        p: Math.round(pct(s.storageUsedBytes, s.storageQuotaBytes)),
      }),
    },
    {
      label: T.tiles.active,
      value: of(s.activeMembers7d, s.activeMembers),
      sub: T.tiles.activeSub,
    },
  ];
}

const LEVEL: Readonly<Record<Signal['level'], number>> = { high: 3, medium: 2, low: 1 };
const KIND_ORDER: readonly Signal['kind'][] = [
  'seats_full',
  'seats_low',
  'storage_high',
  'trial_ending',
  'trial_expired',
  'suspended',
  'inactive',
];

/** Дни с последнего входа участников организации до measuredAt (календарные, по Москве). */
function lastDays(u: Usage, t: UsageTenant | undefined): number | null {
  return t?.lastSignInAt ? calendarDays(t.lastSignInAt, u.measuredAt) : null;
}

function signalView(
  u: Usage,
  s: Signal,
  t: UsageTenant | undefined,
  trialEnds: ReadonlyMap<string, string>,
): Omit<SignalRow, 'key' | 'tenantId' | 'org'> {
  const card = 'card' as const;
  switch (s.kind) {
    case 'seats_full':
    case 'seats_low': {
      const full = s.kind === 'seats_full';
      const base = format(full ? T.signals.seatsFull : T.signals.seatsLow, {
        used: s.seatsUsed ?? 0,
        limit: s.seatsLimit ?? 0,
      });
      const req = s.changeRequestNumber
        ? format(T.signals.request, { number: s.changeRequestNumber })
        : '';
      return {
        text: base + req,
        tone: full ? 'danger' : 'warn',
        icon: full ? 'no_accounts' : 'group',
        act: s.changeRequestId ? 'request' : card,
      };
    }
    case 'storage_high':
      return {
        text: format(T.signals.storage, {
          p: s.storagePercent ?? 0,
          used: gb(s.storageUsedBytes ?? 0),
          quota: gb(s.storageQuotaBytes ?? 0),
        }),
        tone: s.level === 'high' ? 'danger' : 'warn',
        icon: 'storage',
        act: card,
      };
    case 'trial_ending':
      return {
        text: format(T.signals.trialEnding, {
          date: s.trialEndsAt ? mskLastDay(s.trialEndsAt) : KIT_TEXT.dash,
          days: s.daysLeft ?? 0,
        }),
        tone: 'info',
        icon: 'hourglass_top',
        act: card,
      };
    case 'trial_expired': {
      const chip = tenantChip('read_only');
      const end = trialEnds.get(s.tenantId);
      return {
        text: format(T.signals.trialExpired, {
          label: chip.label,
          date: end ? mskLastDay(end) : KIT_TEXT.dash,
        }),
        tone: 'warn',
        icon: chip.icon,
        act: card,
      };
    }
    case 'suspended': {
      const chip = tenantChip('suspended');
      const days = lastDays(u, t);
      return {
        text:
          days === null
            ? format(T.signals.suspendedUnknown, { label: chip.label })
            : format(T.signals.suspendedSeen, { label: chip.label, days }),
        tone: 'danger',
        icon: chip.icon,
        act: card,
      };
    }
    case 'inactive': {
      const days = lastDays(u, t) ?? s.lastSignInDays ?? null;
      return {
        text: days === null ? T.inactiveNever : format(T.signals.inactive, { days }),
        tone: 'warn',
        icon: 'bedtime',
        act: card,
      };
    }
  }
}

/**
 * Сигналы «Требуют внимания» (usageVM :3766–3778): сначала по уровню, затем в порядке организаций ответа и видов
 * проверок эталона (стабильная сортировка по уровню). «Никто не входил» у приостановленной не показывается — у
 * эталона это ветка `else` сигнала приостановки; дни последнего входа — по lastSignInAt организации.
 */
export function signalRows(u: Usage, trialEnds: ReadonlyMap<string, string>): SignalRow[] {
  const order = new Map(u.tenants.map((t, i) => [t.tenantId, i]));
  const suspended = new Set(u.signals.filter((s) => s.kind === 'suspended').map((s) => s.tenantId));
  const rank = (s: Signal) => order.get(s.tenantId) ?? u.tenants.length;
  return u.signals
    .filter((s) => !(s.kind === 'inactive' && suspended.has(s.tenantId)))
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        LEVEL[b.s.level] - LEVEL[a.s.level] ||
        rank(a.s) - rank(b.s) ||
        KIND_ORDER.indexOf(a.s.kind) - KIND_ORDER.indexOf(b.s.kind) ||
        a.i - b.i,
    )
    .map(({ s }) => {
      const t = u.tenants.find((x) => x.tenantId === s.tenantId);
      return {
        key: `${s.tenantId}:${s.kind}`,
        tenantId: s.tenantId,
        org: s.tenantName,
        ...signalView(u, s, t, trialEnds),
      };
    });
}

const moduleName = (key: string): string => T.modules.names[key] ?? key;

/** «Отраслевые модули» (usageVM :3793–3796): все модули каталога, и неподключённые. */
export function moduleCards(u: Usage): ModuleCard[] {
  const total = u.summary.tenantCount;
  return MODULES.map(({ key, icon }) => {
    const m = u.modules.find((x) => x.moduleKey === key);
    const n = m?.tenantCount ?? 0;
    return {
      key,
      name: moduleName(key),
      icon,
      n: format(T.modules.of, { n, total }),
      percent: pct(n, total),
      seats: m
        ? format(T.modules.seats, { seats: m.seatsUsed, gb: gb(m.storageUsedBytes) })
        : T.modules.none,
      orgs: (m?.tenants ?? []).map((x) => ({ tenantId: x.tenantId, name: x.name })),
    };
  });
}

function lastText(days: number | null): string {
  if (days === null) return T.table.lastNone;
  if (days === 0) return T.table.lastToday;
  if (days === 1) return T.table.lastYesterday;
  return format(T.table.lastDays, { days });
}

/** Строки «По организациям» (usageVM :3798–3803) в порядке ответа. */
export function tableRows(u: Usage): TableRow[] {
  return u.tenants.map((t) => {
    const limit = t.seats.limit;
    const seatsPercent = limit ? pct(t.seats.used, limit) : 0;
    const storagePercent = pct(t.storageUsedBytes, t.storageQuotaBytes);
    const days = lastDays(u, t);
    return {
      tenantId: t.tenantId,
      name: t.name,
      chip: tenantChip(t.status),
      tier: t.tierName ?? KIT_TEXT.dash,
      seats:
        limit === null ? String(t.seats.used) : format(T.tiles.of, { a: t.seats.used, b: limit }),
      seatsPercent,
      seatsTone: barTone(seatsPercent, WARN_PERCENT),
      storage: format(T.tiles.storageValue, {
        used: gb(t.storageUsedBytes),
        quota: gb(t.storageQuotaBytes),
      }),
      storagePercent,
      storageTone: barTone(storagePercent, WARN_PERCENT),
      modules: t.moduleKeys.map(moduleName).join(', ') || KIT_TEXT.dash,
      act: format(T.tiles.of, { a: t.activeMembers7d, b: t.activeMembers }),
      activity: t.activeMembers ? t.activeMembers7d / t.activeMembers : null,
      last: lastText(days),
      lastLate: days !== null && days > LATE_DAYS,
    };
  });
}

const collator = new Intl.Collator('ru');

/** Сортировка таблицы (usageVM :3780–3782): по убыванию доли мест, хранилища, активности или по названию. */
export function sortRows(rows: readonly TableRow[], key: SortKey): TableRow[] {
  const by: Readonly<Record<Exclude<SortKey, 'name'>, (r: TableRow) => number>> = {
    seats: (r) => -r.seatsPercent,
    storage: (r) => -r.storagePercent,
    activity: (r) => (r.activity === null ? 1 : -r.activity),
  };
  if (key === 'name') return [...rows].sort((a, b) => collator.compare(a.name, b.name));
  const f = by[key];
  return [...rows].sort((a, b) => f(a) - f(b));
}
