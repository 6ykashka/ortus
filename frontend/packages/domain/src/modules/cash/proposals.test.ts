// Предложения модулей к проведению (cash.js:103–124): сид кассы, принятые расходы рейсов, визиты SPA.
import { describe, expect, it } from 'vitest';
import type { Trip } from '../logistics/types.ts';
import { altaCash, mgr, type CashDb } from './fixture.test-util.ts';
import { cashProposals } from './proposals.ts';

const ids = (db: CashDb, actor: string): string[] => cashProposals(db, actor).map((p) => p.key);

const trip = (o: Record<string, unknown>): Trip =>
  ({
    id: 'Р-205',
    unit: 'f-msk-sever',
    status: 'accepted',
    driverName: 'Илья Васильев',
    expenses: [{ id: 'ex-1', amount: 3000, category: 'fuel' }],
    ...o,
  }) as unknown as Trip;

const withTrips = (db: CashDb, trips: Trip[]): CashDb => {
  Object.assign(db, { trips });
  db.modules.logistics = { enabled: true };
  return db;
};

describe('предложения из сида', () => {
  it('владелец: визиты и возвраты видны, ремонт выключен', () => {
    expect(ids(altaCash(), 'm-owner')).toEqual(['pr-1', 'pr-2']);
  });

  it('с модулем «Ремонт»: оплата заказчика и бригада (владелец имеет право на начисления)', () => {
    const db = altaCash();
    db.modules.repair = { enabled: true };
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-4']);
  });

  it('бригада — только с правом на начисления; оплата заказчика без него видна', () => {
    const db = altaCash([mgr('x1', 'm-petrova', { type: 'tenant' })]);
    db.modules.repair = { enabled: true };
    db.roles = db.roles.map((r) =>
      r.id === 'r-manager' ? { ...r, finance: { read: false, manage: false } } : r,
    );
    expect(ids(db, 'm-petrova')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    db.roles = db.roles.map((r) =>
      r.id === 'r-manager' ? { ...r, finance: { read: true, manage: false } } : r,
    );
    expect(ids(db, 'm-petrova')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-4']);
  });

  it('предложение копируется с ключом = id', () => {
    const [p] = cashProposals(altaCash(), 'm-owner');
    expect(p).toMatchObject({
      id: 'pr-1',
      key: 'pr-1',
      kind: 'in',
      amount: 2800,
      account: 'ca-spa',
    });
  });

  it('модуль, выключенный в организации, скрывает предложения', () => {
    const db = altaCash();
    db.modules.spa = { enabled: false };
    expect(ids(db, 'm-owner')).toEqual(['pr-2']);
  });
});

describe('доступ: кассир и держатель подотчёта', () => {
  it('кассир салона: приход (create) и возврат (edit) своей кассы; чужие — нет', () => {
    const db = altaCash();
    db.modules.repair = { enabled: true };
    expect(ids(db, 'm-morozova')).toEqual(['pr-1', 'pr-2']);
  });

  it('без права «Создавать» приход не предлагается, возврат требует «Изменять»', () => {
    const db = altaCash();
    db.roles = db.roles.map((r) =>
      r.id === 'r-cashier' ? { ...r, actions: { cash: ['view', 'create'] } } : r,
    );
    expect(ids(db, 'm-morozova')).toEqual(['pr-1']);
    db.roles = db.roles.map((r) =>
      r.id === 'r-cashier' ? { ...r, actions: { cash: ['view', 'edit'] } } : r,
    );
    expect(ids(db, 'm-morozova')).toEqual(['pr-2']);
  });

  it('держатель подотчёта (self) предложений не получает; нет доступа — тоже', () => {
    const db = altaCash();
    expect(ids(db, 'm-vasiliev')).toEqual([]);
    expect(ids(db, 'm-kotova')).toEqual([]);
    expect(ids(db, 'm-nobody')).toEqual([]);
  });

  it('предложение на несуществующую кассу не показывается', () => {
    const db = altaCash();
    for (const p of db.cash.proposals) p.account = 'ca-zzz';
    expect(ids(db, 'm-owner')).toEqual([]);
  });
});

describe('проведённые, отклонённые и ожидающие согласования', () => {
  it('скрывает предложение с проведённой операцией, ожидающей заявкой и отклонённое', () => {
    const db = altaCash();
    const op0 = db.cash.ops[0];
    if (!op0) throw new Error('нет операции');
    op0.src = { key: 'pr-1', kind: 'spa', label: 'x' };
    expect(ids(db, 'm-owner')).toEqual(['pr-2']);
    const pending = db.cash.requests[0];
    if (!pending) throw new Error('нет заявки');
    pending.src = { key: 'pr-2', kind: 'service', label: 'y' };
    expect(ids(db, 'm-owner')).toEqual([]);
  });

  it('сторнированная операция предложение возвращает; решённая заявка — тоже', () => {
    const db = altaCash();
    const o = db.cash.ops[0];
    if (!o) throw new Error('нет операции');
    o.src = { key: 'pr-1', kind: 'spa', label: 'x' };
    o.reversedBy = 'K-999';
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
    const q = db.cash.requests[0];
    if (!q) throw new Error('нет заявки');
    q.src = { key: 'pr-2', kind: 'service', label: 'y' };
    q.status = 'rejected';
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
  });

  it('отклонённое предложение исчезает', () => {
    const db = altaCash();
    db.cash.dismissed.push({
      key: 'pr-2',
      reason: 'нет',
      by: 'm-owner',
      at: '',
      title: '',
      amount: 0,
    });
    expect(ids(db, 'm-owner')).toEqual(['pr-1']);
  });

  it('нет среза или он старый — пусто', () => {
    const db = altaCash();
    const bare = { ...db, cash: undefined } as unknown as CashDb;
    expect(cashProposals(bare, 'm-owner')).toEqual([]);
    const old = { ...db, cash: { accounts: [], ops: [] } } as unknown as CashDb;
    expect(cashProposals(old, 'm-owner')).toEqual([]);
  });
});

describe('возмещение расходов рейса', () => {
  it('принятый рейс → «Возместить» в кассу подразделения рейса', () => {
    const db = withTrips(altaCash(), [trip({})]);
    const p = cashProposals(db, 'm-owner').find((x) => x.key === 'tx:ex-1');
    expect(p).toEqual({
      id: 'tx:ex-1',
      key: 'tx:ex-1',
      mod: 'logistics',
      kind: 'out',
      amount: 3000,
      account: 'ca-sever',
      method: 'cash',
      cat: 'Топливо',
      seller: true,
      title: 'Возместить · Илья Васильев',
      sub: 'Рейс Р-205 · топливо · расход принят в приёмке смены',
      src: { kind: 'trip', id: 'Р-205', label: 'Рейс Р-205', nav: 'review' },
    });
  });

  it('порядок: сначала сид, затем рейсы, затем визиты', () => {
    const db = withTrips(altaCash(), [trip({})]);
    Object.assign(db, {
      spa: {
        appointments: [
          {
            id: 'ap-1',
            status: 'done',
            client: 'Мария К.',
            service: 'SPA-ритуал',
            time: '10:00–11:00',
            room: 'Кабинет № 2',
          },
        ],
      },
    });
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2', 'tx:ex-1', 'ap:ap-1']);
  });

  it.each([
    ['не принятый рейс', { status: 'done' }],
    ['подразделение без кассы', { unit: 'f-spb-neva' }],
    ['нет расходов', { expenses: [] }],
  ])('%s — без предложения', (_n, o) => {
    const db = withTrips(altaCash(), [trip(o)]);
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
  });

  it('неизвестная статья → «Прочий расход»; водитель без имени → «водитель»', () => {
    const db = withTrips(altaCash(), [
      trip({ driverName: null, expenses: [{ id: 'ex-2', amount: 10, category: 'zzz' }] }),
    ]);
    const p = cashProposals(db, 'm-owner').find((x) => x.key === 'tx:ex-2');
    expect(p).toMatchObject({
      cat: 'Прочий расход',
      title: 'Возместить · водитель',
      sub: 'Рейс Р-205 · прочий расход · расход принят в приёмке смены',
    });
  });

  it('модуль «Логистика» выключен — возмещений нет; рейс уже проведён — тоже', () => {
    const db = withTrips(altaCash(), [trip({})]);
    db.modules.logistics = { enabled: false };
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
    db.modules.logistics = { enabled: true };
    const first = db.cash.ops[0];
    if (!first) throw new Error('нет операции');
    first.src = { key: 'tx:ex-1', kind: 'trip', label: '' };
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
  });

  it('кассир салона возмещений в кассу офиса не видит', () => {
    const db = withTrips(altaCash(), [trip({})]);
    expect(ids(db, 'm-morozova')).toEqual(['pr-1', 'pr-2']);
  });
});

describe('приход по визитам SPA', () => {
  const appt = (o: Record<string, unknown>) => ({
    id: 'ap-1',
    status: 'done',
    client: 'Мария К.',
    service: 'Классический массаж',
    time: '10:00–11:00',
    room: 'Кабинет № 2',
    ...o,
  });
  const withSpa = (list: unknown[]): CashDb => {
    const db = altaCash();
    Object.assign(db, { spa: { appointments: list } });
    return db;
  };

  it('завершённый визит → приход по цене услуги в кассу салона', () => {
    const p = cashProposals(withSpa([appt({})]), 'm-owner').find((x) => x.key === 'ap:ap-1');
    expect(p).toEqual({
      id: 'ap:ap-1',
      key: 'ap:ap-1',
      mod: 'spa',
      kind: 'in',
      amount: 3200,
      account: 'ca-spa',
      cat: 'Выручка · услуги SPA',
      title: 'Мария К. · Классический массаж',
      sub: 'Визит сегодня 10:00–11:00 · Кабинет № 2',
      src: { kind: 'spa', id: 'ap-1', label: 'Визит 10:00–11:00', nav: 'spa' },
    });
  });

  it('цена: по справочнику, иначе 3000; «done_pending» тоже завершён; «confirmed» — нет', () => {
    const db = withSpa([
      appt({ id: 'a2', service: 'SPA-ритуал', status: 'done_pending' }),
      appt({ id: 'a3', service: 'Новая услуга' }),
      appt({ id: 'a4', status: 'confirmed' }),
    ]);
    const list = cashProposals(db, 'm-owner').filter(
      (x) => x.mod === 'spa' && x.id.startsWith('ap:'),
    );
    expect(list.map((x) => [x.id, x.amount])).toEqual([
      ['ap:a2', 5400],
      ['ap:a3', 3000],
    ]);
  });

  it('нет кассы салона — визиты не предлагаются', () => {
    const db = withSpa([appt({})]);
    for (const a of db.cash.accounts) if (a.id === 'ca-spa') a.archived = true;
    expect(ids(db, 'm-owner')).toEqual(['pr-1', 'pr-2']);
  });
});
