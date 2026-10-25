// Проекция «Кассы» для участника (cash.js 14.10/19.10:126–174): ответ сервера содержит кассы его
// области, остаток — только с правом, смены, перемещения, чеки, заявки, предложения и список
// «Требует решения» для «Главной». `today` — «сегодня» по часам домена (`ДД.ММ`) для сроков отчёта.
import { can } from '../../core/access/can.ts';
import { DEMO } from '../../core/clock.ts';
import { accCan, canAcceptTransfer, cashAccess, rightsText } from './access.ts';
import {
  REQ_LABEL,
  balanceOf,
  dueState,
  nameOf,
  openShift,
  plural,
  rub,
  signRub,
} from './dictionaries.ts';
import { cashProposals } from './proposals.ts';
import type {
  AdvanceReceipt,
  CashAccount,
  CashOp,
  CashOpts,
  CashProposalRow,
  CashRequest,
  CashShift,
  CashShiftDecision,
  CashTenantDb,
  CashTransfer,
  CashVerb,
} from './types.ts';

export interface CashAccountMy {
  all: boolean;
  own: boolean;
  verbs: readonly CashVerb[];
  opt: CashOpts;
  via: string;
  rights: string;
}

/** Касса в ответе: остаток — `null`, если у роли нет права его видеть. */
export type CashAccountView = CashAccount & {
  balance: number | null;
  shift: string | null;
  respName: string;
  memberName: string;
  my: CashAccountMy;
};

export type CashOpView = CashOp & { byName: string; approvedName: string; canReverse: boolean };

export type CashShiftView = Omit<CashShift, 'decision'> & {
  decision?: CashShiftDecision & { byName?: string };
  openedName: string;
  closedName: string;
  expectedNow?: number;
  hiddenCalc?: true;
  my: { seesBal: boolean; canClose: boolean; canReview: boolean };
};

export type CashTransferView = CashTransfer & {
  byName: string;
  fromName: string;
  toName: string;
  my: { canAccept: boolean };
};

export type AdvanceReceiptView = AdvanceReceipt & {
  byName: string;
  decidedName: string;
  my: { canDecide: boolean };
};

export type CashRequestView = CashRequest & {
  byName: string;
  decidedName: string;
  approvers: string[];
  my: { canDecide: boolean; mine: boolean };
};

/** Пункт «Требует решения» на «Главной». `open` — ключ открытия раздела («Касса» → вкладка). */
export interface CashTodoItem {
  tone: 'danger' | 'warn' | 'info' | 'neutral';
  icon: string;
  label: string;
  title: string;
  text: string;
  action: string;
  open: string;
  n?: number;
}

export interface CashView {
  v1: true;
  hidden: boolean;
  accounts: CashAccountView[];
  ops: CashOpView[];
  shifts: CashShiftView[];
  transfers: CashTransferView[];
  receipts: AdvanceReceiptView[];
  requests: CashRequestView[];
  proposals: CashProposalRow[];
  todo: CashTodoItem[];
  badge: number;
  canSettings: boolean;
}

const HIDDEN: CashView = {
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
};

/** Проекция кассы для `actor`; `null` — модуль не установлен (или срез старого вида). */
export function cashView(
  db: CashTenantDb,
  actor: string,
  opts: { today?: string } = {},
): CashView | null {
  const X = db.cash;
  if (!X?.v1) return null;
  const today = opts.today ?? DEMO.cashDay;
  const R = new Map(X.accounts.map((a) => [a.id, cashAccess(db, actor, a)]));
  const vis = X.accounts.filter((a) => R.get(a.id)?.ok);
  if (!vis.length) return structuredClone(HIDDEN);
  const ids = new Set(vis.map((a) => a.id));
  const nm = (id: string) => nameOf(db, id);
  const accName = (id: string) => X.accounts.find((a) => a.id === id)?.name ?? '—';
  const can_ = (id: string, v: CashVerb) => accCan(R.get(id), v);
  const bal = (id: string) => {
    const r = R.get(id);
    return !!(r?.ok && r.opt.balance);
  };
  const isAll = (id: string) => {
    const r = R.get(id);
    return !!(r?.ok && r.all);
  };
  const own = (id: string) => {
    const r = R.get(id);
    return !!(r?.ok && r.own);
  };
  const self = (id: string) => {
    const r = R.get(id);
    return !!(r?.ok && r.opt.self);
  };

  const accounts: CashAccountView[] = vis.flatMap((a) => {
    const r = R.get(a.id);
    if (!r?.ok) return [];
    const sh = openShift(X, a.id);
    return [
      {
        ...structuredClone(a),
        balance: bal(a.id) ? balanceOf(X, a.id) : null,
        shift: sh ? sh.id : null,
        respName: a.resp ? nm(a.resp) : '',
        memberName: a.member ? nm(a.member) : '',
        my: {
          all: r.all,
          own: r.own,
          verbs: r.verbs,
          opt: r.opt,
          via: r.via,
          rights: rightsText(r),
        },
      },
    ];
  });
  const ops: CashOpView[] = X.ops
    .filter((o) => ids.has(o.account))
    .map((o) => ({
      ...structuredClone(o),
      byName: nm(o.by),
      approvedName: o.approvedBy ? nm(o.approvedBy) : '',
      canReverse:
        can_(o.account, 'review') &&
        !o.reversedBy &&
        o.type !== 'storno' &&
        !['move_in', 'move_out'].includes(o.type) &&
        (isAll(o.account) || o.by !== actor),
    }));
  const shifts: CashShiftView[] = X.shifts
    .filter((h) => ids.has(h.account))
    .map((h) => {
      const x = structuredClone(h) as CashShiftView & Partial<CashShift>;
      const b = bal(h.account);
      x.openedName = nm(h.openedBy);
      x.closedName = h.closedBy ? nm(h.closedBy) : '';
      if (x.decision?.by) x.decision.byName = nm(x.decision.by);
      if (h.status === 'open' && b) x.expectedNow = balanceOf(X, h.account);
      if (!b) {
        delete x.expected;
        delete x.diff;
        delete x.openDiff;
        x.hiddenCalc = true;
      }
      x.my = {
        seesBal: b,
        canClose: h.status === 'open' && can_(h.account, 'create'),
        canReview: h.status === 'review' && b && can_(h.account, 'review') && h.closedBy !== actor,
      };
      return x;
    });
  const transfers: CashTransferView[] = X.transfers
    .filter((t) => ids.has(t.from) || ids.has(t.to))
    .map((t) => ({
      ...structuredClone(t),
      byName: nm(t.by),
      fromName: accName(t.from),
      toName: accName(t.to),
      my: { canAccept: t.status === 'transit' && canAcceptTransfer(db, actor, X, t) },
    }));
  const receipts: AdvanceReceiptView[] = X.receipts
    .filter((c) => ids.has(c.account))
    .map((c) => ({
      ...structuredClone(c),
      byName: nm(c.by),
      decidedName: c.decidedBy ? nm(c.decidedBy) : '',
      my: {
        canDecide:
          c.status === 'review' && can_(c.account, 'edit') && !own(c.account) && !self(c.account),
      },
    }));
  const requests: CashRequestView[] = X.requests
    .filter((q) => ids.has(q.account) && (q.by === actor || can_(q.account, 'review')))
    .map((q) => {
      const acc = X.accounts.find((a) => a.id === q.account);
      return {
        ...structuredClone(q),
        byName: nm(q.by),
        decidedName: q.decidedBy ? nm(q.decidedBy) : '',
        approvers: acc
          ? db.members
              .filter(
                (m) =>
                  m.status === 'active' &&
                  m.id !== q.by &&
                  accCan(cashAccess(db, m.id, acc), 'review'),
              )
              .map((m) => m.name)
          : [],
        my: {
          canDecide: q.status === 'pending' && can_(q.account, 'review') && q.by !== actor,
          mine: q.by === actor,
        },
      };
    });
  const proposals = cashProposals(db, actor);
  const out: CashView = {
    v1: true,
    hidden: false,
    accounts,
    ops,
    shifts,
    transfers,
    receipts,
    requests,
    proposals,
    todo: [],
    badge: 0,
    canSettings: can(db, actor, 'cash', 'settings').ok,
  };
  out.todo = cashTodo(out, today);
  out.badge = out.todo.reduce((n, t) => n + (t.n || 1), 0);
  return out;
}

const PROPOSAL_GROUP: Readonly<Record<string, string>> = {
  spa: 'визиты',
  logistics: 'возмещения',
  service: 'возвраты',
  repair: 'объекты',
};

/** «Требует решения» на «Главной»: только то, что этот сотрудник может решить сам. */
export function cashTodo(
  V: Pick<CashView, 'accounts' | 'shifts' | 'requests' | 'transfers' | 'receipts' | 'proposals'>,
  today: string = DEMO.cashDay,
): CashTodoItem[] {
  const A = (id: string) => V.accounts.find((a) => a.id === id) ?? { name: '—', tol: 0 };
  const out: CashTodoItem[] = [];
  for (const h of V.shifts.filter((x) => x.my.canReview)) {
    out.push({
      tone: 'danger',
      icon: 'point_of_sale',
      label: 'Касса · сверка',
      title:
        'Смена ' + h.no + ' · ' + A(h.account).name + ': расхождение ' + signRub(h.diff?.cash ?? 0),
      text: 'Выше допуска ' + rub(A(h.account).tol || 0) + ' · закрыл(а) ' + h.closedName,
      action: 'Решить',
      open: 'sh:' + h.id,
    });
  }
  for (const q of V.requests.filter((x) => x.my.canDecide)) {
    out.push({
      tone: 'warn',
      icon: 'approval',
      label: 'Касса · согласовать',
      title: REQ_LABEL[q.type] + ' ' + rub(q.amount) + ' · ' + A(q.account).name,
      text: q.basis + ' · ' + q.byName + ' · без согласования до ' + rub(q.limit),
      action: 'Решить',
      open: 'rq:' + q.id,
    });
  }
  for (const t of V.transfers.filter((x) => x.my.canAccept)) {
    out.push({
      tone: 'info',
      icon: 'move_down',
      label: 'Касса · принять',
      title: rub(t.amount) + ' из «' + t.fromName + '» в «' + t.toName + '»',
      text: t.note + ' · передал(а) ' + t.byName,
      action: 'Принять',
      open: 'tr:' + t.id,
    });
  }
  for (const c of V.receipts.filter((x) => x.my.canDecide)) {
    out.push({
      tone: 'info',
      icon: 'receipt_long',
      label: 'Подотчёт · чек',
      title: c.byName + ': ' + c.cat + ' ' + rub(c.amount),
      text: (c.link ? c.link + ' · ' : '') + 'чек на проверке с ' + c.at,
      action: 'Проверить',
      open: 'adv:' + c.account,
    });
  }
  for (const a of V.accounts.filter(
    (x) =>
      x.kind === 'advance' &&
      !x.my.own &&
      accCan({ ok: true, ...x.my }, 'edit') &&
      (x.balance ?? 0) > 0 &&
      dueState(x.due, today) === 'late',
  )) {
    out.push({
      tone: 'warn',
      icon: 'event_busy',
      label: 'Подотчёт · срок',
      title: a.memberName + ': не отчитался(ась) за ' + rub(a.balance ?? 0),
      text: 'Срок отчёта ' + a.due + ' прошёл',
      action: 'Открыть',
      open: 'adv:' + a.id,
    });
  }
  if (V.proposals.length) {
    const by: Record<string, number> = {};
    for (const p of V.proposals) {
      const k = PROPOSAL_GROUP[p.mod ?? ''] ?? 'прочее';
      by[k] = (by[k] ?? 0) + 1;
    }
    out.push({
      tone: 'neutral',
      icon: 'inbox',
      label: 'Касса · входящие',
      title:
        plural(V.proposals.length, 'предложение', 'предложения', 'предложений') + ' к проведению',
      text: Object.entries(by)
        .map(([k, n]) => k + ' · ' + n)
        .join(', '),
      action: 'Открыть',
      open: 'inbox',
      n: V.proposals.length,
    });
  }
  return out;
}
