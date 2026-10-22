// W4.61 · Модель «Подписки и мест» владельца (billingVM «Ортус CRM.dc.html» :3916–3957, design-2026-10-19) по
// подписке, тарифной сетке, заявкам и участникам (W4.07): карточка тарифа, места, баннеры, сроки и тарифы с расчётом
// по действующей версии сетки, подсказка отправки, кто занимает и не занимает место.
import type { components } from '@ortus/api-client';
import { initials } from '@ortus/domain';
import { company, errors, format } from '@ortus/texts';

import {
  barTone,
  type Chip,
  mskDate,
  mskLastDay,
  mskStamp,
  rub,
  tenantChip,
} from '../../platform/kit/format.ts';
import type { BarTone } from '../../platform/kit/ui.tsx';
import { BILLING_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Req = S['SubscriptionChangeRequest'];
type Version = S['PriceBookVersion'];

const B = company.billing;
const DAY = 86_400_000;
/** Жёлтая полоса мест — строго больше 80 % (billingVM :3930). */
const WARN_PERCENT = 80;

export interface TierCard {
  code: string;
  name: string;
  seats: string;
  price: string;
  per: string;
  total: string | undefined;
  note: string | undefined;
  checked: boolean;
  disabled: boolean;
}

export interface Person {
  id: string;
  name: string;
  initials: string;
  title: string;
  note: string | undefined;
  chip: Chip;
  invited: boolean;
}

export interface FreePerson {
  id: string;
  name: string;
  initials: string;
  what: string;
}

const RESTRICTED: Readonly<Record<string, S['Tenant']['status']>> = {
  past_due: 'grace',
  grace: 'grace',
  read_only: 'read_only',
  cancelled: 'read_only',
};

/** Карточка тарифа (billingVM :3926–3928): заголовок, чип срока или статуса, пояснение. */
export function planCard(
  sub: S['Subscription'],
  now: number,
): { title: string; chip: Chip; meta: string } {
  const trial = sub.status === 'trialing';
  const title = format(B.title, { trial: String(trial), tier: sub.tierName ?? sub.planKey });
  let chip: Chip;
  if (trial && sub.trialEndsAt) {
    const days = Math.max(0, Math.floor((Date.parse(sub.trialEndsAt) - now) / DAY));
    chip = {
      label: format(B.statusTrial, { date: mskLastDay(sub.trialEndsAt), days }),
      tone: 'info',
      icon: 'hourglass_top',
    };
  } else if (sub.status === 'active') {
    chip = {
      label: format(B.paidUntil, { date: sub.periodEndsAt ? mskLastDay(sub.periodEndsAt) : '—' }),
      tone: 'ok',
      icon: 'check_circle',
    };
  } else {
    chip = tenantChip(RESTRICTED[sub.status] ?? 'read_only');
  }
  let meta: string = B.trialMeta;
  if (!trial && sub.termMonths) {
    const paid = sub.termMonths === 1 ? T.paidMonthly : format(T.paidTerm, { n: sub.termMonths });
    meta = paid + (sub.priceVersion ? format(T.priceVersion, { v: sub.priceVersion }) : '');
  }
  return { title, chip, meta };
}

/** Карточка «Места» (billingVM :3929–3930): «u из l», полоса, подпись; заняты все — «Мест нет…». */
export function seatsCard(seats: S['SeatUsage']): {
  value: string;
  percent: number;
  tone: BarTone;
  sub: string;
  full: boolean;
} {
  const { limit, used } = seats;
  const full = limit !== null && used >= limit;
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  return {
    value: limit === null ? String(used) : format(B.seatsOf, { used, limit }),
    percent,
    tone: full ? 'danger' : barTone(percent, WARN_PERCENT, true),
    sub: format(B.seatsSub, {
      active: seats.active,
      invited: seats.invited,
      unlimited: String(limit === null),
      free: seats.available ?? 0,
    }),
    full,
  };
}

const termLabel = (months: number): string =>
  months === 1 ? T.termMonthly : format(T.termMonths, { n: months });

/** Баннеры (billingVM :3931–3935): заявка на рассмотрении, последняя решённая, смена цен. */
export function banners(
  list: readonly Req[],
  scheduled: Version | undefined,
): {
  pending: { id: string; text: string } | undefined;
  rejected: string | undefined;
  approved: string | undefined;
  priceChange: string | undefined;
} {
  const pending = list.find((r) => r.status === 'pending');
  const last = list.find((r) => r.status !== 'pending');
  return {
    pending: pending
      ? {
          id: pending.id,
          text: format(B.pending, {
            id: pending.number,
            tier: pending.toTierName,
            term: termLabel(pending.termMonths),
            at: mskStamp(pending.requestedAt),
          }),
        }
      : undefined,
    rejected:
      !pending && last?.status === 'rejected'
        ? format(B.rejected, { id: last.number, reason: last.decisionNote || T.noComment })
        : undefined,
    approved:
      !pending && last?.status === 'approved'
        ? format(B.approved, {
            id: last.number,
            at: last.decidedAt ? mskStamp(last.decidedAt) : '',
          })
        : undefined,
    priceChange: scheduled
      ? format(T.priceChange, { date: mskDate(scheduled.effectiveFrom) })
      : undefined,
  };
}

/** Сроки оплаты: «Месяц», «4 мес» и скидка «−5%» (billingVM :3936). */
export const termPills = (
  terms: readonly S['PriceTerm'][],
): { months: number; label: string; off: string | undefined }[] =>
  terms.map((t) => ({
    months: t.months,
    label: t.months === 1 ? B.month : format(B.months, { n: t.months }),
    off: t.discountPercent ? format(T.off, { off: t.discountPercent }) : undefined,
  }));

/** Цена тарифа со скидкой срока: месяц (рубли), период, экономия (calc :3578–3583). */
function quote(v: Version, code: string, term: number) {
  const tier = v.tiers.find((t) => t.code === code);
  if (!tier || tier.monthAmountMinor === null) return undefined;
  const t = v.terms.find((x) => x.months === term) ?? v.terms[0];
  const base = tier.monthAmountMinor / 100;
  const off = t?.discountPercent ?? 0;
  const months = t?.months ?? 1;
  const month = Math.round(base * (1 - off / 100));
  return { month, total: month * months, save: (base - month) * months, months };
}

/** Карточки тарифов действующей версии (billingVM :3937–3943). */
export function tierCards(
  v: Version,
  sub: S['Subscription'],
  term: number,
  selected: string | null,
  pending: boolean,
): TierCard[] {
  const trial = sub.status === 'trialing';
  const used = sub.seats?.used ?? 0;
  return v.tiers.map((t, i) => {
    const isCur = t.code === sub.tierCode && !trial;
    const small = t.seatsLimit !== null && t.seatsLimit < used;
    const q = quote(v, t.code, term);
    const note = isCur
      ? B.currentTier
      : small
        ? format(T.tooSmall, { used })
        : t.code === sub.tierCode && trial
          ? B.sameAsTrial
          : undefined;
    return {
      code: t.code,
      name: t.name,
      seats:
        t.seatsLimit !== null
          ? format(T.upTo, { seats: t.seatsLimit })
          : format(T.more, { seats: v.tiers[i - 1]?.seatsLimit ?? 0 }),
      price: q ? rub(q.month) : B.individual,
      per: q ? B.perMonth : B.withOperator,
      total: q && term > 1 ? format(T.total, { total: rub(q.total), n: term }) : undefined,
      note,
      checked: selected === t.code,
      disabled: small || isCur || pending,
    };
  });
}

/** Расчёт выбранного тарифа (billingVM :3944–3945). */
export function calcView(
  v: Version,
  code: string | null,
  term: number,
): { main: string; sub: string } | undefined {
  const tier = v.tiers.find((t) => t.code === code);
  if (!tier) return undefined;
  const q = quote(v, tier.code, term);
  const limit =
    tier.seatsLimit !== null ? format(T.newLimit, { seats: tier.seatsLimit }) : T.newLimitNone;
  if (!q) return { main: T.calcOperator, sub: limit };
  return {
    main: format(T.calcMain, {
      month: rub(q.month),
      total: rub(q.total),
      period: term === 1 ? T.calcMonth : format(T.calcTerm, { n: term }),
    }),
    sub: (q.save ? format(T.saving, { save: rub(q.save) }) : '') + limit,
  };
}

/** Подсказка у «Отправить заявку оператору» (billingVM :3947). */
export function sendHint(pending: boolean, selected: string | null): string {
  if (pending) return B.sendWait;
  return selected ? '' : errors.mock.company.tierRequired;
}

const profileLabel = (m: S['Member']): string | undefined => {
  const p = m.workProfiles[0];
  return p ? T.profiles[p] : undefined;
};

/**
 * Кто занимает место (billingVM :3949–3954): активные с входом, затем приглашённые; не занимают — заблокированные
 * владельцем и карточки без входа. Подпись под именем — рабочая функция (должности в контракте нет), иначе почта.
 */
export function people(list: readonly S['Member'][]): { paid: Person[]; free: FreePerson[] } {
  const active = list.filter((m) => m.status === 'active' && m.userId !== undefined);
  const invited = list.filter((m) => m.status === 'invited');
  const blocked = list.filter((m) => m.status === 'suspended');
  const cards = list.filter((m) => m.status === 'active' && m.userId === undefined);
  const paid: Person[] = [...active, ...invited].map((m) => {
    const inv = m.status === 'invited';
    return {
      id: m.id,
      name: m.displayName,
      initials: initials(m.displayName),
      title: profileLabel(m) ?? m.email ?? T.noTitle,
      note: inv ? format(T.noteJoin, { note: T.inviteSent, reserved: B.seatReserved }) : undefined,
      chip: inv
        ? { label: T.chipInvited, tone: 'warn', icon: 'schedule' }
        : { label: T.chipActive, tone: 'ok', icon: 'check_circle' },
      invited: inv,
    };
  });
  const join = (title: string | undefined) => (title ? format(T.titleJoin, { title }) : '');
  const free: FreePerson[] = [
    ...blocked.map((m) => ({
      id: m.id,
      name: m.displayName,
      initials: initials(m.displayName),
      what: join(profileLabel(m)) + B.blockedKept,
    })),
    ...cards.map((m) => ({
      id: m.id,
      name: m.displayName,
      initials: initials(m.displayName),
      what: join(profileLabel(m)) + B.crewCard,
    })),
  ];
  return { paid, free };
}
