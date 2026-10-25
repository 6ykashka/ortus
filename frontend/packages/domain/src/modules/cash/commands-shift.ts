// Смены кассы (cash.js 14.10/19.10:394–457): открытие с размена, закрытие с пересчётом по
// номиналам, Z-отчётом и итогами терминала, решение по расхождению. Тексты — дословно из эталона.
import { ApiError } from '../../core/errors/index.ts';
import { accCan } from './access.ts';
import { DENOMS, balanceOf, openShift, parseSum, rub, signRub } from './dictionaries.ts';
import type { Kit } from './kit.ts';
import type { CashShift } from './types.ts';

/** Итоги закрытия смены, как их вводит кассир. */
export interface CashCloseInput {
  counts?: Record<string, unknown>;
  coins?: unknown;
  z?: { no?: unknown; cash?: unknown; card?: unknown } | null;
  term?: { card?: unknown; sbp?: unknown } | null;
  /** Размен на следующую смену; пусто — размен кассы (но не больше посчитанного). */
  keep?: unknown;
}

export type CashShiftApi = {
  cashShiftOpen(accountId: string, counted: unknown): string;
  cashShiftClose(
    shiftId: string,
    form: CashCloseInput,
  ): { status: 'closed' | 'review'; kkt: boolean };
  cashShiftReview(shiftId: string, decision: string, why: string): 'open' | 'closed';
};

const cents = (n: number): number => Math.round(n * 100) / 100;

/** Поля итогов закрытия, которые стираются при возврате смены на пересчёт. */
const CLOSE_FIELDS = [
  'closedAt',
  'closedBy',
  'counted',
  'counts',
  'coins',
  'z',
  'term',
  'expected',
  'diff',
] as const;

export function shiftCommands(k: Kit): CashShiftApi {
  const { acc, need, active, nid, now, who, reason, push, transfer, X, me, ctx } = k;
  return {
    cashShiftOpen(accountId, counted) {
      active();
      const a = acc(accountId);
      need(a, 'create', 'Смену открывает роль с правом «Создавать» в «' + a.name + '»');
      if (a.kind !== 'drawer' || a.mode === 'none')
        throw new ApiError('validation', 'Касса работает без смен');
      if (openShift(X(), a.id)) throw new ApiError('conflict', 'Смена уже открыта');
      const n = parseSum(counted);
      if (!(n >= 0)) throw new ApiError('validation', 'Укажите размен: сколько наличных в ящике');
      const no =
        X()
          .shifts.filter((h) => h.account === a.id)
          .reduce((m, h) => Math.max(m, h.no), 0) + 1;
      const bal = balanceOf(X(), a.id);
      const h: CashShift = {
        id: nid('sh-'),
        account: a.id,
        no,
        status: 'open',
        openedAt: now(),
        openedBy: me(),
        float: n,
      };
      X().shifts.unshift(h);
      if (Math.abs(n - bal) > 0.001) {
        const adj = push({
          account: a.id,
          type: 'adjust',
          sign: n > bal ? 1 : -1,
          amount: cents(Math.abs(n - bal)),
          cat: 'Корректировка',
          basis: 'Расхождение при открытии смены ' + no,
          shift: h.id,
        });
        h.openDiff = { amount: cents(n - bal), op: adj.id };
        ctx.emit(
          'Касса «' +
            a.name +
            '»: размен при открытии смены ' +
            no +
            ' не сошёлся с остатком на ' +
            signRub(n - bal),
          who(a, 'review', me()),
        );
      }
      return h.id;
    },

    cashShiftClose(shiftId, form) {
      active();
      const h = X().shifts.find((x) => x.id === shiftId);
      if (!h || h.status !== 'open') throw new ApiError('conflict', 'Смена уже закрыта');
      const a = acc(h.account);
      const r = need(a, 'create', 'Смену закрывает роль с правом «Создавать»');
      const F = form || {};
      const counts: Record<string, number> = {};
      let counted = 0;
      for (const d of DENOMS) {
        const c = Math.max(0, Math.floor(Number((F.counts || {})[d]) || 0));
        if (c) counts[d] = c;
        counted += c * d;
      }
      const coins = Math.max(0, parseSum(F.coins) || 0);
      counted = cents(counted + coins);
      const z = F.z || {};
      const zc = parseSum(z.cash);
      const zk = parseSum(z.card);
      if (a.kkt === 'manual' && (!String(z.no || '').trim() || !(zc >= 0) || !(zk >= 0))) {
        throw new ApiError(
          'validation',
          'Перепишите итоги Z-отчёта: номер, наличными и безналичными. Если ККТ не работала — укажите 0',
        );
      }
      const tm = F.term || {};
      const tc = parseSum(tm.card);
      const ts = parseSum(tm.sbp);
      const keep =
        F.keep === '' || F.keep == null ? Math.min(a.float || 0, counted) : parseSum(F.keep);
      if (!(keep >= 0) || keep > counted) {
        throw new ApiError('validation', 'Размен на следующую смену — не больше посчитанного');
      }
      const expected = balanceOf(X(), a.id);
      const live = X().ops.filter((o) => o.shift === h.id && !o.reversedBy && o.type !== 'storno');
      const rev = (id: string | null, ms: string[]): number =>
        id
          ? live
              .filter((o) => o.account === id && ms.includes(o.method))
              .reduce(
                (t, o) => t + (o.type === 'in' ? o.amount : o.type === 'refund' ? -o.amount : 0),
                0,
              )
          : 0;
      const revCash = rev(a.id, ['cash']);
      const revCard = rev(a.term, ['card', 'sbp']);
      const diff = cents(counted - expected);
      Object.assign(h, {
        closedAt: now(),
        closedBy: me(),
        counted,
        counts,
        coins,
        z: a.kkt === 'manual' ? { no: String(z.no).trim(), cash: zc, card: zk } : null,
        term: a.term ? { card: tc >= 0 ? tc : 0, sbp: ts >= 0 ? ts : 0 } : null,
        expected: {
          cash: expected,
          revCash,
          revCard,
          card: rev(a.term, ['card']),
          sbp: rev(a.term, ['sbp']),
        },
      });
      h.diff = {
        cash: diff,
        kktCash: h.z ? cents(zc - revCash) : 0,
        kktCard: h.z ? cents(zk - revCard) : 0,
        term: h.term ? cents(h.term.card + h.term.sbp - revCard) : 0,
      };
      if (Math.abs(diff) <= (a.tol || 0)) {
        h.status = 'closed';
        if (diff) {
          const adj = push({
            account: a.id,
            type: 'adjust',
            sign: diff > 0 ? 1 : -1,
            amount: Math.abs(diff),
            cat: 'Корректировка',
            basis: (diff < 0 ? 'Недостача' : 'Излишек') + ' при пересчёте · смена ' + h.no,
            shift: h.id,
          });
          h.decision = {
            kind: 'auto',
            at: h.closedAt ?? '',
            reason: 'В пределах допуска ' + rub(a.tol),
            op: adj.id,
          };
        } else {
          h.decision = { kind: 'auto', at: h.closedAt ?? '', reason: 'Без расхождений' };
        }
      } else {
        h.status = 'review';
        ctx.emit(
          'Касса «' +
            a.name +
            '»: смена ' +
            h.no +
            ' закрыта с расхождением ' +
            signRub(diff) +
            ' — нужно решение',
          who(a, 'review', me()),
        );
      }
      const toSafe = cents(counted - keep);
      const safe = X().accounts.find((x) => x.kind === 'safe' && !x.archived);
      if (toSafe > 0 && safe && accCan(r, 'edit')) {
        transfer(a, safe, toSafe, 'Выручка · смена ' + h.no, h.id);
        h.toSafe = toSafe;
      }
      return { status: h.status, kkt: !!(h.diff.kktCash || h.diff.kktCard || h.diff.term) } as {
        status: 'closed' | 'review';
        kkt: boolean;
      };
    },

    cashShiftReview(shiftId, decision, why) {
      const h = X().shifts.find((x) => x.id === shiftId);
      if (!h || h.status !== 'review') throw new ApiError('conflict', 'Смена уже решена');
      const a = acc(h.account);
      const r = need(a, 'review', 'Расхождение принимает роль с правом «Проверять»');
      if (!r.opt.balance)
        throw new ApiError('forbidden', 'Нужно право видеть остаток и ожидаемую сумму');
      if (h.closedBy === me()) {
        throw new ApiError('forbidden', 'Кто закрывал смену, тот не принимает её расхождение');
      }
      const text = reason(why, 'Укажите причину решения');
      if (decision === 'recount') {
        const closer = h.closedBy || h.openedBy;
        h.status = 'open';
        h.recount = { by: me(), at: now(), reason: text };
        for (const f of CLOSE_FIELDS) Reflect.deleteProperty(h, f);
        ctx.emit(
          'Касса «' + a.name + '»: смену ' + h.no + ' вернули на пересчёт — ' + text,
          [closer].filter(Boolean),
        );
        return 'open';
      }
      const d = h.diff?.cash ?? 0;
      const adj = push({
        account: a.id,
        type: 'adjust',
        sign: d > 0 ? 1 : -1,
        amount: Math.abs(d),
        cat: 'Корректировка',
        basis: (d < 0 ? 'Недостача' : 'Излишек') + ' · смена ' + h.no + ': ' + text,
        shift: h.id,
      });
      h.status = 'closed';
      h.decision = { kind: 'accepted', by: me(), at: now(), reason: text, op: adj.id };
      ctx.emit(
        'Касса «' + a.name + '»: расхождение смены ' + h.no + ' принято — ' + text,
        [h.closedBy].filter((x): x is string => !!x),
      );
      return 'closed';
    },
  };
}
