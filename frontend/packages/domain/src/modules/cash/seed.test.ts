// Сид и установка «Кассы» (cash.js:176–272): демо «Альты», миграция «Лотоса», роли и назначения.
import { describe, expect, it } from 'vitest';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { balanceOf } from './dictionaries.ts';
import { cashHook, cashSeedAlta, installCash } from './seed.ts';
import type { CashSlice, CashTenantDb } from './types.ts';

const alta = (): CashTenantDb => createAlta(createPlatform()) as TenantDb as CashTenantDb;
const lotos = (): CashTenantDb => createLotos(createPlatform()) as TenantDb as CashTenantDb;
const slice = (db: CashTenantDb): CashSlice => {
  if (!db.cash?.v1) throw new Error('кассы нет');
  return db.cash;
};

describe('сид «Альты»', () => {
  const X = cashSeedAlta();

  it('состав: 8 касс, 26 операций, 2 смены, 4 перемещения, 6 чеков, 1 заявка, 4 предложения', () => {
    expect(X.v1).toBe(true);
    expect(X.accounts.map((a) => a.id)).toEqual([
      'ca-spa',
      'ca-term',
      'ca-sever',
      'ca-adv-vas',
      'ca-adv-akh',
      'ca-adv-sok',
      'ca-safe',
      'ca-bank',
    ]);
    expect(X.ops).toHaveLength(26);
    expect(X.shifts.map((h) => h.id)).toEqual(['sh-118', 'sh-117']);
    expect(X.transfers).toHaveLength(4);
    expect(X.receipts).toHaveLength(6);
    expect(X.requests.map((q) => q.id)).toEqual(['rq-1']);
    expect(X.proposals.map((p) => p.id)).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-4']);
    expect(X.dismissed).toEqual([]);
  });

  it('id операций: K-301…K-326 без пропусков и повторов', () => {
    const ids = X.ops.map((o) => o.id).sort();
    expect(ids).toEqual(Array.from({ length: 26 }, (_, i) => 'K-' + (301 + i)));
  });

  it.each([
    ['ca-spa', 7350],
    ['ca-term', 21600],
    ['ca-sever', 30760],
    ['ca-adv-vas', 4450],
    ['ca-adv-akh', 5000],
    ['ca-adv-sok', 11270],
    ['ca-safe', 116840],
    ['ca-bank', 1284000],
  ] as const)('остаток %s = %i', (id, want) => {
    expect(balanceOf(X, id)).toBe(want);
  });

  it('значения по умолчанию кассы, как у фабрики ACC', () => {
    const term = X.accounts.find((a) => a.id === 'ca-term');
    expect(term).toMatchObject({
      kind: 'acquiring',
      drawer: 'ca-spa',
      settle: 'ca-bank',
      fee: 1.8,
      resp: null,
      mode: 'none',
      kkt: 'none',
      limit: null,
      float: 0,
      tol: 0,
      member: null,
      from: null,
      due: null,
      cats: null,
    });
    expect(X.accounts[0]).toMatchObject({
      mode: 'blind',
      kkt: 'manual',
      tol: 100,
      term: 'ca-term',
    });
  });

  it('каждый вызов — новые объекты', () => {
    const a = cashSeedAlta();
    const first = a.ops[0];
    if (first) first.amount = 1;
    expect(cashSeedAlta().ops[0]?.amount).toBe(650);
  });

  it('смена sh-117: закрыта, расхождение −60 в допуске, в сейф 26 840', () => {
    const h = X.shifts.find((s) => s.id === 'sh-117');
    if (!h) throw new Error('нет смены');
    expect(h).toMatchObject({ status: 'closed', no: 117, counted: 31840, toSafe: 26840 });
    expect(h.diff).toEqual({ cash: -60, kktCash: 0, kktCard: 0, term: 0 });
    expect(h.decision).toEqual({
      kind: 'auto',
      at: '30.09 21:04',
      reason: 'В пределах допуска 100 ₽',
      op: 'K-321',
    });
  });
});

describe('installCash', () => {
  it('«Альта»: срез, роли с модулем «Касса», роль кассира, назначение Морозовой', () => {
    const db = alta();
    installCash(db);
    expect(slice(db).accounts).toHaveLength(8);
    const role = (id: string) => db.roles.find((r) => r.id === id);
    expect(role('r-manager')).toMatchObject({
      actions: expect.objectContaining({ cash: ['view', 'create', 'edit'] }) as unknown,
      cash: { balance: true, self: false, out: 5000, refund: 0, advance: 15000 },
    });
    expect(role('r-driver')?.cash).toEqual({
      balance: true,
      self: true,
      out: null,
      refund: null,
      advance: null,
    });
    expect(role('r-driver')?.actions.cash).toEqual(['view', 'create']);
    expect(role('r-foreman')?.cash).toMatchObject({ self: true, balance: true });
    expect(role('r-cashier')).toEqual({
      id: 'r-cashier',
      name: 'Кассир салона',
      kind: 'template',
      actions: { cash: ['view', 'create', 'edit'] },
      cash: { balance: false, self: false, out: 1000, refund: 3000, advance: 0 },
      finance: { read: false, manage: false },
    });
    expect(db.assignments.filter((a) => a.id === 'a-cash1')).toEqual([
      {
        id: 'a-cash1',
        member: 'm-morozova',
        role: 'r-cashier',
        scope: { type: 'account', id: 'ca-spa' },
      },
    ]);
  });

  it('роль владельца и прочие роли не меняются', () => {
    const db = alta();
    const owner = structuredClone(db.roles.find((r) => r.id === 'r-owner'));
    installCash(db);
    expect(db.roles.find((r) => r.id === 'r-owner')).toEqual(owner);
    expect(db.roles.find((r) => r.id === 'r-therapist')?.actions.cash).toBeUndefined();
  });

  it('повтор ничего не меняет', () => {
    const db = alta();
    installCash(db);
    const once = structuredClone(db);
    installCash(db);
    expect(db).toEqual(once);
  });

  it('роль, у которой уже есть действия кассы, не перезаписывается', () => {
    const db = alta();
    const mgr = db.roles.find((r) => r.id === 'r-manager');
    if (!mgr) throw new Error('нет роли');
    mgr.actions = { ...mgr.actions, cash: ['view'] };
    installCash(db);
    expect(db.roles.find((r) => r.id === 'r-manager')?.actions.cash).toEqual(['view']);
    expect(db.roles.find((r) => r.id === 'r-manager')?.cash).toBeUndefined();
  });

  it('назначение a-cash1 не дублируется и не создаётся без Морозовой', () => {
    const db = alta();
    db.assignments.push({
      id: 'a-cash1',
      member: 'm-morozova',
      role: 'r-cashier',
      scope: { type: 'tenant' },
    });
    installCash(db);
    expect(db.assignments.filter((a) => a.id === 'a-cash1')).toHaveLength(1);
    const db2 = alta();
    db2.members = db2.members.filter((m) => m.id !== 'm-morozova');
    installCash(db2);
    expect(db2.assignments.some((a) => a.id === 'a-cash1')).toBe(false);
  });

  it('«Лотос»: касса «Лотос» переезжает в фирму, смены и остатки пустые', () => {
    const db = lotos();
    installCash(db);
    const X = slice(db);
    expect(X.accounts).toHaveLength(1);
    expect(X.accounts[0]).toMatchObject({
      id: 'ca-lotos',
      kind: 'drawer',
      name: 'Касса «Лотос»',
      unit: 'f-lotos-tver',
      mode: 'open',
      kkt: 'manual',
      float: 5000,
      tol: 100,
    });
    expect(X.ops).toEqual([]);
    expect(X.shifts).toEqual([]);
    expect(db.assignments.some((a) => a.id === 'a-cash1')).toBe(false);
    expect(db.roles.some((r) => r.id === 'r-cashier')).toBe(true);
    expect(db.roles.find((r) => r.id === 'r-admin')?.cash).toEqual({
      balance: false,
      self: false,
      out: 3000,
      refund: 3000,
      advance: 0,
    });
  });

  it('старая касса 14.10: подразделение вне оргструктуры → первая фирма; операции получают поля', () => {
    const db = alta();
    db.tenantId = 't-other';
    db.cash = {
      accounts: [
        { id: 'c1', name: 'Первая', unit: 'f-msk-yug' },
        { id: 'c2', name: 'Вторая', unit: 'spa' },
        { id: 'c3', name: 'Третья' },
      ],
      ops: [
        { id: 'K-1', account: 'c1', type: 'in', amount: 5, basis: 'x', at: '01.09', by: 'm-owner' },
      ],
    };
    installCash(db);
    const X = slice(db);
    expect(X.accounts.map((a) => a.unit)).toEqual(['f-msk-yug', 'f-msk-sever', 'f-msk-sever']);
    expect(X.ops[0]).toEqual({
      method: 'cash',
      cat: '',
      time: '',
      src: null,
      ref: null,
      receipt: null,
      shift: null,
      group: null,
      id: 'K-1',
      account: 'c1',
      type: 'in',
      amount: 5,
      basis: 'x',
      at: '01.09',
      by: 'm-owner',
    });
  });

  it('организация без кассы и без фирм: пустой срез', () => {
    const db = alta();
    db.tenantId = 't-empty';
    db.units = [];
    installCash(db);
    expect(slice(db)).toMatchObject({
      v1: true,
      accounts: [],
      ops: [],
      proposals: [],
      dismissed: [],
    });
  });

  it('хук стадии `cash` = installCash', () => {
    const db = alta();
    cashHook(db, { tenantId: 't-alta', clock: { now: () => new Date(0) } });
    expect(slice(db).accounts).toHaveLength(8);
  });
});
