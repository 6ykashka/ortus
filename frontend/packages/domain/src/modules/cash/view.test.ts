// Проекция «Кассы» для участника (cash.js:126–174): кассы его области, остаток — только с правом,
// смены, перемещения, чеки, заявки, предложения и «Требует решения» (`todo`, `badge`).
import { describe, expect, it } from 'vitest';
import { NBSP, altaCash, mgr, type CashDb } from './fixture.test-util.ts';
import { cashView, cashTodo, type CashView } from './view.ts';

const T = { today: '01.10' };
const view = (db: CashDb, actor: string, today = T.today): CashView => {
  const v = cashView(db, actor, { today });
  if (!v) throw new Error('нет проекции');
  return v;
};
const R = (n: string): string => n + NBSP + '₽';

describe('нет доступа и нет модуля', () => {
  it('без касс в области — пустая проекция со скрытым разделом', () => {
    expect(view(altaCash(), 'm-kotova')).toEqual({
      v1: true,
      hidden: true,
      accounts: [],
      ops: [],
      shifts: [],
      transfers: [],
      receipts: [],
      requests: [],
      proposals: [],
      todo: [],
      badge: 0,
      canSettings: false,
    });
  });

  it('заблокированный и чужой участник — тоже скрыт', () => {
    expect(view(altaCash(), 'm-gromov').hidden).toBe(true);
    expect(view(altaCash(), 'm-nobody').hidden).toBe(true);
  });

  it('модуль не установлен или старый срез — null', () => {
    const db = altaCash();
    expect(cashView({ ...db, cash: undefined } as unknown as CashDb, 'm-owner', T)).toBeNull();
    expect(
      cashView({ ...db, cash: { accounts: [], ops: [] } } as unknown as CashDb, 'm-owner', T),
    ).toBeNull();
  });
});

describe('владелец', () => {
  const db = altaCash();
  const v = view(db, 'm-owner');

  it('все 8 касс с остатками, ответственными и правами', () => {
    expect(v.hidden).toBe(false);
    expect(v.accounts.map((a) => [a.id, a.balance])).toEqual([
      ['ca-spa', 7350],
      ['ca-term', 21600],
      ['ca-sever', 30760],
      ['ca-adv-vas', 4450],
      ['ca-adv-akh', 5000],
      ['ca-adv-sok', 11270],
      ['ca-safe', 116840],
      ['ca-bank', 1284000],
    ]);
    const spa = v.accounts[0];
    expect(spa).toMatchObject({
      shift: 'sh-118',
      respName: 'Анна Морозова',
      memberName: '',
      my: {
        all: true,
        own: false,
        rights: 'Всё, включая остаток и сверку',
        via: 'Владелец бизнеса · вся организация',
      },
    });
    expect(v.accounts[3]).toMatchObject({ memberName: 'Илья Васильев', respName: '', shift: null });
  });

  it('проекция не меняет БД', () => {
    const before = structuredClone(db.cash);
    view(db, 'm-owner');
    expect(db.cash).toEqual(before);
  });

  it('операции: имена, возможность сторно (не сторно, не перемещение, не исправленная)', () => {
    expect(v.ops).toHaveLength(26);
    const by = (id: string) => v.ops.find((o) => o.id === id);
    expect(by('K-326')).toMatchObject({
      byName: 'Анна Морозова',
      approvedName: '',
      canReverse: true,
    });
    expect(by('K-322')?.canReverse).toBe(false);
    expect(by('K-321')?.canReverse).toBe(true);
  });

  it('смены: остаток «сейчас» у открытой, решение закрытой', () => {
    const open = v.shifts.find((h) => h.id === 'sh-118');
    expect(open).toMatchObject({
      openedName: 'Анна Морозова',
      closedName: '',
      expectedNow: 7350,
      my: { seesBal: true, canClose: true, canReview: false },
    });
    const closed = v.shifts.find((h) => h.id === 'sh-117');
    expect(closed).toMatchObject({
      closedName: 'Анна Морозова',
      my: { canClose: false, canReview: false },
    });
    expect(closed?.expectedNow).toBeUndefined();
    expect(closed?.decision?.byName).toBeUndefined();
  });

  it('перемещения и чеки с именами и правами', () => {
    expect(v.transfers.map((t) => [t.id, t.fromName, t.toName, t.my.canAccept])).toEqual([
      ['tr-4', 'Сейф офиса', 'Подотчёт · Алексей Соколов', false],
      ['tr-3', 'Касса офиса', 'Подотчёт · Тимур Ахмедов', false],
      ['tr-2', 'Касса салона · ресепшен', 'Сейф офиса', false],
      ['tr-1', 'Касса офиса', 'Подотчёт · Илья Васильев', false],
    ]);
    expect(v.receipts.map((c) => [c.id, c.my.canDecide])).toEqual([
      ['rc-3', true],
      ['rc-4', false],
      ['rc-2', false],
      ['rc-1', false],
      ['rc-5', false],
      ['rc-6', false],
    ]);
    expect(v.receipts.find((c) => c.id === 'rc-4')).toMatchObject({
      byName: 'Илья Васильев',
      decidedName: 'Дарья Зимина',
    });
  });

  it('заявка: согласующие — другие сотрудники с «Проверять»; решает владелец', () => {
    expect(v.requests).toHaveLength(1);
    expect(v.requests[0]).toMatchObject({
      id: 'rq-1',
      byName: 'Марина Котова',
      decidedName: '',
      approvers: ['Дарья Зимина'],
      my: { canDecide: true, mine: false },
    });
  });

  it('предложения, право на настройки', () => {
    expect(v.proposals.map((p) => p.key)).toEqual(['pr-1', 'pr-2']);
    expect(v.canSettings).toBe(true);
  });

  it('«Требует решения»: заявка, чек и входящие; badge считает n', () => {
    expect(v.todo).toEqual([
      {
        tone: 'warn',
        icon: 'approval',
        label: 'Касса · согласовать',
        title: 'Расход ' + R('6' + NBSP + '500') + ' · Касса офиса',
        text:
          'Ремонт ворот склада · ИП Гаврилов · Марина Котова · без согласования до ' +
          R('5' + NBSP + '000'),
        action: 'Решить',
        open: 'rq:rq-1',
      },
      {
        tone: 'info',
        icon: 'receipt_long',
        label: 'Подотчёт · чек',
        title: 'Илья Васильев: Мойка ' + R('600'),
        text: 'Рейс Р-203 · чек на проверке с 30.09 19:20',
        action: 'Проверить',
        open: 'adv:ca-adv-vas',
      },
      {
        tone: 'neutral',
        icon: 'inbox',
        label: 'Касса · входящие',
        title: '2 предложения к проведению',
        text: 'визиты · 1, возвраты · 1',
        action: 'Открыть',
        open: 'inbox',
        n: 2,
      },
    ]);
    expect(v.badge).toBe(4);
  });
});

describe('кассир салона', () => {
  const v = view(altaCash(), 'm-morozova');

  it('своя касса и эквайринг; остаток скрыт', () => {
    expect(v.accounts.map((a) => [a.id, a.balance])).toEqual([
      ['ca-spa', null],
      ['ca-term', null],
    ]);
    expect(v.accounts[0]?.my).toMatchObject({
      all: false,
      own: false,
      verbs: ['view', 'create', 'edit'],
    });
    expect(v.canSettings).toBe(false);
  });

  it('операции только этих касс, сторно недоступно', () => {
    expect(v.ops.every((o) => ['ca-spa', 'ca-term'].includes(o.account))).toBe(true);
    expect(v.ops.some((o) => o.canReverse)).toBe(false);
  });

  it('смены без расчётных полей, закрыть может только открытую', () => {
    const open = v.shifts.find((h) => h.id === 'sh-118');
    expect(open).toMatchObject({ my: { seesBal: false, canClose: true, canReview: false } });
    expect(open?.expectedNow).toBeUndefined();
    const closed = v.shifts.find((h) => h.id === 'sh-117');
    expect(closed?.hiddenCalc).toBe(true);
    expect(closed?.expected).toBeUndefined();
    expect(closed?.diff).toBeUndefined();
    expect(closed?.counted).toBe(31840);
    expect(closed?.decision?.reason).toBe('В пределах допуска 100 ₽');
  });

  it('заявка кассы офиса не видна; перемещение в сейф (чужая касса) — тоже, на сторону салона — да', () => {
    expect(v.requests).toEqual([]);
    expect(v.transfers.map((t) => t.id)).toEqual(['tr-2']);
  });

  it('предложения салона и «входящие» без остальных пунктов', () => {
    expect(v.proposals.map((p) => p.key)).toEqual(['pr-1', 'pr-2']);
    expect(v.todo).toHaveLength(1);
    expect(v.badge).toBe(2);
  });
});

describe('водитель (только свой подотчёт)', () => {
  const v = view(altaCash(), 'm-vasiliev');
  it('одна касса, свой остаток, чеки и перемещения этой кассы', () => {
    expect(v.accounts.map((a) => [a.id, a.balance, a.my.own])).toEqual([
      ['ca-adv-vas', 4450, true],
    ]);
    expect(v.accounts[0]?.my.rights).toBe('Свой подотчёт: остаток и отчёт чеками');
    expect(v.ops.map((o) => o.id)).toEqual(['K-306', 'K-305', 'K-304']);
    expect(v.transfers.map((t) => t.id)).toEqual(['tr-1']);
    expect(v.receipts.map((c) => c.id)).toEqual(['rc-3', 'rc-4', 'rc-2', 'rc-1']);
    expect(v.receipts.every((c) => !c.my.canDecide)).toBe(true);
    expect(v.proposals).toEqual([]);
    expect(v.todo).toEqual([]);
    expect(v.badge).toBe(0);
  });
});

describe('«Требует решения»: прочие поводы', () => {
  it('смена на сверке: решает не тот, кто закрывал, и только с остатком', () => {
    const db = altaCash();
    const h = db.cash.shifts.find((x) => x.id === 'sh-117');
    if (!h) throw new Error('нет смены');
    h.status = 'review';
    h.diff = { cash: -150, kktCash: 0, kktCard: 0, term: 0 };
    const owner = view(db, 'm-owner');
    expect(owner.shifts.find((x) => x.id === 'sh-117')?.my).toMatchObject({ canReview: true });
    expect(owner.todo[0]).toEqual({
      tone: 'danger',
      icon: 'point_of_sale',
      label: 'Касса · сверка',
      title: 'Смена 117 · Касса салона · ресепшен: расхождение −150' + NBSP + '₽',
      text: 'Выше допуска ' + R('100') + ' · закрыл(а) Анна Морозова',
      action: 'Решить',
      open: 'sh:sh-117',
    });
    h.closedBy = 'm-owner';
    expect(view(db, 'm-owner').shifts.find((x) => x.id === 'sh-117')?.my.canReview).toBe(false);
  });

  it('перемещение в пути: принимает получатель', () => {
    const db = altaCash();
    db.cash.transfers.unshift({
      id: 'tr-9',
      from: 'ca-sever',
      to: 'ca-safe',
      amount: 1000,
      note: 'Сдача',
      by: 'm-kotova',
      at: '01.10 09:00',
      status: 'transit',
    });
    const v = view(db, 'm-owner');
    expect(v.transfers[0]).toMatchObject({
      id: 'tr-9',
      byName: 'Марина Котова',
      my: { canAccept: true },
    });
    expect(v.todo.find((t) => t.open === 'tr:tr-9')).toEqual({
      tone: 'info',
      icon: 'move_down',
      label: 'Касса · принять',
      title: R('1' + NBSP + '000') + ' из «Касса офиса» в «Сейф офиса»',
      text: 'Сдача · передал(а) Марина Котова',
      action: 'Принять',
      open: 'tr:tr-9',
    });
  });

  it('просроченный отчёт подотчёта виден тому, кто может выдавать (не держателю)', () => {
    const db = altaCash();
    const a = db.cash.accounts.find((x) => x.id === 'ca-adv-vas');
    if (!a) throw new Error('нет кассы');
    a.due = '30.09';
    const todo = view(db, 'm-owner').todo.find((t) => t.label === 'Подотчёт · срок');
    expect(todo).toEqual({
      tone: 'warn',
      icon: 'event_busy',
      label: 'Подотчёт · срок',
      title: 'Илья Васильев: не отчитался(ась) за ' + R('4' + NBSP + '450'),
      text: 'Срок отчёта 30.09 прошёл',
      action: 'Открыть',
      open: 'adv:ca-adv-vas',
    });
    expect(view(db, 'm-vasiliev').todo).toEqual([]);
  });

  it('срок считается от часов домена (today)', () => {
    const db = altaCash();
    expect(
      view(db, 'm-owner', '04.10').todo.filter((t) => t.label === 'Подотчёт · срок'),
    ).toHaveLength(2);
    expect(view(db, 'm-owner').todo.filter((t) => t.label === 'Подотчёт · срок')).toHaveLength(0);
  });

  it('менеджер без права видеть остаток не получает «срок» (остаток скрыт)', () => {
    const db = altaCash([mgr('x1', 'm-petrova', { type: 'tenant' })]);
    db.roles = db.roles.map((r) =>
      r.id === 'r-manager' ? { ...r, cash: { ...r.cash, balance: false } } : r,
    );
    const a = db.cash.accounts.find((x) => x.id === 'ca-adv-vas');
    if (a) a.due = '30.09';
    expect(view(db, 'm-petrova').todo.some((t) => t.label === 'Подотчёт · срок')).toBe(false);
  });

  it('cashTodo без данных — пусто', () => {
    expect(
      cashTodo(
        { accounts: [], shifts: [], requests: [], transfers: [], receipts: [], proposals: [] },
        T.today,
      ),
    ).toEqual([]);
  });

  it('заявка автора: видна ему, но решить её он не может', () => {
    const db = altaCash([mgr('x1', 'm-kotova', { type: 'firm', id: 'f-msk-sever' })]);
    const v = view(db, 'm-kotova');
    expect(v.requests[0]).toMatchObject({ id: 'rq-1', my: { canDecide: false, mine: true } });
    expect(v.todo.some((t) => t.label === 'Касса · согласовать')).toBe(false);
  });

  it('входящие группируются по модулю: визиты, возмещения, возвраты, объекты, прочее', () => {
    const db = altaCash();
    db.modules.repair = { enabled: true };
    db.cash.proposals.push({
      id: 'pr-9',
      kind: 'in',
      amount: 1,
      account: 'ca-spa',
      cat: 'x',
      title: 't',
      src: { kind: 'x', label: 'x' },
    });
    const inbox = view(db, 'm-owner').todo.find((t) => t.open === 'inbox');
    expect(inbox).toMatchObject({
      title: '5 предложений к проведению',
      text: 'визиты · 1, возвраты · 1, объекты · 2, прочее · 1',
      n: 5,
    });
  });
});
