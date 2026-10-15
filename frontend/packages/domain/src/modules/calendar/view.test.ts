// Проекция календаря (api.js 14.10:212): брони машин видны владельцу и тем, кто видит логистику
// подразделения машины; остальные брони — всем участникам организации.
import { describe, expect, it } from 'vitest';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { logisticsSeed } from '../logistics/seed.ts';
import { calendarSeed } from './seed.ts';
import { calendarView } from './view.ts';

const alta = () => ({
  ...createAlta(createPlatform()),
  ...logisticsSeed('t-alta'),
  calendar: calendarSeed('t-alta'),
});

describe('calendarView', () => {
  it('владелец видит все брони', () => {
    expect(calendarView(alta(), 'm-owner').bookings).toHaveLength(6);
  });

  it('водитель фирмы «Север» видит бронь ТО машины своей фирмы', () => {
    expect(calendarView(alta(), 'm-vasiliev').bookings.map((b) => b.id)).toContain('b-to');
  });

  it('массажист не видит брони машин; бронь рейса (источник — рейс) видна, как в эталоне', () => {
    const ids = calendarView(alta(), 'm-morozova').bookings.map((b) => b.id);
    expect(ids).toEqual(['b-208', 'b-a1', 'b-a2', 'b-a3', 'b-br']);
  });

  it('бронь машины, которой нет в организации, скрыта от всех, кроме владельца', () => {
    const P = createPlatform();
    const lotos = {
      ...createLotos(P),
      ...logisticsSeed('t-lotos'),
      calendar: calendarSeed('t-lotos'),
    };
    expect(calendarView(lotos, 'm-morozova').bookings.map((b) => b.id)).not.toContain('b-to');
    expect(calendarView(lotos, 'm-owner').bookings.map((b) => b.id)).toContain('b-to');
  });

  it('ресурсы не фильтруются; результат — копия', () => {
    const db = alta();
    const v = calendarView(db, 'm-morozova');
    expect(v.resources).toHaveLength(8);
    v.resources.pop();
    expect(db.calendar.resources).toHaveLength(8);
  });
});
