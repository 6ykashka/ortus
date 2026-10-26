// W5.32 · Вкладка «Кассы» (K:42–105, deskVM K:623–661): кассы по подразделениям слева, карточка выбранной кассы
// (кнопки по правам, факты, «В пути») и журнал с фильтром. «Выдать под отчёт» и подотчёт держателя — W5.33.
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { decideTransfer } from './api.ts';
import { useCash } from './ctx.tsx';
import {
  type Account,
  accountGroups,
  canAcceptTransfer,
  deskActions,
  expectedNow,
  fmtTime,
  KIND_INFO,
  MODE_LABEL,
  matchFilter,
  type Operation,
  OP_FILTERS,
  type OpFilter,
  rightsText,
  rub,
} from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import { Button, Chip, type FactData, Facts, type OpNames, OpRow, opCode, Seg } from './ui.tsx';

/** Касса «своё» держателя подотчёта в «Кассах» не показывается — это страница «Подотчёт» (K:625). */
export const isSelfAdvance = (a: Account): boolean =>
  a.kind === 'advance' && a.my.isHolder === true && a.my.via === 'self';

export function useOpNames(): OpNames {
  const c = useCash();
  return {
    member: (id) => c.memberName(id),
    shiftNo: (id) => {
      const s = c.shifts.find((x) => x.id === id);
      return s ? String(s.number) : undefined;
    },
    me: { memberId: c.meId },
    accountOf: (id) => c.accountOf(id),
    onReverse: (o, a) =>
      c.openModal({
        kind: 'reason',
        act: 'reverse',
        id: o.id,
        sub: `${o.basis ?? ''} · ${rub(o.amount.amountMinor)}`,
        vars: { id: opCode(o.id), name: a.name },
      }),
  };
}

function shiftChipOf(c: ReturnType<typeof useCash>, a: Account): ReactElement | null {
  if (a.kind === 'cash_drawer' && a.shiftMode !== 'none') {
    const open = c.shifts.find((x) => x.accountId === a.id && x.status === 'open');
    const review = c.shifts.find((x) => x.accountId === a.id && x.status === 'review');
    if (open)
      return (
        <Chip
          label={format(T.chips.shiftOpen, { no: open.number })}
          tone="ok"
          icon="lock_open"
          size="sm"
        />
      );
    if (review)
      return (
        <Chip
          label={format(T.chips.shiftReview, { no: review.number })}
          tone="danger"
          icon="error"
          size="sm"
        />
      );
    return <Chip label={T.chips.shiftClosed} tone="neutral" icon="lock" size="sm" />;
  }
  return null;
}

function AccountCard(p: { a: Account; on: boolean; onPick: () => void }): ReactElement {
  const c = useCash();
  const { a } = p;
  const info = KIND_INFO[a.kind];
  const holder = a.kind === 'advance' ? c.memberName(a.holderMemberId) : '';
  const resp = a.responsibleMemberId ? c.memberName(a.responsibleMemberId) : '';
  const sub = info.label + (a.kind === 'advance' ? ` · ${holder}` : resp ? ` · ${resp}` : '');
  const bal = a.balance?.amountMinor;
  return (
    <button type="button" className="ox-ca-acc" aria-pressed={p.on} onClick={p.onPick}>
      <span className="ox-ca-ico">
        <Icon name={info.icon} size={20} />
      </span>
      <span className="ox-ca-accmain">
        <strong>{a.name}</strong>
        <span className="ox-ca-accsub">{sub}</span>
        {shiftChipOf(c, a)}
      </span>{' '}
      <span
        className="ox-ca-accbal"
        data-hidden={bal === undefined ? 'true' : undefined}
        data-neg={bal !== undefined && bal < 0 ? 'true' : undefined}
      >
        {bal === undefined ? T.hidden : rub(bal)}
      </span>
    </button>
  );
}

function deskFacts(c: ReturnType<typeof useCash>, a: Account): FactData[] {
  const out: FactData[] = [];
  const bal = a.balance?.amountMinor;
  const limit = a.balanceLimit?.amountMinor;
  if (bal === undefined) {
    out.push({ l: T.facts.balance, v: T.facts.hiddenValue, s: T.facts.hiddenNote });
  } else {
    const over = !!limit && bal > limit;
    out.push({
      l: a.kind === 'advance' ? T.facts.onHands : T.facts.balance,
      v: rub(bal),
      s: limit
        ? over
          ? format(T.facts.overLimit, { limit: rub(limit) })
          : format(T.facts.limit, { limit: rub(limit) })
        : '',
      ...(over ? { tone: 'warn' as const } : {}),
    });
  }
  const shifts = a.kind === 'cash_drawer' && a.shiftMode !== 'none';
  if (shifts) {
    const open = c.shifts.find((x) => x.accountId === a.id && x.status === 'open');
    const review = c.shifts.find((x) => x.accountId === a.id && x.status === 'review');
    if (open) {
      const exp = expectedNow(open, a);
      out.push({
        l: T.facts.shift,
        v: format(T.facts.shiftOpenValue, { no: open.number }),
        s:
          format(T.facts.shiftOpenNote, {
            time: fmtTime(open.openedAt),
            name: c.memberName(open.openedByMemberId),
          }) + (exp === null ? T.facts.blindNow : format(T.facts.expectedNow, { sum: rub(exp) })),
      });
    } else if (review) {
      out.push({
        l: T.facts.shift,
        v: format(T.facts.shiftReviewValue, { no: review.number }),
        s: T.facts.shiftReviewNote,
        tone: 'danger',
      });
    } else {
      out.push({ l: T.facts.shift, v: T.facts.shiftClosedValue, s: T.facts.shiftClosedNote });
    }
  }
  if (a.kind === 'cash_drawer') {
    const tol = a.tolerance?.amountMinor;
    out.push({
      l: T.facts.mode,
      v: MODE_LABEL[a.shiftMode],
      s: [
        a.kktMode === 'manual' ? T.facts.kktManual : T.facts.kktNone,
        tol ? format(T.facts.tolerance, { sum: rub(tol) }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (a.kind === 'acquiring') {
    const fee = String((a.feeBasisPoints ?? 0) / 100).replace('.', ',');
    out.push({
      l: T.facts.settle,
      v: T.facts.settleValue,
      s: format(T.facts.settleNote, { fee }),
    });
  }
  if (a.kind === 'bank') {
    out.push({ l: T.facts.bankFrom, v: T.facts.bankFromValue, s: T.facts.bankFromNote });
  }
  return out;
}

function Moves(p: { a: Account }): ReactElement | null {
  const c = useCash();
  const { a } = p;
  const list = c.transfers.filter(
    (t) => t.status === 'transit' && (t.toAccountId === a.id || t.fromAccountId === a.id),
  );
  if (!list.length) return null;
  return (
    <div className="ox-ca-moves">
      <strong>{T.moves.title}</strong>
      {list.map((t) => {
        const incoming = t.toAccountId === a.id;
        const sum = rub(t.amount.amountMinor);
        const from = c.accountOf(t.fromAccountId)?.name ?? '—';
        const to = c.accountOf(t.toAccountId)?.name ?? '—';
        const canAccept = canAcceptTransfer(t, c.accountOf(t.toAccountId));
        return (
          <div key={t.id} className="ox-ca-move">
            <span className="ox-ca-movetext">
              <strong>
                {incoming
                  ? format(T.moves.from, { sum, name: from })
                  : format(T.moves.to, { sum, name: to })}
              </strong>
              <span>
                {format(T.moves.meta, {
                  note: t.note ?? '',
                  by: c.memberName(t.sentByMemberId),
                  at: t.sentAt.slice(8, 10) + '.' + t.sentAt.slice(5, 7),
                })}
              </span>
            </span>
            {canAccept ? (
              <span className="ox-ca-movebtns">
                <Button
                  small
                  disabled={c.offline}
                  onClick={() =>
                    c.openModal({
                      kind: 'reason',
                      act: 'rejectTr',
                      id: t.id,
                      sub: t.note ?? '',
                      vars: { sum, name: from },
                    })
                  }
                >
                  {T.moves.reject}
                </Button>
                <Button
                  small
                  variant="info"
                  disabled={c.busy || c.offline}
                  onClick={() =>
                    void c.call(
                      `accept:${t.id}`,
                      (key) => decideTransfer(c.api, c.tenantId, t, { decision: 'accept' }, key),
                      format(T.moves.accepted, { sum }),
                    )
                  }
                >
                  {format(T.moves.accept, { sum })}
                </Button>
              </span>
            ) : (
              <span className="ox-ca-wait">{incoming ? T.moves.toReceiver : T.moves.waits}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OpsList(p: {
  ops: readonly Operation[];
  /** «Сторно» в списке (в «Операциях смены» эталона кнопки нет, K:239–246). */
  reverse?: boolean;
  title?: string;
  filters?: boolean;
  empty: string;
  filter?: OpFilter;
  onFilter?: (f: OpFilter) => void;
}): ReactElement {
  const base = useOpNames();
  const names: OpNames = p.reverse === false ? { ...base, noReverse: true } : base;
  return (
    <div className="ox-ca-journal">
      {p.title ? (
        <div className="ox-ca-jhead">
          <strong>{p.title}</strong>
          {p.filters && p.onFilter ? (
            <Seg
              label={T.journal.filterAria}
              value={p.filter ?? 'all'}
              options={OP_FILTERS}
              onChange={p.onFilter}
              soft
            />
          ) : null}
        </div>
      ) : null}
      {p.ops.map((o) => (
        <OpRow key={o.id} op={o} names={names} />
      ))}
      {p.ops.length === 0 ? <div className="ox-ca-empty">{p.empty}</div> : null}
    </div>
  );
}

export function DeskTab(p: {
  selected: string | undefined;
  onSelect: (id: string) => void;
}): ReactElement | null {
  const c = useCash();
  const [flt, setFlt] = useState<OpFilter>('all');
  const list = c.accounts.filter((a) => !isSelfAdvance(a));
  const sel = list.find((a) => a.id === p.selected) ?? list[0];
  if (!sel) return null;
  const groups = accountGroups(list);
  const open = c.shifts.find((x) => x.accountId === sel.id && x.status === 'open');
  const review = c.shifts.find((x) => x.accountId === sel.id && x.status === 'review');
  const others = c.accounts.filter(
    (x) => x.id !== sel.id && (x.kind === 'cash_drawer' || x.kind === 'safe' || x.kind === 'bank'),
  ).length;
  const actions = deskActions(sel, { open: open?.id, review: review?.id, others });
  const info = KIND_INFO[sel.kind];
  const resp = sel.responsibleMemberId ? c.memberName(sel.responsibleMemberId) : '';
  const sub = [c.unitTitle(sel.orgUnitId), info.label, resp ? `${T.respPrefix}${resp}` : '']
    .filter(Boolean)
    .join(' · ');
  const ids = new Set([
    sel.id,
    ...c.accounts.filter((x) => x.drawerAccountId === sel.id).map((x) => x.id),
  ]);
  const ops = c.ops
    .filter((o) => (sel.kind === 'acquiring' ? o.accountId === sel.id : ids.has(o.accountId)))
    .filter((o) => matchFilter(o, flt));
  const rightsLine =
    sel.my.via === 'owner'
      ? T.accessOwner
      : format(T.access, { via: T.via[sel.my.via], rights: rightsText(sel.my.rights) });

  return (
    <div className="ox-ca-cols">
      <aside aria-label={T.asideAccounts} className="ox-ca-aside">
        {groups.map((g) => (
          <div key={g.unitId ?? 'org'} className="ox-ca-group">
            <span className="ox-ca-gname">{c.unitTitle(g.unitId)}</span>
            {g.items.map((a) => (
              <AccountCard
                key={a.id}
                a={a}
                on={a.id === sel.id}
                onPick={() => {
                  setFlt('all');
                  p.onSelect(a.id);
                }}
              />
            ))}
          </div>
        ))}
      </aside>
      <section aria-label={sel.name} className="ox-ca-aside">
        <div className="ox-ca-card">
          <div className="ox-ca-chead">
            <span className="ox-ca-ico" data-xl="true">
              <Icon name={info.icon} size={24} />
            </span>
            <span className="ox-ca-ctitle">
              <h2>{sel.name}</h2>
              <span className="ox-ca-sub">{sub}</span>
            </span>
            <span className="ox-ca-actions">
              {actions.map((k) => {
                if (k === 'post')
                  return (
                    <Button
                      key={k}
                      variant="primary"
                      icon="add"
                      disabled={c.offline}
                      onClick={() => c.openModal({ kind: 'op', accountId: sel.id })}
                    >
                      {sel.kind === 'cash_drawer' || sel.kind === 'acquiring'
                        ? T.actions.post
                        : T.actions.newOp}
                    </Button>
                  );
                if (k === 'openShift')
                  return (
                    <Button
                      key={k}
                      variant={review ? 'secondary' : 'primary'}
                      icon="lock_open"
                      disabled={c.offline}
                      onClick={() => c.openModal({ kind: 'openShift', accountId: sel.id })}
                    >
                      {T.actions.openShift}
                    </Button>
                  );
                if (k === 'closeShift')
                  return (
                    <Button
                      key={k}
                      icon="lock"
                      disabled={c.offline}
                      onClick={() => open && c.openModal({ kind: 'closeShift', shiftId: open.id })}
                    >
                      {T.actions.closeShift}
                    </Button>
                  );
                return (
                  <Button
                    key={k}
                    icon="swap_horiz"
                    disabled={c.offline}
                    onClick={() => c.openModal({ kind: 'transfer', fromId: sel.id })}
                  >
                    {T.actions.transfer}
                  </Button>
                );
              })}
            </span>
          </div>
          <Facts facts={deskFacts(c, sel)} />
          <span className="ox-ca-access">
            <Icon name="badge" size={16} />
            <span>{rightsLine}</span>
          </span>
        </div>
        <Moves a={sel} />
        <OpsList
          ops={ops}
          title={T.journal.title}
          filters
          filter={flt}
          onFilter={setFlt}
          empty={T.journal.empty}
        />
      </section>
    </div>
  );
}
