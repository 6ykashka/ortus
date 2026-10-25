// Правила кассы в `assign` и `saveRole` (api.js 14.10/19.10:416, 439) и ключи прав роли (models.js:319–320).
import { describe, expect, it } from 'vitest';
import { rolePermKeys } from '../../core/access/role-perm-keys.ts';
import type { Role } from '../../core/types/index.ts';
import { altaCash, apiErr } from './fixture.test-util.ts';
import { assertCashScope, driverCashSelf } from './role-rules.ts';

const role = (o: Partial<Role>): Role => ({
  id: 'r-x',
  name: 'Роль',
  kind: 'custom',
  actions: {},
  finance: { read: false, manage: false },
  ...o,
});

describe('assertCashScope: область «Касса» только для ролей с модулем «Касса»', () => {
  const MSG = 'Область «Касса» подходит только ролям с модулем «Касса»';
  const account = { type: 'account', id: 'ca-spa' } as const;

  it('роль без кассы в области «касса» — validation', () => {
    expect(apiErr(() => assertCashScope(role({ actions: { tasks: ['view'] } }), account))).toEqual({
      code: 'validation',
      message: MSG,
    });
    expect(apiErr(() => assertCashScope(role({ actions: { cash: [] } }), account)).message).toBe(
      MSG,
    );
  });

  it.each([
    ['роль с кассой', role({ actions: { cash: ['view'] } }), account],
    ['владелец (all)', role({ all: true }), account],
    ['другая область', role({ actions: {} }), { type: 'tenant' } as const],
    ['область фирмы', role({ actions: {} }), { type: 'firm', id: 'f-msk-sever' } as const],
    ['нет области — проверка не касается', role({ actions: {} }), undefined],
  ])('%s — без ошибки', (_n, r, scope) => {
    expect(() => assertCashScope(r, scope)).not.toThrow();
  });

  it('роли из установки: кассир, менеджер, водитель подходят; терапевт — нет', () => {
    const db = altaCash();
    const byId = (id: string): Role => {
      const r = db.roles.find((x) => x.id === id);
      if (!r) throw new Error(id);
      return r;
    };
    for (const id of ['r-cashier', 'r-manager', 'r-driver', 'r-foreman', 'r-owner']) {
      expect(() => assertCashScope(byId(id), account)).not.toThrow();
    }
    expect(apiErr(() => assertCashScope(byId('r-therapist'), account)).code).toBe('validation');
  });
});

describe('driverCashSelf: у функции «Водитель» в кассе только свой подотчёт', () => {
  it('роль-водитель с кассой получает self = true, остальные параметры сохраняются', () => {
    const r = role({
      professional: 'driver',
      actions: { cash: ['view', 'create'] },
      cash: { balance: true, out: 100 },
    });
    expect(driverCashSelf(r).cash).toEqual({ balance: true, out: 100, self: true });
    expect(
      driverCashSelf(role({ professional: 'driver', actions: { cash: ['view'] } })).cash,
    ).toEqual({
      self: true,
    });
  });

  it.each([
    ['не водитель', role({ actions: { cash: ['view'] }, cash: { balance: true } })],
    ['водитель без кассы', role({ professional: 'driver', actions: { logistics: ['view'] } })],
    ['водитель с пустой кассой', role({ professional: 'driver', actions: { cash: [] } })],
  ])('%s — роль не меняется', (_n, r) => {
    expect(driverCashSelf(r)).toEqual(r);
  });

  it('вход не мутируется', () => {
    const r = role({ professional: 'driver', actions: { cash: ['view'] }, cash: { out: 1 } });
    driverCashSelf(r);
    expect(r.cash).toEqual({ out: 1 });
  });
});

describe('rolePermKeys для ролей кассы', () => {
  it('кассир салона: 7 прав (view, create, edit), без остатка и самообслуживания', () => {
    const db = altaCash();
    const cashier = db.roles.find((r) => r.id === 'r-cashier');
    if (!cashier) throw new Error('нет роли');
    expect(rolePermKeys(cashier)).toEqual([
      'cash.read',
      'cash.post',
      'cash.proposals.post',
      'cash.shift.operate',
      'cash.refund',
      'cash.transfer',
      'cash.advance.issue',
    ]);
  });

  it('водитель после установки: cash.balance.read и cash.advance.self в конце', () => {
    const db = altaCash();
    const driver = db.roles.find((r) => r.id === 'r-driver');
    if (!driver) throw new Error('нет роли');
    expect(rolePermKeys(driver).slice(-2)).toEqual(['cash.balance.read', 'cash.advance.self']);
  });
});
