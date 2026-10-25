// Паритет «Кассы» с эталоном (`design/ortus/cash.js`, `models.js`, `mock-data.js`, `api.js`, снимок
// 19.10): одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
// Команды сравниваются через `createMockAdapter` эталона: те же шаги, те же участники; время суток
// эталона (`new Date()`) и часы домена сводятся к `ЧЧ:ММ`.
//
// Намеренные расхождения (бриф W5.30 §10), проверяются здесь же явно:
// - `cashApprove` и `cashTransferAccept` проверяют тариф; согласование выдачи под отчёт проверяет
//   остаток кассы-источника (в эталоне нет) — проверено в `commands-approve.test.ts`;
// - команда атомарна: при исключении возвращается срез, счётчик id и события (в эталоне — нет);
// - `cashAccountCreate`: право «Настраивать» в подразделении новой кассы (PD-53);
// - `cashShiftReview('recount')` уведомляет закрывшего смену (в эталоне — открывшего: поле
//   `closedBy` уже стёрто к моменту события);
// - `canSettings` проекции — право на организацию, не роль объекта (PD-53 ядра).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/errors/index.ts';
import type { Assignment } from '../../core/types/index.ts';
import { importReference, referenceModels } from '../../seed/reference.ts';
import { accCan, cashAccess, cashPeople, rightsText } from './access.ts';
import * as D from './dictionaries.ts';
import { env, type Env } from './env.test-util.ts';
import { altaCash, grantCash, lotosCash, type CashDb } from './fixture.test-util.ts';
import { cashProposals } from './proposals.ts';
import { cashView } from './view.ts';

type Fn = (...a: unknown[]) => unknown;
type RefCash = Record<string, unknown> & {
  installCash(db: unknown, M: unknown): void;
  cashAccess: Fn;
  accCan: Fn;
  rightsText: Fn;
  cashPeople: Fn;
  cashProposals: Fn;
  cashView: Fn;
  dueState: Fn;
  parseSum: Fn;
  rub: Fn;
  signRub: Fn;
  plural: Fn;
  opSign: Fn;
  balanceOf: Fn;
  openShift: Fn;
  drawerFor: Fn;
  unitTitle: Fn;
  nameOf: Fn;
};
interface RefDb extends CashDb {
  spa: { appointments: { status: string }[] };
}
type RefView = { cash: unknown; seq: number; events: { text: string; to: string[] }[] };
type RefAdapter = Record<string, (...a: unknown[]) => Promise<{ data: unknown; db: RefView }>> & {
  setActor(memberId: string | null, tenantId?: string): void;
};
interface RefMockData {
  seed(): RefDb;
  seedLotos(platform: unknown): RefDb;
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let M: unknown;
let RC: RefCash;
let MD: RefMockData;
let createMockAdapter: () => RefAdapter;

beforeAll(async () => {
  M = await referenceModels<Record<string, unknown>>();
  RC = await importReference<RefCash>('cash.js');
  MD = await importReference<RefMockData>('mock-data.js');
  ({ createMockAdapter } = await importReference<{ createMockAdapter: () => RefAdapter }>(
    'api.js',
  ));
});

const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x ?? null)) as unknown;
/** JSON с временем суток, сведённым к `ЧЧ:ММ` (в эталоне — `new Date()`, в домене — часы). */
const norm = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x ?? null).replace(/\d{2}:\d{2}/g, 'HH:MM')) as unknown;

/** Снимок 19.10 добавил модуль «Обучение» в роли: в домене его ещё нет (этап 7), касса его не трогает. */
const noLearning = (roles: { actions: Record<string, unknown> }[]): unknown => {
  const out = json(roles) as { actions: Record<string, unknown> }[];
  for (const r of out) delete r.actions['learning'];
  return out;
};

const refAlta = (): RefDb => {
  const db = MD.seed();
  RC.installCash(db, M);
  return db;
};
const refLotos = (): RefDb => {
  const l = MD.seedLotos(MD.seed().platform);
  RC.installCash(l, M);
  return l;
};

describe('справочники и чистые функции = cash.js', () => {
  it.each([
    ['KIND', D.KIND],
    ['MODE', D.MODE],
    ['KKT', D.KKT],
    ['OP', D.OP],
    ['REQ_LABEL', D.REQ_LABEL],
    ['METHOD', D.METHOD],
    ['METHODS_OF', D.METHODS_OF],
    ['CATS', D.CATS],
    ['DENOMS', D.DENOMS],
    ['PRICE', D.PRICE],
    ['CASH_OPT0', D.CASH_OPT0],
    ['VERB_TEXT', D.VERB_TEXT],
  ] as const)('%s', (name, ours) => {
    expect(json(ours)).toEqual(RC[name]);
  });

  it('CASH_DAY эталона = демо-день часов домена', () => {
    expect(RC['CASH_DAY']).toBe('01.10');
  });

  it('dueState, parseSum, rub, signRub, plural, opSign', () => {
    for (const d of [
      null,
      undefined,
      '',
      '30.09',
      '01.10',
      '02.10',
      '03.10',
      '15.01',
      '31.12',
      'abc',
      '1.1',
    ]) {
      expect(D.dueState(d as never)).toBe(RC.dueState(d));
    }
    for (const v of [
      '1 500,50',
      '1 500 ₽',
      '12.346',
      '1,2,3',
      'abc',
      '',
      null,
      undefined,
      0,
      100,
      '-5',
      '0,005',
      ' 7 ',
    ]) {
      expect(D.parseSum(v)).toEqual(RC.parseSum(v));
    }
    for (const n of [0, 1, 650, 1500.5, 26840, 1284000, -60, 0.1 + 0.2]) {
      expect(D.rub(n)).toBe(RC.rub(n));
      expect(D.signRub(n)).toBe(RC.signRub(n));
    }
    for (let n = 0; n <= 130; n++) {
      expect(D.plural(n, 'а', 'б', 'в')).toBe(RC.plural(n, 'а', 'б', 'в'));
    }
    for (const o of [
      { type: 'out' },
      { type: 'in' },
      { type: 'adjust', sign: -1 },
      { type: 'storno', sign: 1 },
      { type: 'zzz' },
      { type: 'adjust' },
    ]) {
      expect(D.opSign(o as never)).toBe(RC.opSign(o));
    }
  });

  it('nameOf, unitTitle, balanceOf, openShift, drawerFor на одной БД', () => {
    const ref = refAlta();
    const db = altaCash();
    for (const id of ['m-owner', 'm-zzz']) expect(D.nameOf(db, id)).toBe(RC.nameOf(ref, id));
    for (const id of [null, 'spa', 'f-msk-sever', 'zzz'])
      expect(D.unitTitle(db, id)).toBe(RC.unitTitle(ref, id));
    for (const a of ref.cash.accounts) {
      expect(D.balanceOf(db.cash, a.id)).toBe(RC.balanceOf(ref.cash, a.id));
      expect(json(D.openShift(db.cash, a.id))).toEqual(json(RC.openShift(ref.cash, a.id)));
    }
    for (const u of [null, 'spa', 'f-msk-sever', 'zzz']) {
      expect(json(D.drawerFor(db.cash, u))).toEqual(json(RC.drawerFor(ref.cash, u)));
    }
  });
});

describe('сид и установка = эталон', () => {
  it('«Альта»: срез кассы, роли и назначения', () => {
    const ref = refAlta();
    const db = altaCash();
    expect(json(db.cash)).toEqual(json(ref.cash));
    expect(json(db.roles.filter((r) => r.actions.cash))).toEqual(
      noLearning(ref.roles.filter((r) => r.actions.cash)),
    );
    expect(json(db.assignments.filter((a) => a.id === 'a-cash1'))).toEqual(
      json(ref.assignments.filter((a) => a.id === 'a-cash1')),
    );
  });

  it('«Лотос»: старая касса переезжает в фирму', () => {
    const ref = refLotos();
    const db = lotosCash();
    expect(json(db.cash)).toEqual(json(ref.cash));
    expect(json(db.roles.find((r) => r.id === 'r-admin'))).toEqual(
      json(ref.roles.find((r) => r.id === 'r-admin')),
    );
    expect(json(db.roles.find((r) => r.id === 'r-cashier'))).toEqual(
      json(ref.roles.find((r) => r.id === 'r-cashier')),
    );
  });
});

const EXTRA: Assignment[] = [
  { id: 'x1', member: 'm-petrova', role: 'r-manager', scope: { type: 'region', id: 'r-msk' } },
  { id: 'x2', member: 'm-ilyin', role: 'r-manager', scope: { type: 'firm', id: 'f-msk-yug' } },
  { id: 'x3', member: 'm-akhmedov', role: 'r-driver', scope: { type: 'firm', id: 'f-msk-sever' } },
  { id: 'x4', member: 'm-kotelnikova', role: 'r-cashier', scope: { type: 'tenant' } },
  { id: 'x5', member: 'm-kotova', role: 'r-cashier', scope: { type: 'account', id: 'ca-sever' } },
  { id: 'x6', member: 'm-sokolov', role: 'r-free', scope: { type: 'tenant' } },
  { id: 'x7', member: 'm-vasiliev', role: 'r-manager', scope: { type: 'firm', id: 'f-msk-sever' } },
  { id: 'x8', member: 'm-gromov', role: 'r-manager', scope: { type: 'tenant' } },
];
const R_FREE = {
  id: 'r-free',
  name: 'Свободная',
  kind: 'custom',
  actions: { cash: ['review', 'settings'] },
  cash: { balance: false, out: null, refund: 100, advance: 0 },
  finance: { read: false, manage: false },
};

/** Одинаковая правка обеих БД: общий вид для проверок доступа, проекции и предложений. */
type Pair = { ref: RefDb; dom: CashDb };
const variants: [string, (p: Pair) => void][] = [
  ['сид', () => undefined],
  [
    'дополнительные назначения',
    ({ ref, dom }) => {
      for (const db of [ref, dom]) {
        db.roles.push(structuredClone(R_FREE) as never);
        db.assignments.push(...structuredClone(EXTRA));
      }
    },
  ],
  [
    'движение: сверка, перемещение в пути, просроченный подотчёт',
    ({ ref, dom }) => {
      for (const db of [ref, dom]) {
        const h = db.cash.shifts.find((x) => x.id === 'sh-117');
        if (h) {
          h.status = 'review';
          h.diff = { cash: -250, kktCash: 0, kktCard: 0, term: 0 };
          delete h.decision;
        }
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
        const a = db.cash.accounts.find((x) => x.id === 'ca-adv-vas');
        if (a) a.due = '30.09';
        db.cash.receipts.push({
          id: 'rc-9',
          account: 'ca-adv-akh',
          amount: 100,
          cat: 'Мойка',
          link: '',
          note: '',
          photo: true,
          by: 'm-akhmedov',
          at: '01.10 08:00',
          status: 'review',
        });
      }
    },
  ],
  [
    'ремонт включён, рейс принят, визиты завершены',
    ({ ref, dom }) => {
      const trips = [
        {
          id: 'Р-205',
          unit: 'f-msk-sever',
          status: 'accepted',
          driverName: 'Илья Васильев',
          expenses: [
            { id: 'ex-1', amount: 3000, category: 'fuel' },
            { id: 'ex-2', amount: 700, category: 'wash' },
            { id: 'ex-3', amount: 50, category: 'zzz' },
          ],
        },
      ];
      const appts = [
        {
          id: 'ap-1',
          status: 'done',
          client: 'Мария К.',
          service: 'Классический массаж',
          time: '10:00–11:00',
          room: 'Кабинет № 2',
        },
        {
          id: 'ap-2',
          status: 'done_pending',
          client: 'Ольга Р.',
          service: 'Новая услуга',
          time: '11:30–13:00',
          room: 'Кабинет № 2',
        },
        {
          id: 'ap-3',
          status: 'confirmed',
          client: 'Екатерина Л.',
          service: 'Массаж спины',
          time: '14:00–14:45',
          room: 'Кабинет № 2',
        },
      ];
      for (const db of [ref, dom]) {
        db.modules.repair = { enabled: true };
        db.modules.logistics = { enabled: true };
        Object.assign(db, {
          trips: structuredClone(trips),
          spa: { appointments: structuredClone(appts) },
        });
        db.assignments.push(...structuredClone(EXTRA));
        db.roles.push(structuredClone(R_FREE) as never);
      }
    },
  ],
];
const pair = (mod: (p: Pair) => void): Pair => {
  const p = { ref: refAlta(), dom: altaCash() };
  mod(p);
  return p;
};

describe('доступ = эталон на одной БД (все участники × все кассы)', () => {
  it.each(variants)('cashAccess, accCan, rightsText, cashPeople: %s', (_n, mod) => {
    const { ref, dom } = pair(mod);
    let n = 0;
    for (const m of ref.members) {
      for (const a of ref.cash.accounts) {
        const want = RC.cashAccess(ref, M, m.id, a);
        const got = cashAccess(dom, m.id, a);
        expect(json(got)).toEqual(json(want));
        expect(rightsText(got)).toBe(RC.rightsText(want));
        for (const v of ['view', 'create', 'edit', 'review', 'export', 'settings'] as const) {
          expect(accCan(got, v)).toBe(RC.accCan(want, v));
        }
        n++;
      }
    }
    expect(n).toBe(ref.members.length * 8);
    for (const a of ref.cash.accounts)
      expect(json(cashPeople(dom, a))).toEqual(json(RC.cashPeople(ref, M, a)));
  });
});

describe('проекция и предложения = эталон (все участники)', () => {
  it.each(variants)('cashView, cashProposals: %s', (_n, mod) => {
    const { ref, dom } = pair(mod);
    for (const m of ref.members) {
      const want = RC.cashView(ref, M, m.id, ref.cash) as Record<string, unknown>;
      const got = cashView(dom, m.id);
      expect(json(got)).toEqual(json(want));
      expect(json(cashProposals(dom, m.id))).toEqual(json(RC.cashProposals(ref, M, m.id)));
    }
  });

  it('вариант «ремонт включён…»: предложения от рейса, визитов и ремонта действительно есть', () => {
    const { dom } = pair(variants[3]?.[1] ?? (() => undefined));
    const keys = cashProposals(dom, 'm-owner').map((p) => p.key);
    expect(keys).toEqual([
      'pr-1',
      'pr-2',
      'pr-3',
      'pr-4',
      'tx:ex-1',
      'tx:ex-2',
      'tx:ex-3',
      'ap:ap-1',
      'ap:ap-2',
    ]);
  });
});

// ── Команды: те же шаги в эталоне и в домене ──

type Side = { res: unknown[]; viewOf(actor: string): unknown };
interface Step {
  actor: string;
  method: string;
  args: (s: Side) => unknown[];
}
const FORM = {
  counts: { 5000: 1, 2000: 1 },
  coins: 0,
  z: { no: '118', cash: 3000, card: 12000 },
  term: { card: 12000, sbp: 0 },
};
const result = (s: Side, i: number, key?: string): unknown => {
  const r = s.res[i];
  return key ? (r as Record<string, unknown> | undefined)?.[key] : r;
};
const STEPS: Step[] = [
  /* 0 */ {
    actor: 'm-morozova',
    method: 'cashPost',
    args: () => [
      {
        account: 'ca-spa',
        type: 'in',
        amount: 1200,
        basis: 'Продажа',
        receipt: { fd: '7001', kkt: '118', time: '12:00' },
      },
    ],
  },
  /* 1 */ {
    actor: 'm-morozova',
    method: 'cashPost',
    args: () => [
      {
        account: 'ca-spa',
        type: 'out',
        amount: 1500,
        basis: 'Ремонт кресла',
        cat: 'Мелкий ремонт',
      },
    ],
  },
  /* 2 */ { actor: 'm-owner', method: 'cashApprove', args: (s) => [result(s, 1, 'request'), true] },
  /* 3 */ {
    actor: 'm-owner',
    method: 'cashReverse',
    args: (s) => [result(s, 0, 'id'), 'ошибка ввода'],
  },
  /* 4 */ {
    actor: 'm-owner',
    method: 'cashPostProposal',
    args: () => [
      'pr-1',
      {
        receipt: { fd: '7002' },
        parts: [
          { method: 'cash', amount: 1000 },
          { method: 'card', amount: 1800 },
        ],
      },
    ],
  },
  /* 5 */ { actor: 'm-owner', method: 'cashDismiss', args: () => ['pr-2', 'нет оплаты'] },
  /* 6 */ {
    actor: 'm-owner',
    method: 'cashTransfer',
    args: () => [{ from: 'ca-sever', to: 'ca-safe', amount: 5000 }],
  },
  /* 7 */ { actor: 'm-owner', method: 'cashTransferAccept', args: (s) => [s.res[6], true] },
  /* 8 */ { actor: 'm-morozova', method: 'cashShiftClose', args: () => ['sh-118', FORM] },
  /* 9 */ {
    actor: 'm-owner',
    method: 'cashShiftReview',
    args: () => ['sh-118', 'accept', 'пересчитали дважды'],
  },
  /* 10 */ { actor: 'm-owner', method: 'cashShiftOpen', args: () => ['ca-spa', 5000] },
  /* 11 */ {
    actor: 'm-owner',
    method: 'cashIssue',
    args: () => [{ account: 'ca-adv-vas', amount: 2000, due: '06.10' }],
  },
  /* 12 */ {
    actor: 'm-vasiliev',
    method: 'cashTransferAccept',
    args: (s) => [result(s, 11, 'id'), true],
  },
  /* 13 */ {
    actor: 'm-vasiliev',
    method: 'cashReceipt',
    args: () => [
      { account: 'ca-adv-vas', amount: 700, cat: 'Парковка', photo: true, link: 'Рейс Р-210' },
    ],
  },
  /* 14 */ { actor: 'm-owner', method: 'cashReceiptDecide', args: (s) => [s.res[13], true] },
  /* 15 */ {
    actor: 'm-vasiliev',
    method: 'cashReturn',
    args: () => [{ account: 'ca-adv-vas', amount: 300 }],
  },
  /* 16 */ {
    actor: 'm-owner',
    method: 'cashTransferAccept',
    args: (s) => [s.res[15], false, 'не пришло'],
  },
  /* 17 */ {
    actor: 'm-vasiliev',
    method: 'cashReceipt',
    args: () => [{ account: 'ca-adv-vas', amount: 90, cat: 'Мойка', photo: true, redo: 'rc-4' }],
  },
  /* 18 */ {
    actor: 'm-owner',
    method: 'cashReceiptDecide',
    args: (s) => [s.res[17], false, 'нечитаемо'],
  },
  /* 19 */ {
    actor: 'm-owner',
    method: 'cashAccountCreate',
    args: () => [
      {
        kind: 'advance',
        name: 'Подотчёт · Тест',
        unit: 'f-msk-sever',
        member: 'm-akhmedov',
        limit: 9000,
      },
    ],
  },
  /* 20 */ {
    actor: 'm-owner',
    method: 'cashAccountCreate',
    args: () => [
      {
        kind: 'drawer',
        name: 'Касса Юг',
        unit: 'f-msk-yug',
        mode: 'open',
        kkt: 'manual',
        limit: '40 000',
        float: 3000,
        tol: 50,
      },
    ],
  },
  /* 21 */ {
    actor: 'm-owner',
    method: 'cashIssue',
    args: (s) => [{ account: s.res[19], amount: 1000, due: '07.10', from: 'ca-safe' }],
  },
  /* 22 */ { actor: 'm-owner', method: 'cashApprove', args: () => ['rq-1', false, 'нет бюджета'] },
  /* 23 */ { actor: 'm-owner', method: 'cashShiftOpen', args: (s) => [s.res[20], 3000] },
  /* 24 */ {
    actor: 'm-owner',
    method: 'cashPost',
    args: (s) => [
      {
        account: s.res[20],
        type: 'in',
        amount: 800,
        basis: 'Оплата',
        receipt: { none: true, reason: 'сбой ККТ' },
      },
    ],
  },
  /* 25 */ { actor: 'm-owner', method: 'cashLink', args: (s) => [result(s, 24, 'id'), 'pr-1'] },
];

type Outcome = { ok: unknown } | { code: string; message: string };

async function runRef(
  adapter: RefAdapter,
  st: Step,
  side: Side,
): Promise<{ out: Outcome; view: unknown }> {
  adapter.setActor(st.actor, 't-alta');
  const fn = adapter[st.method] as (...a: unknown[]) => Promise<{ data: unknown; db: RefView }>;
  try {
    const r = await fn(...st.args(side));
    side.res.push(r.data);
    return { out: { ok: r.data }, view: r.db.cash };
  } catch (e) {
    side.res.push(undefined);
    const err = e as { code: string; message: string; db: RefView };
    return { out: { code: err.code, message: err.message }, view: err.db.cash };
  }
}
function runDom(e: Env, st: Step, side: Side): { out: Outcome; view: unknown } {
  e.as(st.actor);
  const fn = e.api[st.method as keyof Env['api']] as unknown as (...a: unknown[]) => unknown;
  let out: Outcome;
  try {
    const data = fn(...st.args(side));
    side.res.push(data);
    out = { ok: data };
  } catch (err) {
    side.res.push(undefined);
    if (!(err instanceof ApiError)) throw err;
    out = { code: err.code, message: err.message };
  }
  return { out, view: cashView(e.db, st.actor) };
}

describe('команды = эталон (сквозной сценарий из 26 шагов)', () => {
  beforeAll(() => {
    // Задержки эталона `cmd(fn, ms)` в тесте не нужны: таймеры срабатывают сразу.
    vi.stubGlobal('setTimeout', (f: () => void) => {
      f();
      return 0;
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('результаты, ошибки и проекция участника после каждого шага; события в конце', async () => {
    const adapter = createMockAdapter();
    const dom = env(altaCash(), 'm-owner');
    const refSide: Side = { res: [], viewOf: () => null };
    const domSide: Side = { res: [], viewOf: () => null };
    const refused: number[] = [];
    for (const [i, st] of STEPS.entries()) {
      const a = await runRef(adapter, st, refSide);
      const b = runDom(dom, st, domSide);
      expect({ step: i, out: norm(b.out) }).toEqual({ step: i, out: norm(a.out) });
      expect({ step: i, view: norm(b.view) }).toEqual({ step: i, view: norm(a.view) });
      if ('code' in a.out) refused.push(i);
    }
    expect(STEPS.length).toBe(26);
    // Единственный ожидаемый отказ — шаг 25: предложение pr-1 уже проведено на шаге 4.
    expect(refused).toEqual([25]);

    // События участникам: тексты и получатели («Касса…» и «Подотчёт…»).
    for (const m of dom.db.members) {
      adapter.setActor(m.id, 't-alta');
      const v = await (adapter['load'] as unknown as (ms: number) => Promise<RefView>)(0);
      const want = v.events.filter((x) => /^(Касса|Подотчёт)/.test(x.text)).map((x) => x.text);
      const got = (dom.db.events ?? [])
        .filter((x) => x.to.includes(m.id) && /^(Касса|Подотчёт)/.test(x.text))
        .map((x) => x.text);
      expect({ member: m.id, events: got }).toEqual({ member: m.id, events: want });
    }
  });

  it('те же отказы: коды и тексты ошибок эталона', async () => {
    const adapter = createMockAdapter();
    const dom = env(altaCash(), 'm-owner');
    const bad: Step[] = [
      ['m-owner', 'cashPost', { account: 'zzz', type: 'in', amount: 1, basis: 'abc' }],
      ['m-kotova', 'cashPost', { account: 'ca-spa', type: 'in', amount: 1, basis: 'abc' }],
      ['m-owner', 'cashPost', { account: 'ca-adv-vas', type: 'out', amount: 1, basis: 'abc' }],
      ['m-vasiliev', 'cashPost', { account: 'ca-adv-vas', type: 'out', amount: 1, basis: 'abc' }],
      ['m-owner', 'cashPost', { account: 'ca-spa', type: 'zzz', amount: 1, basis: 'abc' }],
      ['m-owner', 'cashPost', { account: 'ca-spa', type: 'in', amount: 0, basis: 'abc' }],
      ['m-owner', 'cashPost', { account: 'ca-spa', type: 'in', amount: 5, basis: 'ab' }],
      ['m-owner', 'cashPost', { account: 'ca-spa', type: 'in', amount: 5, basis: 'abc' }],
      [
        'm-owner',
        'cashPost',
        {
          account: 'ca-spa',
          type: 'in',
          amount: 5,
          basis: 'abc',
          receipt: { none: true, reason: 'x' },
        },
      ],
      [
        'm-owner',
        'cashPost',
        {
          account: 'ca-spa',
          type: 'in',
          amount: 5,
          basis: 'abc',
          receipt: { fd: '4520', kkt: '118' },
        },
      ],
      [
        'm-owner',
        'cashPost',
        { account: 'ca-sever', type: 'out', amount: 5, basis: 'abc', method: 'card' },
      ],
      ['m-owner', 'cashPost', { account: 'ca-sever', type: 'out', amount: 40000, basis: 'abc' }],
      [
        'm-owner',
        'cashPost',
        { account: 'ca-spa', type: 'refund', amount: 5, basis: 'abc', receipt: { fd: '8001' } },
      ],
      [
        'm-owner',
        'cashPost',
        {
          account: 'ca-spa',
          type: 'refund',
          amount: 2000,
          basis: 'abc',
          ref: 'K-317',
          receipt: { fd: '8002' },
        },
      ],
      [
        'm-morozova',
        'cashPost',
        { account: 'ca-spa', type: 'refund', amount: 3500, basis: 'abc', ref: 'K-319' },
      ],
      ['m-owner', 'cashReverse', 'K-999', 'причина'],
      ['m-owner', 'cashReverse', 'K-326', 'аб'],
      ['m-owner', 'cashReverse', 'K-322', 'причина'],
      ['m-owner', 'cashReverse', 'K-319', 'причина'],
      ['m-morozova', 'cashReverse', 'K-326', 'причина'],
      ['m-owner', 'cashPostProposal', 'pr-zzz'],
      ['m-owner', 'cashPostProposal', 'pr-1'],
      [
        'm-owner',
        'cashPostProposal',
        'pr-1',
        { receipt: { fd: '8003' }, parts: [{ method: 'cash', amount: 100 }] },
      ],
      ['m-owner', 'cashDismiss', 'pr-1', 'а'],
      ['m-owner', 'cashDismiss', 'pr-zzz', 'причина'],
      ['m-owner', 'cashLink', 'K-326', 'pr-1'],
      ['m-owner', 'cashShiftOpen', 'ca-spa', 7350],
      ['m-owner', 'cashShiftOpen', 'ca-safe', 100],
      ['m-owner', 'cashShiftOpen', 'ca-sever', 100],
      ['m-owner', 'cashShiftClose', 'sh-117', FORM],
      ['m-owner', 'cashShiftClose', 'sh-118', { ...FORM, z: undefined }],
      ['m-owner', 'cashShiftClose', 'sh-118', { ...FORM, keep: 99999 }],
      ['m-owner', 'cashShiftReview', 'sh-118', 'accept', 'причина'],
      ['m-owner', 'cashTransfer', { from: 'ca-sever', to: 'ca-sever', amount: 1 }],
      ['m-owner', 'cashTransfer', { from: 'ca-adv-vas', to: 'ca-safe', amount: 1 }],
      ['m-owner', 'cashTransfer', { from: 'ca-sever', to: 'ca-safe', amount: 40000 }],
      ['m-kotova', 'cashTransfer', { from: 'ca-sever', to: 'ca-safe', amount: 1 }],
      ['m-owner', 'cashTransferAccept', 'tr-1', true],
      ['m-owner', 'cashIssue', { account: 'ca-spa', amount: 1, due: '05.10' }],
      ['m-owner', 'cashIssue', { account: 'ca-adv-vas', amount: 1, due: '5.10' }],
      ['m-owner', 'cashIssue', { account: 'ca-adv-vas', amount: 12000, due: '05.10' }],
      ['m-owner', 'cashIssue', { account: 'ca-adv-vas', amount: 40000, due: '05.10' }],
      ['m-vasiliev', 'cashIssue', { account: 'ca-adv-vas', amount: 1, due: '05.10' }],
      ['m-owner', 'cashReceipt', { account: 'ca-adv-vas', amount: 5, cat: 'Мойка', photo: true }],
      ['m-vasiliev', 'cashReceipt', { account: 'ca-adv-vas', amount: 5, cat: '', photo: true }],
      [
        'm-vasiliev',
        'cashReceipt',
        { account: 'ca-adv-vas', amount: 5, cat: 'Мойка', photo: false },
      ],
      ['m-owner', 'cashReceiptDecide', 'rc-2', true],
      ['m-vasiliev', 'cashReceiptDecide', 'rc-3', true],
      ['m-owner', 'cashReturn', { account: 'ca-adv-vas', amount: 1 }],
      ['m-vasiliev', 'cashReturn', { account: 'ca-adv-vas', amount: 5000 }],
      ['m-owner', 'cashApprove', 'rq-zzz', true],
      ['m-kotova', 'cashApprove', 'rq-1', true],
      ['m-owner', 'cashApprove', 'rq-1', false, 'аб'],
      ['m-owner', 'cashAccountCreate', { kind: 'zzz', name: 'Новая' }],
      ['m-owner', 'cashAccountCreate', { kind: 'drawer', name: 'а' }],
      ['m-owner', 'cashAccountCreate', { kind: 'advance', name: 'Новая' }],
      ['m-owner', 'cashAccountCreate', { kind: 'drawer', name: 'касса офиса' }],
      ['m-morozova', 'cashAccountCreate', { kind: 'drawer', name: 'Новая' }],
    ].map(([actor, method, ...rest]) => ({
      actor: actor as string,
      method: method as string,
      args: () => rest,
    }));
    const refSide: Side = { res: [], viewOf: () => null };
    const domSide: Side = { res: [], viewOf: () => null };
    const codes: string[] = [];
    for (const [i, st] of bad.entries()) {
      const a = await runRef(adapter, st, refSide);
      const b = runDom(dom, st, domSide);
      expect({ i, out: norm(b.out) }).toEqual({ i, out: norm(a.out) });
      codes.push('code' in a.out ? a.out.code : 'ok');
    }
    // Набор отказов покрывает все четыре кода команд кассы.
    expect(new Set(codes)).toEqual(new Set(['not_found', 'forbidden', 'validation', 'conflict']));
  });
});

describe('намеренные расхождения с эталоном', () => {
  it('canSettings: роль объекта «Настраивать» на кассу даёт право в эталоне, но не в домене (PD-53)', () => {
    const pairDb = { ref: refAlta(), dom: altaCash() };
    pairDb.ref.roles.push({
      id: 'r-set',
      name: 'Н',
      kind: 'custom',
      actions: { cash: ['view', 'settings'] },
      finance: { read: false, manage: false },
    } as never);
    pairDb.ref.assignments.push({
      id: 'z1',
      member: 'm-petrova',
      role: 'r-set',
      scope: { type: 'account', id: 'ca-spa' },
    });
    grantCash(pairDb.dom, 'm-petrova', ['view', 'settings'], { type: 'account', id: 'ca-spa' });
    const ref = RC.cashView(pairDb.ref, M, 'm-petrova', pairDb.ref.cash) as {
      canSettings: boolean;
    };
    expect(ref.canSettings).toBe(true);
    expect(cashView(pairDb.dom, 'm-petrova')?.canSettings).toBe(false);
  });

  it('cashShiftReview(recount): эталон уведомляет открывшего смену, домен — закрывшего', async () => {
    vi.stubGlobal('setTimeout', (f: () => void) => {
      f();
      return 0;
    });
    try {
      const adapter = createMockAdapter();
      adapter.setActor('m-owner', 't-alta');
      // Закрывает Васильев-менеджер: нужен второй сотрудник с «Создавать»; в обеих БД роль даёт owner.
      await adapter['assign']?.({
        memberId: 'm-petrova',
        roleId: 'r-manager',
        scope: { type: 'tenant' },
      });
      adapter.setActor('m-petrova', 't-alta');
      await adapter['cashShiftClose']?.('sh-118', FORM);
      adapter.setActor('m-owner', 't-alta');
      await adapter['cashShiftReview']?.('sh-118', 'recount', 'перепроверьте');
      adapter.setActor('m-morozova', 't-alta');
      const refEvents = (
        await (adapter['load'] as unknown as (ms: number) => Promise<RefView>)(0)
      ).events.filter((x) => x.text.includes('вернули на пересчёт'));
      adapter.setActor('m-petrova', 't-alta');
      const refPetrova = (
        await (adapter['load'] as unknown as (ms: number) => Promise<RefView>)(0)
      ).events.filter((x) => x.text.includes('вернули на пересчёт'));
      expect([refEvents.length, refPetrova.length]).toEqual([1, 0]);

      const db = altaCash([
        { id: 'x1', member: 'm-petrova', role: 'r-manager', scope: { type: 'tenant' } },
      ]);
      const e = env(db, 'm-petrova');
      e.api.cashShiftClose('sh-118', FORM);
      e.as('m-owner');
      e.api.cashShiftReview('sh-118', 'recount', 'перепроверьте');
      const ev = (db.events ?? []).find((x) => x.text.includes('вернули на пересчёт'));
      expect(ev?.to).toEqual(['m-petrova']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('команда атомарна: отказ по причине не оставляет следов (в эталоне статус чека уже «rejected»)', async () => {
    vi.stubGlobal('setTimeout', (f: () => void) => {
      f();
      return 0;
    });
    try {
      const adapter = createMockAdapter();
      adapter.setActor('m-owner', 't-alta');
      const err = await adapter['cashReceiptDecide']?.('rc-3', false, 'аб').catch(
        (e: unknown) => e,
      );
      expect((err as { code: string }).code).toBe('validation');
      const refStatus = (
        err as { db: { cash: { receipts: { id: string; status: string }[] } } }
      ).db.cash.receipts.find((c) => c.id === 'rc-3')?.status;
      expect(refStatus).toBe('rejected');
      const e = env();
      expect(() => e.api.cashReceiptDecide('rc-3', false, 'аб')).toThrow(ApiError);
      expect(e.db.cash.receipts.find((c) => c.id === 'rc-3')?.status).toBe('review');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cashAccountCreate: роль региона не заводит кассу вне региона (в эталоне — любую)', () => {
    const db = altaCash();
    grantCash(db, 'm-petrova', ['view', 'settings'], { type: 'region', id: 'r-msk' });
    const e = env(db, 'm-petrova');
    expect(() =>
      e.api.cashAccountCreate({ kind: 'drawer', name: 'Нева', unit: 'f-spb-neva' }),
    ).toThrow(ApiError);
  });
});
