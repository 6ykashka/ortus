// Подотчёт сотрудников (cash.js 14.10/19.10:479–529): выдача деньгами из кассы, чеки держателя и
// их проверка, возврат остатка. Деньги подотчёта живут на отдельной кассе вида `advance`.
import { ApiError } from '../../core/errors/index.ts';
import { balanceOf, nameOf, rub } from './dictionaries.ts';
import type { Kit } from './kit.ts';
import type { AdvanceReceipt } from './types.ts';

export interface CashIssueInput {
  account?: string;
  /** Касса-источник; по умолчанию — касса, из которой пополняется подотчёт. */
  from?: string;
  amount?: number | string;
  /** Срок отчёта, `ДД.ММ`. */
  due?: string;
}

export interface CashReceiptInput {
  account?: string;
  amount?: number | string;
  cat?: string;
  photo?: boolean;
  link?: string;
  note?: string;
  qr?: unknown;
  /** Чек, который переснимают взамен отклонённого. */
  redo?: string;
}

export interface CashReturnInput {
  account?: string;
  amount?: number | string;
}

export type CashAdvanceApi = {
  cashIssue(spec: CashIssueInput): { request: string } | { id: string };
  cashReceipt(spec: CashReceiptInput): string;
  cashReceiptDecide(id: string, ok?: boolean, why?: string): 'accepted' | 'rejected';
  cashReturn(spec: CashReturnInput): string;
};

export function advanceCommands(k: Kit): CashAdvanceApi {
  const {
    acc,
    need,
    active,
    nid,
    now,
    who,
    sum,
    reason,
    push,
    request,
    transfer,
    limitOf,
    X,
    D,
    me,
    ctx,
  } = k;
  return {
    cashIssue(spec) {
      active();
      const s = spec || {};
      const b = acc(s.account as string);
      if (b.kind !== 'advance') throw new ApiError('validation', 'Выберите подотчёт сотрудника');
      const r = need(b, 'edit', 'Выдача под отчёт — действие «Изменять» в роли');
      if (r.own || r.opt.self)
        throw new ApiError('forbidden', 'Себе под отчёт выдаёт другой сотрудник');
      const a = acc((s.from || b.from) as string);
      need(a, 'edit', 'Нет права «Изменять» в «' + a.name + '»');
      const amount = sum(s.amount);
      const due = String(s.due || '').trim();
      if (!/^\d{2}\.\d{2}$/.test(due))
        throw new ApiError('validation', 'Срок отчёта — в формате ДД.ММ');
      if (balanceOf(X(), a.id) < amount) {
        throw new ApiError('validation', 'В «' + a.name + '» нет столько наличных');
      }
      const holder = b.member ? nameOf(D(), b.member) : '—';
      if (b.limit && balanceOf(X(), b.id) + amount > b.limit) {
        throw new ApiError('validation', 'Лимит на руках у ' + holder + ' — ' + rub(b.limit));
      }
      const lim = limitOf(r, 'issue');
      if (lim != null && amount > lim) {
        return {
          request: request(
            b,
            {
              type: 'issue',
              amount,
              method: 'cash',
              cat: 'Перемещение',
              basis: 'Выдача под отчёт · ' + holder,
              from: a.id,
              due,
            },
            lim,
          ).id,
        };
      }
      b.due = due;
      return { id: transfer(a, b, amount, 'Выдача под отчёт · ' + holder).id };
    },

    cashReceipt(spec) {
      active();
      const s = spec || {};
      const b = acc(s.account as string);
      if (b.kind !== 'advance' || b.member !== me()) {
        throw new ApiError('forbidden', 'Чек добавляет держатель подотчёта');
      }
      need(b, 'create');
      const amount = sum(s.amount);
      if (!s.cat) throw new ApiError('validation', 'Выберите статью');
      if (!s.photo) throw new ApiError('validation', 'Сфотографируйте чек');
      const c: AdvanceReceipt = {
        id: nid('rc-'),
        account: b.id,
        amount,
        cat: s.cat,
        link: String(s.link || '').trim(),
        note: String(s.note || '').trim(),
        photo: true,
        qr: !!s.qr,
        by: me(),
        at: now(),
        status: 'review',
      };
      if (s.redo) {
        const old = X().receipts.find((x) => x.id === s.redo);
        if (old) old.redoneBy = c.id;
      }
      X().receipts.unshift(c);
      ctx.emit(
        'Подотчёт: ' + nameOf(D(), me()) + ' — чек «' + s.cat + '» ' + rub(amount) + ' на проверке',
        who(b, 'edit', me()),
      );
      return c.id;
    },

    cashReceiptDecide(id, ok, why) {
      const c = X().receipts.find((x) => x.id === id);
      if (!c || c.status !== 'review') throw new ApiError('conflict', 'Чек уже проверен');
      const b = acc(c.account);
      const r = need(b, 'edit', 'Чеки проверяет роль с правом «Изменять»');
      if (r.own || r.opt.self)
        throw new ApiError('forbidden', 'Свой чек проверяет другой сотрудник');
      c.decidedBy = me();
      c.decidedAt = now();
      if (ok === false) {
        c.status = 'rejected';
        c.reason = reason(why);
        ctx.emit('Подотчёт: чек «' + c.cat + '» ' + rub(c.amount) + ' не принят — ' + c.reason, [
          c.by,
        ]);
        return 'rejected';
      }
      c.status = 'accepted';
      c.op = push({
        account: b.id,
        type: 'out',
        amount: c.amount,
        method: 'cash',
        cat: c.cat,
        basis: 'Чек · ' + c.cat + (c.link ? ' · ' + c.link : '') + (c.note ? ' · ' + c.note : ''),
        src: { kind: 'receipt', id: c.id, label: 'Чек ' + nameOf(D(), c.by) },
        receipt: { seller: true },
      }).id;
      ctx.emit('Подотчёт: чек «' + c.cat + '» ' + rub(c.amount) + ' принят', [c.by]);
      return 'accepted';
    },

    cashReturn(spec) {
      active();
      const s = spec || {};
      const b = acc(s.account as string);
      if (b.kind !== 'advance' || b.member !== me()) {
        throw new ApiError('forbidden', 'Остаток возвращает держатель подотчёта');
      }
      const amount = sum(s.amount);
      const have = balanceOf(X(), b.id);
      if (amount > have) throw new ApiError('validation', 'На руках меньше: ' + rub(have));
      return transfer(
        b,
        acc(b.from as string),
        amount,
        'Возврат остатка подотчёта · ' + nameOf(D(), me()),
      ).id;
    },
  };
}
