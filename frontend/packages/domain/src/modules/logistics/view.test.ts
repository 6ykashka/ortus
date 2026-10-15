// Проекция логистики для участника (api.js 14.10:193–198): машины и рейсы своей области, рейсы —
// с правом «Изменять» или свои; начисления — только с правом финансов.
import { describe, expect, it } from 'vitest';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { logisticsSeed } from './seed.ts';
import { logisticsView } from './view.ts';

const alta = (logistics = true) => {
  const db = { ...createAlta(createPlatform()), ...logisticsSeed('t-alta') };
  db.modules.logistics = { enabled: logistics };
  return db;
};

describe('logisticsView', () => {
  it('владелец видит весь автопарк и рейсы с начислениями', () => {
    const v = logisticsView(alta(), 'm-owner');
    expect(v.vehicles).toHaveLength(7);
    expect(v.trips.map((t) => [t.id, t.earnings])).toEqual([
      ['Р-208', 4500],
      ['Р-211', 3800],
    ]);
    expect(v.pool.drivers).toHaveLength(2);
  });

  it('водитель: машины своей фирмы, только свой рейс, без начислений', () => {
    const db = alta();
    db.earnings.push({ id: 'en-1', trip: 'Р-208' });
    const v = logisticsView(db, 'm-vasiliev');
    expect(v.vehicles.map((x) => x.id)).toEqual(['v1', 'v6', 'v2', 'v3', 'v4']);
    expect(v.trips.map((t) => t.id)).toEqual(['Р-208']);
    expect(v.trips[0]).not.toHaveProperty('earnings');
    expect(v.earnings).toEqual([]);
  });

  it('модуль отключён — начатая работа видна по ролям, как при включённом', () => {
    expect(logisticsView(alta(false), 'm-vasiliev').trips.map((t) => t.id)).toEqual(['Р-208']);
  });

  it('логист без роли логистики не видит ничего (роль проекта не даёт области)', () => {
    const v = logisticsView(alta(), 'm-kotova');
    expect([v.vehicles, v.trips, v.earnings]).toEqual([[], [], []]);
  });

  it('менеджер региона Москва: машины региона, все рейсы, начисления', () => {
    const db = alta();
    db.assignments.push({
      id: 'x1',
      member: 'm-kotova',
      role: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    db.earnings.push({ id: 'en-1' });
    const v = logisticsView(db, 'm-kotova');
    expect(v.vehicles.map((x) => x.id)).toEqual(['v1', 'v6', 'v2', 'v3', 'v4', 'v5']);
    expect(v.trips.map((t) => t.earnings)).toEqual([4500, 3800]);
    expect(v.earnings).toEqual([{ id: 'en-1' }]);
  });

  it('возвращает копии: правка проекции не меняет БД', () => {
    const db = alta();
    const v = logisticsView(db, 'm-owner');
    v.vehicles.pop();
    const first = v.trips[0];
    if (first) first.title = 'x';
    expect(db.vehicles).toHaveLength(7);
    expect(db.trips[0]?.title).toBe('Северный маршрут');
  });
});
