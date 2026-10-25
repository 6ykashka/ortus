// Подотчёт: cashIssue, cashReceipt, cashReceiptDecide, cashReturn (cash.js:479–529).
// Подотчёт Васильева `ca-adv-vas`: на руках 4 450 ₽, лимит 15 000 ₽, срок отчёта 03.10, касса-источник `ca-sever`.
import { describe, expect, it } from 'vitest';
import { balanceOf } from './dictionaries.ts';
import { env, type Env } from './env.test-util.ts';
import { NBSP, altaCash, apiErr, grantCash, setTenantStatus } from './fixture.test-util.ts';
import type { AdvanceReceipt, CashAccount } from './types.ts';

const acc = (e: Env, id: string): CashAccount => {
  const a = e.db.cash.accounts.find((x) => x.id === id);
  if (!a) throw new Error('нет кассы ' + id);
  return a;
};
const receipt = (e: Env, id: string): AdvanceReceipt => {
  const c = e.db.cash.receipts.find((x) => x.id === id);
  if (!c) throw new Error('нет чека ' + id);
  return c;
};
const issue = (e: Env, o: Record<string, unknown> = {}) =>
  e.api.cashIssue({ account: 'ca-adv-vas', amount: 1000, due: '05.10', ...o });
/** Васильев — держатель подотчёта и (для проверок «своё») менеджер с правом «Изменять». */
const holderManager = (): Env => {
  const db = altaCash();
  grantCash(db, 'm-vasiliev', ['view', 'create', 'edit'], { type: 'tenant' }, { balance: true });
  return env(db, 'm-vasiliev');
};

describe('cashIssue (выдача под отчёт)', () => {
  it('выдача: перемещение из кассы-источника, срок отчёта, событие держателю', () => {
    const e = env();
    const r = issue(e) as { id: string };
    expect(e.db.cash.transfers[0]).toMatchObject({
      id: r.id,
      from: 'ca-sever',
      to: 'ca-adv-vas',
      amount: 1000,
      note: 'Выдача под отчёт · Илья Васильев',
      status: 'transit',
      by: 'm-owner',
    });
    expect(acc(e, 'ca-adv-vas').due).toBe('05.10');
    expect(balanceOf(e.db.cash, 'ca-sever')).toBe(29760);
    expect(e.db.events?.[0]).toMatchObject({
      text:
        'Касса: 1' +
        NBSP +
        '000' +
        NBSP +
        '₽ в пути в «Подотчёт · Илья Васильев» — Выдача под отчёт · Илья Васильев',
      to: ['m-vasiliev'],
    });
  });

  it('источник можно задать, по умолчанию — касса подотчёта', () => {
    const e = env();
    const r = issue(e, { from: 'ca-safe' }) as { id: string };
    expect(e.db.cash.transfers.find((t) => t.id === r.id)?.from).toBe('ca-safe');
  });

  it.each([
    [{ account: 'ca-spa' }, 'validation', 'Выберите подотчёт сотрудника'],
    [{ account: 'zzz' }, 'not_found', 'Касса не найдена'],
    [{ from: 'zzz' }, 'not_found', 'Касса не найдена'],
    [{ amount: 0 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ due: '5.10' }, 'validation', 'Срок отчёта — в формате ДД.ММ'],
    [{ due: '' }, 'validation', 'Срок отчёта — в формате ДД.ММ'],
    [{ due: '2026-10-05' }, 'validation', 'Срок отчёта — в формате ДД.ММ'],
    [{ due: undefined }, 'validation', 'Срок отчёта — в формате ДД.ММ'],
    [{ amount: 40000 }, 'validation', 'В «Касса офиса» нет столько наличных'],
    [
      { amount: 12000 },
      'validation',
      'Лимит на руках у Илья Васильев — 15' + NBSP + '000' + NBSP + '₽',
    ],
  ])('%j → %s «%s»', (o, code, message) => {
    const e = env();
    const before = structuredClone(e.db.cash);
    expect(apiErr(() => issue(e, o))).toEqual({ code, message });
    expect(e.db.cash).toEqual(before);
  });

  it('нужно право «Изменять» в подотчёте и в кассе-источнике', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create'], { type: 'tenant' });
    expect(apiErr(() => issue(env(db, 'm-petrova')))).toEqual({
      code: 'forbidden',
      message: 'Выдача под отчёт — действие «Изменять» в роли',
    });
    const only = altaCash();
    grantCash(only, 'm-petrova', ['view', 'edit'], { type: 'account', id: 'ca-adv-vas' });
    expect(apiErr(() => issue(env(only, 'm-petrova')))).toEqual({
      code: 'not_found',
      message: 'Касса «Касса офиса» недоступна: касса вне области назначения',
    });
  });

  it('себе под отчёт выдаёт другой сотрудник', () => {
    expect(apiErr(() => issue(holderManager()))).toEqual({
      code: 'forbidden',
      message: 'Себе под отчёт выдаёт другой сотрудник',
    });
    expect(apiErr(() => issue(env(altaCash(), 'm-vasiliev'))).code).toBe('forbidden');
  });

  it('сумма выше лимита роли «выдача» уходит заявкой; срок и остаток не меняются', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'edit'], { type: 'tenant' }, { advance: 1000 });
    const e = env(db, 'm-petrova');
    const r = issue(e, { amount: 2000 }) as { request: string };
    expect(e.db.cash.requests[0]).toEqual({
      id: r.request,
      account: 'ca-adv-vas',
      type: 'issue',
      amount: 2000,
      method: 'cash',
      cat: 'Перемещение',
      basis: 'Выдача под отчёт · Илья Васильев',
      from: 'ca-sever',
      due: '05.10',
      by: 'm-petrova',
      at: '01.10 10:30',
      status: 'pending',
      limit: 1000,
    });
    expect(acc(e, 'ca-adv-vas').due).toBe('03.10');
    expect(e.db.cash.transfers).toHaveLength(4);
    expect(e.db.events?.[0]?.to).toEqual(['m-owner']);
  });

  it('тариф «только чтение» блокирует выдачу', () => {
    const r = altaCash();
    setTenantStatus(r, 'restricted');
    expect(apiErr(() => issue(env(r))).code).toBe('subscription_restricted');
  });
});

describe('cashReceipt (чек держателя подотчёта)', () => {
  const add = (e: Env, o: Record<string, unknown> = {}) =>
    e.api.cashReceipt({ account: 'ca-adv-vas', amount: 500, cat: 'Мойка', photo: true, ...o });
  const holder = (): Env => env(altaCash(), 'm-vasiliev');

  it('чек уходит на проверку; поля обрезаны; событие тем, кто проверяет', () => {
    const e = holder();
    const id = add(e, { link: ' Рейс Р-207 ', note: ' заметка ', qr: 1 });
    expect(e.db.cash.receipts[0]).toEqual({
      id,
      account: 'ca-adv-vas',
      amount: 500,
      cat: 'Мойка',
      link: 'Рейс Р-207',
      note: 'заметка',
      photo: true,
      qr: true,
      by: 'm-vasiliev',
      at: '01.10 10:30',
      status: 'review',
    });
    expect(id).toMatch(/^rc-/);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Подотчёт: Илья Васильев — чек «Мойка» 500' + NBSP + '₽ на проверке',
      to: ['m-owner'],
    });
  });

  it('повторная подача: старый чек помечается «переснят»', () => {
    const e = holder();
    const id = add(e, { redo: 'rc-4' });
    expect(receipt(e, 'rc-4').redoneBy).toBe(id);
    expect(() => add(e, { redo: 'rc-zzz' })).not.toThrow();
  });

  it.each([
    [{ amount: 0 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ cat: '' }, 'validation', 'Выберите статью'],
    [{ photo: false }, 'validation', 'Сфотографируйте чек'],
    [{ account: 'zzz' }, 'not_found', 'Касса не найдена'],
    [{ account: 'ca-sever' }, 'forbidden', 'Чек добавляет держатель подотчёта'],
    [{ account: 'ca-adv-akh' }, 'forbidden', 'Чек добавляет держатель подотчёта'],
  ])('%j → %s «%s»', (o, code, message) => {
    expect(apiErr(() => add(holder(), o))).toEqual({ code, message });
  });

  it('чужой подотчёт чек не принимает даже у владельца', () => {
    expect(apiErr(() => add(env()))).toEqual({
      code: 'forbidden',
      message: 'Чек добавляет держатель подотчёта',
    });
  });

  it('тариф «только чтение» блокирует', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => add(env(db, 'm-vasiliev'))).code).toBe('subscription_restricted');
  });
});

describe('cashReceiptDecide', () => {
  it('принять: расход подотчёта по чеку, остаток уменьшился, событие автору', () => {
    const e = env();
    expect(e.api.cashReceiptDecide('rc-3', true)).toBe('accepted');
    const c = receipt(e, 'rc-3');
    expect(c).toMatchObject({ status: 'accepted', decidedBy: 'm-owner', decidedAt: '01.10 10:30' });
    expect(e.db.cash.ops.find((o) => o.id === c.op)).toMatchObject({
      account: 'ca-adv-vas',
      type: 'out',
      amount: 600,
      method: 'cash',
      cat: 'Мойка',
      basis: 'Чек · Мойка · Рейс Р-203',
      src: { kind: 'receipt', id: 'rc-3', label: 'Чек Илья Васильев' },
      receipt: { seller: true },
    });
    expect(balanceOf(e.db.cash, 'ca-adv-vas')).toBe(3850);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Подотчёт: чек «Мойка» 600' + NBSP + '₽ принят',
      to: ['m-vasiliev'],
    });
  });

  it('в основании — привязка и заметка, если они есть', () => {
    const e = env();
    const c = receipt(e, 'rc-3');
    c.note = 'мойка кузова';
    c.link = '';
    e.api.cashReceiptDecide('rc-3', true);
    expect(e.db.cash.ops[0]?.basis).toBe('Чек · Мойка · мойка кузова');
  });

  it('отклонить: причина обязательна, событие автору, операции нет', () => {
    const e = env();
    const before = e.db.cash.ops.length;
    expect(apiErr(() => e.api.cashReceiptDecide('rc-3', false, 'аб'))).toEqual({
      code: 'validation',
      message: 'Укажите причину',
    });
    expect(receipt(e, 'rc-3').status).toBe('review');
    expect(e.api.cashReceiptDecide('rc-3', false, 'не видна сумма')).toBe('rejected');
    expect(receipt(e, 'rc-3')).toMatchObject({
      status: 'rejected',
      reason: 'не видна сумма',
      decidedBy: 'm-owner',
    });
    expect(e.db.cash.ops).toHaveLength(before);
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Подотчёт: чек «Мойка» 600' + NBSP + '₽ не принят — не видна сумма',
      to: ['m-vasiliev'],
    });
  });

  it('уже проверенный и несуществующий чек — conflict', () => {
    for (const id of ['rc-2', 'rc-4', 'rc-zzz']) {
      expect(apiErr(() => env().api.cashReceiptDecide(id, true))).toEqual({
        code: 'conflict',
        message: 'Чек уже проверен',
      });
    }
  });

  it('проверяет роль с «Изменять»; свой чек — другой сотрудник', () => {
    expect(apiErr(() => env(altaCash(), 'm-vasiliev').api.cashReceiptDecide('rc-3', true))).toEqual(
      {
        code: 'forbidden',
        message: 'Чеки проверяет роль с правом «Изменять»',
      },
    );
    expect(apiErr(() => holderManager().api.cashReceiptDecide('rc-3', true))).toEqual({
      code: 'forbidden',
      message: 'Свой чек проверяет другой сотрудник',
    });
    expect(apiErr(() => env(altaCash(), 'm-kotova').api.cashReceiptDecide('rc-3', true)).code).toBe(
      'not_found',
    );
  });
});

describe('cashReturn (возврат остатка)', () => {
  const ret = (e: Env, o: Record<string, unknown> = {}) =>
    e.api.cashReturn({ account: 'ca-adv-vas', amount: 1000, ...o });

  it('держатель возвращает остаток в кассу-источник перемещением «в пути»', () => {
    const e = env(altaCash(), 'm-vasiliev');
    const id = ret(e);
    expect(e.db.cash.transfers[0]).toMatchObject({
      id,
      from: 'ca-adv-vas',
      to: 'ca-sever',
      amount: 1000,
      note: 'Возврат остатка подотчёта · Илья Васильев',
      status: 'transit',
      by: 'm-vasiliev',
    });
    expect(balanceOf(e.db.cash, 'ca-adv-vas')).toBe(3450);
    expect(e.db.events?.[0]?.to).toEqual(['m-owner']);
  });

  it.each([
    [{ amount: 0 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ amount: 5000 }, 'validation', 'На руках меньше: 4' + NBSP + '450' + NBSP + '₽'],
    [{ account: 'ca-sever' }, 'forbidden', 'Остаток возвращает держатель подотчёта'],
    [{ account: 'ca-adv-akh' }, 'forbidden', 'Остаток возвращает держатель подотчёта'],
    [{ account: 'zzz' }, 'not_found', 'Касса не найдена'],
  ])('%j → %s «%s»', (o, code, message) => {
    expect(apiErr(() => ret(env(altaCash(), 'm-vasiliev'), o))).toEqual({ code, message });
  });

  it('владелец чужой остаток не возвращает; тариф «только чтение» блокирует', () => {
    expect(apiErr(() => ret(env())).message).toBe('Остаток возвращает держатель подотчёта');
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => ret(env(db, 'm-vasiliev'))).code).toBe('subscription_restricted');
  });
});
