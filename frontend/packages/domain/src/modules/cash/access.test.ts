// Доступ к кассам (cash.js:59–101): роль с модулем «Касса» → область → параметры роли.
import { describe, expect, it } from 'vitest';
import type { Role } from '../../core/types/index.ts';
import { accCan, cashAccess, cashPeople, canAcceptTransfer, rightsText } from './access.ts';
import { CASH_OPT0 } from './dictionaries.ts';
import { NBSP, altaCash, mgr } from './fixture.test-util.ts';
import type { CashAccessResult, CashAccount, CashTransfer } from './types.ts';

const acc = (db: ReturnType<typeof altaCash>, id: string): CashAccount => {
  const a = db.cash.accounts.find((x) => x.id === id);
  if (!a) throw new Error('нет кассы ' + id);
  return a;
};
const access = (db: ReturnType<typeof altaCash>, mid: string, id: string): CashAccessResult =>
  cashAccess(db, mid, acc(db, id));
const why = (r: CashAccessResult): string => (r.ok ? 'ok' : r.why);

describe('cashAccess: отказы', () => {
  const db = altaCash();
  it.each([
    ['m-nobody', 'ca-spa', 'нет в организации'],
    ['m-gromov', 'ca-spa', 'сотрудник заблокирован'],
    ['m-kotova', 'ca-sever', 'в ролях нет модуля «Касса»'],
    ['m-kotova', 'ca-spa', 'в ролях нет модуля «Касса»'],
    ['m-sokolov', 'ca-sever', 'роль даёт только свой подотчёт'],
    ['m-vasiliev', 'ca-sever', 'роль даёт только свой подотчёт'],
    ['m-vasiliev', 'ca-adv-akh', 'роль даёт только свой подотчёт'],
    ['m-morozova', 'ca-sever', 'касса вне области назначения'],
    ['m-morozova', 'ca-safe', 'касса вне области назначения'],
    ['m-morozova', 'ca-adv-vas', 'касса вне области назначения'],
  ])('%s → %s: %s', (mid, id, want) => {
    expect(why(access(db, mid, id))).toBe(want);
  });
});

describe('cashAccess: владелец и держатель подотчёта', () => {
  const db = altaCash();
  it('владелец бизнеса: всё, включая остаток', () => {
    for (const a of db.cash.accounts) {
      expect(cashAccess(db, 'm-owner', a)).toEqual({
        ok: true,
        all: true,
        own: false,
        verbs: ['view', 'create', 'edit', 'review', 'export', 'settings'],
        opt: { ...CASH_OPT0, balance: true },
        via: 'Владелец бизнеса · вся организация',
      });
    }
  });

  it('водитель видит свой подотчёт: own, остаток и только свой', () => {
    expect(access(db, 'm-vasiliev', 'ca-adv-vas')).toEqual({
      ok: true,
      all: false,
      own: true,
      verbs: ['view', 'create'],
      opt: { balance: true, self: true, out: null, refund: null, advance: null },
      via: 'Водитель · Москва / Север Логистик',
    });
  });

  it('прораб Соколов: свой подотчёт в кассе без подразделения (scope self роли)', () => {
    const r = access(db, 'm-sokolov', 'ca-adv-sok');
    expect(r).toMatchObject({ ok: true, own: true, verbs: ['view', 'create'] });
    expect(r.ok && r.via).toBe('Прораб · Только назначенное лично');
  });
});

describe('cashAccess: кассир салона (область «касса»)', () => {
  const db = altaCash();
  it('своя касса и её эквайринг', () => {
    const want = {
      ok: true,
      all: false,
      own: false,
      verbs: ['view', 'create', 'edit'],
      opt: { balance: false, self: false, out: 1000, refund: 3000, advance: 0 },
      via: 'Кассир салона · Касса «Касса салона · ресепшен»',
    };
    expect(access(db, 'm-morozova', 'ca-spa')).toEqual(want);
    expect(access(db, 'm-morozova', 'ca-term')).toEqual(want);
  });
});

describe('cashAccess: территориальные области и объединение ролей', () => {
  it('регион покрывает кассу фирмы региона; касса без подразделения — только вся организация', () => {
    const db = altaCash([mgr('x1', 'm-petrova', { type: 'region', id: 'r-msk' })]);
    expect(why(access(db, 'm-petrova', 'ca-sever'))).toBe('ok');
    expect(why(access(db, 'm-petrova', 'ca-adv-vas'))).toBe('ok');
    expect(why(access(db, 'm-petrova', 'ca-safe'))).toBe('касса вне области назначения');
    expect(why(access(db, 'm-petrova', 'ca-spa'))).toBe('касса вне области назначения');
    const t = altaCash([mgr('x1', 'm-petrova', { type: 'tenant' })]);
    expect(why(access(t, 'm-petrova', 'ca-safe'))).toBe('ok');
    expect(why(access(t, 'm-petrova', 'ca-spa'))).toBe('ok');
  });

  it('фирма другой кассы не подходит', () => {
    const db = altaCash([mgr('x1', 'm-ilyin', { type: 'firm', id: 'f-msk-yug' })]);
    expect(why(access(db, 'm-ilyin', 'ca-sever'))).toBe('касса вне области назначения');
  });

  it('менеджер: параметры роли и подпись «via»', () => {
    const db = altaCash([mgr('x1', 'm-petrova', { type: 'firm', id: 'f-msk-sever' })]);
    expect(access(db, 'm-petrova', 'ca-sever')).toEqual({
      ok: true,
      all: false,
      own: false,
      verbs: ['view', 'create', 'edit'],
      opt: { balance: true, self: false, out: 5000, refund: 0, advance: 15000 },
      via: 'Менеджер логистики · Москва / Север Логистик',
    });
  });

  it('два назначения: глаголы — объединением, баланс — «или», лимит — максимум, null побеждает', () => {
    const extraRole: Role = {
      id: 'r-free',
      name: 'Без лимита',
      kind: 'custom',
      actions: { cash: ['review'] },
      cash: { balance: false, out: null, refund: 100, advance: 0 },
      finance: { read: false, manage: false },
    };
    const db = altaCash([
      mgr('x1', 'm-petrova', { type: 'firm', id: 'f-msk-sever' }),
      {
        id: 'x2',
        member: 'm-petrova',
        role: 'r-cashier',
        scope: { type: 'account', id: 'ca-sever' },
      },
    ]);
    const r = access(db, 'm-petrova', 'ca-sever');
    expect(r).toMatchObject({
      verbs: ['view', 'create', 'edit'],
      opt: { balance: true, self: false, out: 5000, refund: 3000, advance: 15000 },
    });
    db.roles.push(extraRole);
    db.assignments.push({
      id: 'x3',
      member: 'm-petrova',
      role: 'r-free',
      scope: { type: 'tenant' },
    });
    const r2 = access(db, 'm-petrova', 'ca-sever');
    expect(r2).toMatchObject({
      verbs: ['view', 'create', 'edit', 'review'],
      opt: { out: null, refund: 3000, advance: 15000, balance: true },
    });
    expect(r2.ok && r2.via.split('; ')).toHaveLength(3);
  });

  it('роль «только свой подотчёт» не покрывает чужую кассу, но «свой» среди прочих — покрывает', () => {
    const db = altaCash([mgr('x1', 'm-vasiliev', { type: 'firm', id: 'f-msk-sever' })]);
    const own = access(db, 'm-vasiliev', 'ca-adv-vas');
    expect(own).toMatchObject({ ok: true, own: true });
    expect(own.ok && own.opt.self).toBe(false);
    expect(why(access(db, 'm-vasiliev', 'ca-adv-akh'))).toBe('ok');
  });
});

describe('accCan', () => {
  const db = altaCash();
  it.each([
    ['m-owner', 'ca-spa', 'settings', true],
    ['m-morozova', 'ca-spa', 'create', true],
    ['m-morozova', 'ca-spa', 'review', false],
    ['m-vasiliev', 'ca-adv-vas', 'edit', false],
    ['m-kotova', 'ca-spa', 'view', false],
  ] as const)('%s в %s: %s = %s', (mid, id, verb, want) => {
    expect(accCan(access(db, mid, id), verb)).toBe(want);
  });
  it('пустой результат — нет права', () => {
    expect(accCan(undefined, 'view')).toBe(false);
  });
});

describe('rightsText', () => {
  const db = altaCash([mgr('x1', 'm-petrova', { type: 'firm', id: 'f-msk-sever' })]);
  const text = (mid: string, id: string): string => rightsText(access(db, mid, id));
  it('тексты по виду доступа', () => {
    expect(text('m-nobody', 'ca-spa')).toBe('Нет доступа: нет в организации');
    expect(text('m-owner', 'ca-spa')).toBe('Всё, включая остаток и сверку');
    expect(text('m-vasiliev', 'ca-adv-vas')).toBe('Свой подотчёт: остаток и отчёт чеками');
    expect(text('m-petrova', 'ca-sever')).toBe(
      'видит операции, вносит и проводит, ведёт смены, возвраты, перемещения, подотчёт · ' +
        'видит остаток · расход до 5' +
        NBSP +
        '000' +
        NBSP +
        '₽ · возврат — с согласованием',
    );
    expect(text('m-morozova', 'ca-spa')).toBe(
      'видит операции, вносит и проводит, ведёт смены, возвраты, перемещения, подотчёт · ' +
        'остаток скрыт · расход до 1' +
        NBSP +
        '000' +
        NBSP +
        '₽ · возврат до 3' +
        NBSP +
        '000' +
        NBSP +
        '₽',
    );
  });

  it('без лимитов подписи лимитов нет', () => {
    const r: CashAccessResult = {
      ok: true,
      all: false,
      own: false,
      verbs: ['view', 'review'],
      opt: { ...CASH_OPT0 },
      via: '',
    };
    expect(rightsText(r)).toBe('видит операции, согласует, сверяет, сторнирует · остаток скрыт');
    const x: CashAccessResult = { ...r, verbs: ['export'] } as CashAccessResult;
    expect(rightsText(x)).toBe('остаток скрыт');
  });
});

describe('cashPeople', () => {
  it('все не заблокированные; с доступом — сверху; приглашённые помечены', () => {
    const db = altaCash();
    const list = cashPeople(db, acc(db, 'ca-spa'));
    expect(list.map((p) => p.id)).toEqual([
      'm-owner',
      'm-morozova',
      'm-kotova',
      'm-vasiliev',
      'm-sokolov',
      'm-petrova',
      'm-kotelnikova',
      'm-akhmedov',
      'm-ilyin',
    ]);
    expect(list.filter((p) => p.ok).map((p) => p.id)).toEqual(['m-owner', 'm-morozova']);
    expect(list[1]).toEqual({
      id: 'm-morozova',
      name: 'Анна Морозова',
      title: 'Массажист',
      invited: false,
      ok: true,
      text: rightsText(access(db, 'm-morozova', 'ca-spa')),
    });
    expect(list.find((p) => p.id === 'm-petrova')).toMatchObject({
      invited: true,
      ok: false,
      text: 'Нет доступа: в ролях нет модуля «Касса»',
    });
  });
});

describe('canAcceptTransfer', () => {
  const db = altaCash();
  const tr = (to: string): CashTransfer => ({
    id: 't',
    from: 'ca-sever',
    to,
    amount: 1,
    note: '',
    by: 'm-owner',
    at: '',
    status: 'transit',
  });
  it.each([
    ['m-vasiliev', 'ca-adv-vas', true],
    ['m-owner', 'ca-adv-vas', false],
    ['m-owner', 'ca-safe', true],
    ['m-morozova', 'ca-spa', true],
    ['m-kotova', 'ca-safe', false],
    ['m-owner', 'ca-net', false],
  ] as const)('%s принимает в %s: %s', (mid, to, want) => {
    expect(canAcceptTransfer(db, mid, db.cash, tr(to))).toBe(want);
  });
});
