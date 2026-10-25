// Доступ к кассам (cash.js 14.10/19.10:59–101). Источник — «Пользователи и роли»: модуль «Касса»
// в роли (view · create · edit · review · settings) и параметры роли `role.cash`; область
// назначения — организация, регион, фирма или конкретная касса (`{ type: 'account', id }`).
import { grants } from '../../core/access/grants.ts';
import { scopeLabel } from '../../core/access/scope-label.ts';
import { scopeCovers } from '../../core/access/units.ts';
import type { Grant } from '../../core/types/index.ts';
import { ALL_VERBS, CASH_OPT0, VERB_TEXT, rub } from './dictionaries.ts';
import type {
  CashAccessResult,
  CashAccount,
  CashOpts,
  CashSlice,
  CashTenantDb,
  CashTransfer,
  CashVerb,
} from './types.ts';

const member = (db: CashTenantDb, id: string) => db.members.find((m) => m.id === id);

const optOf = (g: Grant): CashOpts => ({ ...CASH_OPT0, ...(g.roleObj.cash ?? {}) });

/** Доступ сотрудника к кассе: роль с модулем «Касса» → область, покрывающая кассу → параметры роли. */
export function cashAccess(db: CashTenantDb, mid: string, a: CashAccount): CashAccessResult {
  const m = member(db, mid);
  if (!m) return { ok: false, why: 'нет в организации' };
  if (m.status === 'blocked') return { ok: false, why: 'сотрудник заблокирован' };
  const gs = grants(db, mid);
  const own = a.kind === 'advance' && a.member === mid;
  if (gs.some((g) => g.roleObj.all)) {
    return {
      ok: true,
      all: true,
      own,
      verbs: ALL_VERBS,
      opt: { ...CASH_OPT0, balance: true },
      via: 'Владелец бизнеса · вся организация',
    };
  }
  const cg = gs.filter((g) => (g.roleObj.actions.cash ?? []).length);
  if (!cg.length) return { ok: false, why: 'в ролях нет модуля «Касса»' };
  const cover = cg.filter((g) => {
    if (optOf(g).self) return own;
    const sc = g.scope;
    if (sc.type === 'account')
      return sc.id === a.id || (a.kind === 'acquiring' && a.drawer === sc.id);
    return a.unit ? scopeCovers(db, sc, a.unit) : sc.type === 'tenant';
  });
  if (!cover.length) {
    return {
      ok: false,
      why: cg.every((g) => optOf(g).self)
        ? 'роль даёт только свой подотчёт'
        : 'касса вне области назначения',
    };
  }
  const opts = cover.map(optOf);
  const lim = (k: 'out' | 'refund' | 'advance'): number | null =>
    opts.some((o) => o[k] == null) ? null : Math.max(...opts.map((o) => o[k] as number));
  return {
    ok: true,
    all: false,
    own,
    verbs: [...new Set(cover.flatMap((g) => g.roleObj.actions.cash ?? []))] as CashVerb[],
    opt: {
      balance: own || opts.some((o) => o.balance),
      self: opts.every((o) => o.self),
      out: lim('out'),
      refund: lim('refund'),
      advance: lim('advance'),
    },
    via: cover.map((g) => g.roleObj.name + ' · ' + scopeLabel(db, g.scope)).join('; '),
  };
}

export const accCan = (r: CashAccessResult | undefined, v: CashVerb): boolean =>
  !!(r && r.ok && (r.all || r.verbs.includes(v)));

const limText = (v: number | null, label: string): string =>
  v == null ? '' : v === 0 ? label + ' — с согласованием' : label + ' до ' + rub(v);

/** Что роль даёт в кассе — одной строкой для «Настроек» и мастера «Новая касса». */
export function rightsText(r: CashAccessResult): string {
  if (!r.ok) return 'Нет доступа: ' + r.why;
  if (r.all) return 'Всё, включая остаток и сверку';
  if (r.opt.self) return 'Свой подотчёт: остаток и отчёт чеками';
  const v = r.verbs
    .filter((x) => VERB_TEXT[x])
    .map((x) => VERB_TEXT[x])
    .join(', ');
  return [
    v,
    r.opt.balance ? 'видит остаток' : 'остаток скрыт',
    limText(r.opt.out, 'расход'),
    r.verbs.includes('edit') ? limText(r.opt.refund, 'возврат') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface CashPerson {
  id: string;
  name: string;
  title: string;
  invited: boolean;
  ok: boolean;
  text: string;
}

/** Кто и как получит доступ к кассе — для мастера «Новая касса» и вкладки «Настройки». */
export function cashPeople(db: CashTenantDb, a: CashAccount): CashPerson[] {
  return db.members
    .filter((m) => m.status !== 'blocked')
    .map((m) => {
      const r = cashAccess(db, m.id, a);
      return {
        id: m.id,
        name: m.name,
        title: m.title ?? '',
        invited: m.status === 'invited',
        ok: r.ok,
        text: rightsText(r),
      };
    })
    .sort((x, y) => Number(y.ok) - Number(x.ok));
}

/** Принимает перемещение получатель: держатель подотчёта или роль с «Изменять» в кассе-получателе. */
export function canAcceptTransfer(
  db: CashTenantDb,
  actor: string,
  X: Pick<CashSlice, 'accounts'>,
  t: Pick<CashTransfer, 'to'>,
): boolean {
  const to = X.accounts.find((a) => a.id === t.to);
  if (!to) return false;
  if (to.kind === 'advance') return to.member === actor;
  return accCan(cashAccess(db, actor, to), 'edit');
}
