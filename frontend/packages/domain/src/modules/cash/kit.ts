// Общие помощники команд кассы (cash.js 14.10/19.10:276–325): доступ к кассе, проверки сумм и
// причин, чек ККТ, запись операции, заявка на согласование, перемещение. Все деньги проходят
// через `write` и `transfer`: операции не удаляются, ошибку исправляет сторно.
import { ddmm, hhmm } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import type { ModuleCtx } from '../../core/module.ts';
import { accCan, cashAccess } from './access.ts';
import {
  METHOD,
  METHODS_OF,
  OP,
  REQ_LABEL,
  balanceOf,
  nameOf,
  openShift,
  parseSum,
  rub,
} from './dictionaries.ts';
import type {
  CashAccessResult,
  CashAccount,
  CashMethod,
  CashOp,
  CashOpReceipt,
  CashOpType,
  CashRequest,
  CashRequestSpec,
  CashSlice,
  CashSrc,
  CashTenantDb,
  CashTransfer,
  CashVerb,
  ReceiptInput,
} from './types.ts';

export type { ReceiptInput };

export type CashAccessOk = Extract<CashAccessResult, { ok: true }>;

/** Задание на запись операции (внутренний вход `write`). */
export interface WriteSpec {
  type: CashOpType;
  amount: number;
  method: CashMethod;
  cat?: string;
  basis: string;
  src?: CashSrc | null;
  ref?: string | null;
  receipt?: ReceiptInput | CashOpReceipt | null;
  /** Уже проверенный чек (оплата по частям: чек один на все части). */
  receiptFixed?: CashOpReceipt | null;
  group?: string | null;
  by?: string;
  approvedBy?: string | null;
}

const RESTRICTED =
  'Пробный период завершён: новые операции недоступны. История доступна для чтения.';

type PlatformDb = { platform?: { tenants: { id: string; status: string }[] } };

export function createKit(ctx: ModuleCtx) {
  const D = (): CashTenantDb => ctx.getDb() as CashTenantDb;
  const me = (): string => ctx.getActor() ?? '';
  const X = (): CashSlice => {
    const x = D().cash;
    if (!x?.v1) throw new ApiError('not_found', 'Модуль «Касса» не подключён');
    return x;
  };
  const acc = (id: string): CashAccount => {
    const a = X().accounts.find((x) => x.id === id);
    if (!a) throw new ApiError('not_found', 'Касса не найдена');
    return a;
  };
  /** Доступ к кассе: не найдена (`not_found`) или нет права (`forbidden`). */
  const need = (a: CashAccount, verb?: CashVerb, why?: string): CashAccessOk => {
    const r = cashAccess(D(), me(), a);
    if (!r.ok) throw new ApiError('not_found', 'Касса «' + a.name + '» недоступна: ' + r.why);
    if (verb && !accCan(r, verb)) {
      throw new ApiError('forbidden', why || 'Недостаточно прав в кассе «' + a.name + '»');
    }
    return r;
  };
  const active = (): void => {
    const db = D() as CashTenantDb & PlatformDb;
    const t = db.platform?.tenants.find((x) => x.id === db.tenantId);
    if (t && ['restricted', 'suspended'].includes(t.status)) {
      throw new ApiError('subscription_restricted', RESTRICTED);
    }
  };
  const nid = (p: string): string => ctx.ids.next(p);
  const now = (): string => ddmm(ctx.clock) + ' ' + hhmm(ctx.clock);
  const who = (a: CashAccount, verb: CashVerb, but?: string): string[] =>
    D()
      .members.filter(
        (m) => m.status === 'active' && m.id !== but && accCan(cashAccess(D(), m.id, a), verb),
      )
      .map((m) => m.id);
  const sum = (v: unknown, label?: string): number => {
    const n = parseSum(v);
    if (!(n > 0))
      throw new ApiError('validation', (label || 'Сумма') + ': укажите число больше нуля');
    return n;
  };
  const reason = (v: unknown, label?: string): string => {
    const t = String(v || '').trim();
    if (t.length < 3) throw new ApiError('validation', label || 'Укажите причину');
    return t;
  };
  const push = (
    o: Partial<CashOp> & Pick<CashOp, 'account' | 'type' | 'amount' | 'basis'>,
  ): CashOp => {
    const x: CashOp = {
      id: ctx.ids.next('K-', 300),
      at: ddmm(ctx.clock),
      time: hhmm(ctx.clock),
      by: me(),
      method: 'cash',
      cat: '',
      src: null,
      ref: null,
      receipt: null,
      shift: null,
      group: null,
      ...o,
    };
    X().ops.unshift(x);
    return x;
  };
  /** Касса-ящик: у эквайринга смены ведёт привязанная к нему касса. */
  const drawerOf = (a: CashAccount): CashAccount =>
    a.kind === 'acquiring' && a.drawer ? acc(a.drawer) : a;
  const shiftFor = (a: CashAccount): string | null => {
    const d = drawerOf(a);
    if (d.kind !== 'drawer' || d.mode === 'none') return null;
    const h = openShift(X(), d.id);
    if (!h) {
      throw new ApiError(
        'validation',
        'Смена в «' + d.name + '» закрыта — откройте смену, чтобы проводить оплаты',
      );
    }
    return h.id;
  };
  /** Лимит роли без согласования для вида операции; `null` — без лимита. */
  const limitOf = (r: CashAccessOk, type: string): number | null =>
    r.all
      ? null
      : type === 'out'
        ? r.opt.out
        : type === 'refund'
          ? r.opt.refund
          : type === 'issue'
            ? r.opt.advance
            : null;
  const receiptOf = (
    a: CashAccount,
    type: string,
    rc?: ReceiptInput | CashOpReceipt | null,
  ): CashOpReceipt | null => {
    const r = (rc || {}) as ReceiptInput;
    const fiscal = (type === 'in' || type === 'refund') && drawerOf(a).kkt === 'manual';
    if (!fiscal) return r.seller ? { seller: true } : null;
    if (r.none)
      return { none: true, reason: reason(r.reason, 'Чек не пробивали — укажите причину') };
    const fd = String(r.fd || '').trim();
    const kkt = String(r.kkt || '').trim();
    if (!/^\d{1,10}$/.test(fd)) {
      throw new ApiError(
        'validation',
        'Укажите № ФД из чека: цифры, до 10 знаков. Если чек не пробивали — отметьте это и укажите причину',
      );
    }
    const dupe = X().ops.find((o) => {
      const f = o.receipt as { fd?: string; kkt?: string } | null;
      return f?.fd === fd && (f.kkt || '') === kkt && !o.reversedBy;
    });
    if (dupe) {
      throw new ApiError(
        'conflict',
        'Чек № ФД ' +
          fd +
          (kkt ? ' (смена ККТ ' + kkt + ')' : '') +
          ' уже внесён: ' +
          dupe.id +
          ' · ' +
          dupe.basis,
      );
    }
    return { fd, kkt, time: String(r.time || '').trim() };
  };
  /** Единственный путь денег по операциям: проверка способа, остатка, возврата, смены и чека. */
  const write = (a: CashAccount, s: WriteSpec): CashOp => {
    if (!(METHODS_OF[a.kind] || ['cash']).includes(s.method)) {
      throw new ApiError(
        'validation',
        (METHOD[s.method] || { label: 'Этот способ' }).label + ' не принимается в «' + a.name + '»',
      );
    }
    if (
      OP[s.type].sign < 0 &&
      ['drawer', 'safe'].includes(a.kind) &&
      balanceOf(X(), a.id) - s.amount < 0
    ) {
      throw new ApiError(
        'validation',
        'В «' + a.name + '» нет столько наличных: остаток ушёл бы в минус',
      );
    }
    if (s.type === 'refund') {
      const o = X().ops.find((x) => x.id === s.ref);
      if (!o || o.type !== 'in') {
        throw new ApiError(
          'validation',
          'Возврат проводится по оплате — выберите операцию прихода',
        );
      }
      const done = X()
        .ops.filter((x) => x.type === 'refund' && x.ref === o.id && !x.reversedBy)
        .reduce((t, x) => t + x.amount, 0);
      if (done + s.amount > o.amount) {
        throw new ApiError(
          'validation',
          'Возвратов по ' + o.id + ' больше оплаты: доступно ' + rub(o.amount - done),
        );
      }
    }
    const shift = shiftFor(a);
    const receipt = s.receiptFixed !== undefined ? s.receiptFixed : receiptOf(a, s.type, s.receipt);
    return push({
      account: a.id,
      type: s.type,
      amount: s.amount,
      method: s.method,
      cat: s.cat || '',
      basis: s.basis,
      src: s.src || null,
      ref: s.ref || null,
      receipt,
      shift,
      group: s.group || null,
      by: s.by || me(),
      approvedBy: s.approvedBy || null,
    });
  };
  /** Заявка на согласование: операция выше лимита роли; согласующим — событие. */
  const request = (a: CashAccount, spec: CashRequestSpec, lim: number): CashRequest => {
    const q: CashRequest = {
      id: nid('rq-'),
      account: a.id,
      ...spec,
      by: me(),
      at: now(),
      status: 'pending',
      limit: lim,
    };
    X().requests.unshift(q);
    ctx.emit(
      'Касса: ' +
        nameOf(D(), me()) +
        ' просит согласовать ' +
        REQ_LABEL[spec.type].toLowerCase() +
        ' ' +
        rub(spec.amount) +
        ' · ' +
        a.name,
      who(a, 'review', me()),
    );
    return q;
  };
  /** Перемещение: списание сразу, зачисление — когда получатель примет. */
  const transfer = (
    from: CashAccount,
    to: CashAccount,
    amount: number,
    note: string,
    shiftId?: string | null,
    by?: string,
  ): CashTransfer => {
    const t: CashTransfer = {
      id: nid('tr-'),
      from: from.id,
      to: to.id,
      amount,
      note,
      by: by || me(),
      at: now(),
      status: 'transit',
    };
    const own = from.kind === 'drawer' && from.mode !== 'none' ? openShift(X(), from.id) : null;
    const sh = shiftId || (own ? own.id : null);
    t.outOp = push({
      account: from.id,
      type: 'move_out',
      amount,
      method: 'cash',
      cat: 'Перемещение',
      basis: note + ' → «' + to.name + '»',
      tr: t.id,
      shift: sh,
      by: t.by,
    }).id;
    X().transfers.unshift(t);
    ctx.emit(
      'Касса: ' + rub(amount) + ' в пути в «' + to.name + '» — ' + note,
      (to.kind === 'advance' && to.member ? [to.member] : who(to, 'edit')).filter(
        (id) => id !== me(),
      ),
    );
    return t;
  };
  /** Команда целиком или ничего: при исключении срез кассы, счётчик id и события возвращаются. */
  const atomic = <T>(fn: () => T): T => {
    const db = D();
    const cash = db.cash;
    const snap = cash ? structuredClone(cash) : null;
    const seq = db.seq;
    const events = db.events?.length ?? 0;
    try {
      return fn();
    } catch (e) {
      if (cash && snap) {
        for (const k of Object.keys(cash)) Reflect.deleteProperty(cash, k);
        Object.assign(cash, snap);
      }
      db.seq = seq;
      if (db.events) db.events.splice(0, db.events.length - events);
      throw e;
    }
  };

  return {
    ctx,
    D,
    me,
    X,
    acc,
    need,
    active,
    nid,
    now,
    who,
    sum,
    reason,
    push,
    drawerOf,
    shiftFor,
    limitOf,
    receiptOf,
    write,
    request,
    transfer,
    atomic,
  };
}

export type Kit = ReturnType<typeof createKit>;
