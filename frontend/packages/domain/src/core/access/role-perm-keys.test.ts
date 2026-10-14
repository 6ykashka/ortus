import { describe, expect, it } from 'vitest';
import { altaFixture } from '../testing/fixture.ts';
import type { Role } from '../types/index.ts';
import { rolePermKeys } from './index.ts';

const db = altaFixture();
const role = (id: string): Role => {
  const r = db.roles.find((x) => x.id === id);
  if (!r) throw new Error('нет роли ' + id);
  return r;
};

describe('rolePermKeys: ключи прав роли (02 §12 п. 15, models.js 14.10)', () => {
  it('владелец — все права', () => {
    expect(rolePermKeys(role('r-owner'))).toEqual(['*']);
  });

  it('водитель — 10 ключей в порядке действий роли', () => {
    expect(rolePermKeys(role('r-driver'))).toEqual([
      'fleet.vehicles.read',
      'fleet.trips.read',
      'fleet.reservations.create',
      'fleet.inspections.create',
      'fleet.expenses.create',
      'forms.read',
      'forms.responses.create',
      'calendar.read',
      'files.upload',
      'knowledge.read',
    ]);
  });

  it('менеджер логистики — 22 ключа, последний fleet.earnings.read', () => {
    const keys = rolePermKeys(role('r-manager'));
    expect(keys).toHaveLength(22);
    expect(keys.slice(9)).toEqual([
      'calendar.read',
      'calendar.bookings.create',
      'calendar.bookings.manage',
      'tasks.read',
      'tasks.create',
      'tasks.manage',
      'forms.read',
      'forms.responses.review',
      'data.read',
      'data.export',
      'files.read',
      'knowledge.read',
      'fleet.earnings.read',
    ]);
  });

  it.each([
    ['r-therapist', 5],
    ['r-foreman', 6],
    ['r-cashier', 7],
  ])('%s — %i ключей', (id, n) => {
    expect(rolePermKeys(role(id))).toHaveLength(n);
  });

  it('касса: cash.balance.read и cash.advance.self только при действиях кассы', () => {
    const cashier: Role = { ...role('r-cashier'), cash: { balance: true, self: true } };
    expect(rolePermKeys(cashier).slice(-2)).toEqual(['cash.balance.read', 'cash.advance.self']);
    const noCash: Role = { ...role('r-foreman'), cash: { balance: true, self: true } };
    expect(rolePermKeys(noCash)).not.toContain('cash.balance.read');
    expect(rolePermKeys(noCash)).not.toContain('cash.advance.self');
  });

  it('finance.manage → fleet.earnings.manage; модули без прав пропускаются', () => {
    const r: Role = {
      id: 'r-x',
      name: 'X',
      kind: 'custom',
      actions: { notifications: ['view'], data: ['view'] },
      finance: { read: false, manage: true },
    };
    expect(rolePermKeys(r)).toEqual(['data.read', 'fleet.earnings.manage']);
    expect(
      rolePermKeys({ ...r, actions: { forms: ['edit'] }, finance: { read: false, manage: false } }),
    ).toEqual([]);
  });
});
