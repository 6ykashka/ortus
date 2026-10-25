// Справочники и чистые функции «Кассы» (cash.js 14.10/19.10:8–57). Ожидания — из B §3.5.
import { describe, expect, it } from 'vitest';
import {
  CASH_OPT0,
  CATS,
  DENOMS,
  KIND,
  METHODS_OF,
  MODE,
  OP,
  PRICE,
  REQ_LABEL,
  balanceOf,
  drawerFor,
  dueState,
  nameOf,
  opSign,
  openShift,
  parseSum,
  plural,
  rub,
  signRub,
  unitTitle,
} from './dictionaries.ts';
import type { CashAccount, CashOp, CashShift, CashSlice } from './types.ts';

const nb = '\u00a0';

const acc = (o: Partial<CashAccount>): CashAccount => ({
  id: 'a',
  kind: 'drawer',
  name: 'A',
  unit: null,
  resp: null,
  mode: 'none',
  kkt: 'none',
  limit: null,
  float: 0,
  tol: 0,
  member: null,
  from: null,
  term: null,
  drawer: null,
  due: null,
  cats: null,
  ...o,
});
const op = (o: Partial<CashOp>): CashOp => ({
  id: 'K-1',
  account: 'a',
  type: 'in',
  amount: 0,
  method: 'cash',
  cat: '',
  basis: '',
  at: '01.10',
  time: '10:00',
  by: 'm',
  src: null,
  ref: null,
  receipt: null,
  shift: null,
  group: null,
  ...o,
});
const slice = (o: Partial<CashSlice>): CashSlice => ({
  v1: true,
  accounts: [],
  ops: [],
  shifts: [],
  transfers: [],
  receipts: [],
  requests: [],
  proposals: [],
  dismissed: [],
  ...o,
});

describe('справочники', () => {
  it('виды касс: пять, подписи дословно', () => {
    expect(Object.keys(KIND)).toEqual(['drawer', 'acquiring', 'advance', 'safe', 'bank']);
    expect(KIND.drawer.label).toBe('Наличная касса');
    expect(KIND.acquiring.label).toBe('Терминал и СБП');
    expect(KIND.advance.label).toBe('Подотчёт сотрудника');
    expect(KIND.safe.label).toBe('Сейф');
    expect(KIND.bank.label).toBe('Банковский счёт');
  });

  it('режимы смен, типы операций со знаком, заявки', () => {
    expect(MODE).toEqual({ none: 'Без смен', open: 'С ожидаемой суммой', blind: 'Вслепую' });
    expect(Object.fromEntries(Object.entries(OP).map(([k, v]) => [k, v.sign]))).toEqual({
      in: 1,
      out: -1,
      refund: -1,
      move_out: -1,
      move_in: 1,
      opening: 1,
      adjust: 0,
      storno: 0,
    });
    expect(OP.move_out.label).toBe('Перемещение');
    expect(REQ_LABEL).toEqual({ out: 'Расход', refund: 'Возврат', issue: 'Выдача под отчёт' });
  });

  it('способы оплаты по видам касс, статьи, номиналы, цены визитов, параметры роли', () => {
    expect(METHODS_OF).toEqual({
      drawer: ['cash'],
      safe: ['cash'],
      advance: ['cash'],
      acquiring: ['card', 'sbp'],
      bank: ['transfer'],
    });
    expect(CATS.in).toHaveLength(4);
    expect(CATS.out).toHaveLength(10);
    expect(CATS.refund).toEqual(['Возврат клиенту']);
    expect(DENOMS).toEqual([5000, 2000, 1000, 500, 200, 100, 50]);
    expect(PRICE).toEqual({
      'Классический массаж': 3200,
      'SPA-ритуал': 5400,
      'Массаж спины': 2400,
    });
    expect(CASH_OPT0).toEqual({
      balance: false,
      self: false,
      out: null,
      refund: null,
      advance: null,
    });
  });
});

describe('dueState (на 01.10)', () => {
  it.each([
    ['30.09', 'late'],
    ['01.10', 'today'],
    ['03.10', 'ok'],
    [null, 'none'],
    ['', 'none'],
    ['15.01', 'late'],
  ] as const)('%s → %s', (due, want) => {
    expect(dueState(due)).toBe(want);
  });

  it('«сегодня» задаётся часами домена', () => {
    expect(dueState('03.10', '05.10')).toBe('late');
    expect(dueState('05.10', '05.10')).toBe('today');
  });
});

describe('parseSum', () => {
  it.each([
    ['1 500,50', 1500.5],
    ['1\u00a0500 ₽', 1500],
    ['12.346', 12.35],
    [100, 100],
    ['0', 0],
  ] as const)('%j → %j', (v, want) => {
    expect(parseSum(v)).toBe(want);
  });

  it.each(['abc', '1,2,3', '', null, undefined, '  ', 'Infinity'])('%j → NaN', (v) => {
    expect(parseSum(v)).toBeNaN();
  });
});

describe('форматирование', () => {
  it('rub и signRub: неразрывный пробел и настоящий минус', () => {
    expect(rub(1500.5)).toBe('1' + nb + '500,5' + nb + '₽');
    expect(rub(0)).toBe('0' + nb + '₽');
    expect(signRub(-60)).toBe('−60' + nb + '₽');
    expect(signRub(100)).toBe('+100' + nb + '₽');
    expect(signRub(0)).toBe('0' + nb + '₽');
  });

  it.each([
    [1, '1 предложение'],
    [2, '2 предложения'],
    [5, '5 предложений'],
    [11, '11 предложений'],
    [21, '21 предложение'],
    [24, '24 предложения'],
    [112, '112 предложений'],
  ] as const)('plural(%i)', (n, want) => {
    expect(plural(n, 'предложение', 'предложения', 'предложений')).toBe(want);
  });

  it('nameOf и unitTitle', () => {
    const db = {
      members: [{ id: 'm1', name: 'Анна' }],
      units: [{ id: 'f1', name: 'Фирма' }],
    };
    expect(nameOf(db, 'm1')).toBe('Анна');
    expect(nameOf(db, 'zzz')).toBe('—');
    expect(unitTitle(db, null)).toBe('Вся организация');
    expect(unitTitle(db, 'spa')).toBe('Салон SPA');
    expect(unitTitle(db, 'f1')).toBe('Фирма');
    expect(unitTitle(db, 'f9')).toBe('f9');
  });
});

describe('баланс и операции', () => {
  it.each([
    [{ type: 'out' }, -1],
    [{ type: 'adjust', sign: -1 }, -1],
    [{ type: 'adjust', sign: 1 }, 1],
    [{ type: 'storno', sign: 1 }, 1],
    [{ type: 'zzz' }, 0],
    [{ type: 'adjust' }, 0],
    [{ type: 'move_in' }, 1],
  ] as const)('opSign(%j) = %i', (o, want) => {
    expect(opSign(o as unknown as CashOp)).toBe(want);
  });

  it('balanceOf: сумма со знаком, копейки не плывут', () => {
    const X = slice({
      ops: [
        op({ type: 'opening', amount: 100.1 }),
        op({ type: 'in', amount: 0.2 }),
        op({ type: 'out', amount: 50 }),
        op({ type: 'adjust', sign: -1, amount: 10 }),
        op({ type: 'in', amount: 999, account: 'other' }),
      ],
    });
    expect(balanceOf(X, 'a')).toBe(40.3);
    expect(balanceOf(X, 'empty')).toBe(0);
  });

  it('openShift и drawerFor', () => {
    const sh = (o: Partial<CashShift>): CashShift => ({
      id: 's',
      account: 'a',
      no: 1,
      status: 'open',
      openedAt: '',
      openedBy: 'm',
      float: 0,
      ...o,
    });
    const X = slice({
      accounts: [
        acc({ id: 'old', unit: 'u1', archived: true }),
        acc({ id: 'd1', unit: 'u1' }),
        acc({ id: 'sf', kind: 'safe', unit: 'u1' }),
      ],
      shifts: [sh({ id: 'c', status: 'closed' }), sh({ id: 'o' }), sh({ id: 'x', account: 'b' })],
    });
    expect(openShift(X, 'a')?.id).toBe('o');
    expect(openShift(X, 'zz')).toBeNull();
    expect(drawerFor(X, 'u1')?.id).toBe('d1');
    expect(drawerFor(X, 'u2')).toBeNull();
  });
});
