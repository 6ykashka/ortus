// Тег Platform, контракт 0.8.0-stage4 (W4.07, шаг 4.6): очередь заявок на тариф и решение оператора, версии
// тарифной сетки (публикация с даты, одна запланированная, отмена до начала). Состояние — billing/plans.ts.
// Повышение применяется сразу, понижение — с конца оплаченного периода (планировщик биллинга в mock не
// запускается: заявка остаётся одобренной без appliedAt до этой даты).
import type { components } from '@ortus/api-client';

import {
  currentVersion,
  operatorVersion,
  plansOf,
  requestById,
  scheduledVersion,
  sortedRequests,
  statusFilter,
  type TermMonths,
  type VersionRow,
  versionState,
} from '../billing/plans.ts';
import { quotaBytes } from '../core/dto.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { TenantRow } from '../core/state.ts';
import { iso, mskDayPlusMonths } from '../core/time.ts';
import { audit } from './audit.ts';

type S = components['schemas'];
type Violation = S['ProblemViolation'];

const MONTHS = [1, 4, 8, 12];

function operatorRef(ctx: HandlerContext): S['AccountRef'] {
  const a = ctx.actor;
  return a ? { accountId: a.id, displayName: a.displayName } : { displayName: 'Система' };
}

/** Начало московских суток даты `YYYY-MM-DD`. */
const mskDate = (d: string): string => iso(new Date(Date.parse(`${d}T00:00:00Z`) - 3 * 3_600_000));

/** Сегодняшняя дата по Москве (`YYYY-MM-DD`). */
const todayMsk = (now: string): string =>
  iso(new Date(Date.parse(now) + 3 * 3_600_000)).slice(0, 10);

function tierChecks(tiers: S['PriceTierDraft'][], out: Violation[]): void {
  const names = new Set<string>();
  const codes = new Set<string>();
  let prev: S['PriceTierDraft'] | undefined;
  tiers.forEach((t, i) => {
    const at = `tiers[${i}]`;
    const name = t.name.trim().toLowerCase();
    if (!name) out.push({ field: `${at}.name`, code: 'required', message: 'Укажите название' });
    else if (names.has(name)) {
      out.push({ field: `${at}.name`, code: 'unique', message: 'Название ступени повторяется' });
    }
    names.add(name);
    if (t.code) {
      if (codes.has(t.code)) {
        out.push({ field: `${at}.code`, code: 'unique', message: 'Код ступени повторяется' });
      }
      codes.add(t.code);
    }
    const unlimited = t.seatsLimit === null;
    if (unlimited !== (t.monthAmountMinor === null)) {
      out.push({
        field: `${at}.seatsLimit`,
        code: 'unlimited',
        message: 'У безлимитной ступени нет ни мест, ни цены',
      });
    } else if (unlimited && i !== tiers.length - 1) {
      out.push({
        field: `${at}.seatsLimit`,
        code: 'unlimited_last',
        message: 'Безлимитная ступень — только последняя',
      });
    }
    if (prev && t.seatsLimit !== null && prev.seatsLimit !== null) {
      if (t.seatsLimit <= prev.seatsLimit) {
        out.push({
          field: `${at}.seatsLimit`,
          code: 'not_increasing',
          message: 'Мест должно быть больше, чем в предыдущей ступени',
        });
      }
    }
    if (prev && t.monthAmountMinor !== null && prev.monthAmountMinor !== null) {
      if (t.monthAmountMinor <= prev.monthAmountMinor) {
        out.push({
          field: `${at}.monthAmountMinor`,
          code: 'not_increasing',
          message: 'Цена должна расти от ступени к ступени',
        });
      }
    }
    prev = t;
  });
  if (!tiers.some((t) => t.monthAmountMinor !== null)) {
    out.push({ field: 'tiers', code: 'priced', message: 'Нужна хотя бы одна ступень с ценой' });
  }
}

function publishChecks(ctx: HandlerContext, b: S['PriceBookVersionCreate']): void {
  const out: Violation[] = [];
  if (b.effectiveFrom <= todayMsk(ctx.now())) {
    out.push({
      field: 'effectiveFrom',
      code: 'future',
      message: 'Дата начала — не раньше завтрашнего дня',
    });
  }
  tierChecks(b.tiers, out);
  const months = b.terms.map((t) => t.months).sort((x, y) => x - y);
  if (months.join() !== MONTHS.join()) {
    out.push({
      field: 'terms',
      code: 'terms',
      message: 'Сроки — 1, 4, 8 и 12 месяцев, каждый один раз',
    });
  }
  if (out.length) fail('validation_failed', 'Проверьте ступени сетки.', { violations: out });
}

const versionParam = (ctx: HandlerContext): VersionRow => {
  const n = Number(ctx.params.version);
  if (!/^\d+$/.test(ctx.params.version ?? '') || n < 1) fail('malformed_request');
  return plansOf(ctx.s).versions.find((v) => v.version === n) ?? fail('not_found');
};

const tenantById = (ctx: HandlerContext, id: string): TenantRow =>
  ctx.s.tenants.find((t) => t.id === id) ?? fail('not_found');

/** Одобрение: новая версия прав мест и условия периода; пробная и read_only организация становится active. */
function applyApproval(ctx: HandlerContext, r: S['SubscriptionChangeRequest']): void {
  const t = tenantById(ctx, r.tenantId);
  const sub = t.subscription;
  const sourceRef = `price-book:v${r.priceVersion}:${r.toTierCode}`;
  const seats = r.toSeatsLimit ?? 1_000_000;
  t.subscription = {
    planKey: r.toTierCode,
    status: 'active',
    cancelAtPeriodEnd: false,
    entitlements: [
      { key: 'seats', sourceType: 'plan', sourceRef, value: seats },
      { key: 'storage_quota_bytes', sourceType: 'plan', sourceRef, value: quotaBytes(t) },
    ],
    periodEndsAt: mskDayPlusMonths(ctx.now(), r.termMonths),
    revision: sub.revision + 1,
  };
  if (t.status === 'trial' || t.status === 'grace' || t.status === 'read_only') {
    t.status = 'active';
    t.revision++;
  }
  plansOf(ctx.s).terms[t.id] = {
    termMonths: r.termMonths as TermMonths,
    priceVersion: r.priceVersion,
  };
  r.appliedAt = ctx.now();
}

export const pricingHandlers: Registry = {
  listPlatformSubscriptionRequests: (ctx) => {
    const status = statusFilter(ctx.query);
    const tenantId = uuidParam(ctx.query, 'tenantId', false);
    if (tenantId) tenantById(ctx, tenantId);
    const all = plansOf(ctx.s).requests;
    const items = sortedRequests(all).filter(
      (r) => (!status || r.status === status) && (!tenantId || r.tenantId === tenantId),
    );
    return {
      body: {
        ...page(structuredClone(items), ctx.query),
        pendingCount: all.filter((r) => r.status === 'pending').length,
      },
    };
  },

  decidePlatformSubscriptionRequest: {
    messages: { note: 'Не длиннее 500 символов' },
    run: (ctx) => {
      const r = requestById(ctx);
      const b = ctx.body as S['SubscriptionRequestDecision'];
      const note = b.note?.trim();
      if (b.decision === 'reject' && !note) {
        fail('validation_failed', 'Укажите причину отказа.', {
          violations: [{ field: 'note', code: 'required', message: 'Укажите причину отказа' }],
        });
      }
      if (r.status !== 'pending') fail('invalid_transition');
      const now = ctx.now();
      r.decidedAt = now;
      r.decidedBy = operatorRef(ctx);
      if (note) r.decisionNote = note;
      r.revision++;
      const t = tenantById(ctx, r.tenantId);
      const target: S['PlatformAuditTarget'] = {
        type: 'subscription',
        tenantId: t.id,
        name: t.name,
      };
      if (b.decision === 'reject') {
        r.status = 'rejected';
        audit(ctx, 'subscription.change_rejected', target, { request: r.number }, note);
        return { body: structuredClone(r) };
      }
      r.status = 'approved';
      const upgrade =
        r.toSeatsLimit === null ||
        r.fromSeatsLimit === null ||
        r.fromSeatsLimit === undefined ||
        r.toSeatsLimit > r.fromSeatsLimit;
      const periodEndsAt = t.subscription.periodEndsAt;
      r.effectiveAt = upgrade || !periodEndsAt || periodEndsAt <= now ? now : periodEndsAt;
      if (r.effectiveAt <= now) applyApproval(ctx, r);
      audit(ctx, 'subscription.change_approved', target, {
        request: r.number,
        tier: r.toTierCode,
        termMonths: String(r.termMonths),
      });
      return { body: structuredClone(r) };
    },
  },

  listPriceBookVersions: (ctx) => {
    const now = ctx.now();
    const raw = ctx.query.get('includeCancelled');
    if (raw !== null && raw !== 'true' && raw !== 'false') fail('malformed_request');
    const items = [...plansOf(ctx.s).versions]
      .filter((v) => raw === 'true' || !v.cancelledAt)
      .sort((a, b) => b.version - a.version)
      .map((v) => operatorVersion(ctx.s, v, now));
    return { body: page(items, ctx.query) };
  },

  publishPriceBookVersion: {
    messages: { note: 'Не длиннее 200 символов' },
    run: (ctx) => {
      const b = ctx.body as S['PriceBookVersionCreate'];
      const now = ctx.now();
      const pending = scheduledVersion(ctx.s, now);
      if (pending) {
        fail(
          'invalid_transition',
          `Уже запланирована версия v${pending.version}. Отмените её, чтобы подготовить другую.`,
        );
      }
      publishChecks(ctx, b);
      const st = plansOf(ctx.s);
      const version = st.versions.reduce((n, v) => Math.max(n, v.version), 0) + 1;
      const effectiveFrom = mskDate(b.effectiveFrom);
      const current = currentVersion(ctx.s, now);
      current.effectiveUntil = effectiveFrom;
      const row: VersionRow = {
        version,
        effectiveFrom,
        note: b.note.trim() || 'Изменение цен',
        currency: 'RUB',
        tiers: b.tiers.map((t, i) => ({
          code: t.code ?? `tier_${version}_${i + 1}`,
          name: t.name.trim(),
          seatsLimit: t.seatsLimit,
          monthAmountMinor: t.monthAmountMinor,
        })),
        terms: [...b.terms].sort((x, y) => x.months - y.months),
        publishedAt: now,
        publishedBy: operatorRef(ctx),
      };
      st.versions.push(row);
      audit(
        ctx,
        'price_book.published',
        { type: 'price_book', name: `v${version}` },
        { version: String(version), effectiveFrom: b.effectiveFrom },
      );
      return { status: 201, body: operatorVersion(ctx.s, row, now) };
    },
  },

  cancelPriceBookVersion: (ctx) => {
    const v = versionParam(ctx);
    const now = ctx.now();
    if (versionState(v, now) !== 'scheduled') fail('invalid_transition');
    v.cancelledAt = now;
    for (const x of plansOf(ctx.s).versions) {
      if (x !== v && x.effectiveUntil === v.effectiveFrom) delete x.effectiveUntil;
    }
    audit(
      ctx,
      'price_book.cancelled',
      { type: 'price_book', name: `v${v.version}` },
      { version: String(v.version) },
    );
    return { body: operatorVersion(ctx.s, v, now) };
  },
};
