// W5.33 · Каталог редактора ролей: «Касса» — флажки блока «Касса · остаток и лимиты» вне уровней модуля
// (`cash.balance.read`, `cash.advance.self`; rolePermKeys M:317–318), помощники блока.
import { describe, expect, it } from 'vitest';

import {
  CASH_BALANCE,
  CASH_SELF,
  cashOn,
  roleCatalog,
  toDraft,
  toPermissions,
  withFlag,
} from './catalog.ts';

const catalog = roleCatalog(() => true);
const cash = catalog.modules.find((m) => m.key === 'cash');
const role = (permissions: string[]) => ({
  id: 'r',
  name: 'Роль',
  description: 'Роль',
  builtIn: false,
  permissions,
  revision: 1,
});

describe('уровни модуля «Касса»', () => {
  it('флажки блока не входят ни в один уровень', () => {
    const keys = (cash?.verbs ?? []).flatMap((v) => v.perms);
    expect(keys).not.toContain(CASH_BALANCE);
    expect(keys).not.toContain(CASH_SELF);
    expect(keys).toContain('cash.read');
    expect(keys).toContain('cash.post');
  });

  it('«Просматривать» — только cash.read; «Создавать» — без cash.advance.self', () => {
    const level = (k: string) => cash?.verbs.find((v) => v.key === k)?.perms;
    expect(level('view')).toEqual(['cash.read']);
    expect(level('create')).toEqual(['cash.post', 'cash.proposals.post', 'cash.shift.operate']);
  });

  it('ключи флажков не мешают определить уровни роли и не пропадают при смене уровней', () => {
    const r = role(['cash.read', CASH_BALANCE, CASH_SELF]);
    const draft = toDraft(r, catalog);
    expect(draft.actions['cash']).toEqual(['view']);
    const next = { ...draft, actions: { ...draft.actions, cash: ['view', 'create'] } };
    const perms = toPermissions(r.permissions, draft, next, catalog);
    expect(perms).toEqual(
      expect.arrayContaining(['cash.read', CASH_BALANCE, CASH_SELF, 'cash.post']),
    );
  });
});

describe('cashOn и withFlag', () => {
  it('модуль включён — целиком или частично', () => {
    expect(cashOn(toDraft(role([]), catalog))).toBe(false);
    expect(cashOn(toDraft(role([CASH_SELF]), catalog))).toBe(false);
    expect(cashOn(toDraft(role(['cash.read']), catalog))).toBe(true);
    // Один ключ уровня «Создавать» — уровень выдан частично, модуль включён.
    expect(cashOn(toDraft(role(['cash.post']), catalog))).toBe(true);
    expect(cashOn({ id: 'r', name: 'Р', actions: {}, partial: { cash: ['create'] } })).toBe(true);
  });

  it('флажок включается без дублей и снимается; прочие ключи не трогаются', () => {
    expect(withFlag(['a'], CASH_BALANCE, true)).toEqual(['a', CASH_BALANCE]);
    expect(withFlag(['a', CASH_BALANCE], CASH_BALANCE, true)).toEqual(['a', CASH_BALANCE]);
    expect(withFlag(['a', CASH_BALANCE], CASH_BALANCE, false)).toEqual(['a']);
    expect(withFlag(['a'], CASH_BALANCE, false)).toEqual(['a']);
  });
});
