// W2.23 · Страница «Ресурсный пул» (`logistics-pool`, S2-14, AUTH-06/07; эталон design-stage-2 · «Ортус CRM.dc.html»
// pg.pool :515–557, poolVM :3300–3319; 03-logistics.md §6). Разметка и стили — по рендеру эталона (pool.css).
// Рейс запроса — `?trip=` (ADR-0001) или первый не начатый рейс без водителя (эталон — всегда Р-211); каталог —
// listAvailableDrivers на его окно, слитый с исходящими запросами (чипы и тексты эталона). Диалог — modal-driver-request
// (RequestDialog.tsx). Демо-ответ «Одобрить» / «Отклонить» эталона (PD-54) заменён блоком входящих запросов фирмы-
// источника — участнику с `fleet.driver_transfers.approve` (Q-W2.51-2, no-reference).
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useOrgUnits } from '../../../../shell/scope.ts';
import { useToast } from '../../../../shell/toast.tsx';
import { may } from '../fleet/model.ts';
import { afterChange, decideTransfer, useCatalog, useTransfers, useTripPlans } from './api.ts';
import {
  cards,
  type Chip,
  type DriverCard,
  type IncomingRow,
  incomingRows,
  pickTrip,
  requestTrips,
  tripLabel,
} from './model.ts';
import { RequestDialog } from './RequestDialog.tsx';
import { POOL_TEXT as T } from './texts.ts';
import './pool.css';

type S = components['schemas'];

const P = logisticsManager.pool;
const R = logisticsManager.request;

const OUTGOING: readonly S['DriverTransfer']['status'][] = ['requested', 'approved', 'rejected'];
const INCOMING: readonly S['DriverTransfer']['status'][] = ['requested'];
/** Ответы решения, которые показывает тост текстом сервера (одобрение перепроверяет рейс и занятость). */
const DECIDE_QUIET = ['invalid_transition', 'resources_unavailable'];

const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail || undefined;

function ChipView({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-pl-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

/** Карточка водителя (:525–542). */
function DriverView(p: {
  card: DriverCard;
  trip: S['TripPlan'] | null;
  onRequest: () => void;
}): ReactElement {
  const { card } = p;
  return (
    <article className="ox-pl-driver">
      <div className="ox-pl-head">
        <span className="ox-pl-avatar">
          <Icon name="person" size={22} />
        </span>
        <div className="ox-pl-who">
          <strong className="ox-pl-code">{card.code}</strong>
          <div className="ox-pl-sub">{card.sub}</div>
        </div>
        <ChipView chip={card.chip} />
      </div>
      <dl className="ox-pl-dl">
        {card.rows.map((r) => (
          <div key={r.term} className="ox-pl-dl-row">
            <dt>{r.term}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {card.canRequest && p.trip ? (
        <button
          type="button"
          className="ox-pl-btn ox-pl-hit ox-pl-request"
          data-variant="primary"
          onClick={p.onRequest}
        >
          {format(P.requestFor, { trip: p.trip.number })}
        </button>
      ) : null}
      {card.pendingText ? (
        <div role="status" className="ox-pl-note" data-tone="warn">
          <Icon name="schedule" size={20} />
          <span>{card.pendingText}</span>
        </div>
      ) : null}
      {card.approvedText ? (
        <div role="status" className="ox-pl-note" data-tone="ok">
          <Icon name="verified" size={20} />
          <span>{card.approvedText}</span>
        </div>
      ) : null}
      {card.declined ? (
        <div className="ox-pl-note" data-tone="neutral">
          <Icon name="block" size={20} />
          <span>{P.declined}</span>
        </div>
      ) : null}
    </article>
  );
}

/** Входящий запрос фирмы-источника: «Одобрить» / «Отклонить» с комментарием (no-reference, Q-W2.51-2). */
function IncomingView(p: { tenantId: string; row: IncomingRow; locked: boolean }): ReactElement {
  const { row, tenantId } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const key = `pool:decide:${row.id}`;
  const busy = useBusy(key);
  const [comment, setComment] = useState('');
  const id = useId();

  const decide = async (decision: 'approve' | 'reject'): Promise<void> => {
    try {
      await run(
        key,
        () =>
          decideTransfer(api, tenantId, row.id, {
            decision,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          }),
        format(decision === 'approve' ? P.firmApproved : P.firmDeclined, { firm: row.source }),
        { quiet: DECIDE_QUIET },
      );
    } catch (e) {
      // Рейс получил водителя, начат или водитель занят (409): текст сервера, список перечитывается.
      if (DECIDE_QUIET.includes(problemCode(e))) toast(detail(e) ?? problemText(e), 'error');
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  return (
    <article className="ox-pl-in-card" aria-labelledby={`${id}-code`}>
      <div className="ox-pl-head">
        <span className="ox-pl-avatar">
          <Icon name="person" size={22} />
        </span>
        <div className="ox-pl-who">
          <strong id={`${id}-code`} className="ox-pl-code">
            {row.code}
          </strong>
          <div className="ox-pl-sub">{row.line}</div>
        </div>
      </div>
      <dl className="ox-pl-dl">
        <div className="ox-pl-dl-row">
          <dt>{R.period}</dt>
          <dd>{row.period}</dd>
        </div>
        {row.reason ? (
          <div className="ox-pl-dl-row">
            <dt>{T.incoming.reason}</dt>
            <dd>{row.reason}</dd>
          </div>
        ) : null}
      </dl>
      <label className="ox-pl-label" htmlFor={`${id}-comment`}>
        {T.incoming.comment}
        <textarea
          id={`${id}-comment`}
          rows={2}
          value={comment}
          placeholder={R.commentPlaceholder}
          disabled={p.locked}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <div className="ox-pl-actions">
        <button
          type="button"
          className="ox-pl-btn ox-pl-hit"
          disabled={busy || p.locked}
          onClick={() => void decide('approve')}
        >
          {P.approve}
        </button>
        <button
          type="button"
          className="ox-pl-btn ox-pl-hit"
          disabled={busy || p.locked}
          onClick={() => void decide('reject')}
        >
          {P.decline}
        </button>
      </div>
    </article>
  );
}

function Empty(p: { icon: string; title: string; hint: string }): ReactElement {
  return (
    <div className="ox-pl-empty">
      <span className="ox-pl-empty-icon">
        <Icon name={p.icon} size={28} />
      </span>
      <strong>{p.title}</strong>
      <span>{p.hint}</span>
    </div>
  );
}

export default function PoolPage(): ReactElement {
  const { tenantId: tid, audience, readOnly, nav } = useShell();
  const tenantId = tid ?? '';
  const owner = audience === 'owner';
  const can = useCan();
  const units = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];
  const access = { owner, caps: nav.capabilities, units };
  const mayRequest = (unit: string): boolean => may(access, 'fleet.driver_transfers.request', unit);
  const approver = owner || can('fleet.driver_transfers.approve');
  const navigate = useNavigate();
  const location = useLocation();
  const raw = (location.search as Record<string, unknown>).trip;
  const param = typeof raw === 'string' && raw ? raw : null;
  const pickId = useId();

  const trips = useTripPlans(tenantId);
  const outgoing = useTransfers(tenantId, 'outgoing', OUTGOING);
  const incoming = useTransfers(tenantId, 'incoming', INCOMING, approver);
  const trip = trips.data && outgoing.data ? pickTrip(trips.data, outgoing.data, param) : null;
  const catalog = useCatalog(tenantId, trip?.plannedWindow ?? null);
  const [dialog, setDialog] = useState<{ open: boolean; card: DriverCard | null }>({
    open: false,
    card: null,
  });

  const candidates = trips.data ? requestTrips(trips.data, mayRequest) : [];
  const inRows = incoming.data ? incomingRows(incoming.data) : [];

  let body: ReactElement;
  if (trips.isPending || outgoing.isPending || (trip && catalog.isPending)) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (trips.isError || outgoing.isError || catalog.isError) {
    const err = trips.error ?? outgoing.error ?? catalog.error;
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(err) })}
        action={{
          label: T.retry,
          onPress: () => {
            if (trips.isError) void trips.refetch();
            if (outgoing.isError) void outgoing.refetch();
            if (catalog.isError) void catalog.refetch();
          },
        }}
      />
    );
  } else {
    const list = cards({
      catalog: trip ? (catalog.data ?? []) : [],
      outgoing: outgoing.data ?? [],
      trip,
      mayRequest: !!trip && !readOnly && mayRequest(trip.orgUnitId),
    });
    body = (
      <>
        {!trip ? (
          <Empty icon="event_busy" title={T.empty.trip} hint={T.empty.tripHint} />
        ) : list.length === 0 ? (
          <Empty icon="person_search" title={T.empty.drivers} hint={T.empty.driversHint} />
        ) : null}
        {list.map((c) => (
          <DriverView
            key={c.key}
            card={c}
            trip={trip}
            onRequest={() => setDialog({ open: true, card: c })}
          />
        ))}
      </>
    );
  }

  return (
    <section aria-labelledby="h-pool" className="ox-pl">
      <div className="ox-pl-top">
        <div className="ox-pl-crumb">{P.crumb}</div>
        <h1 id="h-pool" className="ox-pl-title" tabIndex={-1}>
          {shell.nav.items.pool}
        </h1>
        <p className="ox-pl-intro">{P.intro}</p>
      </div>
      {trip && candidates.length > 1 ? (
        <div className="ox-pl-pick">
          <label htmlFor={pickId}>{T.tripPick}</label>
          <select
            id={pickId}
            value={trip.id}
            onChange={(e) =>
              void navigate({
                to: '/t/$tenantId/$page',
                params: { tenantId, page: 'pool' },
                search: { trip: e.target.value } as never,
              })
            }
          >
            {[...candidates, ...(candidates.some((t) => t.id === trip.id) ? [] : [trip])].map(
              (t) => (
                <option key={t.id} value={t.id}>
                  {tripLabel(t)}
                </option>
              ),
            )}
          </select>
        </div>
      ) : null}
      <div className="ox-pl-layout">
        <div className="ox-pl-main">
          {inRows.length > 0 || (approver && incoming.isError) ? (
            <section aria-labelledby="h-pool-in" className="ox-pl-in">
              <div className="ox-pl-in-top">
                <h2 id="h-pool-in" className="ox-pl-h2">
                  {T.incoming.title}
                </h2>
                <p className="ox-pl-in-intro">{T.incoming.intro}</p>
              </div>
              {incoming.isError ? (
                <Banner
                  tone="danger"
                  role="alert"
                  title={format(T.incoming.loadFailed, { error: problemText(incoming.error) })}
                  action={{ label: T.retry, onPress: () => void incoming.refetch() }}
                />
              ) : null}
              {inRows.map((r) => (
                <IncomingView key={r.id} tenantId={tenantId} row={r} locked={readOnly} />
              ))}
            </section>
          ) : null}
          <div className="ox-pl-list">{body}</div>
        </div>
        <aside className="ox-pl-aside">
          <h3 className="ox-pl-h3">{P.hiddenTitle}</h3>
          <ul>
            {(['contacts', 'rates', 'history', 'documents'] as const).map((k) => (
              <li key={k}>
                <Icon name="visibility_off" size={18} />
                {P.hidden[k]}
              </li>
            ))}
          </ul>
          <p>{P.afterApproval}</p>
        </aside>
      </div>
      <RequestDialog
        open={dialog.open}
        tenantId={tenantId}
        card={dialog.card}
        trip={trip}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />
    </section>
  );
}
