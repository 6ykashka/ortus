// W2.21 · Модель «Начислений водителям» (S2-12, AC-05; no-reference, 14-stage2-dor.md §4): строки по рейсам (рейс,
// водитель, сумма, кто и когда изменил), итог, подразделения фильтра, разбор суммы правки.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { amountError, earningRows, parseAmount, total, unitOptions } from './model.ts';

type S = components['schemas'];

const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');

const trip = (id: string, number: string, unit: string): S['TripPlan'] => ({
  id,
  number,
  title: 'Северный маршрут',
  orgUnitId: unit,
  state: 'accepted',
  plannedWindow: {
    startsAt: '2026-10-01T06:00:00Z',
    endsAt: '2026-10-01T10:00:00Z',
    timeZone: 'Europe/Moscow',
  },
  cargo: { description: 'Сухой груз', weightKg: '1100', volumeM3: '12', lengthM: '3' },
  stops: [],
  driverDisplayName: 'Илья Васильев',
  revision: 9,
});

const earning = (o: Partial<S['TripEarnings']> = {}): S['TripEarnings'] => ({
  tripId: 't1',
  driverMemberId: 'm-vasiliev',
  amount: { amountMinor: 450000, currency: 'RUB' },
  updatedByMemberId: 'm-kotova',
  updatedAt: '2026-10-01T11:42:00Z',
  revision: 1,
  ...o,
});

describe('начисления водителям', () => {
  it('строка: рейс и название, водитель, сумма, кто и когда изменил', () => {
    const rows = earningRows(
      [earning()],
      [trip('t1', 'Р-208', 'u1')],
      new Map([['m-kotova', 'Марина Котова']]),
    );
    expect(rows).toEqual([
      {
        tripId: 't1',
        trip: 'Р-208 · Северный маршрут',
        driver: 'Илья Васильев',
        amount: nb('4 500 ₽'),
        amountMinor: 450000,
        changed: 'Изменено 01.10.2026 в 14:42 · Марина Котова',
        note: null,
        unitId: 'u1',
      },
    ]);
  });

  it('без рейса в списке и без имени автора — «—»; примечание расчёта', () => {
    const [row] = earningRows(
      [earning({ tripId: 'x', calculationNote: 'Доплата за выходной' })],
      [],
      new Map(),
    );
    expect(row).toMatchObject({
      trip: '—',
      driver: '—',
      changed: 'Изменено 01.10.2026 в 14:42 · —',
      note: 'Доплата за выходной',
    });
  });

  it('итог — сумма начислений', () => {
    expect(
      total([
        earning(),
        earning({ tripId: 't2', amount: { amountMinor: 380000, currency: 'RUB' } }),
      ]),
    ).toBe(nb('8 300 ₽'));
    expect(total([])).toBe('0 ₽');
  });

  it('подразделения фильтра — из рейсов начислений, «Все подразделения» первым', () => {
    expect(
      unitOptions(
        [trip('t1', 'Р-208', 'u1'), trip('t2', 'Р-211', 'u2'), trip('t3', 'Р-212', 'u1')],
        (id) => (id === 'u1' ? 'Москва / Север Логистик' : undefined),
      ),
    ).toEqual([
      { value: '', label: 'Все подразделения' },
      { value: 'u1', label: 'Москва / Север Логистик' },
      { value: 'u2', label: 'Подразделение без названия' },
    ]);
  });

  it('сумма правки: рубли с копейками → копейки; ошибки ввода', () => {
    expect(parseAmount('4500')).toBe(450000);
    expect(parseAmount('4 500,50')).toBe(450050);
    expect(parseAmount('abc')).toBeNull();
    expect(amountError('')).toBe('Укажите сумму');
    expect(amountError('abc')).toBe('Сумма должна быть числом');
    expect(amountError('0')).toBe('Сумма должна быть больше нуля');
    expect(amountError('-5')).toBe('Сумма должна быть больше нуля');
    expect(amountError('4500')).toBeNull();
  });
});
