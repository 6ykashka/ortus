// W4.61 · Модель «Тарифной сетки» оператора (plansVM «Ортус CRM.dc.html» :3853–3914, design-2026-10-19) по
// listPriceBookVersions (W4.07): шапка действующей версии, баннер запланированной, строки сетки и ячейки сроков,
// история версий, черновик новой версии с проверками эталона дословно, тело publishPriceBookVersion и диалоги.
import type { components } from '@ortus/api-client';
import { format, platform } from '@ortus/texts';

import type { ConfirmSpec } from '../kit/confirm.tsx';
import { type Chip, mskDate, mskLastDay, plural, rub, shortName } from '../kit/format.ts';
import { KIT_TEXT } from '../kit/texts.ts';
import { PLANS_TEXT as T } from './texts.ts';

type Version = components['schemas']['PriceBookVersion'];
type Create = components['schemas']['PriceBookVersionCreate'];
type Term = Version['terms'][number];

export interface DraftTier {
  /** Код ступени прежней версии (подписки идут за ним); новой ступени код даёт сервер. */
  code?: string;
  name: string;
  /** Строка поля (только цифры); `null` — безлимит. */
  seats: string | null;
  /** Цена в рублях строкой поля; `null` — безлимит. */
  month: string | null;
}

export interface Draft {
  tiers: DraftTier[];
  terms: { months: number; off: string }[];
  /** Дата начала «ДД.ММ.ГГГГ» (значение опции «Начнёт действовать»). */
  from: string;
  note: string;
}

export interface Head {
  months: number;
  label: string;
  offLabel: string;
}

export interface TierRow {
  name: string;
  seats: string;
  month: string;
  custom: boolean;
  cells: { main: string; sub: string }[];
}

export interface HistoryRow {
  v: string;
  chip: Chip;
  period: string;
  line: string;
}

/** Шапка карточки сетки: «Версия v2», «· действует с 01.10.2026», что изменилось (plansVM :3861). */
export function versionHead(v: Version): { title: string; from: string; note: string } {
  return {
    title: format(T.version, { v: v.version }),
    from: format(T.from, { from: mskDate(v.effectiveFrom) }),
    note: v.note,
  };
}

/** Номер следующей версии: после всех, и отменённых (их номер занят журналом, Q-W4.07-12). */
export const nextVersion = (all: readonly Version[]): number =>
  all.reduce((n, v) => Math.max(n, v.version), 0) + 1;

/** Баннер «Запланирована версия vN с …» (plansVM :3859). */
export const scheduledText = (s: Version, cur: Version): string =>
  format(T.scheduled, {
    v: s.version,
    from: mskDate(s.effectiveFrom),
    note: s.note,
    cur: cur.version,
  });

const termLabel = (months: number): string =>
  months === 1 ? T.termMonth : format(T.termMonths, { n: months });

/** Заголовки сроков: «Месяц · базовая цена», «4 мес · скидка 5%» (plansVM :3862). */
export const heads = (terms: readonly { months: number; discountPercent: number }[]): Head[] =>
  terms.map((t) => ({
    months: t.months,
    label: termLabel(t.months),
    offLabel: t.discountPercent ? format(T.off, { off: t.discountPercent }) : T.base,
  }));

/** Строки сетки черновика или версии: места, цена, ячейки сроков (plansVM :3863–3872). */
export function tierRows(d: Draft): TierRow[] {
  return d.tiers.map((t, i) => {
    const custom = t.month === null;
    const prevSeats = d.tiers[i - 1]?.seats ?? 0;
    return {
      name: t.name,
      seats: t.seats ? format(T.upTo, { seats: t.seats }) : format(T.more, { seats: prevSeats }),
      month: custom ? '' : rub(Number(t.month) || 0),
      custom,
      cells: d.terms.map((term) => {
        if (custom) return { main: T.onRequest, sub: T.byOperator };
        const m = Math.round(Number(t.month) * (1 - Number(term.off) / 100));
        const ok = Number.isFinite(m) && m > 0;
        if (!ok) return { main: KIT_TEXT.dash, sub: '' };
        return {
          main: rub(m),
          sub:
            term.months === 1
              ? T.perMonth
              : format(T.perMonthTotal, { total: rub(m * term.months) }),
        };
      }),
    };
  });
}

const CURRENT: Chip = { label: platform.plans.current, tone: 'ok', icon: 'check_circle' };
const ARCHIVE: Chip = { label: platform.plans.archive, tone: 'neutral', icon: 'history' };

function period(v: Version): string {
  const from = mskDate(v.effectiveFrom);
  if (v.state === 'scheduled') return format(T.periodScheduled, { from });
  if (!v.effectiveUntil) return format(T.periodNow, { from });
  if (v.state === 'current') return format(T.periodUntil, { from, to: mskDate(v.effectiveUntil) });
  return format(T.periodClosed, { from, to: mskLastDay(v.effectiveUntil) });
}

/** «История версий» новыми сверху (plansVM :3912); отменённые не показываются. */
export function historyRows(list: readonly Version[]): HistoryRow[] {
  return [...list]
    .filter((v) => v.state !== 'cancelled')
    .sort((a, b) => b.version - a.version)
    .map((v) => {
      const n = v.subscriptionCount ?? 0;
      const chip: Chip =
        v.state === 'current'
          ? CURRENT
          : v.state === 'scheduled'
            ? {
                label: format(T.chipScheduled, { from: mskDate(v.effectiveFrom) }),
                tone: 'info',
                icon: 'event',
              }
            : ARCHIVE;
      const [one, few, many] = T.usageWords;
      return {
        v: `v${v.version}`,
        chip,
        period: period(v),
        line: format(T.historyLine, {
          note: v.note,
          by: v.publishedBy ? shortName(v.publishedBy.displayName) : KIT_TEXT.dash,
          usage: format(T.usage, { n, word: plural(n, one, few, many) }),
        }),
      };
    });
}

const MSK = 3 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Даты начала новой версии: первые числа трёх следующих месяцев по Москве (plansVM :3874). */
export function fromOptions(now: number): { value: string; label: string }[] {
  const d = new Date(now + MSK);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return [1, 2, 3].map((k) => {
    const at = new Date(Date.UTC(y, m + k, 1));
    const value = `01.${pad(at.getUTCMonth() + 1)}.${at.getUTCFullYear()}`;
    return { value, label: format(T.startsOption, { date: value }) };
  });
}

/** Черновик — копия действующей версии (plansVM :3877). */
export function draftFrom(v: Version, from: string): Draft {
  return {
    tiers: v.tiers.map((t) => ({
      code: t.code,
      name: t.name,
      seats: t.seatsLimit === null ? null : String(t.seatsLimit),
      month: t.monthAmountMinor === null ? null : String(t.monthAmountMinor / 100),
    })),
    terms: v.terms.map((t) => ({ months: t.months, off: String(t.discountPercent) })),
    from,
    note: '',
  };
}

/** Проверки черновика — тексты эталона дословно (plansVM :3880–3898). */
export function validateDraft(d: Draft): string[] {
  const E = T.errors;
  const out: string[] = [];
  d.tiers.forEach((t, i) => {
    const name = t.name.trim();
    const nm = name ? format(E.quoted, { name }) : format(E.tierN, { i: i + 1 });
    const unlimited = t.seats === null && t.month === null;
    if (!name) out.push(format(E.name, { i: i + 1 }));
    if (unlimited && i !== d.tiers.length - 1) out.push(format(E.unlimitedLast, { name: nm }));
    if (unlimited) return;
    const seats = Number(t.seats);
    const month = Number(t.month);
    const prev = d.tiers
      .slice(0, i)
      .reverse()
      .find((x) => x.seats !== null);
    if (!(String(t.seats ?? '').length && Number.isInteger(seats) && seats > 0)) {
      out.push(format(E.seats, { name: nm }));
    } else if (prev && seats <= Number(prev.seats)) {
      out.push(format(E.seatsGrow, { name: nm, prev: prev.name.trim(), seats: prev.seats ?? '' }));
    }
    if (!(month > 0)) out.push(format(E.price, { name: nm }));
    else if (prev && Number(prev.month) > 0 && month <= Number(prev.month)) {
      out.push(format(E.priceGrow, { name: nm, prev: prev.name.trim() }));
    }
  });
  const names = d.tiers.map((t) => t.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) out.push(E.unique);
  if (!d.tiers.some((t) => t.seats !== null)) out.push(E.priced);
  for (const t of d.terms) {
    const off = Number(t.off);
    if (!(t.off.length && off >= 0 && off < 50)) {
      const term = t.months === 1 ? E.discountMonth : format(T.termMonths, { n: t.months });
      out.push(format(E.discount, { term }));
    }
  }
  return out;
}

/** «Добавить тариф»: перед безлимитом, мест вдвое больше предыдущего (plansVM :3900–3903). */
export function addTier(d: Draft): Draft {
  const unl = d.tiers.findIndex((t) => t.seats === null);
  const at = unl === -1 ? d.tiers.length : unl;
  const prev = d.tiers[at - 1];
  const tiers = [...d.tiers];
  tiers.splice(at, 0, { name: '', seats: prev ? String(Number(prev.seats) * 2) : '10', month: '' });
  return { ...d, tiers };
}

/** «Удалить тариф». */
export const removeTier = (d: Draft, i: number): Draft => ({
  ...d,
  tiers: d.tiers.filter((_, k) => k !== i),
});

/** «Без лимита, цена индивидуально» последнего тарифа (plansVM :3869). */
export function setUnlimited(d: Draft, i: number, on: boolean): Draft {
  const prev = d.tiers[i - 1];
  const tiers = d.tiers.map((t, k) =>
    k === i
      ? {
          ...t,
          seats: on ? null : String((Number(prev?.seats) || 50) * 2),
          month: on ? null : '',
        }
      : t,
  );
  return { ...d, tiers };
}

/** «01.11.2026» → «2026-11-01». */
const isoDate = (ddmmyyyy: string): string => {
  const [d = '', m = '', y = ''] = ddmmyyyy.split('.');
  return `${y}-${m}-${d}`;
};

/** Тело publishPriceBookVersion: рубли → копейки, места числом, коды прежних ступеней. */
export function publishBody(d: Draft): Create {
  return {
    effectiveFrom: isoDate(d.from),
    note: d.note.trim(),
    tiers: d.tiers.map((t) => {
      const tier = {
        name: t.name.trim(),
        seatsLimit: t.seats === null ? null : Number(t.seats),
        monthAmountMinor: t.month === null ? null : Math.round(Number(t.month) * 100),
      };
      return t.code ? { code: t.code, ...tier } : tier;
    }),
    terms: d.terms.map((t) => ({
      months: t.months as Term['months'],
      discountPercent: Number(t.off),
    })),
  };
}

/** Диалог «Опубликовать тарифную сетку vN?» (plansVM :3906–3910). */
export function publishSpec(next: number, cur: number, from: string): ConfirmSpec {
  const D = T.publishDialog;
  return {
    title: format(D.title, { v: next }),
    text: format(D.text, { from }),
    items: [
      { icon: 'event', tone: 'info', text: format(D.newPrices, { from }) },
      { icon: 'lock_clock', tone: 'ok', text: D.keep },
      { icon: 'event_upcoming', tone: 'neutral', text: format(D.until, { from, cur }) },
    ],
    confirmLabel: D.confirm,
    tone: 'info',
  };
}

/** Диалог «Отменить версию vN?» (plansVM :3860). */
export function cancelSpec(v: number, cur: number): ConfirmSpec {
  const D = T.cancelDialog;
  return {
    title: format(D.title, { v }),
    text: D.text,
    items: [
      { icon: 'undo', tone: 'ok', text: format(D.keep, { cur }) },
      { icon: 'history', tone: 'neutral', text: D.journal },
    ],
    confirmLabel: D.confirm,
    tone: 'danger',
  };
}
