// Согласование заявок сверх лимита роли и создание касс (cash.js 14.10/19.10:531–559).
//
// Отличия от эталона (бриф W5.30 §10):
// - `cashApprove` и `cashTransferAccept` проверяют тариф (`subscription_restricted`): в эталоне
//   `active()` у них не было, и организация «только для чтения» могла проводить деньги;
// - согласование выдачи под отчёт проверяет остаток кассы-источника (в эталоне деньги могли
//   уйти в минус);
// - PD-53: `cashAccountCreate` проверяет право «Настраивать» в подразделении новой кассы
//   (`can` ядра с `unit`); касса без подразделения (сейф, счёт) — только роль на всю организацию.
import { ApiError } from '../../core/errors/index.ts';
import {
  drawerFor,
  CATS,
  KIND,
  MODE,
  REQ_LABEL,
  balanceOf,
  parseSum,
  rub,
} from './dictionaries.ts';
import type { Kit } from './kit.ts';
import type { CashAccount, CashKkt, CashMode } from './types.ts';
import { makeAccount } from './seed.ts';

export interface CashAccountInput {
  kind?: string;
  name?: string;
  unit?: string | null;
  resp?: string | null;
  mode?: string;
  kkt?: string;
  limit?: number | string;
  float?: number | string;
  tol?: number | string;
  /** Держатель подотчёта (только `advance`). */
  member?: string;
}

export type CashApproveApi = {
  cashApprove(id: string, ok?: boolean, why?: string): string;
  cashAccountCreate(spec: CashAccountInput): string;
};

const positive = (v: unknown): number | null => {
  const n = parseSum(v);
  return n > 0 ? n : null;
};

export function approveCommands(k: Kit): CashApproveApi {
  const { acc, need, active, nid, now, reason, write, transfer, X, D, me, ctx } = k;
  return {
    cashApprove(id, ok, why) {
      active();
      const q = X().requests.find((x) => x.id === id);
      if (!q || q.status !== 'pending') throw new ApiError('conflict', 'Заявка уже решена');
      const a = acc(q.account);
      need(a, 'review', 'Согласует роль с правом «Проверять» в «' + a.name + '»');
      if (q.by === me()) throw new ApiError('forbidden', 'Свою заявку согласует другой сотрудник');
      q.decidedBy = me();
      q.decidedAt = now();
      const label = REQ_LABEL[q.type].toLowerCase();
      if (ok === false) {
        q.status = 'rejected';
        q.reason = reason(why);
        ctx.emit('Касса: не согласовано — ' + label + ' ' + rub(q.amount) + ' · ' + q.reason, [
          q.by,
        ]);
        return 'rejected';
      }
      if (q.type === 'issue') {
        const from = acc(q.from as string);
        if (balanceOf(X(), from.id) < q.amount) {
          throw new ApiError('validation', 'В «' + from.name + '» нет столько наличных');
        }
        a.due = q.due ?? null;
        q.result = transfer(from, a, q.amount, q.basis, null, q.by).id;
      } else {
        q.result = write(a, {
          type: q.type,
          amount: q.amount,
          method: q.method,
          cat: q.cat,
          basis: q.basis,
          ref: q.ref,
          receipt: q.receipt,
          src: q.src,
          by: q.by,
          approvedBy: me(),
        }).id;
      }
      q.status = 'approved';
      ctx.emit('Касса: согласовано и проведено — ' + label + ' ' + rub(q.amount) + ' · ' + a.name, [
        q.by,
      ]);
      return q.result;
    },

    cashAccountCreate(spec) {
      active();
      const db = D();
      const s = spec || {};
      const unit = s.unit || null;
      const allowed = unit
        ? ctx.can.can(db, me(), 'cash', 'settings', unit).ok
        : ctx.can.can(db, me(), 'cash', 'settings').ok &&
          ctx.can
            .grants(db, me())
            .some(
              (g) =>
                g.scope.type === 'tenant' &&
                (g.roleObj.all || (g.roleObj.actions.cash ?? []).includes('settings')),
            );
      if (!allowed) {
        throw new ApiError(
          'forbidden',
          'Кассы настраивает роль с действием «Настраивать» в модуле «Касса»',
        );
      }
      const kind = s.kind as CashAccount['kind'];
      if (!Object.hasOwn(KIND, kind ?? '')) throw new ApiError('validation', 'Выберите вид');
      const name = String(s.name || '').trim();
      if (name.length < 2) throw new ApiError('validation', 'Укажите название');
      if (kind === 'advance' && !db.members.some((m) => m.id === s.member)) {
        throw new ApiError('validation', 'Выберите сотрудника');
      }
      if (X().accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new ApiError('conflict', 'Касса с таким названием уже есть');
      }
      const from =
        kind === 'advance'
          ? ((drawerFor(X(), unit) ?? X().accounts.find((a) => a.kind === 'safe'))?.id ?? null)
          : null;
      const drawer = kind === 'drawer';
      const tol = parseSum(s.tol);
      const a = makeAccount(nid('ca-'), kind, name, unit, {
        resp: s.resp || null,
        mode: drawer && s.mode && Object.hasOwn(MODE, s.mode) ? (s.mode as CashMode) : 'none',
        kkt: drawer && s.kkt === 'manual' ? ('manual' as CashKkt) : 'none',
        limit: positive(s.limit),
        float: drawer ? (positive(s.float) ?? 0) : 0,
        tol: drawer ? (tol >= 0 ? tol : 0) : 0,
        member: kind === 'advance' ? (s.member ?? null) : null,
        from,
        cats: kind === 'advance' ? CATS.out.slice(0, 4) : null,
        createdBy: me(),
        createdAt: now(),
      });
      X().accounts.push(a);
      return a.id;
    },
  };
}
