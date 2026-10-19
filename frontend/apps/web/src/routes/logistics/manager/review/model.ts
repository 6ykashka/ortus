// W2.21 · Модель «Приёмки смен» (`logistics-review`; эталон reviewVM :3330–3382, accept/rework :2764–2783,
// 03-logistics.md §7): очередь смен и её порядок, подписи очереди и карточек, статистика осмотров, фото до и после,
// дефекты, расходы, итог решения и проверки доработки. Данные — DTO контракта 0.5.0-stage2 (TripPlan, Inspection,
// TripExpense, InspectionDefect; категории расходов — 0.5.1-stage2); словари — домен W0.12 (TRIP_STATE,
// PHOTO_SIDES, FUEL, EXPENSE_CAT), подписи категорий — logisticsDriver.expenseKinds (W2.40).
import type { components } from '@ortus/api-client';
import { int, rub } from '@ortus/domain';
import { EXPENSE_CAT, FUEL, PHOTO_SIDES, TRIP_STATE } from '@ortus/domain/modules';
import { errors, format, home, logisticsDriver, logisticsManager, shell } from '@ortus/texts';

import { REVIEW_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Insp = S['Inspection'] | undefined;

export interface Chip {
  label: string;
  tone: 'neutral' | 'ok' | 'info' | 'warn' | 'danger';
  icon: string;
}

const L = logisticsManager.review;
const MSK = 'Europe/Moscow';

/** Порядок очереди эталона (:3335): дефект, ожидает приёмки, на доработке, принят. */
const ORDER: Partial<Record<S['TripState'], number>> = {
  defect_review: 0,
  submitted: 1,
  rework: 2,
  accepted: 3,
};

/** Разделы доработки (`ReworkStep`) и их подписи (REV_STEPS эталона). */
export const REWORK_STEPS: readonly (readonly [S['ReworkStep'], string])[] = [
  ['photos', L.reworkSteps.photos],
  ['odometer', L.reworkSteps.odometer],
  ['expenses', L.reworkSteps.expenses],
  ['checklist', L.reworkSteps.checklist],
];

/** Ракурсы осмотра: роль контракта ↔ подпись PHOTO_SIDES эталона (порядок тот же). */
const ROLES: readonly S['InspectionPhoto']['role'][] = [
  'front',
  'rear',
  'left',
  'right',
  'odometer',
];

/** Топливо: процент контракта ↔ ключ FUEL эталона (¼, ½, ¾, полный). */
const FUEL_PERCENT: Readonly<Record<number, string>> = { 25: 'q', 50: 'h', 75: 'tq', 100: 'f' };

const time = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  hour: '2-digit',
  minute: '2-digit',
});
const date = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** «HH:MM» по Москве. */
export const timeOf = (iso: string): string => time.format(new Date(iso));
/** «ДД.ММ.ГГГГ» по Москве. */
export const dateOf = (iso: string): string => date.format(new Date(iso));

export const money = (m: S['Money']): string => rub(m.amountMinor / 100);

export function stateChip(state: S['TripState']): Chip {
  const s = state === 'cancelled' ? undefined : TRIP_STATE[state];
  return s
    ? { label: s.label, tone: s.tone as Chip['tone'], icon: s.icon }
    : {
        label: state,
        tone: 'neutral',
        icon: 'event',
      };
}

/** Смены приёмки в порядке эталона; внутри состояния — по плановому окну и номеру. */
export function reviewQueue(trips: readonly S['TripPlan'][]): S['TripPlan'][] {
  return trips
    .filter((t) => ORDER[t.state] !== undefined)
    .sort(
      (a, b) =>
        (ORDER[a.state] ?? 0) - (ORDER[b.state] ?? 0) ||
        a.plannedWindow.startsAt.localeCompare(b.plannedWindow.startsAt) ||
        a.number.localeCompare(b.number),
    );
}

const vehicleText = (v: S['Vehicle'] | undefined): string =>
  v ? format(T.vehicle, { model: v.displayName, plate: v.registrationNumber }) : '';

export function queueItem(t: S['TripPlan'], v: S['Vehicle'] | undefined) {
  return {
    id: t.id,
    title: format(T.queueTitle, {
      trip: t.number,
      driver: t.driverDisplayName || T.driverFallback,
    }),
    sub: v
      ? format(T.vehicleSub, { model: v.displayName, plate: v.registrationNumber })
      : L.vehicleRemoved,
    chip: stateChip(t.state),
  };
}

/** Крошка (:3333): владелец — организация целиком, логист — подразделение своей области. */
export function crumb(o: { owner: boolean; tenant: string; unit: string | undefined }): string {
  if (o.owner) return format(home.scopeAll, { tenant: o.tenant });
  return o.unit ?? shell.header.noScope;
}

export function shiftHead(t: S['TripPlan'], v: S['Vehicle'] | undefined) {
  return {
    title: format(T.shiftTitle, { trip: t.number, title: t.title }),
    sub: format(T.shiftSub, { driver: t.driverDisplayName ?? '', vehicle: vehicleText(v) }),
    chip: stateChip(t.state),
  };
}

export function fuelLabel(p: number | undefined): string {
  if (p === undefined) return T.none;
  const key = FUEL_PERCENT[p];
  const pair = key ? FUEL.find(([k]) => k === key) : undefined;
  return pair ? pair[1] : format(T.fuelPercent, { p });
}

const km = (n: number): string => format(T.km, { km: int(n) });

/** Статистика карточки смены (:3359–3364). */
export function stats(dep: Insp, ret: Insp): { label: string; value: string }[] {
  const d = dep ? Number(dep.odometerKm) : undefined;
  const r = ret ? Number(ret.odometerKm) : undefined;
  return [
    { label: L.stats.odometerStart, value: d === undefined ? T.none : km(d) },
    { label: L.after, value: r === undefined ? T.none : km(r) },
    {
      label: L.stats.driven,
      value: d === undefined || r === undefined ? T.none : km(r - d),
    },
    {
      label: L.stats.fuel,
      value: format(T.fuel, {
        before: fuelLabel(dep?.fuelPercent),
        after: fuelLabel(ret?.fuelPercent),
      }),
    },
  ];
}

export interface PhotoRow {
  role: S['InspectionPhoto']['role'];
  label: string;
  before: string | undefined;
  after: string | undefined;
}

/** «Фото до и после» (:3365): пять ракурсов, id файла выезда и сдачи. */
export function photoRows(dep: Insp, ret: Insp): PhotoRow[] {
  const file = (i: Insp, role: string) => i?.photos.find((p) => p.role === role)?.fileId;
  return ROLES.map((role, n) => ({
    role,
    label: PHOTO_SIDES[n]?.[1] ?? role,
    before: file(dep, role),
    after: file(ret, role),
  }));
}

export function checks(dep: Insp, ret: Insp): string[] {
  return [...(dep ? [T.checkDeparture] : []), ...(ret ? [T.checkReturn] : [])];
}

/** Дефекты осмотров (:3355, :3367): критический — блокирующий, ещё не признанный некритичным. */
export function defectLines(dep: Insp, ret: Insp): { text: string; critical: boolean }[] {
  const lines = (i: Insp, when: string) =>
    (i?.defects ?? []).map((d) => {
      const downgraded = d.severity === 'blocking' && d.decision === 'allow_departure';
      return {
        text:
          format(T.defectLine, { zone: d.zone, text: d.description, when }) +
          (downgraded ? T.downgraded : ''),
        critical: d.severity === 'blocking' && !downgraded,
      };
    });
  return [...lines(dep, T.whenDeparture), ...lines(ret, T.whenReturn)];
}

/**
 * Иконки категорий расходов: «Топливо» и «Мойка» — EXPENSE_CAT эталона, остальные коды 0.5.1-stage2 (D-12, W2.40) —
 * без эталона. Подписи — словарь кодов `logisticsDriver.expenseKinds` (одна строка — один файл).
 */
const KIND_ICON: Readonly<Record<S['TripExpense']['kind'], string>> = {
  fuel: EXPENSE_CAT.fuel.icon,
  wash: EXPENSE_CAT.wash.icon,
  parking: 'local_parking',
  toll: 'toll',
  tire_service: 'tire_repair',
  other: 'receipt_long',
};
const KIND_FALLBACK_ICON = 'receipt_long';

/**
 * Категория расхода: подпись — справочник тенанта catalog (с архивными, W2.41), затем словарь посева; код вне
 * справочника — сам код и общая иконка (карточка не падает).
 */
function kindOf(
  kind: string,
  catalog?: ReadonlyMap<string, string>,
): { label: string; icon: string } {
  const labels: Readonly<Record<string, string>> = logisticsDriver.expenseKinds;
  const icons: Readonly<Record<string, string>> = KIND_ICON;
  return {
    label: catalog?.get(kind) ?? (Object.hasOwn(labels, kind) ? (labels[kind] ?? kind) : kind),
    icon: Object.hasOwn(icons, kind) ? (icons[kind] ?? KIND_FALLBACK_ICON) : KIND_FALLBACK_ICON,
  };
}

/** Строка расхода (:3369): категория и литры, дата и комментарий, «чек приложен», сумма. */
export function expenseLine(e: S['TripExpense'], catalog?: ReadonlyMap<string, string>) {
  const k = kindOf(e.kind, catalog);
  return {
    icon: k.icon,
    label: k.label + (e.quantity ? format(T.liters, { n: e.quantity }) : ''),
    meta:
      dateOf(e.occurredAt) +
      (e.comment ? ` · ${e.comment}` : '') +
      (e.receiptFileIds.length ? T.receipt : ''),
    amount: money(e.amount),
  };
}

export const expensesTotal = (list: readonly S['TripExpense'][]): string =>
  rub(list.reduce((a, e) => a + e.amount.amountMinor, 0) / 100);

/** Проверки «Вернуть на доработку» (:2780–2781). */
export function reworkError(comment: string, steps: readonly S['ReworkStep'][]): string | null {
  if (!comment.trim()) return errors.mock.logistics.reworkComment;
  if (!steps.length) return errors.mock.logistics.reworkSteps;
  return null;
}

const stepLabel = (s: S['ReworkStep']): string => REWORK_STEPS.find(([k]) => k === s)?.[1] ?? s;

/** Итог решения (:3379). */
export function decidedText(t: S['TripPlan']): string | null {
  const r = t.lastReview;
  if (t.state === 'accepted') {
    const at = t.acceptedAt ?? r?.reviewedAt;
    return format(L.acceptedAt, { time: at ? timeOf(at) : '' });
  }
  if (t.state === 'rework' && r) {
    return format(L.returned, {
      comment: r.comment ?? '',
      steps: (r.steps ?? []).map(stepLabel).join(', '),
    });
  }
  return null;
}

/** Карточка дефекта (:3346): время — отправка осмотра выезда, без него — сообщение о дефекте. */
export function defectCard(
  t: S['TripPlan'],
  d: S['InspectionDefect'],
  v: S['Vehicle'] | undefined,
  dep: Insp,
) {
  return {
    vehicle: vehicleText(v),
    sub: format(T.defectSub, {
      trip: t.number,
      driver: t.driverDisplayName ?? '',
      time: timeOf(dep?.submittedAt ?? d.reportedAt),
    }),
    zone: d.zone,
    text: d.description,
  };
}
