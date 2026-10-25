// Смены кассы: cashShiftOpen, cashShiftClose, cashShiftReview (cash.js:394–457). Касса салона
// `ca-spa`: режим «вслепую», ККТ вручную, допуск 100 ₽, размен 5 000 ₽, терминал `ca-term`;
// на 01.10 открыта смена 118 (остаток 7 350 ₽).
import { describe, expect, it } from 'vitest';
import { env, type Env } from './env.test-util.ts';
import { NBSP, altaCash, apiErr, grantCash, setTenantStatus } from './fixture.test-util.ts';
import type { CashShift } from './types.ts';

const shift = (e: Env, id: string): CashShift => {
  const h = e.db.cash.shifts.find((x) => x.id === id);
  if (!h) throw new Error('нет смены ' + id);
  return h;
};
/** Итоги закрытия смены 118 без расхождений: 7 350 ₽ в ящике, Z-отчёт и терминал сходятся. */
const form = (o: Record<string, unknown> = {}) => ({
  counts: { 5000: 1, 2000: 1, 200: 1, 100: 1 },
  coins: 50,
  z: { no: '118', cash: 3000, card: 12000 },
  term: { card: 12000, sbp: 0 },
  ...o,
});
/** Смена 118 закрыта — можно открывать следующую. */
const closed118 = (): Env => {
  const e = env();
  shift(e, 'sh-118').status = 'closed';
  return e;
};

describe('cashShiftOpen', () => {
  it('открытие: номер = последний + 1, размен = остаток, расхождения нет', () => {
    const e = closed118();
    const id = e.api.cashShiftOpen('ca-spa', '7 350') as string;
    expect(e.db.cash.shifts[0]).toEqual({
      id,
      account: 'ca-spa',
      no: 119,
      status: 'open',
      openedAt: '01.10 10:30',
      openedBy: 'm-owner',
      float: 7350,
    });
    expect(id).toMatch(/^sh-/);
    expect(e.db.cash.ops[0]?.id).toBe('K-326');
  });

  it('размен не сошёлся с остатком: корректировка, openDiff и событие проверяющим', () => {
    const e = env(altaCash(), 'm-morozova');
    shift(e, 'sh-118').status = 'closed';
    const id = e.api.cashShiftOpen('ca-spa', 7000) as string;
    const h = shift(e, id);
    const adj = e.db.cash.ops[0];
    expect(adj).toMatchObject({
      type: 'adjust',
      sign: -1,
      amount: 350,
      cat: 'Корректировка',
      basis: 'Расхождение при открытии смены 119',
      shift: id,
      by: 'm-morozova',
    });
    expect(h.openDiff).toEqual({ amount: -350, op: adj?.id });
    expect(e.db.events?.[0]).toMatchObject({
      text:
        'Касса «Касса салона · ресепшен»: размен при открытии смены 119 не сошёлся с остатком на −350' +
        NBSP +
        '₽',
      to: ['m-owner'],
    });
  });

  it('излишек при открытии: знак +1', () => {
    const e = closed118();
    e.api.cashShiftOpen('ca-spa', 7400);
    expect(e.db.cash.ops[0]).toMatchObject({ type: 'adjust', sign: 1, amount: 50 });
  });

  it.each([
    ['ca-safe', 'Касса работает без смен'],
    ['ca-sever', 'Касса работает без смен'],
    ['ca-term', 'Касса работает без смен'],
  ])('%s — validation «%s»', (id, message) => {
    expect(apiErr(() => env().api.cashShiftOpen(id, 100))).toEqual({ code: 'validation', message });
  });

  it('смена уже открыта — conflict', () => {
    expect(apiErr(() => env().api.cashShiftOpen('ca-spa', 7350))).toEqual({
      code: 'conflict',
      message: 'Смена уже открыта',
    });
  });

  it.each(['abc', '', null, undefined, -5])('размен %j — validation', (v) => {
    expect(apiErr(() => closed118().api.cashShiftOpen('ca-spa', v as never))).toEqual({
      code: 'validation',
      message: 'Укажите размен: сколько наличных в ящике',
    });
  });

  it('нулевой размен допустим', () => {
    expect(() => closed118().api.cashShiftOpen('ca-spa', 0)).not.toThrow();
  });

  it('доступ: нет кассы, нет права «Создавать», тариф «только чтение»', () => {
    expect(apiErr(() => env().api.cashShiftOpen('zzz', 1)).message).toBe('Касса не найдена');
    expect(apiErr(() => env(altaCash(), 'm-kotova').api.cashShiftOpen('ca-spa', 1)).code).toBe(
      'not_found',
    );
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashShiftOpen('ca-spa', 1))).toEqual({
      code: 'forbidden',
      message: 'Смену открывает роль с правом «Создавать» в «Касса салона · ресепшен»',
    });
    const r = altaCash();
    setTenantStatus(r, 'restricted');
    expect(apiErr(() => env(r).api.cashShiftOpen('ca-spa', 1)).code).toBe(
      'subscription_restricted',
    );
  });
});

describe('cashShiftClose: итоги закрытия', () => {
  it('без расхождений: закрыта автоматически, остаток сверх размена уходит в сейф', () => {
    const e = env();
    const r = e.api.cashShiftClose('sh-118', form());
    expect(r).toEqual({ status: 'closed', kkt: false });
    expect(shift(e, 'sh-118')).toMatchObject({
      status: 'closed',
      closedAt: '01.10 10:30',
      closedBy: 'm-owner',
      counted: 7350,
      counts: { 5000: 1, 2000: 1, 200: 1, 100: 1 },
      coins: 50,
      z: { no: '118', cash: 3000, card: 12000 },
      term: { card: 12000, sbp: 0 },
      expected: { cash: 7350, revCash: 3000, revCard: 12000, card: 12000, sbp: 0 },
      diff: { cash: 0, kktCash: 0, kktCard: 0, term: 0 },
      decision: { kind: 'auto', at: '01.10 10:30', reason: 'Без расхождений' },
      toSafe: 2350,
    });
    const t = e.db.cash.transfers[0];
    expect(t).toMatchObject({
      from: 'ca-spa',
      to: 'ca-safe',
      amount: 2350,
      note: 'Выручка · смена 118',
      status: 'transit',
      by: 'm-owner',
    });
    expect(e.db.cash.ops[0]).toMatchObject({
      type: 'move_out',
      amount: 2350,
      shift: 'sh-118',
      tr: t?.id,
    });
  });

  it('недостача в пределах допуска: корректировка и решение «авто»', () => {
    const e = env();
    e.api.cashShiftClose('sh-118', form({ coins: 0 }));
    const h = shift(e, 'sh-118');
    expect(h.status).toBe('closed');
    expect(h.diff?.cash).toBe(-50);
    const adj = e.db.cash.ops.find((o) => o.type === 'adjust');
    expect(adj).toMatchObject({
      sign: -1,
      amount: 50,
      basis: 'Недостача при пересчёте · смена 118',
      cat: 'Корректировка',
      shift: 'sh-118',
    });
    expect(h.decision).toEqual({
      kind: 'auto',
      at: '01.10 10:30',
      reason: 'В пределах допуска 100' + NBSP + '₽',
      op: adj?.id,
    });
    expect(h.toSafe).toBe(2300);
  });

  it('излишек в пределах допуска', () => {
    const e = env();
    e.api.cashShiftClose('sh-118', form({ coins: 100 }));
    expect(e.db.cash.ops.find((o) => o.type === 'adjust')).toMatchObject({
      sign: 1,
      amount: 50,
      basis: 'Излишек при пересчёте · смена 118',
    });
  });

  it('расхождение выше допуска: статус «сверка», корректировки нет, событие проверяющим', () => {
    const e = env(altaCash(), 'm-morozova');
    const r = e.api.cashShiftClose('sh-118', form({ coins: 0, counts: { 5000: 1, 2000: 1 } }));
    expect(r).toEqual({ status: 'review', kkt: false });
    const h = shift(e, 'sh-118');
    expect(h.status).toBe('review');
    expect(h.diff?.cash).toBe(-350);
    expect(h.decision).toBeUndefined();
    expect(e.db.cash.ops.some((o) => o.type === 'adjust' && o.shift === 'sh-118')).toBe(false);
    expect(e.db.events?.find((ev) => ev.text.includes('нужно решение'))).toMatchObject({
      text:
        'Касса «Касса салона · ресепшен»: смена 118 закрыта с расхождением −350' +
        NBSP +
        '₽ — нужно решение',
      to: ['m-owner'],
    });
    expect(h.toSafe).toBe(2000);
  });

  it('расхождение по ККТ или терминалу отмечается в ответе', () => {
    expect(
      env().api.cashShiftClose('sh-118', form({ z: { no: '118', cash: 3100, card: 12000 } })),
    ).toEqual({ status: 'closed', kkt: true });
    const e = env();
    e.api.cashShiftClose('sh-118', form({ term: { card: 11000, sbp: 500 } }));
    expect(shift(e, 'sh-118').diff).toEqual({ cash: 0, kktCash: 0, kktCard: 0, term: -500 });
  });

  it('без итогов терминала: считается как 0', () => {
    const e = env();
    e.api.cashShiftClose('sh-118', form({ term: undefined }));
    expect(shift(e, 'sh-118')).toMatchObject({ term: { card: 0, sbp: 0 }, diff: { term: -12000 } });
  });

  it('номиналы: целые неотрицательные, мусор отбрасывается', () => {
    const e = env();
    e.api.cashShiftClose(
      'sh-118',
      form({ counts: { 5000: '2', 2000: -3, 1000: 1.9, 500: 'x', 777: 5 }, coins: '', keep: 0 }),
    );
    expect(shift(e, 'sh-118')).toMatchObject({
      counts: { 5000: 2, 1000: 1 },
      counted: 11000,
      coins: 0,
    });
  });

  it('размен на следующую смену: по умолчанию — размен кассы, можно задать', () => {
    const e = env();
    e.api.cashShiftClose('sh-118', form({ keep: '1 000' }));
    expect(shift(e, 'sh-118').toSafe).toBe(6350);
    const f = env();
    f.api.cashShiftClose('sh-118', form({ keep: 7350 }));
    expect(shift(f, 'sh-118').toSafe).toBeUndefined();
    expect(f.db.cash.transfers).toHaveLength(4);
  });

  it.each(['abc', -1, 99999])('размен %j — validation', (keep) => {
    const e = env();
    const before = structuredClone(e.db.cash);
    expect(apiErr(() => e.api.cashShiftClose('sh-118', form({ keep })))).toEqual({
      code: 'validation',
      message: 'Размен на следующую смену — не больше посчитанного',
    });
    expect(e.db.cash).toEqual(before);
  });

  it('нет сейфа или нет права «Изменять» — выручка остаётся в кассе', () => {
    const e = env();
    const safe = e.db.cash.accounts.find((a) => a.id === 'ca-safe');
    if (safe) safe.archived = true;
    e.api.cashShiftClose('sh-118', form());
    expect(shift(e, 'sh-118').toSafe).toBeUndefined();
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create'], { type: 'tenant' });
    const p = env(db, 'm-petrova');
    p.api.cashShiftClose('sh-118', form());
    expect(shift(p, 'sh-118').toSafe).toBeUndefined();
    expect(db.cash.transfers).toHaveLength(4);
  });
});

describe('cashShiftClose: ошибки', () => {
  const MSG =
    'Перепишите итоги Z-отчёта: номер, наличными и безналичными. Если ККТ не работала — укажите 0';
  it.each([
    [undefined],
    [{}],
    [{ no: ' ', cash: 1, card: 1 }],
    [{ no: '1', cash: -1, card: 1 }],
    [{ no: '1', cash: 1, card: '' }],
    [{ no: '1', cash: 'abc', card: 1 }],
  ])('Z-отчёт %j обязателен при ручной ККТ', (z) => {
    expect(apiErr(() => env().api.cashShiftClose('sh-118', form({ z })))).toEqual({
      code: 'validation',
      message: MSG,
    });
  });

  it('нулевые итоги Z допустимы («ККТ не работала»)', () => {
    expect(() =>
      env().api.cashShiftClose('sh-118', form({ z: { no: '0', cash: 0, card: 0 } })),
    ).not.toThrow();
  });

  it('смена закрыта, не найдена или на сверке — conflict', () => {
    for (const id of ['sh-117', 'sh-zzz']) {
      expect(apiErr(() => env().api.cashShiftClose(id, form()))).toEqual({
        code: 'conflict',
        message: 'Смена уже закрыта',
      });
    }
  });

  it('нужно право «Создавать»; тариф «только чтение»', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashShiftClose('sh-118', form()))).toEqual({
      code: 'forbidden',
      message: 'Смену закрывает роль с правом «Создавать»',
    });
    expect(
      apiErr(() => env(altaCash(), 'm-kotova').api.cashShiftClose('sh-118', form())).code,
    ).toBe('not_found');
    const r = altaCash();
    setTenantStatus(r, 'suspended');
    expect(apiErr(() => env(r).api.cashShiftClose('sh-118', form())).code).toBe(
      'subscription_restricted',
    );
  });

  it('закрытие без формы: касса с ККТ требует Z-отчёт', () => {
    expect(apiErr(() => env().api.cashShiftClose('sh-118', undefined as never)).message).toBe(MSG);
  });
});

describe('cashShiftReview', () => {
  /** Смена 118 закрыта Морозовой с недостачей 350 ₽ → «сверка». */
  const onReview = (): Env => {
    const e = env(altaCash(), 'm-morozova');
    e.api.cashShiftClose('sh-118', form({ coins: 0, counts: { 5000: 1, 2000: 1 } }));
    e.as('m-owner');
    return e;
  };

  it('принять расхождение: корректировка, решение, событие закрывшему', () => {
    const e = onReview();
    expect(e.api.cashShiftReview('sh-118', 'accept', 'пересчитали дважды')).toBe('closed');
    const h = shift(e, 'sh-118');
    const adj = e.db.cash.ops.find((o) => o.type === 'adjust');
    expect(adj).toMatchObject({
      sign: -1,
      amount: 350,
      basis: 'Недостача · смена 118: пересчитали дважды',
      shift: 'sh-118',
    });
    expect(h.status).toBe('closed');
    expect(h.decision).toEqual({
      kind: 'accepted',
      by: 'm-owner',
      at: '01.10 10:30',
      reason: 'пересчитали дважды',
      op: adj?.id,
    });
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса «Касса салона · ресепшен»: расхождение смены 118 принято — пересчитали дважды',
      to: ['m-morozova'],
    });
  });

  it('любое решение, кроме «recount», принимает расхождение; излишек — знак +1', () => {
    const e = env(altaCash(), 'm-morozova');
    e.api.cashShiftClose('sh-118', form({ coins: 500 }));
    e.as('m-owner');
    expect(e.api.cashShiftReview('sh-118', undefined as never, 'излишек у ресепшена')).toBe(
      'closed',
    );
    expect(e.db.cash.ops.find((o) => o.type === 'adjust')).toMatchObject({
      sign: 1,
      amount: 450,
      basis: 'Излишек · смена 118: излишек у ресепшена',
    });
  });

  it('вернуть на пересчёт: смена снова открыта, итоги стёрты, журнал пересчёта', () => {
    const e = onReview();
    expect(e.api.cashShiftReview('sh-118', 'recount', 'перепроверьте')).toBe('open');
    const h = shift(e, 'sh-118');
    expect(h.status).toBe('open');
    expect(h.recount).toEqual({ by: 'm-owner', at: '01.10 10:30', reason: 'перепроверьте' });
    for (const k of [
      'closedAt',
      'closedBy',
      'counted',
      'counts',
      'coins',
      'z',
      'term',
      'expected',
      'diff',
    ] as const) {
      expect(h[k]).toBeUndefined();
    }
    expect(e.db.events?.[0]).toMatchObject({
      text: 'Касса «Касса салона · ресепшен»: смену 118 вернули на пересчёт — перепроверьте',
      to: ['m-morozova'],
    });
    expect(e.db.cash.ops.some((o) => o.type === 'adjust' && o.shift === 'sh-118')).toBe(false);
  });

  it('смена не на сверке — conflict', () => {
    for (const id of ['sh-118', 'sh-117', 'sh-zzz']) {
      expect(apiErr(() => env().api.cashShiftReview(id, 'accept', 'причина'))).toEqual({
        code: 'conflict',
        message: 'Смена уже решена',
      });
    }
  });

  it('нужно право «Проверять» и право видеть остаток', () => {
    const e = onReview();
    e.as('m-morozova');
    expect(apiErr(() => e.api.cashShiftReview('sh-118', 'accept', 'причина'))).toEqual({
      code: 'forbidden',
      message: 'Расхождение принимает роль с правом «Проверять»',
    });
    grantCash(e.db, 'm-petrova', ['view', 'review'], { type: 'tenant' }, { balance: false });
    e.as('m-petrova');
    expect(apiErr(() => e.api.cashShiftReview('sh-118', 'accept', 'причина'))).toEqual({
      code: 'forbidden',
      message: 'Нужно право видеть остаток и ожидаемую сумму',
    });
  });

  it('кто закрывал смену, тот её расхождение не принимает', () => {
    const e = env();
    e.api.cashShiftClose('sh-118', form({ coins: 0, counts: { 5000: 1, 2000: 1 } }));
    expect(apiErr(() => e.api.cashShiftReview('sh-118', 'accept', 'причина'))).toEqual({
      code: 'forbidden',
      message: 'Кто закрывал смену, тот не принимает её расхождение',
    });
  });

  it('причина обязательна, при ошибке смена не меняется', () => {
    const e = onReview();
    const before = structuredClone(e.db.cash);
    expect(apiErr(() => e.api.cashShiftReview('sh-118', 'accept', 'ab'))).toEqual({
      code: 'validation',
      message: 'Укажите причину решения',
    });
    expect(e.db.cash).toEqual(before);
  });
});
