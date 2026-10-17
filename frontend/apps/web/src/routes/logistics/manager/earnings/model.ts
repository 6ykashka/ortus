// W2.21 · Модель «Начислений водителям» (`logistics-earnings`, S2-12, AC-05; no-reference, 14-stage2-dor.md §4):
// строки по рейсам (рейс, водитель, сумма, кто и когда изменил), итог, подразделения фильтра, разбор суммы правки
// владельцем (setTripEarnings). Деньги — копейки контракта (Money.amountMinor), на экране — rub эталона.
import type { components } from '@ortus/api-client';
import { rub } from '@ortus/domain';
import { errors, format } from '@ortus/texts';

import { dateOf, money, timeOf } from '../review/model.ts';
import { EARNINGS_TEXT as T } from './texts.ts';

type S = components['schemas'];

export interface EarningRow {
  tripId: string;
  trip: string;
  driver: string;
  amount: string;
  amountMinor: number;
  changed: string;
  note: string | null;
  unitId: string | undefined;
}

export function earningRows(
  list: readonly S['TripEarnings'][],
  trips: readonly S['TripPlan'][],
  members: ReadonlyMap<string, string>,
): EarningRow[] {
  return list.map((e) => {
    const t = trips.find((x) => x.id === e.tripId);
    return {
      tripId: e.tripId,
      trip: t ? `${t.number} · ${t.title}` : T.none,
      driver: t?.driverDisplayName ?? members.get(e.driverMemberId) ?? T.none,
      amount: money(e.amount),
      amountMinor: e.amount.amountMinor,
      changed: format(T.changed, {
        date: dateOf(e.updatedAt),
        time: timeOf(e.updatedAt),
        who: members.get(e.updatedByMemberId) ?? T.none,
      }),
      note: e.calculationNote ?? null,
      unitId: t?.orgUnitId,
    };
  });
}

export const total = (list: readonly S['TripEarnings'][]): string =>
  rub(list.reduce((a, e) => a + e.amount.amountMinor, 0) / 100);

/** «Все подразделения» и подразделения рейсов (в порядке первого появления). */
export function unitOptions(
  trips: readonly S['TripPlan'][],
  label: (id: string) => string | undefined,
): { value: string; label: string }[] {
  const ids = [...new Set(trips.map((t) => t.orgUnitId))];
  return [
    { value: '', label: T.allUnits },
    ...ids.map((id) => ({ value: id, label: label(id) ?? T.noUnitName })),
  ];
}

/** Рубли с копейками через запятую или точку, с пробелами разрядов → копейки; не число — null. */
export function parseAmount(s: string): number | null {
  const clean = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Ошибки суммы — тексты validateExpense эталона (models.js :378–389). */
export function amountError(s: string): string | null {
  const E = errors.mock.logistics.expense;
  if (!s.trim()) return E.amountRequired;
  const n = parseAmount(s);
  if (n === null) return E.amountNumber;
  if (n <= 0) return E.amountPositive;
  return null;
}
