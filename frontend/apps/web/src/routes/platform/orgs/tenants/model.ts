// W1.25 · Модель «Организаций» оператора: подписи строк и карточки (opVM :3532–3568) по Tenant и Subscription,
// доступность команд (Q-W1.00-2, 3, 6), причина 5–500 (Q-W1.00-1), строка «Журнала действий» по action и details
// (S1-23, Q-W1.48-8). W4.84: данные W4.07/W4.60 — владелец, модули и занятое место (getPlatformUsage), места и
// участники (Tenant, Subscription.seats), срок и сумма периода, «Квота места» (updatePlatformSubscription) и плашка
// заявки на тариф; чего нет в ответе — «—».
import type { components } from '@ortus/api-client';
import { company, format, platform } from '@ortus/texts';
import type { Tone } from '@ortus/ui';

import { rubMinor } from '../../kit/format.ts';
import { ORGS_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Tenant = S['Tenant'];
export type TenantStatus = Tenant['status'];
export type Subscription = S['Subscription'];
export type SeatUsage = S['SeatUsage'];
export type UsageRow = S['PlatformUsageTenant'];
export type ChangeRequest = S['SubscriptionChangeRequest'];
export type AuditEvent = S['PlatformAuditEvent'];

export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}

/** Цвет заливки полосы (opVM bar, sBar): акцент, warn или danger. */
export type BarTone = 'accent' | 'warn' | 'danger';

/** Заливка полосы: ширина в процентах (как pW/sW эталона, один знак) и цвет. */
export interface Fill {
  width: string;
  tone: BarTone;
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
const MSK_OFFSET = 3 * 3_600_000;
const QUOTA_KEY = 'storage_quota_bytes';

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

/** Действующее значение права: ручное право скрывает право тарифа того же ключа (W1.08, pilot-quotas). */
const entitlement = (sub: Subscription | undefined, key: string): number | undefined => {
  const all = sub?.entitlements.filter((e) => e.key === key) ?? [];
  return (all.filter((e) => e.sourceType === 'manual').at(-1) ?? all.at(-1))?.value;
};

/** Число с одним знаком и запятой: «46,2», «100» (M.num эталона). */
export const num = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');

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

/** Версия цен: priceVersion подписки (W4.07), иначе из источника прав `price-book:v2:start` → 2. */
const priceVersion = (sub: Subscription): string | undefined =>
  sub.priceVersion !== undefined
    ? String(sub.priceVersion)
    : sub.entitlements
        .map((e) => /^price-book:v(\d+):/.exec(e.sourceRef)?.[1])
        .find((v) => v !== undefined);

/** Срок «Тарифа»: идущий trial — «пробный», 1 месяц — «помесячно», иначе «{n} мес»; срока нет — ничего. */
function termText(sub: Subscription): string | undefined {
  if (sub.status === 'trialing') return T.plan.trial;
  if (sub.termMonths === undefined) return undefined;
  return sub.termMonths === 1 ? T.plan.monthly : format(T.plan.term, { months: sub.termMonths });
}

/**
 * «Тариф» карточки (opVM :3559): «{тариф}» · {срок} · цены vN — имя ступени сетки (tierName), срок периода
 * (termMonths; «пробный» только у идущего trial — у grace/read_only после trial его нет) и версия цен периода.
 * Без версии (неизвестный тариф) — только имя.
 */
export function planText(sub: Subscription | undefined): string {
  if (!sub) return T.dash;
  const tier = format(T.plan.tier, { tier: sub.tierName ?? T.tiers[sub.planKey] ?? sub.planKey });
  const version = priceVersion(sub);
  if (!version) return tier;
  return [tier, termText(sub), format(T.plan.version, { version })]
    .filter((p): p is string => p !== undefined)
    .join(T.plan.sep);
}

/**
 * «Оплата» карточки (opVM :3561): пробный период; «Оплачено до ДД.ММ.ГГГГ · 6 800 ₽/мес» — сумма месяца
 * периода со скидкой срока (monthlyAmount; нет у индивидуальной цены — только дата); иначе «—».
 */
export function paymentText(sub: Subscription | undefined): string {
  if (!sub) return T.dash;
  if (sub.status === 'trialing') return company.modules.trial.chipTrial;
  if (sub.periodEndsAt && !fromTrial(sub)) {
    const paid = format(company.billing.paidUntil, { date: mskDate(sub.periodEndsAt) });
    return sub.monthlyAmount
      ? format(T.perMonth, { paid, amount: rubMinor(sub.monthlyAmount.amountMinor) })
      : paid;
  }
  return T.dash;
}

/** Места организации: из подписки (W4.07), иначе из строки организации (Tenant.seats). */
export const seatsOf = (t: Tenant, sub: Subscription | undefined): SeatUsage | undefined =>
  sub?.seats ?? t.seats;

/** «Владелец: Дарья Зимина · мест 9/10» (opVM :3545); без лимита — «мест 40»; нет данных — «—». */
export function ownerLine(owner: string | undefined, seats: SeatUsage | undefined): string {
  const count = !seats
    ? T.dash
    : seats.limit === null
      ? String(seats.used)
      : format(T.ownerSeats, { used: seats.used, limit: seats.limit });
  return format(platform.tenants.ownerLine, { name: owner || T.dash, seats: count });
}

/** Квота места в ГБ (право `storage_quota_bytes` подписки). */
export const quotaGb = (sub: Subscription | undefined): number | undefined => {
  const v = entitlement(sub, 'storage_quota_bytes');
  return v === undefined ? undefined : v / GiB;
};

/** Занятое место в ГБ с одним знаком (opVM: usedGb округляется до 0,1). */
export const usedGb = (bytes: number): number => Math.round((bytes / GiB) * 10) / 10;

/** «46,2 из 100 ГБ» (opVM :3547); занятое не загружено — «— из 100 ГБ»; без квоты — «—». */
export function usageText(usedBytes: number | undefined, sub: Subscription | undefined): string {
  const quota = quotaGb(sub);
  if (quota === undefined) return T.dash;
  const used = usedBytes === undefined ? T.dash : num(usedGb(usedBytes));
  return format(T.usage, { used, quota: num(quota) });
}

const EMPTY: Fill = { width: '0%', tone: 'accent' };
const width = (percent: number): string => `${Math.min(100, percent).toFixed(1)}%`;

/** Полоса места (opVM bar :3537): занято всё — danger, больше 85 % — warn, иначе акцент. */
export function storageFill(usedBytes: number | undefined, sub: Subscription | undefined): Fill {
  const quota = quotaGb(sub);
  if (usedBytes === undefined || !quota) return EMPTY;
  const used = usedGb(usedBytes);
  const tone: BarTone = used >= quota ? 'danger' : used / quota > 0.85 ? 'warn' : 'accent';
  return { width: width((used / quota) * 100), tone };
}

/** Квота в гигабайтах: «50 ГБ». */
export function quotaText(sub: Subscription | undefined): string {
  const quota = quotaGb(sub);
  return quota === undefined ? T.dash : format(T.gb, { gb: num(quota) });
}

/**
 * «Места с входом» (opVM :3560): «9 из 10», все заняты — «10 из 10 · мест нет», без лимита —
 * «40 · без ограничения»; мест нет в данных (загрузка, ошибка) — «—».
 */
export function seatsText(seats: SeatUsage | undefined): string {
  if (!seats) return T.dash;
  if (seats.limit === null) return format(T.seatsUnlimited, { used: seats.used });
  const text = format(T.seatsOf, { used: seats.used, limit: seats.limit });
  return seats.used >= seats.limit ? text + T.seatsFull : text;
}

/** Полоса мест (opVM :3561): все заняты — danger, больше 80 % — warn; без лимита — пустая. */
export function seatsFill(seats: SeatUsage | undefined): Fill {
  if (!seats) return EMPTY;
  const { limit, used } = seats;
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  const tone: BarTone =
    limit !== null && used >= limit ? 'danger' : percent > 80 ? 'warn' : 'accent';
  return { width: width(percent), tone };
}

/** «Модули» (opVM :3551): названия отраслевых модулей; без них — «Только ядро»; не загружены — «—». */
export function modulesText(keys: readonly string[] | undefined): string {
  if (!keys) return T.dash;
  if (keys.length === 0) return platform.tenants.coreOnly;
  return keys.map((k) => T.modules[k] ?? k).join(', ');
}

/** «Участники» (opVM :3551): незавершённые членства. */
export const membersText = (n: number | undefined): string =>
  n === undefined ? T.dash : String(n);

/** Варианты «Квоты места» эталона (opVM :3565), ГБ. */
export const QUOTAS: readonly number[] = [25, 50, 100, 250, 500];

export interface QuotaOption {
  value: string;
  label: string;
}

/** Варианты квоты: меньше занятого — с пометкой; текущая квота вне списка — вариантом по порядку (Q-W4.84-3). */
export function quotaOptions(
  usedBytes: number | undefined,
  sub: Subscription | undefined,
): QuotaOption[] {
  const current = quotaGb(sub);
  const list = current === undefined || QUOTAS.includes(current) ? QUOTAS : [...QUOTAS, current];
  const used = usedBytes === undefined ? undefined : usedGb(usedBytes);
  return [...list]
    .sort((a, b) => a - b)
    .map((n) => ({
      value: String(n),
      label: format(used !== undefined && n < used ? T.quotaBelow : T.quotaOption, {
        gb: num(n),
      }),
    }));
}

/** Срок ручного права квоты — 12 месяцев: полночь по Москве после того же дня через год (Q-W4.84-1). */
function quotaValidUntil(now: number): string {
  const msk = new Date(now + MSK_OFFSET);
  const end = Date.UTC(msk.getUTCFullYear() + 1, msk.getUTCMonth(), msk.getUTCDate() + 1);
  return new Date(end - MSK_OFFSET).toISOString().replace('.000Z', 'Z');
}

/**
 * Тело updatePlatformSubscription для «Квоты места»: тариф, статус и даты — текущие (сервер сбрасывает
 * незаданный конец периода и льготы), прочие ручные права сохраняются, квота — ручное право `storage_quota_bytes`
 * со сроком 12 месяцев и причиной в источнике (контракт: у ручного права срок и основание обязательны).
 */
export function quotaUpdate(
  sub: Subscription,
  gb: number,
  reason: string,
  now: number,
): S['PlatformSubscriptionUpdate'] {
  const text = reason.trim();
  const body: S['PlatformSubscriptionUpdate'] = {
    planKey: sub.planKey,
    status: sub.status,
    cancelAtPeriodEnd: false,
    manualEntitlements: [
      ...sub.entitlements.filter((e) => e.sourceType === 'manual' && e.key !== QUOTA_KEY),
      {
        key: QUOTA_KEY,
        value: gb * GiB,
        sourceType: 'manual',
        sourceRef: text,
        validUntil: quotaValidUntil(now),
      },
    ],
    reason: text,
  };
  if (sub.trialEndsAt) body.trialEndsAt = sub.trialEndsAt;
  if (sub.periodEndsAt) body.periodEndsAt = sub.periodEndsAt;
  if (sub.graceEndsAt) body.graceEndsAt = sub.graceEndsAt;
  return body;
}

/** Плашка заявки (opVM :3562): «Заявка SR-12: переход на «Бизнес» от 29.09 16:40». */
export const requestText = (r: ChangeRequest): string =>
  format(T.request, { number: r.number, tier: r.toTierName, at: stamp(r.requestedAt) });

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
    // W4.84: «Квота места» оператора — updatePlatformSubscription с деталью quotaBytes (эталон :3566).
    case 'subscription.updated':
      return d.quotaBytes
        ? format(T.audit.quota, { name, gb: num(Number(d.quotaBytes) / GiB) })
        : format(T.audit.other, { name, action: e.action });
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
