// W2.21 · Страница «Начисления водителям» (`logistics-earnings`, S2-12, AC-05; no-reference, 14-stage2-dor.md §4:
// пусто, есть начисления, нет права). Вне меню (как «Хранилище»), вход — ссылка на «Приёмке смен». Начисление
// создаёт приёмка смены (Q-55); читает владелец и менеджер с fleet.earnings.read в своей области, правит — владелец
// (fleet.earnings.manage). Водителю — гейт оболочки и 403 сервера (D-10). Подразделение — `?unit=` (ADR-0001).
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell } from '@ortus/texts';
import { Banner, Dialog, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { unitLabel, useOrgUnits } from '../../../../shell/scope.ts';
import { afterChange, useTripPlans } from '../review/api.ts';
import { useCrumb } from '../review/crumb.ts';
import { setEarnings, useEarnings, useMemberNames } from './api.ts';
import {
  amountError,
  type EarningRow,
  earningRows,
  parseAmount,
  total,
  unitOptions,
} from './model.ts';
import { EARNINGS_TEXT as T } from './texts.ts';
import '../review/review.css';
import './earnings.css';

type S = components['schemas'];

const L = logisticsManager.review;

function EditDialog(p: {
  tenantId: string;
  row: EarningRow;
  current: S['TripEarnings'];
  onClose: () => void;
}): ReactElement {
  const { tenantId, row } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('earn');
  const id = useId();
  const [amount, setAmount] = useState(String(row.amountMinor / 100).replace('.', ','));
  const [note, setNote] = useState(p.current.calculationNote ?? '');
  const [err, setErr] = useState<string | null>(null);
  const trip = row.trip.split(' · ')[0] ?? row.trip;

  const save = async (): Promise<void> => {
    const e = amountError(amount);
    setErr(e);
    if (e) return;
    try {
      await run(
        'earn',
        () =>
          setEarnings(api, tenantId, row.tripId, {
            amount: { amountMinor: parseAmount(amount) ?? 0, currency: p.current.amount.currency },
            ...(note.trim() ? { calculationNote: note.trim() } : {}),
          }),
        format(T.dialog.done, { trip }),
      );
      p.onClose();
    } catch {
      // Ошибку показал тост `run`; диалог остаётся открытым.
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      busy={busy}
      title={format(T.dialog.title, { trip })}
      footer={
        <div className="ox-rv-actions">
          <button type="button" className="ox-rv-btn ox-rv-hit" disabled={busy} onClick={p.onClose}>
            {T.dialog.cancel}
          </button>
          <button
            type="button"
            className="ox-rv-btn ox-rv-hit"
            data-variant="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {T.dialog.save}
          </button>
        </div>
      }
    >
      <div className="ox-er-form">
        <label className="ox-rv-label" htmlFor={`${id}-amount`}>
          {T.dialog.amount}
        </label>
        <input
          id={`${id}-amount`}
          className="ox-er-input"
          inputMode="decimal"
          value={amount}
          aria-invalid={err ? 'true' : undefined}
          onChange={(e) => {
            setAmount(e.target.value);
            setErr(null);
          }}
        />
        {err ? (
          <div role="alert" className="ox-rv-error">
            <Icon name="error" size={18} />
            {err}
          </div>
        ) : null}
        <label className="ox-rv-label">
          {T.dialog.note}
          <textarea
            rows={2}
            value={note}
            placeholder={T.dialog.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}

export default function EarningsPage(): ReactElement {
  const { tenantId: id, audience, readOnly } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const crumbText = useCrumb('fleet.earnings.read');
  const navigate = useNavigate();
  const location = useLocation();
  const raw = (location.search as Record<string, unknown>).unit;
  const unit = typeof raw === 'string' ? raw : '';
  const earnings = useEarnings(tenantId, unit);
  const all = useEarnings(tenantId, '');
  const trips = useTripPlans(tenantId);
  const members = useMemberNames(tenantId, owner || can('members.read')).data ?? new Map();
  const units = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];
  const [edit, setEdit] = useState<string | null>(null);
  const canManage = !readOnly && (owner || can('fleet.earnings.manage'));
  const list = earnings.data ?? [];
  const rows = earningRows(list, trips.data ?? [], members);
  const tripsOfAll = (trips.data ?? []).filter((t) =>
    (all.data ?? []).some((e) => e.tripId === t.id),
  );
  const options = unitOptions(tripsOfAll, (u) => unitLabel(units, u));
  const editing = rows.find((r) => r.tripId === edit);
  const current = list.find((e) => e.tripId === edit);

  const setUnit = (value: string): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'earnings' },
      search: (value ? { unit: value } : {}) as never,
    });

  let body: ReactElement;
  if (earnings.isPending) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (earnings.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(earnings.error) })}
        action={{ label: T.retry, onPress: () => void earnings.refetch() }}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <div className="ox-rv-empty">
        <span className="ox-rv-empty-icon">
          <Icon name="payments" size={28} />
        </span>
        <strong>{T.empty.title}</strong>
        <span>{T.empty.text}</span>
      </div>
    );
  } else {
    body = (
      <div className="ox-rv-card ox-er-card">
        <div role="list" aria-label={T.listAria} className="ox-er-list">
          {rows.map((r) => (
            <div key={r.tripId} role="listitem" className="ox-er-row">
              <div className="ox-er-main">
                <strong className="ox-er-trip">{r.trip}</strong>
                <span className="ox-rv-sub">{r.driver}</span>
                <span className="ox-rv-sub ox-rv-sub-sm">{r.changed}</span>
                {r.note ? <span className="ox-rv-sub ox-rv-sub-sm">{r.note}</span> : null}
              </div>
              <strong className="ox-er-amount">{r.amount}</strong>
              {canManage ? (
                <button
                  type="button"
                  className="ox-rv-btn ox-rv-hit"
                  aria-label={format(T.editNamed, { trip: r.trip.split(' · ')[0] ?? r.trip })}
                  onClick={() => setEdit(r.tripId)}
                >
                  <Icon name="edit" size={18} />
                  {T.edit}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="ox-rv-total">
          <span>{format(T.total, { sum: total(list) })}</span>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="h-earnings" className="ox-rv">
      <div className="ox-rv-top">
        <div className="ox-rv-crumb">{crumbText}</div>
        <h1 id="h-earnings" className="ox-rv-title" tabIndex={-1}>
          {shell.nav.items.earnings}
        </h1>
        <p className="ox-rv-intro">
          {T.intro} {L.earningsNote}
        </p>
      </div>
      <label className="ox-rv-label ox-er-filter">
        {T.unit}
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {body}
      {editing && current ? (
        <EditDialog
          tenantId={tenantId}
          row={editing}
          current={current}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </section>
  );
}
