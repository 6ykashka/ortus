// Перемещения между кассой, сейфом и счётом (cash.js 14.10/19.10:459–477): `cashTransfer`
// списывает сразу, `cashTransferAccept` зачисляет, когда получатель принял (или возвращает).
import { ApiError } from '../../core/errors/index.ts';
import { canAcceptTransfer } from './access.ts';
import { balanceOf, nameOf, rub } from './dictionaries.ts';
import type { Kit } from './kit.ts';

export interface CashTransferInput {
  from?: string;
  to?: string;
  amount?: number | string;
  note?: string;
}

export type CashTransferApi = {
  cashTransfer(spec: CashTransferInput): string;
  cashTransferAccept(id: string, ok?: boolean, why?: string): 'done' | 'rejected';
};

export function transferCommands(k: Kit): CashTransferApi {
  const { acc, need, active, sum, reason, push, now, transfer, X, D, me, ctx } = k;
  return {
    cashTransfer(spec) {
      active();
      const s = spec || {};
      const a = acc(s.from as string);
      const b = acc(s.to as string);
      need(a, 'edit', 'Перемещение — действие «Изменять» в роли');
      if (a.id === b.id) throw new ApiError('validation', 'Выберите другую кассу');
      if (!['drawer', 'safe'].includes(a.kind) || !['drawer', 'safe', 'bank'].includes(b.kind)) {
        throw new ApiError(
          'validation',
          'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»',
        );
      }
      const amount = sum(s.amount);
      if (balanceOf(X(), a.id) < amount) {
        throw new ApiError('validation', 'В «' + a.name + '» нет столько наличных');
      }
      const note =
        String(s.note || '').trim() ||
        (b.kind === 'safe' ? 'Сдача выручки' : b.kind === 'bank' ? 'Инкассация' : 'Перемещение');
      return transfer(a, b, amount, note).id;
    },

    cashTransferAccept(id, ok, why) {
      active();
      const t = X().transfers.find((x) => x.id === id);
      if (!t || t.status !== 'transit') {
        throw new ApiError('conflict', 'Перемещение уже принято или отклонено');
      }
      const a = acc(t.from);
      const b = acc(t.to);
      if (!canAcceptTransfer(D(), me(), X(), t)) {
        throw new ApiError(
          'forbidden',
          'Принимает получатель: ' +
            (b.kind === 'advance' && b.member
              ? nameOf(D(), b.member)
              : 'роль с правом «Изменять» в «' + b.name + '»'),
        );
      }
      t.decidedBy = me();
      t.decidedAt = now();
      if (ok === false) {
        const text = reason(why);
        t.status = 'rejected';
        t.reason = text;
        t.backOp = push({
          account: a.id,
          type: 'move_in',
          amount: t.amount,
          method: 'cash',
          cat: 'Перемещение',
          basis: 'Не принято в «' + b.name + '»: ' + text,
          tr: t.id,
        }).id;
        ctx.emit('Касса: «' + b.name + '» не принял(а) ' + rub(t.amount) + ' — ' + text, [t.by]);
        return 'rejected';
      }
      t.status = 'done';
      t.inOp = push({
        account: b.id,
        type: 'move_in',
        amount: t.amount,
        method: b.kind === 'bank' ? 'transfer' : 'cash',
        cat: 'Перемещение',
        basis: t.note + ' ← «' + a.name + '»',
        tr: t.id,
      }).id;
      ctx.emit(
        'Касса: ' + rub(t.amount) + ' приняты в «' + b.name + '»',
        [t.by].filter((x) => x !== me()),
      );
      return 'done';
    },
  };
}
