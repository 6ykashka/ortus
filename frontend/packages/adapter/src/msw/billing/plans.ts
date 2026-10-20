// Тег Billing, контракт 0.8.0-stage4 (W4.07, шаг 4.6): места подписки, тарифная сетка и заявки на тариф
// (design/docs/17-users-and-billing.md). Состояние control DB шага — версии сетки, заявки SR-N, условия периода
// организаций — лежит в состоянии сервера (`plans`, JSON) и на старте строится из сида домена W0.12
// (`createPlatform()`: priceBook, requests, tenants[].plan), как журнал платформы (`platformAudit`).
// Те же правила считает генератор примеров tools/gen/examples-w407.mjs (PD-43: примеры — снимки сервера).
import type { components } from '@ortus/api-client';
import { createPlatform, seedUuid } from '@ortus/domain/seed';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { ScenarioState, TenantRow } from '../core/state.ts';
import { DAY, iso, mskEndOfDay, mskStamp } from '../core/time.ts';
import { audit } from '../platform/audit.ts';

type S = components['schemas'];
type Version = S['PriceBookVersion'];
type Request = S['SubscriptionChangeRequest'];

const P = (id: string): string => seedUuid('platform', id);
const RUB = 'RUB';
export type TermMonths = 1 | 4 | 8 | 12;

/** Версия сетки в состоянии: поля контракта без вычисляемых `state` и `subscriptionCount`. */
export type VersionRow = Omit<Version, 'state' | 'subscriptionCount'>;

/** Условия оплаченного периода организации (subscriptions.term_months, price_version). */
export interface TermsRow {
  /** Срок оплаченного периода; нет — пробный период или без оплаты. */
  termMonths?: TermMonths;
  priceVersion: number;
}

export interface PlansState {
  versions: VersionRow[];
  requests: Request[];
  /** Условия периода по UUID организации. */
  terms: Record<string, TermsRow>;
}

type WithPlans = ScenarioState & { plans?: PlansState };

/** «01.06.2026» → начало суток по Москве (00:00 МСК = 21:00Z накануне). */
export function mskDayStart(s: string): string {
  const end = mskEndOfDay(s);
  if (!end) throw new Error(`дата ${s}`);
  return iso(new Date(Date.parse(end) - DAY));
}

/** «Е. Лаптева» журнала прототипа → оператор сида (accounts.id его аккаунта и полное имя). */
function operatorRef(short: string | undefined): S['AccountRef'] | undefined {
  if (!short) return undefined;
  const o = createPlatform().operators.find((x) => {
    const [first = '', last = ''] = x.name.split(' ');
    return `${first.slice(0, 1)}. ${last}` === short || x.name === short;
  });
  return o ? { accountId: P(`account:${o.id}`), displayName: o.name } : { displayName: short };
}

function seedPlans(): PlansState {
  const P0 = createPlatform();
  const versions: VersionRow[] = P0.priceBook.versions.map((v) => {
    const row: VersionRow = {
      version: v.v,
      effectiveFrom: mskDayStart(v.from),
      note: v.note,
      currency: RUB,
      tiers: v.tiers.map((t) => ({
        code: t.id,
        name: t.name,
        seatsLimit: t.seats,
        monthAmountMinor: t.month === null ? null : t.month * 100,
      })),
      terms: v.terms.map((t) => ({ months: t.months as TermMonths, discountPercent: t.off })),
    };
    const until = mskEndOfDay(v.to);
    if (until) row.effectiveUntil = until;
    const by = operatorRef(v.by);
    if (by) row.publishedBy = by;
    return row;
  });
  const first = versions[0];
  if (!first) throw new Error('сетка сида пуста');
  const inForce = (at: string): VersionRow =>
    versions.find((v) => v.effectiveFrom <= at && (!v.effectiveUntil || at < v.effectiveUntil)) ??
    first;
  const accountRef = (name: string): S['AccountRef'] => {
    const a = P0.accounts.find((x) => x.name === name);
    return a ? { accountId: P(a.id), displayName: a.name } : { displayName: name };
  };
  const requests: Request[] = P0.requests.map((r) => {
    const tenant = P0.tenants.find((t) => t.id === r.tenantId);
    const requestedAt = mskStamp(r.at) ?? '';
    const v = inForce(requestedAt);
    const from = v.tiers.find((t) => t.code === r.from);
    const to = v.tiers.find((t) => t.code === r.to);
    const term = r.term as TermMonths;
    const row: Request = {
      id: P(`subscription-request:${r.id}`),
      number: r.id,
      tenantId: P(r.tenantId),
      tenantName: tenant?.name ?? '',
      fromTierCode: r.from,
      fromTierName: from?.name ?? null,
      fromSeatsLimit: from?.seatsLimit ?? null,
      toTierCode: r.to,
      toTierName: to?.name ?? r.to,
      toSeatsLimit: to?.seatsLimit ?? null,
      termMonths: term,
      priceVersion: v.version,
      seatsUsed: r.used,
      status: r.status,
      requestedAt,
      requestedBy: accountRef(r.by),
      revision: r.status === 'pending' ? 1 : 2,
    };
    const q = quote(v, r.to, term);
    if (q) row.quote = q;
    if (r.comment) row.comment = r.comment;
    const decidedAt = mskStamp(r.decidedAt);
    if (decidedAt) {
      row.decidedAt = decidedAt;
      const by = operatorRef(r.decidedBy);
      if (by) row.decidedBy = by;
      if (r.decision) row.decisionNote = r.decision;
      if (r.status === 'approved') {
        row.effectiveAt = decidedAt;
        row.appliedAt = decidedAt;
      }
    }
    return row;
  });
  const terms: Record<string, TermsRow> = {};
  for (const t of P0.tenants) {
    const paid = t.status === 'active' || t.status === 'suspended';
    terms[P(t.id)] = paid
      ? { termMonths: t.plan.term as TermMonths, priceVersion: t.plan.version }
      : { priceVersion: t.plan.version };
  }
  return { versions, requests, terms };
}

/** Состояние шага 4.6 (на старте — из сида домена). */
export function plansOf(s: ScenarioState): PlansState {
  const x = s as WithPlans;
  x.plans ??= seedPlans();
  return x.plans;
}

/** Состояние версии в момент `now`. */
export function versionState(v: VersionRow, now: string): Version['state'] {
  if (v.cancelledAt) return 'cancelled';
  if (v.effectiveFrom > now) return 'scheduled';
  if (v.effectiveUntil && v.effectiveUntil <= now) return 'archived';
  return 'current';
}

/** Действующая версия сетки. */
export function currentVersion(s: ScenarioState, now: string): VersionRow {
  const vs = plansOf(s).versions;
  const v = vs.find((x) => versionState(x, now) === 'current') ?? vs.at(-1);
  if (!v) throw new Error('нет версий сетки');
  return v;
}

/** Запланированная версия (не больше одной). */
export const scheduledVersion = (s: ScenarioState, now: string): VersionRow | undefined =>
  plansOf(s).versions.find((v) => versionState(v, now) === 'scheduled');

/** Версия оператора: состояние и число подписок оплаченного периода по ней. */
export function operatorVersion(s: ScenarioState, v: VersionRow, now: string): Version {
  const subscriptionCount = Object.values(plansOf(s).terms).filter(
    (t) => t.priceVersion === v.version,
  ).length;
  return { ...structuredClone(v), state: versionState(v, now), subscriptionCount };
}

/** Версия владельца: без авторов, даты публикации и числа подписок (TenantPriceBook). */
export function ownerVersion(v: VersionRow, now: string): Version {
  const out: Version = { ...structuredClone(v), state: versionState(v, now) };
  delete out.publishedBy;
  delete out.publishedAt;
  delete out.cancelledAt;
  return out;
}

const money = (amountMinor: number): S['Money'] => ({ amountMinor, currency: RUB });

/**
 * Расчёт тарифа и срока по версии (PriceTerm): месяц со скидкой — до целых рублей, период — месяц × срок.
 * Безлимит без цены — undefined.
 */
export function quote(
  v: VersionRow,
  tierCode: string,
  months: number,
): S['SubscriptionQuote'] | undefined {
  const t = v.tiers.find((x) => x.code === tierCode);
  const term = v.terms.find((x) => x.months === months);
  if (!t || t.monthAmountMinor === null || !term) return undefined;
  const monthly = Math.round((t.monthAmountMinor * (1 - term.discountPercent / 100)) / 100) * 100;
  return {
    monthlyAmount: money(monthly),
    periodAmount: money(monthly * months),
    savingAmount: money((t.monthAmountMinor - monthly) * months),
    discountPercent: term.discountPercent,
  };
}

/** Места организации (control DB view tenant_seat_usage): активные и приглашённые членства. */
export function seatUsage(s: ScenarioState, t: TenantRow): S['SeatUsage'] {
  const ms = s.memberships.filter((m) => m.tenantId === t.id);
  const active = ms.filter((m) => m.status === 'active').length;
  const invited = ms.filter((m) => m.status === 'invited').length;
  const used = active + invited;
  const tier = versionOf(s, t)?.tiers.find((x) => x.code === t.subscription.planKey);
  const ent = t.subscription.entitlements.filter((e) => e.key === 'seats').at(-1)?.value;
  const limit = tier && tier.seatsLimit === null ? null : (ent ?? null);
  return {
    limit,
    used,
    active,
    invited,
    available: limit === null ? null : Math.max(0, limit - used),
  };
}

/** Версия сетки оплаченного периода организации. */
function versionOf(s: ScenarioState, t: TenantRow): VersionRow | undefined {
  const terms = plansOf(s).terms[t.id];
  return plansOf(s).versions.find((v) => v.version === terms?.priceVersion);
}

/** Subscription + условия периода и места (поля W4.07). */
export function subscriptionWithTerms(s: ScenarioState, t: TenantRow): S['Subscription'] {
  const sub = structuredClone(t.subscription);
  const terms = plansOf(s).terms[t.id];
  const v = versionOf(s, t);
  const tier = v?.tiers.find((x) => x.code === sub.planKey);
  sub.tierCode = sub.planKey;
  if (tier) sub.tierName = tier.name;
  if (terms) sub.priceVersion = terms.priceVersion;
  if (terms?.termMonths && v) {
    sub.termMonths = terms.termMonths;
    const q = quote(v, sub.planKey, terms.termMonths);
    if (q) {
      sub.monthlyAmount = q.monthlyAmount;
      sub.periodAmount = q.periodAmount;
    }
  }
  sub.seats = seatUsage(s, t);
  return sub;
}

/** Заявка глазами владельца: решение без оператора (decidedBy — только у отмены владельцем). */
export function tenantRequest(r: Request): Request {
  const out = structuredClone(r);
  if (out.status === 'approved' || out.status === 'rejected') delete out.decidedBy;
  return out;
}

const newest = (a: Request, b: Request): number =>
  a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0;

const STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);

/** Фильтр status списка заявок (неизвестное значение — 400). */
export function statusFilter(query: URLSearchParams): string | undefined {
  const v = query.get('status');
  if (v === null) return undefined;
  if (!STATUSES.has(v)) fail('malformed_request', 'Неизвестный статус заявки.');
  return v;
}

/** Заявки по убыванию даты. */
export const sortedRequests = (list: Request[]): Request[] => [...list].sort(newest);

const tenantOf = (ctx: HandlerContext): TenantRow => ctx.org().tenant;

function requestById(ctx: HandlerContext, tenantId?: string): Request {
  const id = ctx.params.changeRequestId?.toLowerCase();
  const r = plansOf(ctx.s).requests.find((x) => x.id === id);
  if (!r || (tenantId && r.tenantId !== tenantId)) fail('not_found');
  return r;
}

const TIER_FIELD = (message: string) => ({
  violations: [{ field: 'tierCode', code: 'tier', message }],
});

export const plansHandlers: Registry = {
  getTenantPriceBook: (ctx) => {
    const now = ctx.now();
    const t = tenantOf(ctx);
    const current = currentVersion(ctx.s, now);
    const body: S['TenantPriceBook'] = { current: ownerVersion(current, now) };
    const scheduled = scheduledVersion(ctx.s, now);
    if (scheduled) body.scheduled = ownerVersion(scheduled, now);
    const sub = versionOf(ctx.s, t);
    if (sub && sub.version !== current.version) body.subscribed = ownerVersion(sub, now);
    return { body };
  },

  listSubscriptionChangeRequests: (ctx) => {
    const t = tenantOf(ctx);
    const status = statusFilter(ctx.query);
    const mine = plansOf(ctx.s).requests.filter((r) => r.tenantId === t.id);
    const items = sortedRequests(mine)
      .filter((r) => !status || r.status === status)
      .map(tenantRequest);
    return {
      body: {
        ...page(items, ctx.query),
        pendingCount: mine.filter((r) => r.status === 'pending').length,
      },
    };
  },

  createSubscriptionChangeRequest: {
    messages: { comment: 'Не длиннее 500 символов' },
    run: (ctx) => {
      const t = tenantOf(ctx);
      const b = ctx.body as S['SubscriptionChangeRequestCreate'];
      const st = plansOf(ctx.s);
      const now = ctx.now();
      if (st.requests.some((r) => r.tenantId === t.id && r.status === 'pending')) {
        fail('request_pending');
      }
      const v = currentVersion(ctx.s, now);
      const to = v.tiers.find((x) => x.code === b.tierCode);
      if (!to) {
        fail(
          'validation_failed',
          'Выберите тариф из тарифной сетки.',
          TIER_FIELD('Нет такого тарифа в действующей сетке'),
        );
      }
      const seats = seatUsage(ctx.s, t);
      if (to.seatsLimit !== null && to.seatsLimit < seats.used) {
        const text = `В тарифе «${to.name}» ${to.seatsLimit} мест, а занято ${seats.used}`;
        fail('tier_below_usage', text, {
          violations: [{ field: 'tierCode', code: 'tier_below_usage', message: text }],
        });
      }
      const terms = st.terms[t.id];
      const sub = t.subscription;
      if (
        sub.status === 'active' &&
        sub.planKey === b.tierCode &&
        terms?.termMonths === b.termMonths
      ) {
        fail('validation_failed', 'Этот тариф и срок уже подключены.', TIER_FIELD('Уже подключён'));
      }
      const fromVersion = versionOf(ctx.s, t);
      const from = fromVersion?.tiers.find((x) => x.code === sub.planKey);
      const user = ctx.user();
      const max = st.requests.reduce((n, r) => Math.max(n, Number(r.number.slice(3))), 0);
      const row: Request = {
        id: ctx.newId(),
        number: `SR-${max + 1}`,
        tenantId: t.id,
        tenantName: t.name,
        fromTierCode: sub.planKey,
        fromTierName: from?.name ?? null,
        fromSeatsLimit: seats.limit,
        toTierCode: to.code,
        toTierName: to.name,
        toSeatsLimit: to.seatsLimit,
        termMonths: b.termMonths,
        priceVersion: v.version,
        seatsUsed: seats.used,
        status: 'pending',
        requestedAt: now,
        requestedBy: { accountId: user.id, displayName: user.displayName },
        revision: 1,
      };
      const q = quote(v, to.code, b.termMonths);
      if (q) row.quote = q;
      const comment = b.comment?.trim();
      if (comment) row.comment = comment;
      st.requests.push(row);
      audit(
        ctx,
        'subscription.change_requested',
        subscriptionTarget(t),
        { request: row.number, tier: row.toTierCode, termMonths: String(row.termMonths) },
        undefined,
        'owner',
      );
      return { status: 201, body: tenantRequest(row) };
    },
  },

  cancelSubscriptionChangeRequest: (ctx) => {
    const t = tenantOf(ctx);
    const r = requestById(ctx, t.id);
    if (r.status !== 'pending') fail('invalid_transition');
    const user = ctx.user();
    r.status = 'cancelled';
    r.decidedAt = ctx.now();
    r.decidedBy = { accountId: user.id, displayName: user.displayName };
    r.revision++;
    audit(
      ctx,
      'subscription.change_request_cancelled',
      subscriptionTarget(t),
      { request: r.number },
      undefined,
      'owner',
    );
    return { body: tenantRequest(r) };
  },
};

/** Цель строки журнала подписки (PlatformAuditTarget type subscription — id подписки контракт не раскрывает). */
function subscriptionTarget(t: TenantRow): S['PlatformAuditTarget'] {
  return { type: 'subscription', tenantId: t.id, name: t.name };
}

export { requestById };
