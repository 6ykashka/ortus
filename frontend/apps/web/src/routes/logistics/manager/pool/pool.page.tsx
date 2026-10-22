// W2.23 · Страница «Ресурсный пул» (`logistics-pool`, S2-14, AUTH-06/07; эталон design-stage-2 · «Ортус CRM.dc.html»
// pg.pool :515–557, poolVM :3300–3319; 03-logistics.md §6). Разметка и стили — по рендеру эталона (pool.css).
// Рейс запроса — `?trip=` (ADR-0001) или первый не начатый рейс без водителя (эталон — всегда Р-211); каталог —
// listAvailableDrivers на его окно, слитый с исходящими запросами (чипы и тексты эталона). Диалог — modal-driver-request
// (RequestDialog.tsx). Демо-ответ «Одобрить» / «Отклонить» эталона (PD-54) заменён блоком входящих запросов фирмы-
// источника — участнику с `fleet.driver_transfers.approve` (Q-W2.51-2).
// W2.73 (S2-20, D-35; «Временный водитель - варианты.dc.html», design-2026-10-19b): входящий запрос — по макету 1b
// («Одобрить с машиной» / «Только водителя» / «Отклонить» с причиной, Q-W2.70-8); карточка одобренного запроса с
// машиной — итог 1f («Машины рейса», «Журнал», «Оставить …» до выбора, «Поставить машину» без машины).
import type { components } from '@ortus/api-client';
import { errors, format, logisticsManager, shell } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useId, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useOrgUnits } from '../../../../shell/scope.ts';
import { useToast } from '../../../../shell/toast.tsx';
import { may } from '../fleet/model.ts';
import {
  afterChange,
  decideTransfer,
  keepReservation,
  useCatalog,
  usePublications,
  useTransfers,
  useTripPlans,
  useVehicles,
} from './api.ts';
import {
  cards,
  type DriverCard,
  type IncomingRow,
  incomingRows,
  pickTrip,
  requestTrips,
  tripLabel,
} from './model.ts';
import { RequestDialog, type VehiclesState } from './RequestDialog.tsx';
import { ChipView, TransferBlock, whoOf } from './S220.tsx';
import { POOL_TEXT as T } from './texts.ts';
import { incomingCar, transferView } from './vehicle.ts';
import './pool.css';

type S = components['schemas'];

const P = logisticsManager.pool;
const I = logisticsManager.pool.incoming;

const OUTGOING: readonly S['DriverTransfer']['status'][] = ['requested', 'approved', 'rejected'];
const INCOMING: readonly S['DriverTransfer']['status'][] = ['requested'];
/** Ответы решения, которые показывает тост текстом сервера (одобрение перепроверяет рейс, занятость и машины). */
const DECIDE_QUIET = [
  'invalid_transition',
  'resources_unavailable',
  'vehicle_incompatible',
  'reservation_overlap',
];
/** «Оставить …»: выбор уже сделан или срок прошёл (409 offer_closed) — текст сервера. */
const KEEP_QUIET = ['offer_closed', 'not_found'];

const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail || undefined;

interface Ctx {
  tenantId: string;
  trips: readonly S['TripPlan'][];
  vehicles: readonly S['Vehicle'][];
  unitName: (id: string) => string;
  mayManage: (unit: string) => boolean;
  readOnly: boolean;
}

/** Итог одобренного запроса с машиной (1f): «Оставить …» — chooseReservation логиста фирмы рейса. */
function TransferView(p: { ctx: Ctx; x: S['DriverTransfer'] }): ReactElement {
  const { ctx, x } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const navigate = useNavigate();
  const key = `pool:keep:${x.id}`;
  const busy = useBusy(key);
  const trip = ctx.trips.find((t) => t.id === x.tripId);
  const view = transferView(x, trip, ctx.vehicles, ctx.unitName(x.targetOrgUnitId));
  const manage = !ctx.readOnly && ctx.mayManage(x.targetOrgUnitId);
  const keep = async (id: string): Promise<void> => {
    try {
      await run(key, () => keepReservation(api, ctx.tenantId, id), undefined, {
        quiet: KEEP_QUIET,
      });
    } catch (e) {
      if (KEEP_QUIET.includes(problemCode(e))) toast(detail(e) ?? problemText(e), 'error');
    } finally {
      await afterChange(qc, ctx.tenantId);
    }
  };
  return (
    <TransferBlock
      view={view}
      busy={busy}
      onAssign={
        manage && x.tripId
          ? () =>
              void navigate({
                to: '/t/$tenantId/$page',
                params: { tenantId: ctx.tenantId, page: 'fleet' },
                search: { trip: x.tripId } as never,
              })
          : null
      }
      onKeep={manage && view.keep ? () => void keep(view.keep?.reservationId ?? '') : null}
    />
  );
}

/** Карточка водителя (:525–542); одобренный запрос с машиной — итог 1f. */
function DriverView(p: {
  card: DriverCard;
  trip: S['TripPlan'] | null;
  ctx: Ctx;
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
      {card.transfer ? (
        <TransferView ctx={p.ctx} x={card.transfer} />
      ) : (
        <dl className="ox-pl-dl">
          {card.rows.map((r) => (
            <div key={r.term} className="ox-pl-dl-row">
              <dt>{r.term}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
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

type Decision = 'approve' | 'approve_driver_only' | 'reject';

/**
 * Входящий запрос фирмы водителя (1b :196–228): «Ждёт решения», «Когда», «Машина», «Ваша машина», «Что откроется …»;
 * «Одобрить с машиной» / «Только водителя» / «Отклонить» (без обычной машины — «Одобрить» / «Отклонить»). «Отклонить» —
 * только с причиной: поле «Причина отказа» под кнопками (no-reference, Q-W2.70-8), пустое — сообщение без запроса.
 */
function IncomingView(p: {
  tenantId: string;
  row: IncomingRow;
  name: string | undefined;
  locked: boolean;
}): ReactElement {
  const { row, tenantId } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const key = `pool:decide:${row.id}`;
  const busy = useBusy(key);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const car = incomingCar(row.transfer);

  const decide = async (decision: Decision): Promise<void> => {
    const comment = reason.trim();
    // Сообщение «Укажите причину отказа» относится только к «Отклонить» — другое решение его снимает.
    if (decision !== 'reject') setMissing(false);
    if (decision === 'reject' && !comment) {
      // Сообщение связано с полем (aria-describedby), фокус — в поле причины.
      setMissing(true);
      field.current?.focus();
      return;
    }
    try {
      await run(
        key,
        () =>
          decideTransfer(api, tenantId, row.id, {
            decision,
            ...(decision === 'reject' ? { comment } : {}),
          }),
        format(decision === 'reject' ? P.firmDeclined : P.firmApproved, { firm: row.source }),
        { quiet: DECIDE_QUIET },
      );
    } catch (e) {
      // Рейс получил водителя, начат, водитель или машина заняты (409): текст сервера, список перечитывается.
      if (DECIDE_QUIET.includes(problemCode(e))) toast(detail(e) ?? problemText(e), 'error');
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  const button = (d: Decision, label: string, primary = false, danger = false): ReactElement => (
    <button
      key={d}
      type="button"
      className="ox-pl-btn ox-pl-btn-lg ox-pl-hit"
      data-variant={primary ? 'primary' : undefined}
      data-danger={danger ? '' : undefined}
      disabled={busy || p.locked}
      onClick={() => void decide(d)}
    >
      {label}
    </button>
  );

  return (
    <article className="ox-pl-in-card" aria-labelledby={`${id}-code`}>
      <div className="ox-pl-head">
        <span className="ox-pl-avatar">
          <Icon name="person" size={22} />
        </span>
        <div className="ox-pl-who">
          <strong id={`${id}-code`} className="ox-pl-code">
            {whoOf(p.name, row.code)}
          </strong>
          <div className="ox-pl-sub">{row.line}</div>
        </div>
        <ChipView chip={{ label: I.waiting, tone: 'warn', icon: 'schedule' }} />
      </div>
      <dl className="ox-pl-dl ox-pl-dl-in">
        <div className="ox-pl-dl-row">
          <dt>{I.when}</dt>
          <dd>{car.when}</dd>
        </div>
        {car.car ? (
          <div className="ox-pl-dl-row">
            <dt>{logisticsManager.request.vehicle}</dt>
            <dd className="ox-pl-strong">{car.car}</dd>
          </div>
        ) : null}
        {row.reason ? (
          <div className="ox-pl-dl-row">
            <dt>{T.incoming.reason}</dt>
            <dd>{row.reason}</dd>
          </div>
        ) : null}
      </dl>
      {car.usual ? (
        <div className="ox-pl-yours">
          <div className="ox-pl-yours-head">
            <strong>{I.yours}</strong>
            <span>
              {car.usual.name} · <span className="ox-pl-mono">{car.usual.plate}</span>
            </span>
            <ChipView chip={{ label: car.usual.free, tone: 'ok', icon: 'check_circle' }} />
          </div>
          <span className="ox-pl-yours-text">{car.usual.hold}</span>
          <span className="ox-pl-yours-text">{I.defects}</span>
        </div>
      ) : null}
      <div className="ox-pl-opens">
        <strong>{car.opens}</strong>
        <span>
          <Icon name="visibility" size={18} />
          {car.opensDriver}
        </span>
        {car.withUsual ? (
          <span>
            <Icon name="visibility" size={18} />
            {I.opensVehicle}
          </span>
        ) : null}
        <span data-hidden="">
          <Icon name="visibility_off" size={18} />
          {car.hidden}
        </span>
      </div>
      <div className="ox-pl-actions">
        {car.withUsual
          ? [
              button('approve', I.approveWithVehicle, true),
              button('approve_driver_only', I.driverOnly),
              button('reject', P.decline, false, true),
            ]
          : [button('approve', P.approve, true), button('reject', P.decline, false, true)]}
      </div>
      <label className="ox-pl-label" htmlFor={`${id}-reason`}>
        {T.vehicle.rejectReason}
        <textarea
          ref={field}
          id={`${id}-reason`}
          rows={2}
          value={reason}
          disabled={p.locked}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${id}-reason-error` : undefined}
          onChange={(e) => {
            setReason(e.target.value);
            setMissing(false);
          }}
        />
      </label>
      {missing ? (
        <div id={`${id}-reason-error`} role="alert" className="ox-pl-error">
          <Icon name="error" size={18} />
          <span>{errors.mock.logistics.vehicleOffer.rejectReason}</span>
        </div>
      ) : null}
      <span className="ox-pl-car-small">{car.note}</span>
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
  const vehiclesOn = owner || can('fleet.vehicles.read');
  const vehicles = useVehicles(tenantId, vehiclesOn);
  // Возврат 3: диалог 1a не подбирает машину по пустому списку, пока он грузится или не загрузился (без права
  // `fleet.vehicles.read` запроса нет — список пуст, как раньше). Ошибка при уже загруженном списке — список прежний.
  const vehiclesState: VehiclesState =
    !vehiclesOn || vehicles.data
      ? { status: 'ready' }
      : vehicles.isError
        ? { status: 'error', error: problemText(vehicles.error) }
        : { status: 'pending' };
  const pubs = usePublications(tenantId, approver);
  const trip = trips.data && outgoing.data ? pickTrip(trips.data, outgoing.data, param) : null;
  const catalog = useCatalog(tenantId, trip?.plannedWindow ?? null, trip?.id);
  const [dialog, setDialog] = useState<{ open: boolean; card: DriverCard | null }>({
    open: false,
    card: null,
  });

  const candidates = trips.data ? requestTrips(trips.data, mayRequest) : [];
  const inRows = incoming.data ? incomingRows(incoming.data) : [];
  const unitName = (unitId: string): string =>
    units.find((u) => u.id === unitId)?.name ??
    outgoing.data?.find((x) => x.targetOrgUnitId === unitId)?.targetOrgUnitName ??
    '';
  const ctx: Ctx = {
    tenantId,
    trips: trips.data ?? [],
    vehicles: vehicles.data ?? [],
    unitName,
    mayManage: (unit) => may(access, 'fleet.reservations.manage', unit),
    readOnly,
  };

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
            ctx={ctx}
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
                <IncomingView
                  key={r.id}
                  tenantId={tenantId}
                  row={r}
                  name={
                    pubs.data?.find((x) => x.id === r.transfer.publicationId)?.driverDisplayName
                  }
                  locked={readOnly}
                />
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
        vehicles={vehicles.data ?? []}
        vehiclesState={vehiclesState}
        onRetryVehicles={() => void vehicles.refetch()}
        unitName={trip ? unitName(trip.orgUnitId) : ''}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />
    </section>
  );
}
