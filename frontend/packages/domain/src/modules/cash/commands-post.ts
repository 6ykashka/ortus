// Команды проведения операций (cash.js 14.10/19.10:328–392): `cashPost`, `cashPostProposal`,
// `cashDismiss`, `cashLink`, `cashReverse`. Тексты ошибок — дословно из эталона.
import { ApiError } from '../../core/errors/index.ts';
import { accCan } from './access.ts';
import { METHODS_OF, opSign, openShift, balanceOf, parseSum, rub } from './dictionaries.ts';
import type { Kit, ReceiptInput } from './kit.ts';
import { cashProposals } from './proposals.ts';
import type { CashMethod, CashRequestSpec } from './types.ts';

/** Вход `cashPost`: значения приходят из формы как есть (строки, числа), проверяет их команда. */
export interface CashPostInput {
  account?: string;
  type?: string;
  amount?: number | string;
  method?: string;
  cat?: string;
  basis?: string;
  ref?: string | null;
  receipt?: ReceiptInput | null;
}

export interface CashPayInput {
  receipt?: ReceiptInput | null;
  parts?: { method: string; amount: number | string }[];
}

export type CashPostApi = {
  cashPost(spec: CashPostInput): { request: string } | { id: string };
  cashPostProposal(key: string, pay?: CashPayInput): { ids: string[] } | { request: string };
  cashDismiss(key: string, why: string): void;
  cashLink(opId: string, key: string): string;
  cashReverse(opId: string, why: string): string;
};

export function postCommands(k: Kit): CashPostApi {
  const {
    acc,
    need,
    active,
    nid,
    sum,
    reason,
    push,
    write,
    request,
    limitOf,
    receiptOf,
    X,
    D,
    me,
  } = k;
  const proposal = (key: string) => cashProposals(D(), me()).find((x) => x.key === key);

  return {
    cashPost(spec) {
      active();
      const s = spec || {};
      const a = acc(s.account as string);
      const r = need(a, 'create', 'Нет права «Создавать» в кассе «' + a.name + '»');
      if (r.opt.self || a.kind === 'advance') {
        throw new ApiError(
          'forbidden',
          'Подотчёт пополняется выдачей из кассы, расход отчитывается чеком сотрудника',
        );
      }
      if (!['in', 'out', 'refund'].includes(s.type as string)) {
        throw new ApiError('validation', 'Выберите тип операции');
      }
      const type = s.type as 'in' | 'out' | 'refund';
      if (type === 'refund' && !accCan(r, 'edit')) {
        throw new ApiError('forbidden', 'Возвраты — действие «Изменять» в роли');
      }
      const amount = sum(s.amount);
      const basis = String(s.basis || '').trim();
      if (basis.length < 3) throw new ApiError('validation', 'Укажите основание: за что и кому');
      const spec2: Omit<CashRequestSpec, 'type'> & { type: 'in' | 'out' | 'refund' } = {
        type,
        amount,
        method: ((s.method as CashMethod | undefined) ||
          (METHODS_OF[a.kind] || ['cash'])[0]) as CashMethod,
        cat: s.cat || '',
        basis,
        ref: s.ref || null,
        receipt: (s.receipt as CashRequestSpec['receipt']) || null,
        src: null,
      };
      const lim = limitOf(r, type);
      if (lim != null && amount > lim) {
        if (type !== 'out') receiptOf(a, type, s.receipt);
        return { request: request(a, spec2 as CashRequestSpec, lim).id };
      }
      return { id: write(a, spec2).id };
    },

    cashPostProposal(key, pay) {
      active();
      const p = proposal(key);
      if (!p) throw new ApiError('conflict', 'Предложение уже проведено, отклонено или недоступно');
      const a = acc(p.account);
      const r = need(a, p.kind === 'refund' ? 'edit' : 'create');
      const src = {
        key: p.key,
        kind: p.src.kind,
        id: p.src.id || null,
        label: p.src.label,
        nav: p.src.nav || null,
      };
      const P = pay || {};
      if (p.kind === 'in') {
        const first = (METHODS_OF[a.kind] || ['cash'])[0] ?? 'cash';
        const parts = (
          P.parts && P.parts.length ? P.parts : [{ method: p.method || first, amount: p.amount }]
        )
          .map((x) => ({ method: x.method as CashMethod, amount: parseSum(x.amount) }))
          .filter((x) => x.amount > 0);
        const total = Math.round(parts.reduce((t, x) => t + x.amount, 0) * 100) / 100;
        if (!parts.length || Math.abs(total - p.amount) > 0.001) {
          throw new ApiError(
            'validation',
            'Части оплаты дают ' + rub(total) + ', а к оплате ' + rub(p.amount),
          );
        }
        const targets = parts.map((x) => {
          const t =
            ['card', 'sbp'].includes(x.method) && a.kind === 'drawer'
              ? a.term
                ? acc(a.term)
                : null
              : a;
          if (!t) {
            throw new ApiError(
              'validation',
              'У «' + a.name + '» нет терминала: карта и СБП недоступны',
            );
          }
          need(t, 'create');
          return t;
        });
        const receipt = receiptOf(a, 'in', P.receipt);
        const group = parts.length > 1 ? nid('g-') : null;
        return {
          ids: parts.map(
            (x, i) =>
              write(targets[i] ?? a, {
                type: 'in',
                amount: x.amount,
                method: x.method,
                cat: p.cat,
                basis: p.title,
                src,
                receiptFixed: receipt,
                group,
              }).id,
          ),
        };
      }
      const spec: CashRequestSpec = {
        type: p.kind,
        amount: p.amount,
        method: p.method || 'cash',
        cat: p.cat,
        basis: p.title + (p.sub ? ' · ' + p.sub : ''),
        src,
        ref: p.ref || null,
        receipt: P.receipt || (p.seller ? { seller: true } : null),
      };
      const lim = limitOf(r, p.kind);
      if (lim != null && p.amount > lim) {
        if (p.kind === 'refund') receiptOf(a, 'refund', spec.receipt);
        return { request: request(a, spec, lim).id };
      }
      return { ids: [write(a, { ...spec, type: p.kind }).id] };
    },

    cashDismiss(key, why) {
      const p = proposal(key);
      if (!p) throw new ApiError('conflict', 'Предложение уже проведено или отклонено');
      X().dismissed.unshift({
        key,
        reason: reason(why, 'Укажите, почему не проводите'),
        by: me(),
        at: k.now(),
        title: p.title,
        amount: p.amount,
      });
    },

    cashLink(opId, key) {
      const p = proposal(key);
      const o = X().ops.find((x) => x.id === opId);
      if (!p || !o) throw new ApiError('conflict', 'Предложение или операция недоступны');
      const a = acc(p.account);
      need(a, 'create');
      if (o.src || o.amount !== p.amount || ![a.id, a.term].includes(o.account)) {
        throw new ApiError(
          'validation',
          'Связать можно ручную операцию на ту же сумму в этой кассе',
        );
      }
      o.src = {
        key: p.key,
        kind: p.src.kind,
        id: p.src.id || null,
        label: p.src.label,
        nav: p.src.nav || null,
        linkedBy: me(),
      };
      return o.id;
    },

    cashReverse(opId, why) {
      active();
      const o = X().ops.find((x) => x.id === opId);
      if (!o) throw new ApiError('not_found', 'Операция не найдена');
      const a = acc(o.account);
      const r = need(a, 'review', 'Сторно — действие «Проверять» в роли');
      const text = reason(why, 'Укажите причину исправления');
      if (o.reversedBy || o.type === 'storno')
        throw new ApiError('conflict', 'Операция уже исправлена');
      if (['move_in', 'move_out'].includes(o.type)) {
        throw new ApiError('validation', 'Перемещение исправляется обратным перемещением');
      }
      if (!r.all && o.by === me()) {
        throw new ApiError(
          'forbidden',
          'Свою операцию сторнирует второй сотрудник с правом «Проверять»',
        );
      }
      const sign = -opSign(o);
      if (sign < 0 && ['drawer', 'safe'].includes(a.kind) && balanceOf(X(), a.id) - o.amount < 0) {
        throw new ApiError('validation', 'Сторно увело бы остаток «' + a.name + '» в минус');
      }
      const sh = a.kind === 'drawer' && a.mode !== 'none' ? openShift(X(), a.id) : null;
      const s = push({
        account: a.id,
        type: 'storno',
        sign,
        amount: o.amount,
        method: o.method,
        cat: o.cat,
        basis: 'Сторно ' + o.id + ': ' + text,
        reverses: o.id,
        shift: sh ? sh.id : null,
      });
      o.reversedBy = s.id;
      return s.id;
    },
  };
}
