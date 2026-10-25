// Команды проведения операций: cashPost, cashReverse, cashPostProposal, cashDismiss, cashLink
// (cash.js:326–392). Тексты ошибок — дословно из эталона.
import { describe, expect, it } from 'vitest';
import { env } from './env.test-util.ts';
import {
  NBSP,
  altaCash,
  apiErr,
  grantCash,
  outcome,
  setTenantStatus,
} from './fixture.test-util.ts';
import type { CashOp } from './types.ts';

const FD = { fd: '5000', kkt: '118', time: '12:00' };
const NO_FD =
  'Укажите № ФД из чека: цифры, до 10 знаков. Если чек не пробивали — отметьте это и укажите причину';
const RESTRICTED =
  'Пробный период завершён: новые операции недоступны. История доступна для чтения.';
const rub = (s: string): string => s + NBSP + '₽';
const op = (db: ReturnType<typeof altaCash>, id: string): CashOp => {
  const o = db.cash.ops.find((x) => x.id === id);
  if (!o) throw new Error('нет операции ' + id);
  return o;
};
const post = (o: Record<string, unknown>) => ({
  account: 'ca-spa',
  type: 'in',
  amount: 1000,
  basis: 'Продажа абонемента',
  receipt: FD,
  ...o,
});

describe('cashPost: проверки доступа', () => {
  it('нет кассы', () => {
    expect(apiErr(() => env().api.cashPost(post({ account: 'zzz' })))).toEqual({
      code: 'not_found',
      message: 'Касса не найдена',
    });
    expect(apiErr(() => env().api.cashPost(undefined as never)).message).toBe('Касса не найдена');
  });

  it('участник без модуля «Касса»: касса недоступна, причина в тексте', () => {
    const e = env(altaCash(), 'm-kotova');
    expect(apiErr(() => e.api.cashPost(post({})))).toEqual({
      code: 'not_found',
      message: 'Касса «Касса салона · ресепшен» недоступна: в ролях нет модуля «Касса»',
    });
  });

  it('роль только «Видеть» — нет права «Создавать»', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashPost(post({})))).toEqual({
      code: 'forbidden',
      message: 'Нет права «Создавать» в кассе «Касса салона · ресепшен»',
    });
  });

  it('подотчёт пополняется выдачей: касса подотчёта и держатель его не проводят', () => {
    const MSG = 'Подотчёт пополняется выдачей из кассы, расход отчитывается чеком сотрудника';
    expect(apiErr(() => env().api.cashPost(post({ account: 'ca-adv-vas', type: 'out' })))).toEqual({
      code: 'forbidden',
      message: MSG,
    });
    const own = env(altaCash(), 'm-vasiliev');
    expect(
      apiErr(() => own.api.cashPost(post({ account: 'ca-adv-vas', type: 'out' }))).message,
    ).toBe(MSG);
  });

  it('тариф «только чтение» блокирует проведение', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => env(db).api.cashPost(post({})))).toEqual({
      code: 'subscription_restricted',
      message: RESTRICTED,
    });
    setTenantStatus(db, 'suspended');
    expect(apiErr(() => env(db).api.cashPost(post({}))).code).toBe('subscription_restricted');
  });
});

describe('cashPost: проверка полей', () => {
  it.each([
    [{ type: 'zzz' }, 'validation', 'Выберите тип операции'],
    [{ type: undefined }, 'validation', 'Выберите тип операции'],
    [{ type: 'move_in' }, 'validation', 'Выберите тип операции'],
    [{ amount: 0 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ amount: 'abc' }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ amount: -5 }, 'validation', 'Сумма: укажите число больше нуля'],
    [{ basis: 'ab' }, 'validation', 'Укажите основание: за что и кому'],
    [{ basis: '   ' }, 'validation', 'Укажите основание: за что и кому'],
    [{ basis: undefined }, 'validation', 'Укажите основание: за что и кому'],
  ])('%j → %s «%s»', (o, code, message) => {
    expect(apiErr(() => env().api.cashPost(post(o)))).toEqual({ code, message });
  });

  it('возврат — действие «Изменять» роли', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashPost(post({ type: 'refund' })))).toEqual({
      code: 'forbidden',
      message: 'Возвраты — действие «Изменять» в роли',
    });
  });

  it('способ оплаты не из списка кассы', () => {
    expect(
      apiErr(() => env().api.cashPost(post({ account: 'ca-sever', type: 'out', method: 'card' }))),
    ).toEqual({
      code: 'validation',
      message: 'Карта не принимается в «Касса офиса»',
    });
    expect(
      apiErr(() => env().api.cashPost(post({ account: 'ca-sever', type: 'out', method: 'zzz' })))
        .message,
    ).toBe('Этот способ не принимается в «Касса офиса»');
  });
});

describe('cashPost: проведение', () => {
  it('приход: операция, смена, остаток; id по формуле K-(300+seq)', () => {
    const e = env();
    const r = e.api.cashPost(post({ amount: '1 000,50' }));
    expect(r).toEqual({ id: 'K-400' });
    expect(e.db.cash.ops[0]).toEqual({
      id: 'K-400',
      account: 'ca-spa',
      type: 'in',
      amount: 1000.5,
      method: 'cash',
      cat: '',
      basis: 'Продажа абонемента',
      at: '01.10',
      time: '10:30',
      by: 'm-owner',
      src: null,
      ref: null,
      receipt: FD,
      shift: 'sh-118',
      group: null,
      approvedBy: null,
    });
    expect(e.db.seq).toBe(101);
  });

  it('основание обрезается, статья и способ сохраняются, у кассы без смен смены нет', () => {
    const e = env();
    e.api.cashPost(
      post({
        account: 'ca-sever',
        type: 'out',
        basis: '  Канцтовары  ',
        cat: 'Материалы',
        amount: 100,
      }),
    );
    expect(e.db.cash.ops[0]).toMatchObject({
      basis: 'Канцтовары',
      cat: 'Материалы',
      method: 'cash',
      shift: null,
      receipt: null,
    });
  });

  it('эквайринг: способ по умолчанию — карта; смена берётся у кассы-ящика', () => {
    const e = env();
    e.api.cashPost(post({ account: 'ca-term', amount: 500 }));
    expect(e.db.cash.ops[0]).toMatchObject({
      account: 'ca-term',
      method: 'card',
      shift: 'sh-118',
      receipt: FD,
    });
  });

  it('чек у продавца отмечается только для расхода', () => {
    const e = env();
    e.api.cashPost(
      post({ account: 'ca-sever', type: 'out', amount: 100, receipt: { seller: true } }),
    );
    expect(e.db.cash.ops[0]?.receipt).toEqual({ seller: true });
  });

  it('закрытая смена не даёт проводить оплаты', () => {
    const e = env();
    const h = e.db.cash.shifts.find((x) => x.id === 'sh-118');
    if (h) h.status = 'closed';
    expect(apiErr(() => e.api.cashPost(post({})))).toEqual({
      code: 'validation',
      message: 'Смена в «Касса салона · ресепшен» закрыта — откройте смену, чтобы проводить оплаты',
    });
  });

  it('расход не уводит наличные в минус; безналичный счёт — без такой проверки', () => {
    const e = env();
    expect(
      apiErr(() => e.api.cashPost(post({ account: 'ca-sever', type: 'out', amount: 40000 }))),
    ).toEqual({
      code: 'validation',
      message: 'В «Касса офиса» нет столько наличных: остаток ушёл бы в минус',
    });
    expect(() =>
      e.api.cashPost(
        post({ account: 'ca-bank', type: 'out', amount: 2000000, method: 'transfer' }),
      ),
    ).not.toThrow();
  });
});

describe('cashPost: фискальный чек', () => {
  it.each([
    [undefined],
    [null],
    [{}],
    [{ fd: '' }],
    [{ fd: 'abc' }],
    [{ fd: '12345678901' }],
    [{ fd: '12 34' }],
  ])('приход без валидного № ФД %j отклоняется', (receipt) => {
    expect(apiErr(() => env().api.cashPost(post({ receipt })))).toEqual({
      code: 'validation',
      message: NO_FD,
    });
  });

  it('«чек не пробивали» требует причину и сохраняет её', () => {
    expect(
      apiErr(() => env().api.cashPost(post({ receipt: { none: true, reason: 'аб' } }))),
    ).toEqual({
      code: 'validation',
      message: 'Чек не пробивали — укажите причину',
    });
    const e = env();
    e.api.cashPost(post({ receipt: { none: true, reason: ' сбой ККТ ' } }));
    expect(e.db.cash.ops[0]?.receipt).toEqual({ none: true, reason: 'сбой ККТ' });
  });

  it('повтор № ФД той же смены ККТ — conflict, после сторно можно вносить снова', () => {
    const e = env();
    expect(apiErr(() => e.api.cashPost(post({ receipt: { fd: '4520', kkt: '118' } })))).toEqual({
      code: 'conflict',
      message: 'Чек № ФД 4520 (смена ККТ 118) уже внесён: K-325 · Подарочный сертификат № 214',
    });
    expect(() => e.api.cashPost(post({ receipt: { fd: '4520', kkt: '119' } }))).not.toThrow();
    e.api.cashReverse('K-325', 'ошибка ввода');
    expect(() => e.api.cashPost(post({ receipt: { fd: '4520', kkt: '118' } }))).not.toThrow();
  });

  it('повтор без номера смены ККТ — сообщение без скобок', () => {
    const e = env();
    e.api.cashPost(post({ receipt: { fd: '7777' } }));
    expect(apiErr(() => e.api.cashPost(post({ receipt: { fd: '7777' } }))).message).toBe(
      'Чек № ФД 7777 уже внесён: K-400 · Продажа абонемента',
    );
  });

  it('у кассы без ККТ чек не требуется', () => {
    const e = env();
    expect(() => e.api.cashPost(post({ account: 'ca-sever', receipt: undefined }))).not.toThrow();
    expect(e.db.cash.ops[0]?.receipt).toBeNull();
  });
});

describe('cashPost: возвраты', () => {
  const refund = (o: Record<string, unknown> = {}) =>
    post({ type: 'refund', amount: 1000, ref: 'K-317', receipt: { fd: '6001' }, ...o });

  it('возврат по оплате прихода; ссылка и сумма сохраняются', () => {
    const e = env();
    e.api.cashPost(refund());
    expect(e.db.cash.ops[0]).toMatchObject({ type: 'refund', ref: 'K-317', amount: 1000 });
  });

  it('без оплаты-прихода возврат невозможен', () => {
    for (const ref of [undefined, 'K-999', 'K-326']) {
      expect(apiErr(() => env().api.cashPost(refund({ ref })))).toEqual({
        code: 'validation',
        message: 'Возврат проводится по оплате — выберите операцию прихода',
      });
    }
  });

  it('возвратов по оплате не больше самой оплаты (K-317 уже возвращено 1 600 из 3 200)', () => {
    const e = env();
    expect(apiErr(() => e.api.cashPost(refund({ amount: 2000 })))).toEqual({
      code: 'validation',
      message: 'Возвратов по K-317 больше оплаты: доступно ' + rub('1' + NBSP + '600'),
    });
    expect(() => e.api.cashPost(refund({ amount: 1600 }))).not.toThrow();
  });
});

describe('cashPost: лимиты роли → заявка на согласование', () => {
  const clerk = () => env(altaCash(), 'm-morozova');

  it('расход выше лимита роли (1 000) уходит заявкой; операции нет, событие — согласующим', () => {
    const e = clerk();
    const before = e.db.cash.ops.length;
    const r = e.api.cashPost(
      post({
        type: 'out',
        amount: 1500,
        basis: 'Ремонт кресла',
        cat: 'Мелкий ремонт',
        receipt: undefined,
      }),
    ) as {
      request: string;
    };
    expect(r.request).toMatch(/^rq-/);
    expect(e.db.cash.ops).toHaveLength(before);
    expect(e.db.cash.requests[0]).toEqual({
      id: r.request,
      account: 'ca-spa',
      type: 'out',
      amount: 1500,
      method: 'cash',
      cat: 'Мелкий ремонт',
      basis: 'Ремонт кресла',
      ref: null,
      receipt: null,
      src: null,
      by: 'm-morozova',
      at: '01.10 10:30',
      status: 'pending',
      limit: 1000,
    });
    expect(e.db.events?.[0]).toMatchObject({
      text:
        'Касса: Анна Морозова просит согласовать расход 1' +
        NBSP +
        '500' +
        NBSP +
        '₽ · Касса салона · ресепшен',
      to: ['m-owner'],
    });
  });

  it('ровно лимит — проводится сразу', () => {
    const e = clerk();
    expect(e.api.cashPost(post({ type: 'out', amount: 1000, receipt: undefined }))).toHaveProperty(
      'id',
    );
  });

  it('возврат выше лимита: сначала чек ККТ, затем заявка', () => {
    const e = clerk();
    const spec = { type: 'refund', amount: 3500, ref: 'K-319', basis: 'Возврат абонемента' };
    expect(apiErr(() => e.api.cashPost(post({ ...spec, receipt: undefined }))).message).toBe(NO_FD);
    expect(e.api.cashPost(post({ ...spec, receipt: { fd: '6002' } }))).toHaveProperty('request');
    expect(e.db.cash.requests[0]).toMatchObject({
      type: 'refund',
      limit: 3000,
      ref: 'K-319',
      receipt: { fd: '6002' },
    });
  });

  it('приход лимитов не имеет', () => {
    expect(clerk().api.cashPost(post({ amount: 900000 }))).toHaveProperty('id');
  });
});

describe('cashReverse (сторно)', () => {
  it('сторно расхода: знак +1, смена, ссылка reversedBy, остаток вернулся', () => {
    const e = env();
    const id = e.api.cashReverse('K-326', 'ошибочный расход') as string;
    expect(op(e.db, id)).toMatchObject({
      type: 'storno',
      sign: 1,
      amount: 650,
      method: 'cash',
      cat: 'Хозяйственные расходы',
      basis: 'Сторно K-326: ошибочный расход',
      reverses: 'K-326',
      shift: 'sh-118',
    });
    expect(op(e.db, 'K-326').reversedBy).toBe(id);
  });

  it('сторно прихода: знак −1; кассы без смен — shift null', () => {
    const e = env();
    const id = e.api.cashReverse('K-316', 'ошибка') as string;
    expect(op(e.db, id)).toMatchObject({ sign: -1, shift: 'sh-118' });
    const sever = e.api.cashPost(post({ account: 'ca-sever', type: 'out', amount: 10 })) as {
      id: string;
    };
    const s2 = e.api.cashReverse(sever.id, 'ошибка') as string;
    expect(op(e.db, s2).shift).toBeNull();
  });

  it.each([
    ['K-999', 'причина', 'not_found', 'Операция не найдена'],
    ['K-326', 'ab', 'validation', 'Укажите причину исправления'],
    ['K-322', 'причина', 'validation', 'Перемещение исправляется обратным перемещением'],
    ['K-323', 'причина', 'validation', 'Перемещение исправляется обратным перемещением'],
    ['K-319', 'причина', 'validation', 'Сторно увело бы остаток «Касса салона · ресепшен» в минус'],
  ])('%s: %s → %s «%s»', (id, why, code, message) => {
    expect(apiErr(() => env().api.cashReverse(id, why))).toEqual({ code, message });
  });

  it('исправленную операцию и само сторно повторно не исправляют', () => {
    const e = env();
    const id = e.api.cashReverse('K-326', 'ошибка') as string;
    const MSG = { code: 'conflict', message: 'Операция уже исправлена' };
    expect(apiErr(() => e.api.cashReverse('K-326', 'ещё раз'))).toEqual(MSG);
    expect(apiErr(() => e.api.cashReverse(id, 'ещё раз'))).toEqual(MSG);
  });

  it('нужно право «Проверять»; свою операцию сторнирует второй сотрудник (владелец — любую)', () => {
    const e = env(altaCash(), 'm-morozova');
    expect(apiErr(() => e.api.cashReverse('K-326', 'причина'))).toEqual({
      code: 'forbidden',
      message: 'Сторно — действие «Проверять» в роли',
    });
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'create', 'review'], { type: 'tenant' }, { balance: true });
    const rev = env(db, 'm-petrova');
    const mine = rev.api.cashPost(post({ account: 'ca-sever', type: 'out', amount: 10 })) as {
      id: string;
    };
    expect(apiErr(() => rev.api.cashReverse(mine.id, 'причина'))).toEqual({
      code: 'forbidden',
      message: 'Свою операцию сторнирует второй сотрудник с правом «Проверять»',
    });
    expect(() => rev.api.cashReverse('K-302', 'причина')).not.toThrow();
    expect(() => env(altaCash(), 'm-owner').api.cashReverse('K-318', 'причина')).not.toThrow();
  });

  it('тариф «только чтение» блокирует сторно', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => env(db).api.cashReverse('K-326', 'причина')).code).toBe(
      'subscription_restricted',
    );
  });
});

describe('cashPostProposal', () => {
  const key = (e: ReturnType<typeof env>, k: string) => e.db.cash.proposals.find((p) => p.id === k);

  it('приход по предложению: операция с источником, предложение исчезло', () => {
    const e = env();
    const r = e.api.cashPostProposal('pr-1', { receipt: { fd: '6100' } }) as { ids: string[] };
    expect(r.ids).toHaveLength(1);
    expect(op(e.db, r.ids[0] ?? '')).toMatchObject({
      type: 'in',
      amount: 2800,
      method: 'cash',
      cat: 'Выручка · услуги SPA',
      basis: 'Наталья С. · Массаж лица',
      src: { key: 'pr-1', kind: 'spa', id: null, label: 'Визит 30.09 18:00', nav: 'spa' },
      receipt: { fd: '6100' },
      group: null,
      account: 'ca-spa',
    });
    expect(apiErr(() => e.api.cashPostProposal('pr-1', { receipt: { fd: '6101' } }))).toEqual({
      code: 'conflict',
      message: 'Предложение уже проведено, отклонено или недоступно',
    });
  });

  it('нет такого предложения — conflict', () => {
    expect(apiErr(() => env().api.cashPostProposal('pr-zzz')).code).toBe('conflict');
    expect(apiErr(() => env(altaCash(), 'm-kotova').api.cashPostProposal('pr-1')).code).toBe(
      'conflict',
    );
  });

  it('приход требует чек ККТ', () => {
    expect(apiErr(() => env().api.cashPostProposal('pr-1')).message).toBe(NO_FD);
  });

  it('оплата по частям: наличные в кассу, карта — на терминал, общая группа', () => {
    const e = env();
    const r = e.api.cashPostProposal('pr-1', {
      receipt: { fd: '6200' },
      parts: [
        { method: 'cash', amount: '1 000' },
        { method: 'card', amount: '1800' },
      ],
    }) as { ids: string[] };
    const [a, b] = r.ids.map((id) => op(e.db, id));
    expect(a).toMatchObject({ account: 'ca-spa', method: 'cash', amount: 1000 });
    expect(b).toMatchObject({ account: 'ca-term', method: 'card', amount: 1800 });
    expect(a?.group).toMatch(/^g-/);
    expect(b?.group).toBe(a?.group);
  });

  it('части оплаты должны давать сумму предложения; нулевые части отбрасываются', () => {
    const e = env();
    expect(
      apiErr(() =>
        e.api.cashPostProposal('pr-1', {
          parts: [
            { method: 'cash', amount: 1000 },
            { method: 'card', amount: 1000 },
          ],
        }),
      ),
    ).toEqual({
      code: 'validation',
      message:
        'Части оплаты дают ' + rub('2' + NBSP + '000') + ', а к оплате ' + rub('2' + NBSP + '800'),
    });
    expect(
      apiErr(() => e.api.cashPostProposal('pr-1', { parts: [{ method: 'cash', amount: 0 }] }))
        .message,
    ).toBe('Части оплаты дают ' + rub('0') + ', а к оплате ' + rub('2' + NBSP + '800'));
  });

  it('нет терминала — карта и СБП недоступны, ничего не проведено', () => {
    const e = env();
    const spa = e.db.cash.accounts.find((a) => a.id === 'ca-spa');
    if (spa) spa.term = null;
    const before = e.db.cash.ops.length;
    expect(
      apiErr(() =>
        e.api.cashPostProposal('pr-1', { receipt: FD, parts: [{ method: 'card', amount: 2800 }] }),
      ),
    ).toEqual({
      code: 'validation',
      message: 'У «Касса салона · ресепшен» нет терминала: карта и СБП недоступны',
    });
    expect(e.db.cash.ops).toHaveLength(before);
  });

  it('возврат по предложению: основание = заголовок и пояснение, ссылка на оплату', () => {
    const e = env();
    const r = e.api.cashPostProposal('pr-2', { receipt: { fd: '6300' } }) as { ids: string[] };
    expect(op(e.db, r.ids[0] ?? '')).toMatchObject({
      type: 'refund',
      amount: 1600,
      ref: 'K-316',
      cat: 'Возврат клиенту',
      basis: 'Ирина П. · компенсация по жалобе · Часть оплаты визита 30.09 · по оплате K-316',
      src: { key: 'pr-2', kind: 'service', nav: 'service' },
    });
  });

  it('оплата заказчика на счёт (безналичный), чек ККТ не нужен', () => {
    const e = env();
    e.db.modules.repair = { enabled: true };
    const r = e.api.cashPostProposal('pr-3') as { ids: string[] };
    expect(op(e.db, r.ids[0] ?? '')).toMatchObject({
      account: 'ca-bank',
      method: 'transfer',
      amount: 462000,
      receipt: null,
    });
  });

  it('выплата бригаде: чек у продавца не нужен, расход не по возмещению', () => {
    const e = env();
    e.db.modules.repair = { enabled: true };
    const r = e.api.cashPostProposal('pr-4') as { ids: string[] };
    expect(op(e.db, r.ids[0] ?? '')).toMatchObject({
      type: 'out',
      receipt: null,
      account: 'ca-bank',
    });
  });

  it('предложение сверх лимита роли уходит заявкой с ключом источника', () => {
    const e = env(altaCash(), 'm-morozova');
    const spa = e.db.roles.find((r) => r.id === 'r-cashier');
    if (spa) spa.cash = { ...spa.cash, refund: 1000 };
    const r = e.api.cashPostProposal('pr-2', { receipt: { fd: '6400' } }) as { request: string };
    expect(e.db.cash.requests[0]).toMatchObject({
      id: r.request,
      type: 'refund',
      amount: 1600,
      limit: 1000,
      src: { key: 'pr-2' },
      receipt: { fd: '6400' },
    });
    expect(key(e, 'pr-2')).toBeDefined();
    expect(apiErr(() => e.api.cashPostProposal('pr-2', { receipt: { fd: '6401' } })).code).toBe(
      'conflict',
    );
  });

  it('возмещение расхода рейса: «чек у продавца» проставляется само', () => {
    const db = altaCash();
    db.modules.logistics = { enabled: true };
    Object.assign(db, {
      trips: [
        {
          id: 'Р-205',
          unit: 'f-msk-sever',
          status: 'accepted',
          driverName: 'Илья Васильев',
          expenses: [{ id: 'ex-1', amount: 3000, category: 'fuel' }],
        },
      ],
    });
    const e = env(db);
    const r = e.api.cashPostProposal('tx:ex-1') as { ids: string[] };
    expect(op(db, r.ids[0] ?? '')).toMatchObject({
      type: 'out',
      account: 'ca-sever',
      amount: 3000,
      receipt: { seller: true },
      basis: 'Возместить · Илья Васильев · Рейс Р-205 · топливо · расход принят в приёмке смены',
      src: { key: 'tx:ex-1', kind: 'trip', id: 'Р-205', nav: 'review' },
    });
  });

  it('нет права на кассу предложения', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view'], { type: 'tenant' });
    expect(apiErr(() => env(db, 'm-petrova').api.cashPostProposal('pr-1')).code).toBe('conflict');
  });

  it('тариф «только чтение» блокирует проведение', () => {
    const db = altaCash();
    setTenantStatus(db, 'restricted');
    expect(apiErr(() => env(db).api.cashPostProposal('pr-1')).code).toBe('subscription_restricted');
  });
});

describe('cashDismiss', () => {
  it('отклонение с причиной: запись журнала, предложение исчезло', () => {
    const e = env();
    expect(e.api.cashDismiss('pr-1', 'клиент не пришёл')).toBeUndefined();
    expect(e.db.cash.dismissed[0]).toEqual({
      key: 'pr-1',
      reason: 'клиент не пришёл',
      by: 'm-owner',
      at: '01.10 10:30',
      title: 'Наталья С. · Массаж лица',
      amount: 2800,
    });
    expect(apiErr(() => e.api.cashDismiss('pr-1', 'повтор'))).toEqual({
      code: 'conflict',
      message: 'Предложение уже проведено или отклонено',
    });
  });

  it('причина не короче трёх символов; ничего не записывается', () => {
    const e = env();
    expect(apiErr(() => e.api.cashDismiss('pr-1', ' а '))).toEqual({
      code: 'validation',
      message: 'Укажите, почему не проводите',
    });
    expect(e.db.cash.dismissed).toEqual([]);
  });
});

describe('cashLink', () => {
  it('ручная операция на ту же сумму в той же кассе привязывается к предложению', () => {
    const e = env();
    const made = e.api.cashPost(post({ amount: 2800 })) as { id: string };
    expect(e.api.cashLink(made.id, 'pr-1')).toBe(made.id);
    expect(op(e.db, made.id).src).toEqual({
      key: 'pr-1',
      kind: 'spa',
      id: null,
      label: 'Визит 30.09 18:00',
      nav: 'spa',
      linkedBy: 'm-owner',
    });
    expect(apiErr(() => e.api.cashPostProposal('pr-1', { receipt: { fd: '6500' } })).code).toBe(
      'conflict',
    );
  });

  it('нет предложения или операции — conflict', () => {
    const e = env();
    expect(apiErr(() => e.api.cashLink('K-326', 'pr-zzz'))).toEqual({
      code: 'conflict',
      message: 'Предложение или операция недоступны',
    });
    expect(apiErr(() => e.api.cashLink('K-zzz', 'pr-1')).code).toBe('conflict');
  });

  it.each([
    ['другая сумма', 'K-326'],
    ['другая касса', 'K-302'],
    ['уже связана', 'K-325'],
  ])('%s — validation', (_n, id) => {
    const e = env();
    const o = op(e.db, id);
    if (id === 'K-325') o.src = { key: 'x', kind: 'x', label: 'x' };
    if (id !== 'K-302') o.amount = id === 'K-325' ? 2800 : o.amount;
    expect(apiErr(() => e.api.cashLink(id, 'pr-1'))).toEqual({
      code: 'validation',
      message: 'Связать можно ручную операцию на ту же сумму в этой кассе',
    });
  });

  it('нужно право «Создавать» в кассе предложения', () => {
    const e = env(altaCash(), 'm-owner');
    const made = e.api.cashPost(post({ amount: 2800 })) as { id: string };
    const db = e.db;
    grantCash(db, 'm-petrova', ['view', 'edit'], { type: 'tenant' });
    const p = env(db, 'm-petrova');
    expect(outcome(() => p.api.cashLink(made.id, 'pr-1'))).toMatchObject({ code: 'conflict' });
  });
});

describe('откат при сбое', () => {
  it('исключение внутри команды (например, в событии) не оставляет частичных изменений', () => {
    const e = env(altaCash(), 'm-morozova', {
      emit: () => {
        throw new Error('сбой доставки');
      },
    });
    const snapshot = structuredClone(e.db.cash);
    const seq = e.db.seq;
    expect(() => e.api.cashPost(post({ type: 'out', amount: 1500, receipt: undefined }))).toThrow(
      'сбой доставки',
    );
    expect(e.db.cash).toEqual(snapshot);
    expect(e.db.seq).toBe(seq);
  });
});
