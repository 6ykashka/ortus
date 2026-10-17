// W1.25 · Модель «Организаций» оператора: подписи строк и карточки (opVM :3532–3568) по Tenant и Subscription
// контракта 0.4.0-stage1, доступность команд (Q-W1.00-2, 3, 6), причина 5–500 (Q-W1.00-1), строка «Журнала
// действий» по action и details (S1-23, Q-W1.48-8). Данных, которых нет в контракте оператора этапа 1 (владелец,
// занятые места и место), — «—» (бриф W1.25 §10 п. 1).
import type { components } from '@ortus/api-client';
import { company, format, platform } from '@ortus/texts';
import type { Tone } from '@ortus/ui';

import { ORGS_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Tenant = S['Tenant'];
export type TenantStatus = Tenant['status'];
export type Subscription = S['Subscription'];
export type AuditEvent = S['PlatformAuditEvent'];

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

export interface Actions {
  extend: boolean;
  suspend: boolean;
  resume: boolean;
}

export interface AuditLine {
  text: string;
  meta: string;
  reason?: string;
}

export const REASON_MIN = 5;
export const REASON_MAX = 500;

const GiB = 1024 ** 3;
const DAY = 86_400_000;
/** Предел «без ограничения» мест: MSW выдаёт безлимитному тарифу 1 000 000 (adapter billing TIERS). */
const UNLIMITED_SEATS = 1_000_000;

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

/** Чип статуса организации (TENANT_STATE эталона, models.js:151–156; бриф §10 п. 4). */
export const statusChip = (status: TenantStatus): Chip => CHIPS[status];

const mskDay = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const mskStamp = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Последний день периода по Москве: конец — исключающая граница (полночь следующего дня). */
export const mskDate = (iso: string): string => mskDay.format(new Date(Date.parse(iso) - 1));

/** «30.09 18:12» по Москве (строка журнала эталона :1908). */
const stamp = (iso: string): string => mskStamp.format(new Date(iso)).replace(', ', ' ');

const fromTrial = (sub: Subscription): boolean =>
  sub.status === 'trialing' ||
  ((sub.status === 'grace' || sub.status === 'read_only') &&
    sub.entitlements.some((e) => e.sourceType === 'trial'));

const entitlement = (sub: Subscription | undefined, key: string): number | undefined =>
  sub?.entitlements.filter((e) => e.key === key).at(-1)?.value;

const seatLimit = (sub: Subscription | undefined): number | null => {
  const v = entitlement(sub, 'seats');
  return v === undefined || v >= UNLIMITED_SEATS ? null : v;
};

const num = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');

/** Колонка пробного периода (opVM :3548): осталось · до, завершён, не применяется. */
export function trialText(sub: Subscription | undefined, now: number): string {
  if (!sub) return T.dash;
  if (sub.status === 'trialing' && sub.trialEndsAt) {
    const days = Math.max(0, Math.floor((Date.parse(sub.trialEndsAt) - now) / DAY));
    return format(T.trialLeft, { days, date: mskDate(sub.trialEndsAt) });
  }
  // После неоплаченного trial (grace/read_only с правами trial) — «Завершён»; дату конца стенд у read_only не отдаёт.
  if (sub.status !== 'trialing' && fromTrial(sub)) {
    return format(T.trialEnded, { date: sub.trialEndsAt ? mskDate(sub.trialEndsAt) : T.dash });
  }
  return T.notApplicable;
}

/** Версия цен из источника прав: `price-book:v2:start` → 2. */
const priceVersion = (sub: Subscription): string | undefined =>
  sub.entitlements
    .map((e) => /^price-book:v(\d+):/.exec(e.sourceRef)?.[1])
    .find((v) => v !== undefined);

/**
 * «Тариф» карточки (opVM :3559): «{тариф}» · пробный · цены vN — «пробный» только у идущего trial (у
 * grace/read_only после trial его нет); срока подписки в контракте нет (§10 п. 10).
 */
export function planText(sub: Subscription | undefined): string {
  if (!sub) return T.dash;
  const tier = T.tiers[sub.planKey] ?? sub.planKey;
  const version = priceVersion(sub);
  if (!version) return format(T.plan.bare, { tier });
  return format(sub.status === 'trialing' ? T.plan.trial : T.plan.paid, { tier, version });
}

/** «Оплата» карточки (opVM :3560): пробный период, оплачено до (без суммы — прайс этапа 4), иначе «—». */
export function paymentText(sub: Subscription | undefined): string {
  if (!sub) return T.dash;
  if (sub.status === 'trialing') return company.modules.trial.chipTrial;
  if (sub.periodEndsAt && !fromTrial(sub)) {
    return format(company.billing.paidUntil, { date: mskDate(sub.periodEndsAt) });
  }
  return T.dash;
}

/** «Владелец: — · мест —/10» (opVM :3545; владелец и занятые места — этап 4). */
export function ownerLine(sub: Subscription | undefined): string {
  const limit = seatLimit(sub);
  const seats = limit === null ? T.dash : format(T.ownerSeats, { used: T.dash, limit });
  return format(platform.tenants.ownerLine, { name: T.dash, seats });
}

const quotaGb = (sub: Subscription | undefined): number | undefined => {
  const v = entitlement(sub, 'storage_quota_bytes');
  return v === undefined ? undefined : v / GiB;
};

/** «— из 100 ГБ» (opVM :3547; занятое место — этап 4). */
export function usageText(sub: Subscription | undefined): string {
  const quota = quotaGb(sub);
  return quota === undefined ? T.dash : format(T.usage, { used: T.dash, quota: num(quota) });
}

/** Квота в гигабайтах: «50 ГБ». */
export function quotaText(sub: Subscription | undefined): string {
  const quota = quotaGb(sub);
  return quota === undefined ? T.dash : format(T.gb, { gb: num(quota) });
}

/**
 * «Места с входом» (opVM :3562): «— из 10», без лимита — «— · без ограничения»; подписки нет (загрузка,
 * ошибка) — «—»: о лимите ничего не известно.
 */
export function seatsText(sub: Subscription | undefined): string {
  if (!sub) return T.dash;
  const limit = seatLimit(sub);
  return limit === null
    ? format(T.seatsUnlimited, { used: T.dash })
    : format(T.seatsOf, { used: T.dash, limit });
}

const SUSPENDABLE: ReadonlySet<TenantStatus> = new Set(['trial', 'active', 'grace', 'read_only']);
const LIVE: ReadonlySet<TenantStatus> = new Set([...SUSPENDABLE, 'suspended']);

/**
 * Команды карточки: «Продлить…» — trialing или grace/read_only после trial (Q-W1.00-6), «Ограничить…» —
 * trial/active/grace/read_only (Q-W1.00-2), «Снять ограничение» — suspended (Q-W1.00-3).
 */
export function actionsFor(t: Tenant, sub: Subscription | undefined): Actions {
  return {
    extend: LIVE.has(t.status) && sub !== undefined && fromTrial(sub),
    suspend: SUSPENDABLE.has(t.status),
    resume: t.status === 'suspended',
  };
}

/** Причина действия оператора: 5–500 символов после обрезки пробелов (TenantStatusChange.reason). */
export function reasonOk(text: string): boolean {
  const n = text.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
}

/**
 * Ошибка поля «Причина» до отправки: длиннее 500 символов — текст под полем (иначе кнопка недоступна молча);
 * короче 5 — без ошибки: кнопка недоступна, подсказка «От 5 до 500 символов» (design-requests).
 */
export function reasonTooLong(text: string): string | undefined {
  return text.trim().length > REASON_MAX ? T.reason.tooLong : undefined;
}

/** «Евгения Лаптева» → «Е. Лаптева» (подпись автора журнала эталона :1908). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return T.dash;
  if (parts.length === 1) return parts[0] as string;
  const [first, ...rest] = parts;
  return `${(first as string).charAt(0)}. ${rest.join(' ')}`;
}

const statusLabel = (s: string | undefined): string =>
  s && s in CHIPS ? CHIPS[s as TenantStatus].label : (s ?? T.dash);

function lineText(e: AuditEvent): string {
  const name = e.target.name ?? T.dash;
  const d = e.details ?? {};
  const days = Number(d.days ?? 0);
  switch (e.action) {
    case 'subscription.trial_started':
      return d.quotaBytes
        ? format(T.audit.trialStartedQuota, { name, days, gb: num(Number(d.quotaBytes) / GiB) })
        : format(T.audit.trialStarted, { name, days });
    case 'subscription.trial_ended':
      return format(T.audit.trialEnded, { name });
    case 'subscription.trial_extended':
      return format(T.audit.trialExtended, { name, days });
    case 'tenant.suspended':
      return format(T.audit.status, { name, status: statusLabel(d.toStatus ?? 'suspended') });
    case 'tenant.resumed':
      return format(T.audit.status, { name, status: statusLabel(d.toStatus) });
    case 'storage.quota_changed':
      return format(T.audit.quota, { name, gb: num(Number(d.quotaBytes ?? 0) / GiB) });
    case 'tenant.renamed':
      return format(T.audit.renamed, { name });
    case 'tenant.created':
      return format(T.audit.created, { name });
    default:
      return format(T.audit.other, { name, action: e.action });
  }
}

/** Строка «Журнала действий»: текст по action и details, «ДД.ММ ЧЧ:ММ · автор», причина (Q-W1.48-8). */
export function auditLine(e: AuditEvent): AuditLine {
  const base = lineText(e);
  const text =
    e.result === 'denied'
      ? format(T.audit.denied, { text: base })
      : e.result === 'failed'
        ? format(T.audit.failed, { text: base })
        : base;
  const by =
    e.actor.kind === 'system' || !e.actor.displayName
      ? T.audit.system
      : shortName(e.actor.displayName);
  const line: AuditLine = { text, meta: format(T.audit.meta, { at: stamp(e.at), by }) };
  if (e.reason) line.reason = format(T.audit.reason, { reason: e.reason });
  return line;
}

/** Знак организации: первый буквенно-цифровой символ имени (brand.short — этап 4, §10 п. 9). */
export function markLetter(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toUpperCase() : '?';
}
