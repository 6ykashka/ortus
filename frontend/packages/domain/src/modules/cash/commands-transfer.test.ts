// Перемещения между кассами: cashTransfer, cashTransferAccept (cash.js:459–477).
import { describe, expect, it } from 'vitest';
import { balanceOf } from './dictionaries.ts';
import { env, type Env } from './env.test-util.ts';
import { NBSP, altaCash, apiErr, grantCash, setTenantStatus } from './fixture.test-util.ts';
import type { CashOp, CashTransfer } from './types.ts';

const transferOf = (e: Env, id: string): CashTransfer => {
  const t = e.db.cash.transfers.find((x) => x.id === id);
  if (!t) throw new Error('нет перемещения ' + id);
  return t;
};
const opOf = (e: Env, id: string | undefined): CashOp => {
  const o = e.db.cash.ops.find((x) => x.id === id);
  if (!o) throw new Error('нет операции ' + String(id));
  return o;
};
const send = (e: Env, o: Record<string, unknown> = {}): string =>
  e.api.cashTransfer({ from: 'ca-sever', to: 'ca-safe', amount: 1000, ...o });

describe('cashTransfer', () => {
  it('касса → сейф: списание сразу, перемещение «в пути», заметка по умолчанию', () => {
    const e = env();
    const id = send(e);
    expect(transferOf(e, id)).toMatchObject({
      from: 'ca-sever',
      to: 'ca-safe',
      amount: 1000,
      note: 'Сдача выручки',
      by: 'm-owner',
      at: '01.10 10:30',
      status: 'transit',
    });
    const out = opOf(e, transferOf(e, id).outOp);
    expect(out).toMatchObject({
      account: 'ca-sever',
      type: 'move_out',
      amount: 1000,
      method: 'cash',
      cat: 'Перемещение',
      basis: 'Сдача выручки → «Сейф офиса»',
      tr: id,
      shift: null,
      by: 'm-owner',
    });
    expect(balanceOf(e.db.cash, 'ca-sever')).toBe(29760);
    expect(balanceOf(e.db.cash, 'ca-safe')).toBe(116840);
    expect(e.db.cash.transfers[0]?.id).toBe(id);
  });

  it.each([
    ['ca-bank', undefined, 'Инкассация'],
    ['ca-safe', '  Сдача в банк  ', 'Сдача в банк'],
    ['ca-sever', '', 'Перемещение'],
  ])('заметка по получателю %s: «%s» → «%s»', (to, note, want) => {
    const e = env();
    const from = to === 'ca-bank' ? 'ca-safe' : 'ca-spa';
    const id = send(e, { from, to, note });
    expect(transferOf(e, id).note).toBe(want);
  });

  it('из кассы со сменами: операция привязана к открытой смене; событие — получателям с «Изменять»', () => {
    const e = env(altaCash(), 'm-morozova');
    const id = send(e, { from: 'ca-spa', amount: 500 });
    expect(opOf(e, transferOf(e, id).outOp).shift).toBe('sh-118');
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса: 500' + NBSP + '₽ в пути в «Сейф офиса» — Сдача выручки',
      to: ['m-owner'],
    });
  });

  it('перемещение собственнику-отправителю не шлёт событие самому себе', () => {
    const e = env();
    send(e);
    expect(e.db.events?.[0]?.to).toEqual([]);
  });

  it.each([
    [{ to: 'ca-sever' }, 'validation', 'Выберите другую кассу'],
    [
      { from: 'ca-adv-vas' },
      'validation',
      'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»',
    ],
    [
      { to: 'ca-adv-vas' },
      'validation',
      'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»',
    ],
    [
      { from: 'ca-bank' },
      'validation',
      'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»',
    ],
    [
      { to: 'ca-term' },
      'validation',
      'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»',
    ],
    [{ amount: 0 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ amount: 40000 }, 'validation', 'В «Касса офиса» нет столько наличных'],
    [{ from: 'zzz' }, 'not_found', 'Касса не найдена'],
    [{ to: 'zzz' }, 'not_found', 'Касса не найдена'],
  ])('%j → %s «%s»', (o, code, message) => {
    expect(apiErr(() => send(env(), o))).toEqual({ code, message });
  });

  it('нужно право «Изменять» в кассе-отправителе; тариф «только чтение»', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create'], { type: 'tenant' });
    expect(apiErr(() => send(env(db, 'm-petrova')))).toEqual({
      code: 'forbidden',
      message: 'Перемещение — действие «Изменять» в роли',
    });
    expect(apiErr(() => send(env(altaCash(), 'm-kotova'))).code).toBe('not_found');
    const r = altaCash();
    setTenantStatus(r, 'restricted');
    expect(apiErr(() => send(env(r))).code).toBe('subscription_restricted');
  });
});

describe('cashTransferAccept', () => {
  const sent = (o: Record<string, unknown> = {}): { e: Env; id: string } => {
    const e = env(altaCash(), 'm-morozova');
    const id = send(e, { from: 'ca-spa', ...o });
    e.as('m-owner');
    return { e, id };
  };

  it('приём: зачисление на кассу-получателя, событие отправителю', () => {
    const { e, id } = sent();
    expect(e.api.cashTransferAccept(id, true)).toBe('done');
    const t = transferOf(e, id);
    expect(t).toMatchObject({ status: 'done', decidedBy: 'm-owner', decidedAt: '01.10 10:30' });
    expect(opOf(e, t.inOp)).toMatchObject({
      account: 'ca-safe',
      type: 'move_in',
      amount: 1000,
      method: 'cash',
      cat: 'Перемещение',
      basis: 'Сдача выручки ← «Касса салона · ресепшен»',
      tr: id,
    });
    expect(balanceOf(e.db.cash, 'ca-safe')).toBe(117840);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса: 1' + NBSP + '000' + NBSP + '₽ приняты в «Сейф офиса»',
      to: ['m-morozova'],
    });
  });

  it('ok не указан — это приём; зачисление на счёт — безналичным способом', () => {
    const e = env();
    const id = send(e, { from: 'ca-safe', to: 'ca-bank', amount: 5000 });
    expect(e.api.cashTransferAccept(id, undefined as never)).toBe('done');
    expect(opOf(e, transferOf(e, id).inOp)).toMatchObject({
      account: 'ca-bank',
      method: 'transfer',
    });
  });

  it('отказ: возврат на кассу-отправитель с причиной, событие отправителю', () => {
    const { e, id } = sent();
    expect(e.api.cashTransferAccept(id, false, 'нет подписи')).toBe('rejected');
    const t = transferOf(e, id);
    expect(t).toMatchObject({ status: 'rejected', reason: 'нет подписи' });
    expect(opOf(e, t.backOp)).toMatchObject({
      account: 'ca-spa',
      type: 'move_in',
      amount: 1000,
      basis: 'Не принято в «Сейф офиса»: нет подписи',
      tr: id,
    });
    expect(balanceOf(e.db.cash, 'ca-spa')).toBe(7350);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса: «Сейф офиса» не принял(а) 1' + NBSP + '000' + NBSP + '₽ — нет подписи',
      to: ['m-morozova'],
    });
  });

  it('отказ без причины — validation, перемещение остаётся «в пути»', () => {
    const { e, id } = sent();
    expect(apiErr(() => e.api.cashTransferAccept(id, false, 'аб'))).toEqual({
      code: 'validation',
      message: 'Укажите причину',
    });
    expect(transferOf(e, id)).toMatchObject({ status: 'transit' });
    expect(transferOf(e, id).decidedBy).toBeUndefined();
  });

  it('принимает получатель: держатель подотчёта или роль с «Изменять» в кассе-получателе', () => {
    const e = env();
    const id = send(e, { from: 'ca-sever', to: 'ca-safe' });
    e.as('m-kotova');
    expect(apiErr(() => e.api.cashTransferAccept(id, true))).toEqual({
      code: 'forbidden',
      message: 'Принимает получатель: роль с правом «Изменять» в «Сейф офиса»',
    });
    const adv = env();
    adv.db.cash.transfers.unshift({
      id: 'tr-9',
      from: 'ca-sever',
      to: 'ca-adv-vas',
      amount: 1000,
      note: 'Выдача под отчёт · Илья Васильев',
      by: 'm-owner',
      at: '01.10 09:00',
      status: 'transit',
    });
    const aid = { id: 'tr-9' };
    expect(apiErr(() => adv.api.cashTransferAccept(aid.id, true))).toEqual({
      code: 'forbidden',
      message: 'Принимает получатель: Илья Васильев',
    });
    adv.as('m-vasiliev');
    expect(adv.api.cashTransferAccept(aid.id, true)).toBe('done');
  });

  it('решённое или несуществующее перемещение — conflict', () => {
    const { e, id } = sent();
    e.api.cashTransferAccept(id, true);
    for (const x of [id, 'tr-zzz', 'tr-1']) {
      expect(apiErr(() => e.api.cashTransferAccept(x, true))).toEqual({
        code: 'conflict',
        message: 'Перемещение уже принято или отклонено',
      });
    }
  });

  it('тариф «только чтение» блокирует и приём (дополнение к эталону)', () => {
    const { e, id } = sent();
    setTenantStatus(e.db, 'restricted');
    expect(apiErr(() => e.api.cashTransferAccept(id, true)).code).toBe('subscription_restricted');
  });
});
