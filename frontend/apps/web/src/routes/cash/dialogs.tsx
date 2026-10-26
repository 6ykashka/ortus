// W5.32 · Диалоги страницы «Касса» (K:345–515, modalVM K:838–944): «Новая операция», «Открыть смену», «Закрыть смену»,
// «Перемещение» и «Причина» (сторно, «Не принимать», «Отклонить», «Не проводить»). «Новая касса» — account-dialog.tsx.
// Ошибка команды остаётся в диалоге (alert), успех закрывает его и даёт тост.
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import { type ReactElement, type ReactNode, useState } from 'react';

import {
  closeShift,
  createTransfer,
  decideRequest,
  decideTransfer,
  dismissProposal,
  openShift,
  postOperation,
  reverseOperation,
  useDuplicates,
} from './api.ts';
import { can, type Modal, useCash } from './ctx.tsx';
import {
  type Account,
  closeTotals,
  DENOMS,
  expectedNow,
  fmtAt,
  fmtTime,
  limitFor,
  METHOD_INFO,
  METHODS_OF,
  type Method,
  money,
  overLimit,
  parseRub,
  rub,
} from './model.ts';
import { CASH_TEXT as T } from './texts.ts';
import {
  Alert,
  Button,
  Note,
  opCode,
  SelectField,
  Seg,
  Steps,
  SwitchRow,
  TextField,
} from './ui.tsx';

type S = components['schemas'];
const D = T.dialogs;

function Shell(p: {
  title: string;
  sub?: string;
  submit: string;
  danger?: boolean;
  error: string;
  busy: boolean;
  disabled?: boolean;
  width?: 'w640' | 'w980';
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Dialog
      open
      onClose={p.onClose}
      busy={p.busy}
      size="lg"
      title={p.title}
      footer={
        <div className="ox-ca-dfoot">
          {p.error ? <Alert>{p.error}</Alert> : null}
          <div className="ox-ca-dbtns">
            <Button onClick={p.onClose} disabled={p.busy}>
              {D.cancel}
            </Button>
            <Button
              variant={p.danger ? 'danger' : 'primary'}
              disabled={p.busy || p.disabled}
              onClick={p.onSubmit}
            >
              {p.submit}
            </Button>
          </div>
        </div>
      }
    >
      <div className={`ox-ca-form${p.width ? ` ox-ca-${p.width}` : ''}`}>
        {p.sub ? <p className="ox-ca-dsub">{p.sub}</p> : null}
        {p.children}
      </div>
    </Dialog>
  );
}

const opAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter(
    (a) => can(a, 'cash.post') && a.kind !== 'advance' && !(a.my.isHolder && a.my.via === 'self'),
  );

// ─────────────────────────── Новая операция ───────────────────────────

type OpType = 'in' | 'out' | 'refund';
const CATEGORY_OF: Record<OpType, S['CashOperation']['category']> = {
  in: 'service_payment',
  out: 'expense',
  refund: 'refund',
};

export function OpDialog(p: { modal: Extract<Modal, { kind: 'op' }> }): ReactElement | null {
  const c = useCash();
  const list = opAccounts(c.accounts);
  const first = list.find((a) => a.id === p.modal.accountId) ?? list[0];
  return first ? <OpForm modal={p.modal} list={list} first={first} /> : null;
}

function OpForm(p: {
  modal: Extract<Modal, { kind: 'op' }>;
  list: Account[];
  first: Account;
}): ReactElement {
  const c = useCash();
  const { list, first } = p;
  const [accountId, setAccountId] = useState(first?.id ?? '');
  const [type, setType] = useState<OpType>(p.modal.type ?? 'in');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method | ''>('');
  const [cat, setCat] = useState('');
  const [basis, setBasis] = useState('');
  const [ref, setRef] = useState('');
  const [fd, setFd] = useState('');
  const [kkt, setKkt] = useState('');
  const [none, setNone] = useState(false);
  const [reason, setReason] = useState('');
  const [seller, setSeller] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const a = c.accountOf(accountId) ?? first;
  const types: OpType[] = can(a, 'cash.refund') ? ['in', 'out', 'refund'] : ['in', 'out'];
  const t: OpType = types.includes(type) ? type : 'in';
  const methods = METHODS_OF[a.kind];
  const m: Method = method && methods.includes(method) ? method : (methods[0] ?? 'cash');
  const cats = c.categories.filter((x) =>
    t === 'in' ? x.group === 'income' : t === 'refund' ? x.id === 'refund' : x.group === 'expense',
  );
  const catId = cats.some((x) => x.id === cat) ? cat : (cats[0]?.id ?? '');
  const drawer = a.kind === 'acquiring' && a.drawerAccountId ? c.accountOf(a.drawerAccountId) : a;
  const fiscal = (t === 'in' || t === 'refund') && !!drawer && drawer.kktMode === 'manual';
  const shiftMode = !!drawer && drawer.kind === 'cash_drawer' && drawer.shiftMode !== 'none';
  const shift = shiftMode
    ? c.shifts.find((x) => x.accountId === drawer.id && x.status === 'open')
    : undefined;
  const sumMinor = parseRub(amount);
  const lim = limitFor(a, t);
  const over = sumMinor !== null && overLimit(lim, sumMinor);
  const dupQ = useDuplicates(
    c.tenantId,
    { accountId: a.id, amountMinor: sumMinor ?? 0, method: m, type: t },
    !!sumMinor && sumMinor > 0,
  );
  const dup = (dupQ.data ?? []).find((o) => !o.reversedByOperationId);
  const refs =
    t === 'refund'
      ? c.ops
          .filter(
            (o) =>
              o.type === 'in' &&
              !o.reversedByOperationId &&
              [
                a.id,
                ...c.accounts
                  .filter((x) => x.drawerAccountId === a.id || x.id === a.drawerAccountId)
                  .map((x) => x.id),
              ].includes(o.accountId),
          )
          .slice(0, 12)
          .map((o) => ({
            value: o.id,
            label: `${opCode(o.id)} · ${o.basis ?? ''} · ${rub(o.amount.amountMinor)} · ${fmtAt(o.occurredAt)}`,
          }))
      : [];
  const notes: ReactElement[] = [];
  if (shiftMode && !shift && drawer)
    notes.push(
      <Note key="closed" tone="warn" icon="lock">
        {format(D.op.noteClosed, { name: drawer.name })}
      </Note>,
    );
  if (over && lim !== null && sumMinor !== null)
    notes.push(
      <Note key="over" tone="warn" icon="approval">
        {format(D.op.noteOver, { sum: rub(sumMinor), limit: rub(lim) })}
      </Note>,
    );
  if (dup)
    notes.push(
      <Note key="dup" tone="warn" icon="content_copy">
        {format(D.op.noteDup, {
          id: opCode(dup.id),
          sum: rub(dup.amount.amountMinor),
          time: fmtTime(dup.occurredAt),
          basis: dup.basis ?? '',
        })}
      </Note>,
    );
  if (
    a.balance &&
    t !== 'in' &&
    (a.kind === 'cash_drawer' || a.kind === 'safe') &&
    sumMinor !== null &&
    sumMinor > a.balance.amountMinor
  )
    notes.push(
      <Note key="minus" tone="danger" icon="block">
        {format(D.op.noteMinus, { sum: rub(a.balance.amountMinor) })}
      </Note>,
    );

  const submit = async (): Promise<void> => {
    if (sumMinor === null || sumMinor <= 0) return setErr(T.errors.amount);
    if (basis.trim().length < 3) return setErr(T.errors.basis);
    if (t === 'refund' && !ref) return setErr(T.errors.ref);
    let receipt: S['CashReceipt'] | undefined;
    if (fiscal) {
      if (none) {
        if (reason.trim().length < 3) return setErr(T.errors.reason);
        receipt = { none: true, reason: reason.trim() };
      } else {
        if (!/^\d{1,20}$/.test(fd.trim())) return setErr(T.errors.fd);
        receipt = {
          fdNumber: fd.trim(),
          kktShift: kkt.trim() || (shift ? String(shift.number) : '0'),
        };
      }
    } else if (t === 'out' && seller) {
      receipt = { sellerMemberId: c.meId };
    }
    const body: S['CashOperationCreate'] = {
      accountId: a.id,
      type: t,
      direction: t === 'in' ? 'in' : 'out',
      method: m,
      amount: money(sumMinor),
      category: CATEGORY_OF[t],
      categoryId: catId || null,
      basis: basis.trim(),
      occurredAt: c.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ...(receipt ? { receipt } : {}),
      ...(t === 'refund' ? { refundsOperationId: ref } : {}),
    };
    setBusy(true);
    setErr('');
    const r = await c.submit(
      `op:${a.id}:${t}:${String(sumMinor)}:${basis.trim()}`,
      (key) => postOperation(c.api, c.tenantId, body, key),
      (x) => (x.kind === 'request' ? D.op.okRequest : D.op.okPosted),
    );
    setBusy(false);
    if (r.ok) c.closeModal();
    else setErr(r.error);
  };

  return (
    <Shell
      title={D.op.title}
      sub={format(D.op.sub, {
        name: a.name,
        shift: shift ? format(D.op.shift, { no: shift.number }) : '',
      })}
      submit={over ? D.op.toApproval : D.op.submit}
      error={err}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={c.closeModal}
    >
      <Seg
        label={D.op.typesAria}
        value={t}
        options={types.map((k) => [k, D.op.types[k]] as const)}
        onChange={(k) => {
          setType(k);
          setCat('');
          setRef('');
        }}
        fill
      />
      <div className="ox-ca-fgrid">
        <SelectField
          label={D.op.account}
          value={a.id}
          onChange={(v) => {
            setAccountId(v);
            setMethod('');
          }}
          options={list.map((x) => ({ value: x.id, label: x.name }))}
        />
        <TextField
          label={D.op.amount}
          inputMode="decimal"
          value={amount}
          placeholder="0"
          onChange={setAmount}
        />
        <SelectField
          label={D.op.method}
          value={m}
          onChange={(v) => setMethod(v as Method)}
          options={methods.map((k) => ({ value: k, label: METHOD_INFO[k].label }))}
        />
        <SelectField
          label={D.op.cat}
          value={catId}
          onChange={setCat}
          options={cats.map((x) => ({ value: x.id, label: x.title }))}
        />
      </div>
      {t === 'refund' ? (
        <SelectField
          label={D.op.ref}
          value={ref}
          onChange={setRef}
          options={refs}
          hint={D.op.refHint}
        >
          <option value="">{D.op.refPick}</option>
        </SelectField>
      ) : null}
      <TextField
        label={D.op.basis}
        value={basis}
        placeholder={D.op.basisPh[t]}
        onChange={setBasis}
      />
      {fiscal ? (
        <div className="ox-ca-fiscal">
          <span className="ox-ca-fiscal-h">
            <strong>{D.op.fiscal}</strong>
            <span>{D.op.fiscalFor}</span>
          </span>
          {!none ? (
            <div className="ox-ca-grid3">
              <TextField
                label={T.inbox.fd}
                small
                mono
                inputMode="numeric"
                value={fd}
                onChange={setFd}
              />
              <TextField
                label={T.inbox.kktShift}
                small
                mono
                inputMode="numeric"
                value={kkt || (shift ? String(shift.number) : '')}
                onChange={setKkt}
              />
            </div>
          ) : null}
          <SwitchRow checked={none} onChange={setNone}>
            {D.op.noReceipt}
          </SwitchRow>
          {none ? (
            <input
              className="ox-ca-input"
              aria-label={T.inbox.reasonAria}
              value={reason}
              placeholder={D.op.reasonPh}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}
      {t === 'out' && !fiscal ? (
        <SwitchRow checked={seller} onChange={setSeller}>
          {D.op.seller}
        </SwitchRow>
      ) : null}
      {notes}
    </Shell>
  );
}

// ─────────────────────────── Открыть смену ───────────────────────────

export function OpenShiftDialog(p: {
  modal: Extract<Modal, { kind: 'openShift' }>;
}): ReactElement | null {
  const c = useCash();
  const a = c.accountOf(p.modal.accountId);
  const [counted, setCounted] = useState(String((a?.floatAmount?.amountMinor ?? 0) / 100));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!a) return null;
  const submit = async (): Promise<void> => {
    const n = parseRub(counted);
    if (n === null || n < 0) return setErr(T.errors.recountPick);
    setBusy(true);
    setErr('');
    const r = await c.submit(
      `open:${a.id}`,
      (key) => openShift(c.api, c.tenantId, a.id, { countedFloat: money(n) }, key),
      D.open.ok,
    );
    setBusy(false);
    if (r.ok) c.closeModal();
    else setErr(r.error);
  };
  return (
    <Shell
      title={D.open.title}
      sub={a.name}
      submit={D.open.submit}
      error={err}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={c.closeModal}
    >
      <TextField label={D.open.counted} inputMode="decimal" value={counted} onChange={setCounted} />
      <span className="ox-ca-help">
        {a.shiftMode === 'blind'
          ? D.open.blind
          : format(D.open.open, { sum: rub(a.floatAmount?.amountMinor ?? 0) })}
      </span>
    </Shell>
  );
}

// ─────────────────────────── Закрыть смену ───────────────────────────

export function CloseShiftDialog(p: {
  modal: Extract<Modal, { kind: 'closeShift' }>;
}): ReactElement | null {
  const c = useCash();
  const h = c.shifts.find((x) => x.id === p.modal.shiftId);
  const a = h ? c.accountOf(h.accountId) : undefined;
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('');
  const [zno, setZno] = useState(h ? String(h.number) : '');
  const [zcash, setZcash] = useState('');
  const [zcard, setZcard] = useState('');
  const [tcard, setTcard] = useState('');
  const [tsbp, setTsbp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!h || !a) return null;
  const keep = String((a.floatAmount?.amountMinor ?? 0) / 100);
  const totals = closeTotals(counts, coins, keep);
  const exp = expectedNow(h, a);
  const blind = a.shiftMode === 'blind' || exp === null;
  const term = c.accounts.some((x) => x.drawerAccountId === a.id);
  const canSafe = can(a, 'cash.transfer');
  const submit = async (): Promise<void> => {
    const body: S['CashShiftClose'] = {
      counted: money(totals.countedMinor),
      counts: Object.fromEntries(
        DENOMS.map(
          (d) => [String(d), Math.max(0, Math.floor(Number(counts[d]) || 0))] as const,
        ).filter(([, n]) => n > 0),
      ),
      ...(parseRub(coins) ? { coins: money(parseRub(coins) ?? 0) } : {}),
      ...(a.kktMode === 'manual'
        ? {
            z: {
              number: zno.trim(),
              cash: money(parseRub(zcash) ?? 0),
              card: money(parseRub(zcard) ?? 0),
            },
          }
        : {}),
      ...(term
        ? { terminal: { card: money(parseRub(tcard) ?? 0), sbp: money(parseRub(tsbp) ?? 0) } }
        : {}),
      ...(canSafe && totals.toSafeMinor > 0 ? { toSafe: true } : {}),
    };
    if (a.kktMode === 'manual' && !zno.trim()) return setErr(T.errors.z);
    setBusy(true);
    setErr('');
    const r = await c.submit(
      `close:${h.id}`,
      (key) => closeShift(c.api, c.tenantId, h, body, key),
      (x) =>
        x.status === 'review'
          ? exp !== null
            ? D.close.okReview
            : D.close.okBlind
          : exp !== null && x.diff && (x.diff.kktCash.amountMinor || x.diff.kktCard.amountMinor)
            ? D.close.okKkt
            : D.close.okPlain,
    );
    setBusy(false);
    if (r.ok) {
      c.closeModal();
      c.show({ tab: 'shifts', shift: h.id });
    } else setErr(r.error);
  };
  return (
    <Shell
      title={format(D.close.title, { no: h.number })}
      sub={format(D.close.sub, {
        name: a.name,
        who: c.memberName(h.openedByMemberId),
        time: fmtTime(h.openedAt),
      })}
      submit={D.close.submit}
      width="w640"
      error={err}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={c.closeModal}
    >
      <div className="ox-ca-stack">
        <Steps
          n={1}
          title={D.close.step1}
          extra={
            blind ? (
              <span className="ox-ca-chip" data-tone="neutral" data-size="sm">
                <Icon name="visibility_off" size={15} />
                {D.close.blindChip}
              </span>
            ) : null
          }
        />
        <div className="ox-ca-denoms">
          {DENOMS.map((d) => {
            const n = Math.max(0, Math.floor(Number(counts[d]) || 0));
            return (
              <label key={d} className="ox-ca-denom">
                <span>{d.toLocaleString('ru-RU')}</span>
                <span>×</span>
                <input
                  className="ox-ca-input"
                  inputMode="numeric"
                  aria-label={format(D.close.denomAria, { nom: String(d) })}
                  value={counts[d] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [d]: e.target.value })}
                />
                <span>{n ? rub(n * d * 100) : '—'}</span>
              </label>
            );
          })}
          <label className="ox-ca-denom">
            <span>{D.close.coins}</span>
            <span />
            <input
              className="ox-ca-input"
              inputMode="decimal"
              aria-label={D.close.coinsAria}
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
            />
            <span>₽</span>
          </label>
        </div>
        <div className="ox-ca-total">
          <span>{D.close.total}</span>
          <strong>{rub(totals.countedMinor)}</strong>
        </div>
        <span className="ox-ca-expnote">
          <Icon name={blind ? 'visibility_off' : 'info'} size={16} />
          <span>
            {blind ? D.close.blindNote : format(D.close.expectedNote, { sum: rub(exp ?? 0) })}
          </span>
        </span>
      </div>
      {a.kktMode === 'manual' ? (
        <div className="ox-ca-stack">
          <Steps n={2} title={D.close.step2} />
          <div className="ox-ca-grid3">
            <TextField
              label={D.close.zNo}
              small
              mono
              inputMode="numeric"
              value={zno}
              onChange={setZno}
            />
            <TextField
              label={D.close.zCash}
              small
              inputMode="decimal"
              value={zcash}
              onChange={setZcash}
            />
            <TextField
              label={D.close.zCard}
              small
              inputMode="decimal"
              value={zcard}
              onChange={setZcard}
            />
          </div>
        </div>
      ) : null}
      {term ? (
        <div className="ox-ca-stack">
          <Steps n={3} title={D.close.step3} />
          <div className="ox-ca-fgrid">
            <TextField
              label={D.close.tCard}
              small
              inputMode="decimal"
              value={tcard}
              onChange={setTcard}
            />
            <TextField
              label={D.close.tSbp}
              small
              inputMode="decimal"
              value={tsbp}
              onChange={setTsbp}
            />
          </div>
        </div>
      ) : null}
      {canSafe ? (
        <div className="ox-ca-stack">
          <Steps n={4} title={D.close.step4} />
          <div className="ox-ca-fgrid">
            <label className="ox-ca-field" data-small="true">
              {D.close.keep}
              <input className="ox-ca-input" readOnly value={keep} />
            </label>
            <span className="ox-ca-field" data-small="true">
              {D.close.toSafe}
              <strong>{rub(totals.toSafeMinor)}</strong>
            </span>
          </div>
          <span className="ox-ca-help">{D.close.transitNote}</span>
        </div>
      ) : null}
      <span className="ox-ca-help">{D.close.foot}</span>
    </Shell>
  );
}

// ─────────────────────────── Перемещение ───────────────────────────

export function TransferDialog(p: { modal: Extract<Modal, { kind: 'transfer' }> }): ReactElement {
  const c = useCash();
  const froms = c.accounts.filter(
    (a) => (a.kind === 'cash_drawer' || a.kind === 'safe') && can(a, 'cash.transfer'),
  );
  const [from, setFrom] = useState(p.modal.fromId);
  const tos = c.accounts.filter(
    (a) => a.id !== from && (a.kind === 'cash_drawer' || a.kind === 'safe' || a.kind === 'bank'),
  );
  const [toRaw, setTo] = useState((tos.find((a) => a.kind === 'safe') ?? tos[0])?.id ?? '');
  const to = tos.some((x) => x.id === toRaw) ? toRaw : (tos[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const n = parseRub(amount);
    if (n === null || n <= 0) return setErr(T.errors.amount);
    setBusy(true);
    setErr('');
    const r = await c.submit(
      `transfer:${from}:${to}:${String(n)}`,
      (key) =>
        createTransfer(
          c.api,
          c.tenantId,
          {
            fromAccountId: from,
            toAccountId: to,
            amount: money(n),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
          key,
        ),
      D.transfer.ok,
    );
    setBusy(false);
    if (r.ok) c.closeModal();
    else setErr(r.error);
  };
  return (
    <Shell
      title={D.transfer.title}
      sub={D.transfer.sub}
      submit={D.transfer.submit}
      error={err}
      busy={busy}
      disabled={!to}
      onSubmit={() => void submit()}
      onClose={c.closeModal}
    >
      <div className="ox-ca-fgrid">
        <SelectField
          label={D.transfer.from}
          value={from}
          onChange={setFrom}
          options={froms.map((a) => ({
            value: a.id,
            label: a.name + (a.balance ? ` · ${rub(a.balance.amountMinor)}` : ''),
          }))}
        />
        <SelectField
          label={D.transfer.to}
          value={to}
          onChange={setTo}
          options={
            tos.length
              ? tos.map((a) => ({ value: a.id, label: a.name }))
              : [{ value: '', label: D.transfer.none }]
          }
        />
        <TextField
          label={D.transfer.amount}
          inputMode="decimal"
          value={amount}
          onChange={setAmount}
        />
        <TextField
          label={D.transfer.note}
          value={note}
          placeholder={D.transfer.notePh}
          onChange={setNote}
        />
      </div>
      <span className="ox-ca-help">{D.transfer.hint}</span>
    </Shell>
  );
}

// ─────────────────────────── Причина ───────────────────────────

export function ReasonDialog(p: { modal: Extract<Modal, { kind: 'reason' }> }): ReactElement {
  const c = useCash();
  const { modal } = p;
  const tx = D.reason[modal.act];
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const vars = modal.vars;
  const submit = async (): Promise<void> => {
    const text = reason.trim();
    if (text.length < 3) return setErr(T.errors.reason);
    setBusy(true);
    setErr('');
    const sig = `${modal.act}:${modal.id}`;
    const r = await c.submit(
      sig,
      (key): Promise<unknown> => {
        if (modal.act === 'reverse')
          return reverseOperation(c.api, c.tenantId, modal.id, text, key);
        if (modal.act === 'dismiss') return dismissProposal(c.api, c.tenantId, modal.id, text, key);
        if (modal.act === 'rejectTr') {
          const t = c.transfers.find((x) => x.id === modal.id);
          if (!t) throw new Error('transfer');
          return decideTransfer(c.api, c.tenantId, t, { decision: 'reject', reason: text }, key);
        }
        const q = c.requests.find((x) => x.id === modal.id);
        if (!q) throw new Error('request');
        return decideRequest(c.api, c.tenantId, q, { decision: 'reject', reason: text }, key);
      },
      tx.ok,
    );
    setBusy(false);
    if (r.ok) c.closeModal();
    else setErr(r.error);
  };
  return (
    <Shell
      title={format(tx.title, vars)}
      sub={modal.sub}
      submit={tx.submit}
      danger
      error={err}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={c.closeModal}
    >
      <span className="ox-ca-help">{format(tx.text, vars)}</span>
      <TextField label={tx.label} value={reason} onChange={setReason} />
      <span className="ox-ca-help">{D.reasonHint}</span>
    </Shell>
  );
}
