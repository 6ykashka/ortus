// Согласование заявок и создание касс: cashApprove, cashAccountCreate (cash.js:531–559).
// Заявка `rq-1` из сида: расход 6 500 ₽ из кассы офиса, автор Котова, лимит без согласования 5 000 ₽.
import { describe, expect, it } from 'vitest';
import { balanceOf } from './dictionaries.ts';
import { env, type Env } from './env.test-util.ts';
import { NBSP, altaCash, apiErr, grantCash, setTenantStatus } from './fixture.test-util.ts';
import type { CashRequest } from './types.ts';

const req = (e: Env, id = 'rq-1'): CashRequest => {
  const q = e.db.cash.requests.find((x) => x.id === id);
  if (!q) throw new Error('нет заявки ' + id);
  return q;
};

describe('cashApprove', () => {
  it('согласование расхода: проведено от имени автора, approvedBy — согласующий, событие автору', () => {
    const e = env();
    const id = e.api.cashApprove('rq-1', true);
    const q = req(e);
    expect(q).toMatchObject({
      status: 'approved',
      decidedBy: 'm-owner',
      decidedAt: '01.10 10:30',
      result: id,
    });
    expect(e.db.cash.ops.find((o) => o.id === id)).toMatchObject({
      account: 'ca-sever',
      type: 'out',
      amount: 6500,
      method: 'cash',
      cat: 'Мелкий ремонт',
      basis: 'Ремонт ворот склада · ИП Гаврилов',
      by: 'm-kotova',
      approvedBy: 'm-owner',
      receipt: { seller: true },
    });
    expect(balanceOf(e.db.cash, 'ca-sever')).toBe(24260);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса: согласовано и проведено — расход 6' + NBSP + '500' + NBSP + '₽ · Касса офиса',
      to: ['m-kotova'],
    });
  });

  it('отказ: причина обязательна, операции нет, событие автору', () => {
    const e = env();
    const ops = e.db.cash.ops.length;
    expect(apiErr(() => e.api.cashApprove('rq-1', false, 'аб'))).toEqual({
      code: 'validation',
      message: 'Укажите причину',
    });
    expect(req(e).status).toBe('pending');
    expect(e.api.cashApprove('rq-1', false, 'нет бюджета')).toBe('rejected');
    expect(req(e)).toMatchObject({
      status: 'rejected',
      reason: 'нет бюджета',
      decidedBy: 'm-owner',
    });
    expect(e.db.cash.ops).toHaveLength(ops);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса: не согласовано — расход 6' + NBSP + '500' + NBSP + '₽ · нет бюджета',
      to: ['m-kotova'],
    });
  });

  it('заявка сверх остатка кассы: ошибка проведения, заявка остаётся на согласовании', () => {
    const e = env();
    req(e).amount = 50000;
    expect(apiErr(() => e.api.cashApprove('rq-1', true))).toEqual({
      code: 'validation',
      message: 'В «Касса офиса» нет столько наличных: остаток ушёл бы в минус',
    });
    expect(req(e)).toMatchObject({ status: 'pending' });
    expect(req(e).decidedBy).toBeUndefined();
  });

  it('возврат клиенту: заявка кассира сверх лимита проводится от автора с чеком ККТ', () => {
    const e = env(altaCash(), 'm-morozova');
    const r = e.api.cashPost({
      account: 'ca-spa',
      type: 'refund',
      amount: 3500,
      ref: 'K-319',
      basis: 'Возврат абонемента',
      receipt: { fd: '6002' },
    }) as { request: string };
    e.as('m-owner');
    const id = e.api.cashApprove(r.request, true);
    expect(e.db.cash.ops.find((o) => o.id === id)).toMatchObject({
      type: 'refund',
      amount: 3500,
      ref: 'K-319',
      by: 'm-morozova',
      approvedBy: 'm-owner',
      receipt: { fd: '6002' },
      shift: 'sh-118',
    });
  });

  describe('выдача под отчёт', () => {
    const asked = (): Env => {
      const db = altaCash();
      grantCash(db, 'm-petrova', ['view', 'edit'], { type: 'tenant' }, { advance: 1000 });
      const e = env(db, 'm-petrova');
      const r = e.api.cashIssue({ account: 'ca-adv-vas', amount: 2000, due: '05.10' }) as {
        request: string;
      };
      e.as('m-owner');
      expect(r.request).toBe('rq-100');
      return e;
    };

    it('согласование = перемещение от автора, срок отчёта обновляется', () => {
      const e = asked();
      const tid = e.api.cashApprove('rq-100', true);
      expect(e.db.cash.transfers.find((t) => t.id === tid)).toMatchObject({
        from: 'ca-sever',
        to: 'ca-adv-vas',
        amount: 2000,
        note: 'Выдача под отчёт · Илья Васильев',
        by: 'm-petrova',
        status: 'transit',
      });
      expect(e.db.cash.accounts.find((a) => a.id === 'ca-adv-vas')?.due).toBe('05.10');
      expect(req(e, 'rq-100').result).toBe(tid);
      expect(e.db.events?.find((x) => x.text.startsWith('Касса: согласовано'))?.text).toBe(
        'Касса: согласовано и проведено — выдача под отчёт 2' +
          NBSP +
          '000' +
          NBSP +
          '₽ · Подотчёт · Илья Васильев',
      );
    });

    it('в кассе-источнике не хватает наличных — ошибка, заявка ждёт (дополнение к эталону)', () => {
      const e = asked();
      req(e, 'rq-100').amount = 50000;
      expect(apiErr(() => e.api.cashApprove('rq-100', true))).toEqual({
        code: 'validation',
        message: 'В «Касса офиса» нет столько наличных',
      });
      expect(req(e, 'rq-100').status).toBe('pending');
    });
  });

  it('решённая и несуществующая заявка — conflict', () => {
    const e = env();
    e.api.cashApprove('rq-1', true);
    for (const id of ['rq-1', 'rq-zzz']) {
      expect(apiErr(() => e.api.cashApprove(id, true))).toEqual({
        code: 'conflict',
        message: 'Заявка уже решена',
      });
    }
  });

  it('нужно право «Проверять» в кассе заявки; свою заявку согласует другой сотрудник', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashApprove('rq-1', true))).toEqual({
      code: 'forbidden',
      message: 'Согласует роль с правом «Проверять» в «Касса офиса»',
    });
    expect(apiErr(() => env(altaCash(), 'm-morozova').api.cashApprove('rq-1', true))).toEqual({
      code: 'not_found',
      message: 'Касса «Касса офиса» недоступна: касса вне области назначения',
    });
    const own = env();
    req(own).by = 'm-owner';
    expect(apiErr(() => own.api.cashApprove('rq-1', true))).toEqual({
      code: 'forbidden',
      message: 'Свою заявку согласует другой сотрудник',
    });
  });

  it('тариф «только чтение» блокирует согласование (дополнение к эталону)', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => env(db).api.cashApprove('rq-1', true)).code).toBe(
      'subscription_restricted',
    );
  });
});

describe('cashAccountCreate', () => {
  const FORBIDDEN = 'Кассы настраивает роль с действием «Настраивать» в модуле «Касса»';

  it('наличная касса со всеми настройками', () => {
    const e = env();
    const id = e.api.cashAccountCreate({
      kind: 'drawer',
      name: '  Касса ресепшен 2 ',
      unit: 'f-msk-yug',
      resp: 'm-kotova',
      mode: 'open',
      kkt: 'manual',
      limit: '50 000',
      float: 3000,
      tol: '50',
    });
    expect(id).toBe('ca-100');
    expect(e.db.cash.accounts.at(-1)).toEqual({
      id: 'ca-100',
      kind: 'drawer',
      name: 'Касса ресепшен 2',
      unit: 'f-msk-yug',
      resp: 'm-kotova',
      mode: 'open',
      kkt: 'manual',
      limit: 50000,
      float: 3000,
      tol: 50,
      member: null,
      from: null,
      term: null,
      drawer: null,
      due: null,
      cats: null,
      createdBy: 'm-owner',
      createdAt: '01.10 10:30',
    });
  });

  it('настройки кассы-ящика: неверные значения → умолчания; для других видов смен и ККТ нет', () => {
    const e = env();
    const a = e.db.cash;
    e.api.cashAccountCreate({
      kind: 'drawer',
      name: 'Ящик А',
      mode: 'zzz',
      kkt: 'yes',
      limit: 0,
      float: 'abc',
      tol: '-5',
    });
    expect(a.accounts.at(-1)).toMatchObject({
      mode: 'none',
      kkt: 'none',
      limit: null,
      float: 0,
      tol: 0,
      unit: null,
      resp: null,
    });
    e.api.cashAccountCreate({
      kind: 'safe',
      name: 'Сейф Б',
      mode: 'blind',
      kkt: 'manual',
      float: 100,
      tol: 10,
      limit: -1,
    });
    expect(a.accounts.at(-1)).toMatchObject({
      kind: 'safe',
      mode: 'none',
      kkt: 'none',
      float: 0,
      tol: 0,
      limit: null,
    });
  });

  it('подотчёт: сотрудник, касса-источник (касса подразделения или сейф), четыре статьи', () => {
    const e = env();
    e.api.cashAccountCreate({
      kind: 'advance',
      name: 'Подотчёт · Ахмедов 2',
      unit: 'f-msk-sever',
      member: 'm-akhmedov',
      limit: 10000,
    });
    expect(e.db.cash.accounts.at(-1)).toMatchObject({
      kind: 'advance',
      member: 'm-akhmedov',
      from: 'ca-sever',
      limit: 10000,
      cats: ['Топливо', 'Мойка', 'Парковка', 'Мелкий ремонт'],
    });
    e.api.cashAccountCreate({
      kind: 'advance',
      name: 'Подотчёт · Ахмедов 3',
      member: 'm-akhmedov',
    });
    expect(e.db.cash.accounts.at(-1)?.from).toBe('ca-safe');
  });

  it('банковский счёт без подразделения; id берётся из общего счётчика', () => {
    const e = env();
    const first = e.api.cashAccountCreate({ kind: 'bank', name: 'Счёт 2' });
    const second = e.api.cashAccountCreate({ kind: 'bank', name: 'Счёт 3' });
    expect([first, second]).toEqual(['ca-100', 'ca-101']);
  });

  it.each([
    [{ kind: 'zzz' }, 'validation', 'Выберите вид'],
    [{ kind: undefined }, 'validation', 'Выберите вид'],
    [{ name: 'а' }, 'validation', 'Укажите название'],
    [{ name: '   ' }, 'validation', 'Укажите название'],
    [{ kind: 'advance' }, 'validation', 'Выберите сотрудника'],
    [{ kind: 'advance', member: 'm-zzz' }, 'validation', 'Выберите сотрудника'],
    [{ name: 'касса офиса' }, 'conflict', 'Касса с таким названием уже есть'],
    [{ name: 'КАССА ОФИСА ' }, 'conflict', 'Касса с таким названием уже есть'],
  ])('%j → %s «%s»', (o, code, message) => {
    const e = env();
    const before = e.db.cash.accounts.length;
    expect(apiErr(() => e.api.cashAccountCreate({ kind: 'drawer', name: 'Новая', ...o }))).toEqual({
      code,
      message,
    });
    expect(e.db.cash.accounts).toHaveLength(before);
  });

  it('нужно право «Настраивать» в модуле «Касса» (кассир, без роли, роль объекта — нет)', () => {
    const spec = { kind: 'drawer', name: 'Новая' };
    expect(apiErr(() => env(altaCash(), 'm-morozova').api.cashAccountCreate(spec))).toEqual({
      code: 'forbidden',
      message: FORBIDDEN,
    });
    expect(apiErr(() => env(altaCash(), 'm-kotova').api.cashAccountCreate(spec)).code).toBe(
      'forbidden',
    );
    const obj = altaCash();
    grantCash(obj, 'm-petrova', ['view', 'settings'], { type: 'account', id: 'ca-spa' });
    expect(apiErr(() => env(obj, 'm-petrova').api.cashAccountCreate(spec)).code).toBe('forbidden');
  });

  it('роль региона «Настраивать»: кассу можно завести только в своём подразделении', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'settings'], { type: 'region', id: 'r-msk' });
    const e = env(db, 'm-petrova');
    expect(() =>
      e.api.cashAccountCreate({ kind: 'drawer', name: 'Касса Юг', unit: 'f-msk-yug' }),
    ).not.toThrow();
    expect(
      apiErr(() =>
        e.api.cashAccountCreate({ kind: 'drawer', name: 'Касса Нева', unit: 'f-spb-neva' }),
      ),
    ).toEqual({
      code: 'forbidden',
      message: FORBIDDEN,
    });
    expect(apiErr(() => e.api.cashAccountCreate({ kind: 'safe', name: 'Сейф 2' })).code).toBe(
      'forbidden',
    );
  });

  it('тариф «только чтение» блокирует создание', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(
      apiErr(() => env(db).api.cashAccountCreate({ kind: 'drawer', name: 'Новая' })).code,
    ).toBe('subscription_restricted');
  });
});
