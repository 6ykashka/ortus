// W5.32 · Вкладка «Смены» (K:195–251, shiftsVM K:738–777): список смен, карточка со сверкой «Ортус · ККТ · факт»,
// решение по расхождению (принять или вернуть на пересчёт — попытка закрытия сохраняется, Q-W4.00-cash-4) и операции смены.
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { reviewShift } from './api.ts';
import { can, useCash } from './ctx.tsx';
import { OpsList } from './desk.tsx';
import {
  expectedNow,
  fmtAt,
  fmtTime,
  MODE_LABEL,
  rub,
  type Shift,
  shiftChip,
  shiftOrder,
  signRub,
  type Tone,
} from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import { Button, Chip, type FactData, Facts, Note, Seg } from './ui.tsx';

const toneOf = (d: number, within: boolean): Tone => (d === 0 ? 'ok' : within ? 'warn' : 'danger');

function Table(p: { shift: Shift; tol: number }): ReactElement | null {
  const { shift: h } = p;
  const E = h.expected;
  const D = h.diff;
  if (!E || !D) return null;
  const within = Math.abs(D.cash.amountMinor) <= p.tol;
  const z = h.z;
  const term = h.terminal;
  const cash = D.cash.amountMinor;
  const rows: ReactElement[] = [];
  rows.push(
    <div key="cash" className="ox-ca-trow">
      <strong>{T.shifts.cash}</strong>
      <span className="ox-ca-tcell">
        <span className="ox-ca-tnum">{rub(E.cash.amountMinor)}</span>
        <span className="ox-ca-tsub">{T.shifts.ortCash}</span>
      </span>
      <span className="ox-ca-tcell">
        <span className="ox-ca-tnum">{z ? rub(z.cash.amountMinor) : '—'}</span>
        <span className="ox-ca-tsub" data-warn={D.kktCash.amountMinor ? 'true' : undefined}>
          {z
            ? format(T.shifts.zNo, { no: z.number }) +
              (D.kktCash.amountMinor
                ? format(T.shifts.zMismatch, { sum: signRub(D.kktCash.amountMinor) })
                : T.shifts.zMatch)
            : T.shifts.zNone}
        </span>
      </span>
      <span className="ox-ca-tcell">
        <span className="ox-ca-tnum">{rub(h.counted?.amountMinor ?? 0)}</span>
        <span className="ox-ca-tsub">{T.shifts.recount}</span>
      </span>
      <span className="ox-ca-tcell">
        <span className="ox-ca-pill" data-tone={toneOf(cash, within)}>
          {cash ? signRub(cash) : '0 ₽'}
        </span>
        <span className="ox-ca-tsub">
          {format(within ? T.shifts.inTol : T.shifts.overTol, { sum: rub(p.tol) })}
        </span>
      </span>
    </div>,
  );
  if (term || E.revCard.amountMinor) {
    const dt = D.term.amountMinor;
    rows.push(
      <div key="cashless" className="ox-ca-trow">
        <strong>{T.shifts.cashless}</strong>
        <span className="ox-ca-tcell">
          <span className="ox-ca-tnum">{rub(E.revCard.amountMinor)}</span>
          <span className="ox-ca-tsub">
            {format(T.shifts.ortCashless, {
              card: rub(E.card.amountMinor),
              sbp: rub(E.sbp.amountMinor),
            })}
          </span>
        </span>
        <span className="ox-ca-tcell">
          <span className="ox-ca-tnum">{z ? rub(z.card.amountMinor) : '—'}</span>
          <span className="ox-ca-tsub" data-warn={D.kktCard.amountMinor ? 'true' : undefined}>
            {z
              ? D.kktCard.amountMinor
                ? format(T.shifts.zCardMismatch, { sum: signRub(D.kktCard.amountMinor) })
                : T.shifts.zCardMatch
              : ''}
          </span>
        </span>
        <span className="ox-ca-tcell">
          <span className="ox-ca-tnum">
            {term ? rub(term.card.amountMinor + term.sbp.amountMinor) : '—'}
          </span>
          <span className="ox-ca-tsub">
            {term
              ? format(T.shifts.terminal, {
                  card: rub(term.card.amountMinor),
                  sbp: rub(term.sbp.amountMinor),
                })
              : ''}
          </span>
        </span>
        <span className="ox-ca-tcell">
          <span className="ox-ca-pill" data-tone={dt ? 'warn' : 'ok'}>
            {dt ? signRub(dt) : '0 ₽'}
          </span>
          <span className="ox-ca-tsub">
            {dt > 0 ? T.shifts.termMore : dt < 0 ? T.shifts.termLess : T.shifts.termOk}
          </span>
        </span>
      </div>,
    );
  }
  return (
    <div className="ox-ca-table" role="region" aria-label="Сверка смены" tabIndex={0}>
      <div className="ox-ca-trow" data-head="true">
        <span>{T.shifts.tableMethod}</span>
        <span>{T.shifts.tableOrt}</span>
        <span>{T.shifts.tableKkt}</span>
        <span>{T.shifts.tableFact}</span>
        <span>{T.shifts.tableDiff}</span>
      </div>
      {rows}
    </div>
  );
}

export function ShiftsTab(p: {
  selected: string | undefined;
  onSelect: (id: string) => void;
}): ReactElement {
  const c = useCash();
  const list = shiftOrder(c.shifts);
  const [rv, setRv] = useState<{ id: string; reason: string; comment: string } | null>(null);
  const [err, setErr] = useState('');
  const sel = list.find((s) => s.id === p.selected) ?? list[0];

  if (!sel) {
    return (
      <div className="ox-ca-cols">
        <aside aria-label={T.shifts.aria} className="ox-ca-aside" data-list="true" />
        <section aria-label={T.shifts.emptyTitle} className="ox-ca-aside">
          <div className="ox-ca-card">
            <div className="ox-ca-ctitle">
              <h2>{T.shifts.emptyTitle}</h2>
              <span className="ox-ca-sub">{T.shifts.emptySub}</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const a = c.accountOf(sel.accountId);
  const see = !!a?.balance;
  const closed = sel.status !== 'open';
  const tol = a?.tolerance?.amountMinor ?? 0;
  const chip = shiftChip(sel.status);
  const cur =
    rv && rv.id === sel.id ? rv : { id: sel.id, reason: T.shifts.reasons[0], comment: '' };
  const text = cur.reason + (cur.comment.trim() ? `: ${cur.comment.trim()}` : '');
  const canClose = sel.status === 'open' && can(a, 'cash.shift.operate');
  const canReview =
    sel.status === 'review' && can(a, 'cash.reconcile') && sel.closedByMemberId !== c.meId;
  const toSafe = sel.toSafeTransferId
    ? c.transfers.find((t) => t.id === sel.toSafeTransferId)?.amount.amountMinor
    : undefined;
  const exp = a ? expectedNow(sel, a) : null;

  const facts: FactData[] = [
    { l: T.shifts.openedBy, v: c.memberName(sel.openedByMemberId), s: fmtAt(sel.openedAt) },
    {
      l: T.shifts.float,
      v: rub(sel.openingFloat.amountMinor),
      s:
        sel.openingDiff && sel.openingDiff.amountMinor
          ? format(T.shifts.floatDiff, { sum: signRub(sel.openingDiff.amountMinor) })
          : '',
      ...(sel.openingDiff && sel.openingDiff.amountMinor ? { tone: 'warn' as const } : {}),
    },
  ];
  if (!closed) {
    facts.push(
      exp !== null
        ? { l: T.shifts.expected, v: rub(exp), s: T.shifts.expectedNote }
        : { l: T.shifts.expected, v: T.shifts.expectedHidden, s: T.shifts.expectedHiddenNote },
    );
  } else {
    facts.push({
      l: T.shifts.closedBy,
      v: c.memberName(sel.closedByMemberId),
      s: sel.closedAt ? fmtAt(sel.closedAt) : '',
    });
    facts.push({
      l: T.shifts.counted,
      v: rub(sel.counted?.amountMinor ?? 0),
      s: toSafe ? format(T.shifts.toSafe, { sum: rub(toSafe) }) : '',
    });
  }

  const notes: ReactElement[] = [];
  if (closed && !see)
    notes.push(
      <Note key="blind" tone="info" icon="visibility_off">
        {format(T.shifts.noteBlind, { sum: rub(sel.counted?.amountMinor ?? 0) })}
      </Note>,
    );
  if (closed && see && sel.diff && sel.diff.term.amountMinor > 0)
    notes.push(
      <Note key="term" tone="info" icon="manage_search">
        {format(T.shifts.noteTerm, { sum: rub(sel.diff.term.amountMinor) })}
      </Note>,
    );
  if (sel.status === 'review' && sel.closedByMemberId === c.meId && see)
    notes.push(
      <Note key="self" tone="warn" icon="person_off">
        {T.shifts.noteSelf}
      </Note>,
    );
  if (sel.decision) {
    const d = sel.decision;
    notes.push(
      <Note key="decision" tone={d.kind === 'auto' ? 'ok' : 'warn'} icon="check_circle">
        {(d.kind === 'auto'
          ? format(T.shifts.noteAuto, { reason: d.reason })
          : format(T.shifts.noteAccepted, {
              name: c.memberName(d.byMemberId),
              at: fmtAt(d.at),
              reason: d.reason,
            })) +
          (d.operationId
            ? format(T.shifts.noteOp, { id: d.operationId.slice(-5).toUpperCase() })
            : '')}
      </Note>,
    );
  }
  const recount =
    sel.status === 'open' ? [...sel.attempts].reverse().find((x) => x.recountReason) : undefined;
  if (recount?.recountReason)
    notes.push(
      <Note key="recount" tone="warn" icon="restart_alt">
        {format(T.shifts.noteRecount, {
          at: fmtAt(recount.closedAt),
          reason: recount.recountReason,
        })}
      </Note>,
    );

  const review = async (decision: 'accept' | 'recount'): Promise<void> => {
    setErr('');
    const r = await c.submit(
      `review:${sel.id}:${decision}`,
      (key) => reviewShift(c.api, c.tenantId, sel, { decision, reason: text }, key),
      decision === 'recount' ? format(T.shifts.recounted, { no: sel.number }) : T.shifts.accepted,
    );
    if (!r.ok) setErr(r.error);
  };

  return (
    <div className="ox-ca-cols">
      <aside aria-label={T.shifts.aria} className="ox-ca-aside" data-list="true">
        {list.map((h) => {
          const ha = c.accountOf(h.accountId);
          const d = h.diff && ha?.balance ? h.diff.cash.amountMinor : null;
          const ch = shiftChip(h.status);
          return (
            <button
              key={h.id}
              type="button"
              className="ox-ca-pick ox-ca-shiftrow"
              aria-pressed={h.id === sel.id}
              onClick={() => {
                setRv(null);
                p.onSelect(h.id);
              }}
            >
              <span className="ox-ca-pickmain">
                <strong>
                  {format(T.shifts.listTitle, { no: h.number, name: ha?.name ?? '' })}
                </strong>
                <span>
                  {fmtAt(h.openedAt)}
                  {h.closedAt ? ` — ${fmtTime(h.closedAt)}` : ''} ·{' '}
                  {c.memberName(h.openedByMemberId)}
                </span>
              </span>{' '}
              <span className="ox-ca-pickside">
                <Chip label={ch.label} tone={ch.tone} icon={ch.icon} size="sm" />
                <span
                  className="ox-ca-diff"
                  style={{
                    color:
                      d === null || d === 0
                        ? 'var(--ox-text-muted)'
                        : h.status === 'review'
                          ? 'var(--ox-danger-fg)'
                          : 'var(--ox-warn-fg)',
                  }}
                >
                  {d === null ? '' : d === 0 ? T.shifts.noDiff : signRub(d)}
                </span>
              </span>
            </button>
          );
        })}
      </aside>
      <section
        aria-label={format(T.shifts.listTitle, { no: sel.number, name: a?.name ?? '' })}
        className="ox-ca-aside"
      >
        <div className="ox-ca-card">
          <div className="ox-ca-chead">
            <span className="ox-ca-ctitle">
              <span className="ox-ca-phead">
                <h2>{format(T.shifts.listTitle, { no: sel.number, name: a?.name ?? '' })}</h2>
                <Chip label={chip.label} tone={chip.tone} icon={chip.icon} size="lg" />
              </span>
              <span className="ox-ca-sub">
                {[
                  a ? MODE_LABEL[a.shiftMode] : '',
                  a?.kktMode === 'manual' ? T.shifts.modeKkt : '',
                  tol ? format(T.shifts.tolerance, { sum: rub(tol) }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {canClose ? (
              <Button
                variant="primary"
                icon="lock"
                disabled={c.offline}
                onClick={() => c.openModal({ kind: 'closeShift', shiftId: sel.id })}
              >
                {T.shifts.close}
              </Button>
            ) : null}
          </div>
          <Facts facts={facts} min={160} />
          {closed && see ? <Table shift={sel} tol={tol} /> : null}
          {notes}
          {canReview ? (
            <div className="ox-ca-review">
              <strong>{T.shifts.reviewTitle}</strong>
              <Seg
                label={T.shifts.reasonsAria}
                value={cur.reason}
                options={T.shifts.reasons.map((x) => [x, x] as const)}
                onChange={(k) => setRv({ ...cur, reason: k })}
                soft
              />
              <input
                className="ox-ca-input"
                aria-label={T.shifts.commentAria}
                value={cur.comment}
                placeholder={T.shifts.commentPh}
                onChange={(e) => setRv({ ...cur, comment: e.target.value })}
              />
              {err ? (
                <div role="alert" className="ox-ca-alert">
                  <Icon name="error" size={18} />
                  <span className="ox-ca-alert-text">{err}</span>
                </div>
              ) : null}
              <div className="ox-ca-rbtns">
                <Button disabled={c.busy || c.offline} onClick={() => void review('recount')}>
                  {T.shifts.recountBtn}
                </Button>
                <Button
                  variant="danger"
                  disabled={c.busy || c.offline}
                  onClick={() => void review('accept')}
                >
                  {T.shifts.acceptBtn}
                </Button>
              </div>
              <span className="ox-ca-help">{T.shifts.reviewFoot}</span>
            </div>
          ) : null}
        </div>
        <OpsList
          reverse={false}
          ops={c.ops.filter((o) => o.shiftId === sel.id)}
          title={T.shifts.ops}
          empty={T.shifts.opsEmpty}
        />
      </section>
    </div>
  );
}
