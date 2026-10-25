// Модуль «Касса» по контракту ядра: установка, проекция, команды, задержки, экспорты.
import { describe, expect, it } from 'vitest';
import { demoClock, fixedClock } from '../../core/clock.ts';
import { composeCommands, composeDelays, createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { SEED_STAGES, runSeedHooks } from '../../core/seed-hooks.ts';
import { altaCash } from './fixture.test-util.ts';
import * as api from './index.ts';
import { cashHook, cashModule, createCashModule } from './module.ts';
import { cashView } from './view.ts';

const METHODS = [
  'cashPost',
  'cashPostProposal',
  'cashDismiss',
  'cashLink',
  'cashReverse',
  'cashShiftOpen',
  'cashShiftClose',
  'cashShiftReview',
  'cashTransfer',
  'cashTransferAccept',
  'cashIssue',
  'cashReceipt',
  'cashReceiptDecide',
  'cashReturn',
  'cashApprove',
  'cashAccountCreate',
];

const ctxFor = (db: TenantDb, actor: string | null = 'm-owner') =>
  createModuleCtx({
    getDb: () => db,
    getActor: () => actor,
    clock: demoClock,
    tasks: createFakeTaskPort(),
  });

describe('контракт DomainModule', () => {
  it('ключ, 16 методов эталона и задержки по cmd(fn, ms)', () => {
    expect(cashModule.key).toBe('cash');
    expect([...cashModule.methods]).toEqual(METHODS);
    expect(composeDelays([cashModule])).toEqual({
      cashPost: 350,
      cashPostProposal: 400,
      cashDismiss: 250,
      cashLink: 250,
      cashReverse: 350,
      cashShiftOpen: 350,
      cashShiftClose: 450,
      cashShiftReview: 350,
      cashTransfer: 350,
      cashTransferAccept: 300,
      cashIssue: 350,
      cashReceipt: 350,
      cashReceiptDecide: 300,
      cashReturn: 350,
      cashApprove: 350,
      cashAccountCreate: 350,
    });
  });

  it('composeCommands собирает реестр: у каждого метода есть команда, без лишних', () => {
    const db = altaCash();
    const cmds = composeCommands([cashModule], ctxFor(db));
    expect(Object.keys(cmds)).toEqual(METHODS);
    for (const fn of Object.values(cmds)) expect(typeof fn).toBe('function');
  });

  it('команда из реестра работает над БД и возвращает результат', () => {
    const db = altaCash();
    const cmds = composeCommands([cashModule], ctxFor(db));
    const r = (cmds['cashDismiss'] as (k: string, w: string) => unknown)('pr-1', 'нет оплаты');
    expect(r).toBeUndefined();
    expect(db.cash.dismissed).toHaveLength(1);
  });
});

describe('install', () => {
  it('«Альта»: срез кассы и роли; повтор идемпотентен', () => {
    const db = createAlta(createPlatform()) as TenantDb;
    cashModule.install(db, { tenantId: 't-alta', clock: demoClock });
    const once = structuredClone(db);
    cashModule.install(db, { tenantId: 't-alta', clock: demoClock });
    expect(db).toEqual(once);
    expect((db as unknown as { cash: { accounts: unknown[] } }).cash.accounts).toHaveLength(8);
  });

  it('хук стадии `cash` — та же установка; стадия есть в SEED_STAGES', () => {
    expect(SEED_STAGES).toContain('cash');
    const db = createAlta(createPlatform()) as TenantDb;
    const ran = runSeedHooks(db, { cash: cashHook }, { tenantId: 't-alta', clock: demoClock });
    expect(ran).toEqual(['cash']);
    expect((db as unknown as { cash: { v1: boolean } }).cash.v1).toBe(true);
  });
});

describe('view', () => {
  it('проекция участника = cashView; «сегодня» — по часам модуля', () => {
    const db = altaCash();
    expect(cashModule.view(db, 'm-owner', undefined)).toEqual(
      cashView(db, 'm-owner', { today: '01.10' }),
    );
    const late = createCashModule({ clock: fixedClock('2026-10-04T10:00:00+03:00') });
    const v = late.view(db, 'm-owner', undefined);
    expect(v?.todo.filter((t) => t.label === 'Подотчёт · срок')).toHaveLength(2);
    expect(
      cashModule.view(db, 'm-owner', undefined)?.todo.filter((t) => t.label === 'Подотчёт · срок'),
    ).toHaveLength(0);
  });

  it('нет среза кассы — null', () => {
    const db = createAlta(createPlatform()) as TenantDb;
    expect(cashModule.view(db, 'm-owner', undefined)).toBeNull();
  });
});

describe('часы модуля и команд', () => {
  it('команды с чужими часами не собираются: срок решался бы по-разному', () => {
    const m = createCashModule({ clock: fixedClock('2026-10-04T10:00:00+03:00') });
    expect(() => m.commands(ctxFor(altaCash()))).toThrow(/часы команд/);
  });
});

describe('публичный API индекса', () => {
  it('экспортирует модуль, команды, проекцию, доступ, правила ролей и справочники', () => {
    for (const name of [
      'cashModule',
      'createCashModule',
      'cashHook',
      'installCash',
      'cashSeedAlta',
      'cashCommands',
      'cashView',
      'cashTodo',
      'cashProposals',
      'cashAccess',
      'cashPeople',
      'canAcceptTransfer',
      'assertCashScope',
      'driverCashSelf',
      'CASH_DELAYS',
      'CASH_METHODS',
      'CASH_KIND',
      'CASH_OP',
      'cashBalanceOf',
      'cashParseSum',
      'cashRub',
    ]) {
      expect(api, name).toHaveProperty(name);
    }
    expect(api.CASH_METHODS).toEqual(METHODS);
  });
});
