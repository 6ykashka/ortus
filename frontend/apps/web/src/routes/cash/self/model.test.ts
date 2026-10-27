// W5.33 · Модель «Мой подотчёт» (эталон Касса.dc.html selfVM :802–818): суммы, строка «Выдано …», чип срока,
// «В пути», строки чеков, статьи диалога, разбор QR чека ФНС и ввод сумм.
import type { components } from '@ortus/api-client';
import { cashRub as rub } from '@ortus/domain/modules';
import { describe, expect, it } from 'vitest';

import {
  buildCard,
  ddmm,
  dueChip,
  holderAccounts,
  mskDay,
  parseReceiptQr,
  toMinor,
} from './model.ts';
import { SELF_TEXT as T } from './texts.ts';

type S = components['schemas'];

const ACC = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const money = (minor: number): S['Money'] => ({ amountMinor: minor, currency: 'RUB' });

const account = (o: Partial<S['CashAccount']> = {}): S['CashAccount'] =>
  ({
    id: ACC,
    orgUnitId: null,
    name: 'Подотчёт · Илья Васильев',
    currency: 'RUB',
    kind: 'advance',
    balance: { amountMinor: 3_000_00, currency: 'RUB' },
    revision: 1,
    shiftMode: 'none',
    kktMode: 'none',
    categoryIds: [],
    my: {
      via: 'self',
      rights: ['cash.advance.self'],
      limits: { outMinor: null, refundMinor: null, advanceMinor: null },
      isHolder: true,
    },
    ...o,
  }) as S['CashAccount'];

const op = (o: Partial<S['CashOperation']>): S['CashOperation'] =>
  ({
    id: crypto.randomUUID(),
    accountId: ACC,
    direction: 'in',
    amount: money(0),
    category: 'expense',
    occurredAt: '2026-09-28T08:10:00Z',
    postedAt: '2026-09-28T08:10:00Z',
    createdByMemberId: ME,
    type: 'move_in',
    method: 'cash',
    origin: 'manual',
    reversedByOperationId: null,
    ...o,
  }) as S['CashOperation'];

const transfer = (o: Partial<S['CashTransfer']>): S['CashTransfer'] =>
  ({
    id: crypto.randomUUID(),
    fromAccountId: DESK,
    toAccountId: ACC,
    amount: money(100_00),
    purpose: 'advance_issue',
    status: 'done',
    sentByMemberId: ME,
    sentAt: '2026-09-28T08:10:00Z',
    decidedAt: '2026-09-28T08:10:00Z',
    revision: 1,
    ...o,
  }) as S['CashTransfer'];

const receipt = (o: Partial<S['AdvanceReceipt']>): S['AdvanceReceipt'] =>
  ({
    id: crypto.randomUUID(),
    accountId: ACC,
    amount: money(1_260_00),
    categoryId: 'fuel',
    fileId: crypto.randomUUID(),
    status: 'review',
    submittedByMemberId: ME,
    submittedAt: '2026-09-29T10:00:00Z',
    revision: 1,
    ...o,
  }) as S['AdvanceReceipt'];

const CATS: S['CashCategory'][] = [
  { id: 'fuel', title: 'Топливо', group: 'expense', direction: 'out' },
  { id: 'parking', title: 'Парковка', group: 'expense', direction: 'out' },
  { id: 'service', title: 'Оплата услуг', group: 'income', direction: 'in' },
];

const base = { today: '2026-09-30', categories: CATS, ops: [], transfers: [], receipts: [] };

describe('ввод сумм', () => {
  it.each([
    ['1260', 126000],
    ['1 260,50', 126050],
    ['1 260,5', 126050],
    ['12.5', 1250],
    [' 7 ', 700],
    ['1,234', 123],
  ])('toMinor(%j) → %j копеек', (text, minor) => {
    expect(toMinor(text)).toBe(minor);
  });

  it.each(['', '   ', '0', '-5', 'abc', '1e3', '12,3,4'])('toMinor(%j) → null', (text) => {
    expect(toMinor(text)).toBeNull();
  });
});

describe('QR чека ФНС', () => {
  it('сумма из s= в рублях с копейками', () => {
    expect(parseReceiptQr('t=20260930T1304&s=1260.00&fn=9960&i=1234&fp=5678&n=1')).toEqual({
      amountMinor: 126000,
    });
    expect(parseReceiptQr('s=89.90&t=20260930T1304')).toEqual({ amountMinor: 8990 });
  });

  it.each(['', 'https://example.com', 't=20260930T1304&fn=1', 's=abc', 's=0.00', 's=-5'])(
    'не чек: %j → null',
    (text) => {
      expect(parseReceiptQr(text)).toBeNull();
    },
  );
});

describe('даты (Москва)', () => {
  it('ddmm: день и месяц по московскому времени', () => {
    expect(ddmm('2026-09-28T08:10:00Z')).toBe('28.09');
    expect(ddmm('2026-09-28T22:30:00Z')).toBe('29.09');
  });

  it('mskDay: ISO-дата московских суток', () => {
    expect(mskDay('2026-09-30T21:30:00Z')).toBe('2026-10-01');
    expect(mskDay('2026-09-30T10:00:00Z')).toBe('2026-09-30');
  });
});

describe('чип срока отчёта', () => {
  it('остаток исчерпан — «Отчитались полностью», срок не нужен', () => {
    expect(dueChip(0, null, '2026-09-30')).toEqual({
      text: T.card.paid,
      tone: 'ok',
      icon: 'check_circle',
    });
    expect(dueChip(-1, '2026-09-01', '2026-09-30')?.text).toBe(T.card.paid);
  });

  it('срок прошёл / сегодня / впереди', () => {
    expect(dueChip(100, '2026-09-29', '2026-09-30')).toEqual({
      text: 'Срок отчёта 29.09 прошёл',
      tone: 'danger',
      icon: 'event_busy',
    });
    expect(dueChip(100, '2026-09-30', '2026-09-30')).toEqual({
      text: T.card.today,
      tone: 'warn',
      icon: 'event',
    });
    expect(dueChip(100, '2026-10-05', '2026-09-30')).toEqual({
      text: 'Отчитаться до 05.10',
      tone: 'warn',
      icon: 'event',
    });
  });

  it('срока нет в ответе — чипа нет (Q-W5.33-5)', () => {
    expect(dueChip(100, null, '2026-09-30')).toBeNull();
  });
});

describe('держатель подотчёта', () => {
  it('только свои счета вида «подотчёт»', () => {
    const own = account();
    const foreign = account({ id: DESK, my: { ...own.my, isHolder: false } });
    const drawer = account({ id: DESK, kind: 'cash_drawer' });
    expect(holderAccounts([own, foreign, drawer]).map((a) => a.id)).toEqual([ACC]);
  });
});

describe('карточка остатка', () => {
  it('остаток, «Выдано … · ДД.ММ · отчитались на …», полоса прогресса', () => {
    const card = buildCard(account(), {
      ...base,
      ops: [
        op({ type: 'move_in', direction: 'in', amount: money(10_000_00) }),
        op({ type: 'out', direction: 'out', amount: money(2_000_00) }),
        op({ type: 'out', direction: 'out', amount: money(500_00), reversedByOperationId: ME }),
        op({ type: 'move_out', direction: 'out', amount: money(5_000_00) }),
      ],
      transfers: [
        transfer({ decidedAt: '2026-09-20T08:10:00Z' }),
        transfer({ decidedAt: '2026-09-28T08:10:00Z' }),
        transfer({ decidedAt: '2026-09-30T08:10:00Z', status: 'transit' }),
      ],
    });
    expect(card.name).toBe(T.card.name);
    expect(card.balance).toBe(rub(3000));
    expect(card.line).toBe(`Выдано ${rub(10000)} · 28.09 · отчитались на ${rub(2000)}`);
    expect(card.pct).toBe(20);
  });

  it('перемещений держателю не отдают (listCashTransfers — cash.read): дата последней выдачи — по журналу', () => {
    const card = buildCard(account(), {
      ...base,
      ops: [
        op({
          type: 'move_in',
          direction: 'in',
          amount: money(5_000_00),
          occurredAt: '2026-09-20T08:12:00Z',
        }),
        op({
          type: 'move_in',
          direction: 'in',
          amount: money(5_000_00),
          occurredAt: '2026-09-28T08:12:00Z',
        }),
        op({
          type: 'move_in',
          direction: 'in',
          amount: money(1_00),
          occurredAt: '2026-09-30T08:12:00Z',
          reversedByOperationId: ME,
        }),
      ],
    });
    expect(card.line).toBe(`Выдано ${rub(10000)} · 28.09 · отчитались на ${rub(0)}`);
  });

  it('остаток скрыт правами — считается по журналу', () => {
    const card = buildCard(account({ balance: null }), {
      ...base,
      ops: [
        op({ type: 'move_in', direction: 'in', amount: money(10_000_00) }),
        op({ type: 'out', direction: 'out', amount: money(2_500_00) }),
      ],
    });
    expect(card.balanceMinor).toBe(7_500_00);
  });

  it('выдач нет: строка без даты, полоса 0 %', () => {
    const card = buildCard(account({ balance: money(0) }), base);
    expect(card.line).toBe(`Выдано ${rub(0)} · отчитались на ${rub(0)}`);
    expect(card.pct).toBe(0);
    expect(card.canReturn).toBe(false);
  });

  it('полоса не выше 100 %', () => {
    const card = buildCard(account(), {
      ...base,
      ops: [
        op({ type: 'move_in', direction: 'in', amount: money(1_000_00) }),
        op({ type: 'out', direction: 'out', amount: money(2_000_00) }),
      ],
    });
    expect(card.pct).toBe(100);
  });

  it('срок отчёта — из необязательного поля счёта', () => {
    const card = buildCard({ ...account(), reportDueDate: '2026-10-05' } as S['CashAccount'], base);
    expect(card.due?.text).toBe('Отчитаться до 05.10');
    expect(buildCard(account(), base).due).toBeNull();
  });
});

describe('«В пути»', () => {
  it('возврат ждёт приёма; название кассы — только если она видна', () => {
    const out = transfer({
      id: 'out-1',
      fromAccountId: ACC,
      toAccountId: DESK,
      purpose: 'advance_return',
      status: 'transit',
      amount: money(500_00),
    });
    const hidden = buildCard(account(), { ...base, transfers: [out] });
    expect(hidden.moves).toEqual([
      { id: 'out-1', icon: 'schedule', text: `Возврат ${rub(500)} ждёт приёма`, canAccept: false },
    ]);
    const named = buildCard(account(), {
      ...base,
      transfers: [out],
      names: new Map([[DESK, 'Касса «Север Логистик»']]),
    });
    expect(named.moves[0]?.text).toBe(`Возврат ${rub(500)} ждёт приёма в «Касса «Север Логистик»»`);
  });

  it('входящая выдача в пути: «Получил(а)» только с правом приёма', () => {
    const inc = transfer({ id: 'in-1', status: 'transit', amount: money(300_00) });
    const text = `Вам выдают ${rub(300)} под отчёт. Пересчитайте и подтвердите получение`;
    expect(buildCard(account(), { ...base, transfers: [inc] }).moves).toEqual([
      { id: 'in-1', icon: 'payments', text, canAccept: false },
    ]);
    const withRight = account({
      my: { ...account().my, rights: ['cash.advance.self', 'cash.transfer'] },
    });
    expect(buildCard(withRight, { ...base, transfers: [inc] }).moves[0]?.canAccept).toBe(true);
  });

  it('принятые и отклонённые перемещения и чужие счета не показываются', () => {
    const card = buildCard(account(), {
      ...base,
      transfers: [
        transfer({ status: 'done' }),
        transfer({ status: 'rejected' }),
        transfer({ status: 'transit', fromAccountId: DESK, toAccountId: DESK }),
      ],
    });
    expect(card.moves).toEqual([]);
  });
});

describe('чеки', () => {
  it('название «статья · к чему · сумма» и статусы эталона', () => {
    const card = buildCard(account(), {
      ...base,
      receipts: [
        receipt({ id: 'r1', status: 'review', note: 'Р-208' }),
        receipt({ id: 'r2', status: 'accepted', categoryId: 'parking', amount: money(300_00) }),
        receipt({ id: 'r3', status: 'rejected', reason: 'Не видно сумму', amount: money(90_00) }),
      ],
    });
    expect(card.receipts.map((r) => [r.id, r.title, r.status, r.tone, r.icon, r.redo])).toEqual([
      ['r1', `Топливо · Р-208 · ${rub(1260)}`, 'На проверке', 'info', 'schedule', false],
      ['r2', `Парковка · ${rub(300)}`, 'Принят', 'ok', 'check_circle', false],
      ['r3', `Топливо · ${rub(90)}`, 'Не принят: Не видно сумму', 'danger', 'cancel', true],
    ]);
    expect(card.receipts[0]?.amount).toBe(rub(1260));
  });

  it('переснятый чек скрыт, «Переснять» — только у отклонённого', () => {
    const card = buildCard(account(), {
      ...base,
      receipts: [
        receipt({ id: 'new', status: 'review', redoOfReceiptId: 'old' }),
        receipt({ id: 'old', status: 'rejected', reason: 'Размыто' }),
        receipt({ id: 'other', status: 'rejected', reason: 'Нет даты' }),
      ],
    });
    expect(card.receipts.map((r) => [r.id, r.redo])).toEqual([
      ['new', false],
      ['other', true],
    ]);
  });

  it('чеки других счетов не показываются; неизвестная статья — по коду', () => {
    const card = buildCard(account(), {
      ...base,
      receipts: [
        receipt({ id: 'x', accountId: DESK }),
        receipt({ id: 'y', categoryId: 'unknown' }),
      ],
    });
    expect(card.receipts.map((r) => [r.id, r.title])).toEqual([['y', `unknown · ${rub(1260)}`]]);
  });
});

describe('диалог чека', () => {
  it('статьи расходов; список счёта сужает набор', () => {
    expect(buildCard(account(), base).categories).toEqual([
      { id: 'fuel', title: 'Топливо' },
      { id: 'parking', title: 'Парковка' },
    ]);
    expect(buildCard(account({ categoryIds: ['parking'] }), base).categories).toEqual([
      { id: 'parking', title: 'Парковка' },
    ]);
  });

  it('подсказка «К чему относится»: рейс у счёта подразделения, иначе объект', () => {
    expect(buildCard(account(), base).linkHint).toBe(T.receiptDialog.linkObject);
    expect(buildCard(account({ orgUnitId: DESK }), base).linkHint).toBe(T.receiptDialog.linkTrip);
  });
});
