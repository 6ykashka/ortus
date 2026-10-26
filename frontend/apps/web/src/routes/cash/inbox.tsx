// W5.32 · Вкладка «Входящие» (K:107–193, inboxVM K:663–693, postVM K:695–737): слева заявки на согласование, деньги
// «в пути» и предложения модулей по группам; справа панель проведения предложения, заявки или перемещения.
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, type ReactNode, useState } from 'react';

import { decideRequest, decideTransfer, linkSource, postProposal, useDuplicates } from './api.ts';
import { can, useCash } from './ctx.tsx';
import {
  type Account,
  canAcceptTransfer,
  canDecideRequest,
  fmtAt,
  limitFor,
  METHOD_INFO,
  type Method,
  overLimit,
  parseRub,
  REQ_LABEL,
  rub,
  splitSum,
  type Tone,
} from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import { Alert, Button, Chip, Note, Seg, SwitchRow, TextField } from './ui.tsx';

type S = components['schemas'];

const GROUP_OF: Record<S['CashProposal']['kind'], { title: string; icon: string }> = {
  visit: { title: T.inbox.groups.visit, icon: 'spa' },
  expense: { title: T.inbox.groups.expense, icon: 'local_shipping' },
  refund: { title: T.inbox.groups.refund, icon: 'support_agent' },
  purchase: { title: T.inbox.groups.purchase, icon: 'construction' },
  payroll: { title: T.inbox.groups.payroll, icon: 'construction' },
  invoice: { title: T.inbox.groups.invoice, icon: 'construction' },
};

const SRC_ICON: Record<string, string> = {
  visit: 'spa',
  appointment: 'spa',
  trip: 'local_shipping',
  service: 'support_agent',
  repair: 'construction',
};

interface Item {
  key: string;
  title: string;
  sub: string;
  amount: string;
  chip: { label: string; tone: Tone };
  fin: boolean;
}
interface Group {
  title: string;
  icon: string;
  items: Item[];
}

const chipOf = (p: S['CashProposal']): { label: string; tone: Tone } =>
  p.kind === 'refund'
    ? { label: T.inbox.chipRefund, tone: 'warn' }
    : p.direction === 'in'
      ? { label: T.inbox.chipIn, tone: 'ok' }
      : { label: T.inbox.chipOut, tone: 'neutral' };

function Row(p: { l: string; v: ReactNode }): ReactElement {
  return (
    <div className="ox-ca-row">
      <span>{p.l}</span>
      <span>{p.v}</span>
    </div>
  );
}

/** Время чека «ЧЧ:ММ» (Москва) сегодняшнего дня → момент; пусто или неверно — не задано. */
function receiptAt(time: string, now: Date): string | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return undefined;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const iso = `${day}T${(m[1] ?? '0').padStart(2, '0')}:${m[2] ?? '00'}:00+03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace('.000Z', 'Z');
}

interface Pay {
  key: string;
  method: Method | 'split';
  cash: string;
  card: string;
  fd: string;
  kkt: string;
  time: string;
  none: boolean;
  reason: string;
  dupOk: boolean;
}

function ProposalPanel(p: { prop: S['CashProposal']; onDone: () => void }): ReactElement {
  const c = useCash();
  const { prop } = p;
  const candidates = c.accounts.filter(
    (a) =>
      can(a, 'cash.proposals.post') &&
      a.kind !== 'advance' &&
      (prop.direction === 'in' ? a.kind !== 'acquiring' : true),
  );
  const a: Account | undefined =
    candidates.find((x) => x.id === prop.defaultAccountId) ?? candidates[0];
  const term = a ? c.accounts.find((x) => x.drawerAccountId === a.id) : undefined;
  const drawer =
    a && a.kind === 'acquiring' && a.drawerAccountId ? c.accountOf(a.drawerAccountId) : a;
  const fiscal =
    (prop.direction === 'in' || prop.kind === 'refund') && !!drawer && drawer.kktMode === 'manual';
  const needShift = !!drawer && drawer.kind === 'cash_drawer' && drawer.shiftMode !== 'none';
  const shift = needShift
    ? c.shifts.find((x) => x.accountId === drawer.id && x.status === 'open')
    : undefined;
  const initial = (): Pay => ({
    key: prop.key,
    method: prop.direction === 'in' ? (a?.kind === 'bank' ? 'transfer' : 'cash') : 'cash',
    cash: '',
    card: '',
    fd: '',
    kkt: shift ? String(shift.number) : '',
    time: '',
    none: false,
    reason: '',
    dupOk: false,
  });
  const [pay, setPay] = useState<Pay>(initial);
  const [errState, setErrState] = useState({ key: '', text: '' });
  const err = errState.key === prop.key ? errState.text : '';
  const setErr = (text: string): void => setErrState({ key: prop.key, text });
  const cur = pay.key === prop.key ? pay : initial();
  const set = (patch: Partial<Pay>): void => {
    setPay({ ...cur, ...patch });
    setErr('');
  };

  const amount = prop.amount.amountMinor;
  const split = cur.method === 'split';
  const methods: [Pay['method'], string][] =
    prop.direction === 'in' && a?.kind === 'cash_drawer'
      ? [
          ['cash', T.inbox.methods.cash],
          ...(term
            ? ([
                ['card', T.inbox.methods.card],
                ['sbp', T.inbox.methods.sbp],
                ['split', T.inbox.methods.split],
              ] as [Pay['method'], string][])
            : []),
        ]
      : [];
  const destOf = (m: Method): string =>
    (m === 'card' || m === 'sbp') && term ? term.name : (a?.name ?? '—');
  const dest = (m: Method): string =>
    destOf(m) + (needShift && shift ? format(T.inbox.destShift, { no: shift.number }) : '');
  const parts: {
    icon: string;
    label: string;
    edit: boolean;
    value: string;
    dest: string;
    on?: (v: string) => void;
  }[] = split
    ? [
        {
          icon: METHOD_INFO.card.icon,
          label: METHOD_INFO.card.label,
          edit: true,
          value: cur.card,
          dest: dest('card'),
          on: (v) => set({ card: v }),
        },
        {
          icon: METHOD_INFO.cash.icon,
          label: METHOD_INFO.cash.label,
          edit: true,
          value: cur.cash,
          dest: dest('cash'),
          on: (v) => set({ cash: v }),
        },
      ]
    : [
        {
          icon: METHOD_INFO[cur.method as Method].icon,
          label: METHOD_INFO[cur.method as Method].label,
          edit: false,
          value: rub(amount),
          dest: dest(cur.method as Method),
        },
      ];
  const sumInfo = split ? splitSum([cur.cash, cur.card], amount) : { sum: amount, ok: true };
  const type: 'in' | 'out' | 'refund' =
    prop.direction === 'in' ? 'in' : prop.kind === 'refund' ? 'refund' : 'out';
  const lim = a ? limitFor(a, type) : null;
  const over = overLimit(lim, amount);
  const dupQ = useDuplicates(
    c.tenantId,
    {
      accountId: a?.id ?? '',
      amountMinor: amount,
      method: split ? 'cash' : (cur.method as Method),
      type,
    },
    !!a && !split,
  );
  const dup = cur.dupOk
    ? undefined
    : (dupQ.data ?? []).find((o) => !o.source && !o.reversedByOperationId);

  const post = async (): Promise<void> => {
    if (!a) return;
    if (!sumInfo.ok) return setErr(T.errors.parts);
    if (fiscal) {
      if (cur.none && cur.reason.trim().length < 3) return setErr(T.errors.reason);
      if (!cur.none && !/^\d{1,20}$/.test(cur.fd.trim())) return setErr(T.errors.fd);
    }
    const body: S['CashProposalPost'] = {
      accountId: a.id,
      parts: split
        ? [
            { method: 'cash', amount: { amountMinor: parseRub(cur.cash) ?? 0, currency: 'RUB' } },
            { method: 'card', amount: { amountMinor: parseRub(cur.card) ?? 0, currency: 'RUB' } },
          ]
        : [{ method: cur.method as Method, amount: prop.amount }],
      ...(fiscal
        ? {
            receipt: cur.none
              ? { none: true, reason: cur.reason.trim() }
              : {
                  fdNumber: cur.fd.trim(),
                  kktShift: cur.kkt.trim() || '0',
                  ...(receiptAt(cur.time, c.now)
                    ? { receiptAt: receiptAt(cur.time, c.now) as string }
                    : {}),
                },
          }
        : {}),
    };
    const r = await c.submit(
      `post:${prop.key}`,
      (key) => postProposal(c.api, c.tenantId, prop.key, body, key),
      (x) =>
        x.kind === 'request'
          ? T.dialogs.op.okRequest
          : format(T.dialogs.proposalOk, { sum: rub(amount) }),
    );
    if (r.ok) {
      setPay(initial());
      p.onDone();
    } else setErr(r.error);
  };

  const notes: ReactElement[] = [];
  if (needShift && !shift && drawer)
    notes.push(
      <Note key="closed" tone="warn" icon="lock">
        {format(T.inbox.noteShiftClosed, { name: drawer.name })}
      </Note>,
    );
  if (over && lim !== null)
    notes.push(
      <Note key="over" tone="warn" icon="approval">
        {format(T.inbox.noteOver, { sum: rub(amount), limit: rub(lim) })}
      </Note>,
    );
  if (!a)
    notes.push(
      <Note key="noacc" tone="warn" icon="block">
        {T.inbox.noAccount}
      </Note>,
    );
  const head =
    (prop.direction === 'in'
      ? T.inbox.headIn
      : prop.kind === 'refund'
        ? T.inbox.headRefund
        : T.inbox.headOut) +
    ' · ' +
    prop.title.split(' · ')[0];
  const catTitle = c.categories.find((x) => x.id === prop.categoryId)?.title ?? '—';
  const effects: { icon: string; t: string }[] = [];
  if (a) {
    if (prop.direction === 'in') {
      (split
        ? ([
            ['card', cur.card],
            ['cash', cur.cash],
          ] as [Method, string][])
        : ([[cur.method as Method, '']] as [Method, string][])
      ).forEach(([m, v]) => {
        const n = split ? parseRub(v) : amount;
        effects.push({
          icon: 'receipt_long',
          t: format(T.inbox.effectIn, {
            sum: n && n > 0 ? rub(n) : '…',
            method: METHOD_INFO[m].label.toLowerCase(),
            name: destOf(m),
          }),
        });
      });
    } else {
      effects.push({
        icon: 'receipt_long',
        t: format(prop.kind === 'refund' ? T.inbox.effectRefund : T.inbox.effectOut, {
          sum: rub(amount),
          name: a.name,
          cat: catTitle,
        }),
      });
    }
    effects.push({
      icon: 'link',
      t: format(T.inbox.effectLink, { label: prop.source.label ?? prop.source.id }),
    });
    if (needShift)
      effects.push({
        icon: 'fact_check',
        t: format(T.inbox.effectShift, { no: shift ? ` ${String(shift.number)}` : '' }),
      });
  }

  return (
    <div className="ox-ca-pbody">
      <div className="ox-ca-phead">
        <h3>{head}</h3>
        <Chip
          label={format(T.inbox.sourceChip, { label: prop.source.label ?? prop.source.id })}
          tone="info"
          icon={SRC_ICON[prop.source.kind] ?? 'inbox'}
          size="lg"
        />
      </div>
      <div className="ox-ca-box">
        <span className="ox-ca-boxmain">
          <strong>{prop.title}</strong>
          <span>{prop.source.label ?? ''}</span>
        </span>
        <span className="ox-ca-boxside">
          <strong>{rub(amount)}</strong>
        </span>
      </div>
      {methods.length > 1 ? (
        <div className="ox-ca-stack">
          <span className="ox-ca-label">{T.inbox.method}</span>
          <Seg
            label={T.inbox.method}
            value={cur.method}
            options={methods}
            onChange={(k) => set({ method: k, cash: '', card: '' })}
            fill
          />
        </div>
      ) : null}
      <div className="ox-ca-parts">
        {parts.map((x) => (
          <div key={x.label} className="ox-ca-part">
            <span className="ox-ca-partlabel">
              <Icon name={x.icon} size={18} />
              {x.label}
            </span>
            {x.edit ? (
              <input
                className="ox-ca-input"
                inputMode="decimal"
                aria-label={x.label}
                value={x.value}
                onChange={(e) => x.on?.(e.target.value)}
              />
            ) : (
              <strong>{x.value}</strong>
            )}
            <span className="ox-ca-partdest">
              <Icon name="arrow_forward" size={16} />
              <span>{x.dest}</span>
            </span>
          </div>
        ))}
        <div className="ox-ca-sum" data-bad={sumInfo.ok ? undefined : 'true'}>
          <Icon name={sumInfo.ok ? 'check_circle' : 'error'} size={16} />
          {sumInfo.ok
            ? format(T.inbox.sumOk, { sum: rub(amount) })
            : format(T.inbox.sumBad, { got: rub(sumInfo.sum), sum: rub(amount) })}
        </div>
      </div>
      {fiscal ? (
        <div className="ox-ca-fiscal">
          <span className="ox-ca-fiscal-h">
            <strong>{T.inbox.fiscalTitle}</strong>
            <span>{T.inbox.fiscalHint}</span>
          </span>
          {!cur.none ? (
            <div className="ox-ca-grid3">
              <TextField
                label={T.inbox.fd}
                small
                mono
                inputMode="numeric"
                value={cur.fd}
                onChange={(v) => set({ fd: v })}
              />
              <TextField
                label={T.inbox.kktShift}
                small
                mono
                inputMode="numeric"
                value={cur.kkt}
                onChange={(v) => set({ kkt: v })}
              />
              <TextField
                label={T.inbox.receiptTime}
                small
                mono
                placeholder={T.inbox.receiptTimePh}
                value={cur.time}
                onChange={(v) => set({ time: v })}
              />
            </div>
          ) : null}
          <SwitchRow checked={cur.none} onChange={(v) => set({ none: v })}>
            {T.inbox.noReceipt}
          </SwitchRow>
          {cur.none ? (
            <input
              className="ox-ca-input"
              aria-label={T.inbox.reasonAria}
              value={cur.reason}
              placeholder={T.inbox.noReceiptReasonPh}
              onChange={(e) => set({ reason: e.target.value })}
            />
          ) : null}
        </div>
      ) : null}
      <div className="ox-ca-lockrow">
        <span className="ox-ca-locked">
          {T.inbox.catLocked}
          <span className="ox-ca-lockedv">
            {catTitle}
            <Icon name="lock" size={16} />
          </span>
        </span>
        <span className="ox-ca-locked">
          {T.inbox.basisLocked}
          <span className="ox-ca-lockedv">
            {prop.source.label ?? prop.source.id}
            <Icon name="lock" size={16} />
          </span>
        </span>
      </div>
      {notes}
      {dup ? (
        <div className="ox-ca-dup">
          <span className="ox-ca-dup-t">
            <Icon name="content_copy" size={18} />
            <span>
              {format(T.inbox.dupText, {
                id: dup.id.slice(-5).toUpperCase(),
                sum: rub(dup.amount.amountMinor),
                method: METHOD_INFO[dup.method].label.toLowerCase(),
                time: fmtAt(dup.occurredAt).split(' ')[1] ?? '',
                by: c.memberName(dup.createdByMemberId),
              })}
            </span>
          </span>
          <span className="ox-ca-dup-b">
            <Button
              small
              disabled={c.busy || c.offline}
              onClick={() =>
                void c
                  .call(
                    `link:${dup.id}`,
                    (key) => linkSource(c.api, c.tenantId, dup.id, prop.source, key),
                    format(T.inbox.linked, {
                      id: dup.id.slice(-5).toUpperCase(),
                      label: prop.source.label ?? prop.source.id,
                    }),
                  )
                  .then((r) => r && p.onDone())
              }
            >
              {format(T.inbox.dupLink, { id: dup.id.slice(-5).toUpperCase() })}
            </Button>
            <Button small onClick={() => set({ dupOk: true })}>
              {T.inbox.dupOther}
            </Button>
          </span>
        </div>
      ) : null}
      <div className="ox-ca-stack">
        <span className="ox-ca-label">{T.inbox.effects}</span>
        {effects.map((e) => (
          <span key={e.t} className="ox-ca-effect">
            <Icon name={e.icon} size={18} />
            <span>{e.t}</span>
          </span>
        ))}
      </div>
      {err ? <Alert>{err}</Alert> : null}
      <div className="ox-ca-pact">
        <Button
          disabled={c.offline || !can(a, 'cash.proposals.post')}
          onClick={() =>
            c.openModal({
              kind: 'reason',
              act: 'dismiss',
              id: prop.key,
              sub: `${prop.title} · ${rub(amount)}`,
              vars: {},
            })
          }
        >
          {T.inbox.dismiss}
        </Button>
        <Button variant="primary" disabled={c.busy || c.offline || !a} onClick={() => void post()}>
          {over ? T.inbox.toApproval : format(T.inbox.post, { sum: rub(amount) })}
        </Button>
      </div>
    </div>
  );
}

function RequestPanel(p: { q: S['CashApprovalRequest']; onDone: () => void }): ReactElement {
  const c = useCash();
  const { q } = p;
  const a = c.accountOf(q.accountId);
  const mine = canDecideRequest(q, a, c.meId);
  const cat = c.categories.find((x) => x.id === q.categoryId)?.title ?? '—';
  const sum = rub(q.amount.amountMinor);
  return (
    <div className="ox-ca-pbody">
      <div className="ox-ca-phead">
        <h3>{format(T.inbox.reqHead, { type: REQ_LABEL[q.type], sum })}</h3>
        {mine ? (
          <Chip label={T.inbox.reqMine} tone="warn" icon="approval" size="lg" />
        ) : (
          <Chip label={T.inbox.reqWait} tone="neutral" icon="schedule" size="lg" />
        )}
      </div>
      <div className="ox-ca-rows">
        <Row l={T.inbox.rows.account} v={a?.name ?? '—'} />
        <Row l={T.inbox.rows.basis} v={q.basis ?? '—'} />
        <Row l={T.inbox.rows.cat} v={cat} />
        <Row
          l={T.inbox.rows.author}
          v={`${c.memberName(q.requestedByMemberId)} · ${fmtAt(q.requestedAt)}`}
        />
        <Row l={T.inbox.rows.limit} v={q.limit ? rub(q.limit.amountMinor) : '—'} />
      </div>
      <span className="ox-ca-help">{T.inbox.reqHint}</span>
      {mine ? (
        <div className="ox-ca-pact">
          <Button
            disabled={c.offline}
            onClick={() =>
              c.openModal({
                kind: 'reason',
                act: 'rejectRq',
                id: q.id,
                sub: `${REQ_LABEL[q.type]} ${sum} · ${c.memberName(q.requestedByMemberId)}`,
                vars: {},
              })
            }
          >
            {T.inbox.reject}
          </Button>
          <Button
            variant="primary"
            disabled={c.busy || c.offline}
            onClick={() =>
              void c
                .call(
                  `approve:${q.id}`,
                  (key) => decideRequest(c.api, c.tenantId, q, { decision: 'approve' }, key),
                  T.inbox.approved,
                )
                .then((r) => r && p.onDone())
            }
          >
            {T.inbox.approve}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TransferPanel(p: { t: S['CashTransfer']; onDone: () => void }): ReactElement {
  const c = useCash();
  const { t } = p;
  const from = c.accountOf(t.fromAccountId)?.name ?? '—';
  const to = c.accountOf(t.toAccountId)?.name ?? '—';
  const sum = rub(t.amount.amountMinor);
  return (
    <div className="ox-ca-pbody">
      <h3 className="ox-ca-phead">{`${t.note ?? ''} · ${sum}`}</h3>
      <div className="ox-ca-rows">
        <Row l={T.inbox.rows.from} v={from} />
        <Row l={T.inbox.rows.to} v={to} />
        <Row l={T.inbox.rows.handed} v={`${c.memberName(t.sentByMemberId)} · ${fmtAt(t.sentAt)}`} />
        <Row l={T.inbox.rows.sum} v={sum} />
      </div>
      <span className="ox-ca-help">{T.inbox.trHint}</span>
      <div className="ox-ca-pact">
        <Button
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
          {T.inbox.trReject}
        </Button>
        <Button
          variant="primary"
          disabled={c.busy || c.offline}
          onClick={() =>
            void c
              .call(
                `accept:${t.id}`,
                (key) => decideTransfer(c.api, c.tenantId, t, { decision: 'accept' }, key),
                format(T.moves.accepted, { sum }),
              )
              .then((r) => r && p.onDone())
          }
        >
          {format(T.inbox.trAccept, { sum })}
        </Button>
      </div>
    </div>
  );
}

export function InboxTab(p: {
  selected: string | undefined;
  onSelect: (k: string | undefined) => void;
}): ReactElement {
  const c = useCash();
  const groups: Group[] = [];
  const keys: string[] = [];
  const add = (g: Group): void => {
    groups.push(g);
    g.items.forEach((i) => keys.push(i.key));
  };
  const reqs = c.requests.filter(
    (q) =>
      q.status === 'pending' &&
      (canDecideRequest(q, c.accountOf(q.accountId), c.meId) || q.requestedByMemberId === c.meId),
  );
  if (reqs.length)
    add({
      title: T.inbox.groupApproval,
      icon: 'approval',
      items: reqs.map((q) => ({
        key: `rq:${q.id}`,
        title: `${REQ_LABEL[q.type]} · ${c.accountOf(q.accountId)?.name ?? ''}`,
        sub: `${q.basis ?? ''} · ${c.memberName(q.requestedByMemberId)}`,
        amount: rub(q.amount.amountMinor),
        chip: canDecideRequest(q, c.accountOf(q.accountId), c.meId)
          ? { label: T.inbox.chipDecide, tone: 'warn' }
          : { label: T.inbox.chipWaiting, tone: 'neutral' },
        fin: false,
      })),
    });
  const trs = c.transfers.filter((t) => canAcceptTransfer(t, c.accountOf(t.toAccountId)));
  if (trs.length)
    add({
      title: T.inbox.groupTransit,
      icon: 'move_down',
      items: trs.map((t) => ({
        key: `tr:${t.id}`,
        title: t.note ?? '',
        sub: `из «${c.accountOf(t.fromAccountId)?.name ?? ''}» в «${c.accountOf(t.toAccountId)?.name ?? ''}» · ${c.memberName(t.sentByMemberId)}`,
        amount: rub(t.amount.amountMinor),
        chip: { label: T.inbox.chipTransit, tone: 'info' },
        fin: false,
      })),
    });
  const order: S['CashProposal']['kind'][] = [
    'visit',
    'expense',
    'refund',
    'purchase',
    'payroll',
    'invoice',
  ];
  const byGroup = new Map<string, Group>();
  for (const k of order) {
    for (const pr of c.proposals.filter((x) => x.kind === k && x.status === 'open')) {
      const meta = GROUP_OF[k];
      const g = byGroup.get(meta.title) ?? { title: meta.title, icon: meta.icon, items: [] };
      g.items.push({
        key: `pr:${pr.key}`,
        title: pr.title,
        sub: pr.source.label ?? '',
        amount: rub(pr.amount.amountMinor),
        chip: chipOf(pr),
        fin: k === 'payroll',
      });
      byGroup.set(meta.title, g);
    }
  }
  [...byGroup.values()].forEach(add);
  const key = p.selected && keys.includes(p.selected) ? p.selected : keys[0];
  const done = (): void => p.onSelect(undefined);

  let panel: ReactElement;
  if (!key) {
    panel = <div className="ox-ca-pnone">{T.inbox.pick}</div>;
  } else if (key.startsWith('rq:')) {
    const q = c.requests.find((x) => `rq:${x.id}` === key);
    panel = q ? (
      <RequestPanel q={q} onDone={done} />
    ) : (
      <div className="ox-ca-pnone">{T.inbox.pick}</div>
    );
  } else if (key.startsWith('tr:')) {
    const t = c.transfers.find((x) => `tr:${x.id}` === key);
    panel = t ? (
      <TransferPanel t={t} onDone={done} />
    ) : (
      <div className="ox-ca-pnone">{T.inbox.pick}</div>
    );
  } else {
    const pr = c.proposals.find((x) => `pr:${x.key}` === key);
    panel = pr ? (
      <ProposalPanel prop={pr} onDone={done} />
    ) : (
      <div className="ox-ca-pnone">{T.inbox.pick}</div>
    );
  }

  return (
    <div className="ox-ca-cols" data-wide="true">
      <aside aria-label={T.inbox.aria} className="ox-ca-aside" data-list="true">
        {groups.map((g) => (
          <div key={g.title} className="ox-ca-igroupbox">
            <span className="ox-ca-igroup">
              <Icon name={g.icon} size={15} />
              {g.title}
            </span>
            {g.items.map((it) => (
              <button
                key={it.key}
                type="button"
                className="ox-ca-pick"
                aria-pressed={it.key === key}
                onClick={() => p.onSelect(it.key)}
              >
                <span className="ox-ca-pickmain">
                  <strong>{it.title}</strong>
                  <span>{it.sub}</span>
                </span>{' '}
                <span className="ox-ca-pickside">
                  <strong>{it.amount}</strong>
                  <Chip label={it.chip.label} tone={it.chip.tone} size="sm" />
                </span>
                {it.fin ? (
                  <span className="ox-ca-pickfin">
                    <Icon name="lock" size={15} />
                    {T.inbox.fin}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        {keys.length === 0 ? <div className="ox-ca-asideempty">{T.inbox.empty}</div> : null}
        <span className="ox-ca-asidefoot">{T.inbox.footer}</span>
      </aside>
      <section aria-label={T.inbox.panelAria} className="ox-ca-panel">
        {panel}
      </section>
    </div>
  );
}
