// W5.32 · Чистые функции страницы «Касса» (cash.js :13–57 эталона design-2026-10-19, деньги — копейки контракта 0.12).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accountGroups,
  canAcceptTransfer,
  canDecideRequest,
  closeTotals,
  deskActions,
  dueState,
  expectedNow,
  fmtAt,
  hasRight,
  isReversible,
  KIND_INFO,
  limitFor,
  METHODS_OF,
  matchFilter,
  opAmountText,
  opChip,
  opReceiptText,
  overLimit,
  parseRub,
  plural,
  rightsText,
  rub,
  shiftChip,
  shiftOrder,
  signRub,
  splitSum,
} from './model.ts';

type S = components['schemas'];

const NB = ' ';
const money = (amountMinor: number): S['Money'] => ({ amountMinor, currency: 'RUB' });

const limits: S['CashLimits'] = { outMinor: null, refundMinor: null, advanceMinor: null };
const acct = (x: Partial<S['CashAccount']> = {}): S['CashAccount'] => ({
  id: 'a1',
  orgUnitId: 'u1',
  name: 'Касса салона',
  currency: 'RUB',
  kind: 'cash_drawer',
  balance: { amountMinor: 100_000, currency: 'RUB' },
  revision: 1,
  shiftMode: 'blind',
  kktMode: 'manual',
  my: { via: 'role', rights: ['cash.read', 'cash.post', 'cash.shift.operate'], limits },
  ...x,
});

const op = (x: Partial<S['CashOperation']> = {}): S['CashOperation'] => ({
  id: 'o1',
  accountId: 'a1',
  direction: 'in',
  amount: money(320_000),
  category: 'service_payment',
  occurredAt: '2026-09-30T18:04:00Z',
  postedAt: '2026-09-30T18:04:00Z',
  createdByMemberId: 'm1',
  type: 'in',
  method: 'cash',
  origin: 'manual',
  ...x,
});

describe('деньги', () => {
  it('rub — рубли с неразрывным пробелом, копейки только если есть', () => {
    expect(rub(320_000)).toBe(`3${NB}200${NB}₽`);
    expect(rub(12_050)).toBe(`120,5${NB}₽`);
    expect(rub(0)).toBe(`0${NB}₽`);
    expect(rub(-150_000)).toBe(`-1${NB}500${NB}₽`.replace('-', '−'));
  });

  it('signRub — знак «+»/«−» и модуль', () => {
    expect(signRub(10_000)).toBe(`+100${NB}₽`);
    expect(signRub(-10_000)).toBe(`−100${NB}₽`);
    expect(signRub(0)).toBe(`0${NB}₽`);
  });

  it('parseRub — «1 200,50», «1200», «₽», пусто и не число → null', () => {
    expect(parseRub('1200')).toBe(120_000);
    expect(parseRub('1 200,50')).toBe(120_050);
    expect(parseRub(`1${NB}200 ₽`)).toBe(120_000);
    expect(parseRub('0,1')).toBe(10);
    expect(parseRub('')).toBeNull();
    expect(parseRub('abc')).toBeNull();
    expect(parseRub('-5')).toBe(-500);
  });

  it('plural — склонение по числу', () => {
    expect(plural(1, 'касса', 'кассы', 'касс')).toBe('1 касса');
    expect(plural(3, 'касса', 'кассы', 'касс')).toBe('3 кассы');
    expect(plural(8, 'касса', 'кассы', 'касс')).toBe('8 касс');
    expect(plural(11, 'касса', 'кассы', 'касс')).toBe('11 касс');
    expect(plural(21, 'касса', 'кассы', 'касс')).toBe('21 касса');
  });

  it('splitSum — «Частями»: итог частей против суммы предложения', () => {
    expect(splitSum(['1000', '2200'], 320_000)).toEqual({ sum: 320_000, ok: true });
    expect(splitSum(['1000', ''], 320_000)).toEqual({ sum: 100_000, ok: false });
  });

  it('closeTotals — номиналы × штуки, монеты, «Сдать в сейф» = посчитано − размен', () => {
    const t = closeTotals({ 5000: '1', 1000: '3', 50: 'x' }, '240', '5000');
    expect(t.countedMinor).toBe(5000_00 + 3000_00 + 240_00);
    expect(t.toSafeMinor).toBe(5000_00 + 3000_00 + 240_00 - 5000_00);
    expect(closeTotals({}, '', '9999').toSafeMinor).toBe(0);
  });
});

describe('даты и сроки', () => {
  it('fmtAt — «ДД.ММ ЧЧ:ММ» по Москве', () => {
    expect(fmtAt('2026-09-30T18:04:00Z')).toBe('30.09 21:04');
  });

  it('dueState — прошёл / сегодня / впереди / нет', () => {
    const today = new Date('2026-10-01T07:30:00Z');
    expect(dueState('2026-09-30', today)).toBe('late');
    expect(dueState('2026-10-01', today)).toBe('today');
    expect(dueState('2026-10-05', today)).toBe('ok');
    expect(dueState(undefined, today)).toBe('none');
  });
});

describe('виды касс и способы', () => {
  it('KIND_INFO — подписи эталона по виду контракта', () => {
    expect(KIND_INFO.cash_drawer.label).toBe('Наличная касса');
    expect(KIND_INFO.acquiring.label).toBe('Терминал и СБП');
    expect(KIND_INFO.advance.label).toBe('Подотчёт сотрудника');
    expect(KIND_INFO.safe.label).toBe('Сейф');
    expect(KIND_INFO.bank.label).toBe('Банковский счёт');
  });

  it('METHODS_OF — способы оплаты по виду кассы', () => {
    expect(METHODS_OF.cash_drawer).toEqual(['cash']);
    expect(METHODS_OF.acquiring).toEqual(['card', 'sbp']);
    expect(METHODS_OF.bank).toEqual(['transfer']);
  });

  it('accountGroups — по подразделениям, касса организации (без подразделения) последней', () => {
    const list = [
      acct({ id: 'a', orgUnitId: null, name: 'Сейф', kind: 'safe' }),
      acct({ id: 'b', orgUnitId: 'u1' }),
      acct({ id: 'c', orgUnitId: 'u2' }),
      acct({ id: 'd', orgUnitId: 'u1', kind: 'acquiring' }),
    ];
    expect(accountGroups(list).map((g) => [g.unitId, g.items.map((a) => a.id)])).toEqual([
      ['u1', ['b', 'd']],
      ['u2', ['c']],
      [null, ['a']],
    ]);
  });
});

describe('журнал', () => {
  it('opChip — подпись, тон и значок типа', () => {
    expect(opChip('in')).toMatchObject({ label: 'Приход', tone: 'ok', icon: 'south_west' });
    expect(opChip('move_in').label).toBe('Перемещение');
    expect(opChip('storno')).toMatchObject({ label: 'Сторно', tone: 'danger' });
  });

  it('opAmountText — «+»/«−» по типу, корректировка и сторно без знака', () => {
    expect(opAmountText(op())).toBe(`+3${NB}200${NB}₽`);
    expect(opAmountText(op({ type: 'out' }))).toBe(`−3${NB}200${NB}₽`);
    expect(opAmountText(op({ type: 'adjust' }))).toBe(`3${NB}200${NB}₽`);
    expect(opAmountText(op({ type: 'storno' }))).toBe(`3${NB}200${NB}₽`);
  });

  it('opReceiptText — ФД, «чек не пробит», чек продавца', () => {
    expect(opReceiptText(undefined)).toBe('');
    expect(opReceiptText({ fdNumber: '4520', kktShift: '118' })).toBe('ФД 4520 · смена ККТ 118');
    expect(opReceiptText({ none: true, reason: 'ККТ не работала' })).toBe(
      'Чек не пробит: ККТ не работала',
    );
    expect(opReceiptText({ sellerMemberId: 'm2' })).toBe('Чек продавца');
  });

  it('matchFilter — «Приход» включает ввод остатка, «Перемещения», «Исправления»', () => {
    expect(matchFilter(op({ type: 'opening' }), 'in')).toBe(true);
    expect(matchFilter(op({ type: 'in' }), 'out')).toBe(false);
    expect(matchFilter(op({ type: 'move_out' }), 'move')).toBe(true);
    expect(matchFilter(op({ type: 'storno' }), 'fix')).toBe(true);
    expect(matchFilter(op({ type: 'adjust' }), 'fix')).toBe(true);
    expect(matchFilter(op({ type: 'refund' }), 'refund')).toBe(true);
    expect(matchFilter(op({ type: 'out' }), 'all')).toBe(true);
  });

  it('isReversible — право, не исправленная, не сторно и не перемещение', () => {
    const a = acct({ my: { via: 'role', rights: ['cash.reverse'], limits } });
    expect(isReversible(op(), a)).toBe(true);
    expect(isReversible(op({ reversedByOperationId: 'o9' }), a)).toBe(false);
    expect(isReversible(op({ type: 'storno' }), a)).toBe(false);
    expect(isReversible(op({ type: 'move_in' }), a)).toBe(false);
    expect(isReversible(op(), acct())).toBe(false);
  });
});

describe('кнопки карточки кассы', () => {
  it('hasRight — по my.rights', () => {
    expect(hasRight(acct(), 'cash.post')).toBe(true);
    expect(hasRight(acct(), 'cash.transfer')).toBe(false);
  });

  it('смена закрыта: «Открыть смену» без «Принять оплату»', () => {
    expect(deskActions(acct(), { open: undefined, review: undefined, others: 1 })).toEqual([
      'openShift',
    ]);
  });

  it('смена открыта: «Принять оплату» и «Закрыть смену»', () => {
    expect(deskActions(acct(), { open: 's1', review: undefined, others: 1 })).toEqual([
      'post',
      'closeShift',
    ]);
  });

  it('терминал и сейф: операция без смены; «Переместить» — с правом и другой кассой', () => {
    const term = acct({ kind: 'acquiring', shiftMode: 'none' });
    expect(deskActions(term, { open: undefined, review: undefined, others: 0 })).toEqual(['post']);
    const safe = acct({
      kind: 'safe',
      shiftMode: 'none',
      my: { via: 'owner', rights: ['cash.post', 'cash.transfer'], limits },
    });
    expect(deskActions(safe, { open: undefined, review: undefined, others: 2 })).toEqual([
      'post',
      'transfer',
    ]);
    expect(deskActions(safe, { open: undefined, review: undefined, others: 0 })).toEqual(['post']);
  });

  it('подотчёт: операции кассой не вносятся', () => {
    const adv = acct({ kind: 'advance', shiftMode: 'none' });
    expect(deskActions(adv, { open: undefined, review: undefined, others: 1 })).toEqual([]);
  });
});

describe('права и лимиты', () => {
  it('rightsText — глаголы по порядку каталога, с маленькой буквы', () => {
    expect(rightsText(['cash.post', 'cash.read', 'cash.nope'])).toBe(
      'видит операции, вносит приход и расход',
    );
    expect(rightsText([])).toBe('');
  });

  it('limitFor — лимит роли по типу: расход, возврат; приход без лимита', () => {
    const a = acct({
      my: {
        via: 'role',
        rights: [],
        limits: { outMinor: 100_000, refundMinor: 0, advanceMinor: null },
      },
    });
    expect(limitFor(a, 'out')).toBe(100_000);
    expect(limitFor(a, 'refund')).toBe(0);
    expect(limitFor(a, 'in')).toBeNull();
  });

  it('overLimit — сверх лимита и «всегда с согласованием» (0), null — без лимита', () => {
    expect(overLimit(100_000, 100_001)).toBe(true);
    expect(overLimit(100_000, 100_000)).toBe(false);
    expect(overLimit(0, 1)).toBe(true);
    expect(overLimit(null, 99_999_999)).toBe(false);
  });

  it('expectedNow — остаток кассы для открытой смены при праве видеть остаток', () => {
    const open = { status: 'open' } as S['CashShift'];
    expect(expectedNow(open, acct())).toBe(100_000);
    expect(expectedNow(open, acct({ balance: null }))).toBeNull();
    expect(expectedNow({ status: 'closed' } as S['CashShift'], acct())).toBeNull();
  });

  it('canDecideRequest — право «Согласовывать», не автор, ждёт решения', () => {
    const a = acct({ my: { via: 'role', rights: ['cash.approve'], limits } });
    const q = { status: 'pending', requestedByMemberId: 'm2' } as S['CashApprovalRequest'];
    expect(canDecideRequest(q, a, 'm1')).toBe(true);
    expect(canDecideRequest(q, a, 'm2')).toBe(false);
    expect(canDecideRequest({ ...q, status: 'approved' }, a, 'm1')).toBe(false);
    expect(canDecideRequest(q, acct(), 'm1')).toBe(false);
  });

  it('canAcceptTransfer — в пути, получатель с правом «Перемещать»; в подотчёт — держатель', () => {
    const t = { status: 'transit' } as S['CashTransfer'];
    const to = acct({ my: { via: 'role', rights: ['cash.transfer'], limits } });
    expect(canAcceptTransfer(t, to)).toBe(true);
    expect(canAcceptTransfer({ ...t, status: 'done' }, to)).toBe(false);
    expect(canAcceptTransfer(t, acct())).toBe(false);
    const adv = acct({
      kind: 'advance',
      my: { via: 'self', rights: ['cash.advance.self'], limits, isHolder: true },
    });
    expect(canAcceptTransfer(t, adv)).toBe(true);
    expect(canAcceptTransfer(t, undefined)).toBe(false);
  });
});

describe('смены', () => {
  const shift = (x: Partial<S['CashShift']>): S['CashShift'] => ({
    id: 's',
    accountId: 'a1',
    number: 1,
    status: 'open',
    openedAt: '2026-10-01T07:00:00Z',
    openedByMemberId: 'm1',
    openingFloat: money(500_000),
    attempts: [],
    revision: 1,
    ...x,
  });

  it('shiftChip — «Открыта», «Ждёт решения», «Закрыта»', () => {
    expect(shiftChip('open')).toMatchObject({ label: 'Открыта', tone: 'ok' });
    expect(shiftChip('review')).toMatchObject({ label: 'Ждёт решения', tone: 'danger' });
    expect(shiftChip('closed')).toMatchObject({ label: 'Закрыта', tone: 'neutral' });
  });

  it('shiftOrder — ждёт решения → открыта → закрыта, внутри — по номеру убыванием', () => {
    const list = [
      shift({ id: 'c1', status: 'closed', number: 5 }),
      shift({ id: 'o', status: 'open', number: 2 }),
      shift({ id: 'r', status: 'review', number: 1 }),
      shift({ id: 'c2', status: 'closed', number: 6 }),
    ];
    expect(shiftOrder(list).map((s) => s.id)).toEqual(['r', 'o', 'c2', 'c1']);
  });
});
