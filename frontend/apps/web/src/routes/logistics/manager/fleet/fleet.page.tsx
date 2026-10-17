// W2.20 · Страница «Рабочее место логиста» (`logistics-fleet`, S2-01, S2-02, S2-13; эталон design-stage-2 ·
// «Ортус CRM.dc.html» pg.fleet :428–520, fleetVM :3249–3307, assignVehicle :2787–2790; 03-logistics.md §5).
// Разметка и стили — по рендеру эталона (fleet.css). Данные — listTripPlans, listVehicles, listOrgUnits; подбор и
// участки — правила домена (`compat`, `legs`), сервер повторяет проверку при назначении (assignTripVehicle).
// Состояние страницы — search-параметры (ADR-0001): `?trip=` — выбранный рейс, `?plan=new` — форма планирования
// (`logistics-plan`, no-reference, ../plan/PlanForm.tsx).
import type { ProblemError } from '@ortus/api-client';
import type { Vehicle as DomainVehicle } from '@ortus/domain/modules';
import { errors, format, logisticsManager, shell, toast as toastText } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { unitLabel as shellUnitLabel, useOrgUnits } from '../../../../shell/scope.ts';
import { useToast } from '../../../../shell/toast.tsx';
import { PlanForm } from '../plan/PlanForm.tsx';
import { afterChange, assignVehicle, useTripPlans, useVehicles } from './api.ts';
import {
  canEdit,
  card,
  type Chip,
  crumb,
  type Filter,
  legFor,
  legRows,
  may,
  pickOf,
  type Row,
  rows,
  stats,
  subtree,
  tabsOf,
  vehicleOf,
  visibleTrips,
} from './model.ts';
import { FLEET_TEXT } from './texts.ts';
import './fleet.css';

const L = logisticsManager.fleet;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function ChipView({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-fl-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

const FILTERS: readonly (readonly [Filter, string])[] = [
  ['all', L.filters.all],
  ['fit', L.filters.fit],
  ['free', L.filters.free],
];

const STATS = [
  ['free', L.stats.free, 'check_circle'],
  ['busy', L.stats.busy, 'route'],
  ['review', L.stats.review, 'pending'],
  ['unavailable', L.stats.unavailable, 'block'],
] as const;

function VehicleRow({
  row,
  onPick,
  onAssign,
}: {
  row: Row;
  onPick: () => void;
  onAssign: () => void;
}): ReactElement {
  const busy = useBusy(`asg:${row.id}`);
  return (
    <div className="ox-fl-vehicle" data-picked={row.picked ? '' : undefined}>
      <div className="ox-fl-vehicle-head">
        <span className="ox-fl-vehicle-icon">
          <Icon name={row.icon} size={22} />
        </span>
        <div className="ox-fl-vehicle-name">
          <span className="ox-fl-model">
            <span className="ox-fl-model-name">{row.model}</span>{' '}
            <span className="ox-fl-plate">{row.plate}</span>
          </span>
          <span className="ox-fl-sub">{row.sub}</span>
        </div>
        <ChipView chip={row.chip} />
        <div className="ox-fl-vehicle-actions">
          <button
            type="button"
            className="ox-fl-pick ox-fl-hit"
            aria-pressed={row.picked ? 'true' : 'false'}
            onClick={onPick}
          >
            {/* 17 px — размер эталона :470, вне шкалы Icon. */}
            <span className="material-symbols-rounded ox-fl-pick-icon" aria-hidden="true">
              stacked_bar_chart
            </span>
            {row.picked ? L.loadShown : L.showLoad}
          </button>
          {row.action === 'assign' ? (
            <button
              type="button"
              className="ox-fl-assign ox-fl-hit"
              disabled={busy}
              onClick={onAssign}
            >
              {L.assign}
            </button>
          ) : null}
          {row.action === 'unfit' || row.action === 'unavailable' ? (
            <button type="button" className="ox-fl-cannot ox-fl-hit" disabled>
              {row.action === 'unfit' ? L.unfit : L.unavailable}
            </button>
          ) : null}
        </div>
      </div>
      <div className="ox-fl-checks">
        {row.checks.map((c) => (
          <span key={c.text} className="ox-fl-check" data-ok={c.ok ? '' : undefined}>
            <Icon name={c.ok ? 'check' : 'close'} size={15} />
            <span>{c.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const detail = (e: unknown): string | undefined => (e as ProblemError).problem?.detail ?? undefined;

function Workspace({ tripParam }: { tripParam: string | undefined }): ReactElement {
  const { tenant, tenantId: id, audience, readOnly, nav, scope, go } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const navigate = useNavigate();
  const trips = useTripPlans(tenantId);
  const vehicles = useVehicles(tenantId);
  const units = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [pick, setPick] = useState<{ trip: string; id: string } | null>(null);

  const setSearch = useCallback(
    (search: Record<string, string>) =>
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'fleet' },
        search: search as never,
      }),
    [navigate, tenantId],
  );

  const area = owner && scope !== 'all' ? subtree(units, scope) : null;
  const inArea = (unitId: string) => !area || area.has(unitId);
  const vs: DomainVehicle[] = (vehicles.data ?? [])
    .filter((v) => inArea(v.orgUnitId))
    .map(vehicleOf);
  const list = visibleTrips(trips.data ?? []).filter((t) => inArea(t.orgUnitId));
  const trip = list.find((t) => t.id === tripParam) ?? list[0];
  const access = { owner, caps: nav.capabilities, units };
  const planAllowed = !readOnly && (owner || can('fleet.routes.manage'));
  const count = stats(vs);
  const label = (unitId: string) => shellUnitLabel(units, unitId) ?? '';

  const assign = async (vehicleId: string): Promise<void> => {
    if (!trip) return;
    try {
      await run(
        `asg:${vehicleId}`,
        () => assignVehicle(api, tenantId, trip.id, vehicleId),
        format(toastText.manager.vehicleAssigned, { trip: trip.number }),
        { quiet: ['reservation_overlap', 'vehicle_incompatible'] },
      );
    } catch (e) {
      // Конфликт (:2787–2790): тост «Конфликт: …» текстом сервера и перечитывание списка; несовместимость —
      // причины сервера «Нельзя назначить: …». Прочее показал `run`.
      const code = problemCode(e);
      if (code === 'reservation_overlap') {
        toast(
          format(toastText.shell.conflict, {
            message: detail(e) ?? errors.problem.reservation_overlap,
          }),
          'error',
        );
      } else if (code === 'vehicle_incompatible') {
        toast(detail(e) ?? errors.problem.vehicle_incompatible, 'error');
      }
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  const head = (
    <div className="ox-fl-top">
      <div className="ox-fl-head">
        <div className="ox-fl-crumb">
          {crumb({ owner, scope, tenant: tenant?.name ?? '', units, caps: nav.capabilities })}
        </div>
        <h1 id="h-fleet" className="ox-fl-title" tabIndex={-1}>
          {shell.nav.items.fleet}
        </h1>
        <p className="ox-fl-intro">{L.intro}</p>
      </div>
      {planAllowed ? (
        <button
          type="button"
          className="ox-fl-plan ox-fl-hit"
          onClick={() => setSearch({ plan: 'new' })}
        >
          <Icon name="add_road" size={18} />
          {FLEET_TEXT.plan}
        </button>
      ) : null}
    </div>
  );

  let body: ReactElement;
  if (trips.isPending || vehicles.isPending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (trips.isError || vehicles.isError) {
    const error = trips.error ?? vehicles.error;
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(FLEET_TEXT.loadFailed, { error: problemText(error) })}
        action={{
          label: FLEET_TEXT.retry,
          onPress: () => {
            void trips.refetch();
            void vehicles.refetch();
          },
        }}
      />
    );
  } else {
    body = (
      <>
        <div className="ox-fl-stats">
          {STATS.map(([key, title, icon]) => (
            <div key={key} className="ox-fl-stat" data-kind={key}>
              <Icon name={icon} size={22} />
              <div className="ox-fl-stat-text">
                <span className="ox-fl-stat-value">{String(count[key])}</span>
                <span className="ox-fl-stat-label">{title}</span>
              </div>
            </div>
          ))}
        </div>
        {trip ? (
          <TripView
            trips={list}
            trip={trip}
            vehicles={vs}
            filter={filter}
            setFilter={setFilter}
            pickId={pick?.trip === trip.id ? pick.id : null}
            onPick={(vid) => setPick({ trip: trip.id, id: vid })}
            onTab={(tid) => setSearch({ trip: tid })}
            onAssign={(vid) => void assign(vid)}
            onPool={() => go('pool')}
            editable={canEdit(trip, {
              readOnly,
              may: may(access, 'fleet.routes.manage', trip.orgUnitId),
            })}
            unitLabel={label}
          />
        ) : (
          <div className="ox-fl-empty">
            <Icon name="search_off" size={32} />
            <strong>{L.emptyScope}</strong>
            <span>{L.emptyScopeHint}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="h-fleet" className="ox-fl">
      {head}
      {body}
    </section>
  );
}

function TripView(p: {
  trips: ReturnType<typeof visibleTrips>;
  trip: ReturnType<typeof visibleTrips>[number];
  vehicles: DomainVehicle[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  pickId: string | null;
  onPick: (vehicleId: string) => void;
  onTab: (tripId: string) => void;
  onAssign: (vehicleId: string) => void;
  onPool: () => void;
  editable: boolean;
  unitLabel: (unitId: string) => string;
}): ReactElement {
  const { trip, vehicles } = p;
  const picked = pickOf(vehicles, trip, p.pickId);
  const lines = rows(vehicles, trip, {
    filter: p.filter,
    pick: picked,
    canEdit: p.editable,
    unitLabel: p.unitLabel,
  });
  const c = card(
    trip,
    vehicles.find((v) => v.id === trip.vehicleId),
  );
  const legs = legRows(trip, picked);
  const tt = L.trip;
  return (
    <>
      <div role="tablist" aria-label={L.tripsAria} className="ox-fl-tabs">
        {tabsOf(p.trips, trip.id).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.selected ? 'true' : 'false'}
            className="ox-fl-tab"
            onClick={() => p.onTab(t.id)}
          >
            <span className="ox-fl-tab-title">{t.title}</span>
            <span className="ox-fl-tab-sub">{t.sub}</span>
          </button>
        ))}
      </div>
      <div className="ox-fl-cols">
        <div className="ox-fl-main">
          <div className="ox-fl-main-head">
            <h2 className="ox-fl-h2">{format(L.pick, { trip: trip.number })}</h2>
            <div role="group" aria-label={L.filterAria} className="ox-fl-filters">
              {FILTERS.map(([key, title]) => (
                <button
                  key={key}
                  type="button"
                  className="ox-fl-filter ox-fl-hit"
                  aria-pressed={p.filter === key ? 'true' : 'false'}
                  onClick={() => p.setFilter(key)}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
          {lines.map((r) => (
            <VehicleRow
              key={r.id}
              row={r}
              onPick={() => p.onPick(r.id)}
              onAssign={() => p.onAssign(r.id)}
            />
          ))}
          {lines.length === 0 ? <div className="ox-fl-nomatch">{L.noMatch}</div> : null}
          <div className="ox-fl-note">
            <Icon name="info" size={16} />
            <span>{L.compatNote}</span>
          </div>
        </div>
        <aside className="ox-fl-aside">
          <div className="ox-fl-trip">
            <div className="ox-fl-trip-head">
              <div>
                <span className="ox-fl-trip-when">{c.when}</span>
                <h2 className="ox-fl-trip-title">{c.title}</h2>
              </div>
              <ChipView chip={c.chip} />
            </div>
            <dl className="ox-fl-dl">
              <dt>{tt.cargo}</dt>
              <dd>{c.cargo}</dd>
              <dt>{tt.requirements}</dt>
              <dd>{c.req}</dd>
              <dt>{tt.driver}</dt>
              <dd>{c.driver}</dd>
              <dt>{tt.vehicle}</dt>
              <dd>{c.vehicle}</dd>
              <dt>{tt.route}</dt>
              <dd>{c.route}</dd>
            </dl>
            {c.noDriver ? (
              <button type="button" className="ox-fl-pool" onClick={p.onPool}>
                <Icon name="person_search" size={18} />
                {tt.findDriver}
              </button>
            ) : null}
          </div>
          <div className="ox-fl-route">
            <div>
              <h3 className="ox-fl-h3">{tt.legs}</h3>
              <span className="ox-fl-legfor">{legFor(picked)}</span>
            </div>
            <ol className="ox-fl-legs">
              {legs.map((l) => (
                <li key={l.n}>
                  <span className="ox-fl-leg-time">{l.time}</span>
                  <div className="ox-fl-leg-body">
                    <div className="ox-fl-leg-head">
                      <span className="ox-fl-leg-name">
                        {l.n}. {l.name}
                      </span>
                      <span className="ox-fl-leg-op">{l.op}</span>
                    </div>
                    {picked ? (
                      <div className="ox-fl-bars">
                        <span>{tt.volume}</span>
                        <div className="ox-fl-bar">
                          <div data-level={l.vBar} style={{ width: l.vW }} />
                        </div>
                        <span className="ox-fl-pct">{l.vPct}</span>
                        <span>{tt.mass}</span>
                        <div className="ox-fl-bar">
                          <div data-level={l.wBar} style={{ width: l.wW }} />
                        </div>
                        <span className="ox-fl-pct">{l.wPct}</span>
                      </div>
                    ) : null}
                    <span className="ox-fl-leg-after">{l.after}</span>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="ox-fl-navigator" disabled>
              {L.navigator}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function FleetPage(): ReactElement {
  const location = useLocation();
  const raw = location.search as Record<string, unknown>;
  if (raw.plan === 'new') return <PlanForm tripParam={text(raw.trip)} />;
  return <Workspace tripParam={text(raw.trip)} />;
}
