// W2.25 · «Главная» (`home`, S2-18; эталон design-stage-2 «Ортус CRM.dc.html» pg.home :1708–1779, homeVM
// :4043–4137; 05 §5): шапка (дата · область, приветствие по часам, сводка), «Начало работы» владельца,
// «Требует решения» — очередь getMyDecisionQueue на реестре источников `@ortus/domain/home` (карточку вида
// собирает провайдер модуля, общий VM не правится), «Сегодня в работе» (логистика; неподключённые отраслевые
// модули — пунктир с «Подключить» у владельца), «Рейсы сегодня», «Последние события» (входящие участника).
// Источники и карточки модулей этапов 4–7 — out-of-stage (allowlist/home.md).
import {
  dateLine,
  greeting,
  hhmm,
  type HomeTarget,
  homeQueue,
  logisticsWork,
  offModules,
  setupSteps,
  summary,
  tripsToday,
} from '@ortus/domain/home';
import { buildNav, defaultPage, segmentOf } from '@ortus/domain/nav';
import { format, home, shell } from '@ortus/texts';
import { DecisionQueue, Icon } from '@ortus/ui';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { ALL_UNITS, unitLabel, useOrgUnits } from '../../shell/scope.ts';
import {
  useDecisionQueue,
  useHasStaff,
  useRecentEvents,
  useTripPlans,
  useVehicles,
} from './api.ts';
import { textOf } from './texts.ts';
import './home.css';

const ON = new Set(['active', 'draining']);

/** Иконка размера эталона вне шкалы Icon @ortus/ui (17 px шага :1722, 14 px чипа рейса :1768). */
function Glyph({ name, size }: { name: string; size: number }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

/**
 * У водителя «Главной» в эталоне нет (бриф §3): прямой URL уводит на его стартовую страницу — первый пункт меню,
 * как вход по `/` (ShellScreen). Офисная «Главная» не рендерится и её запросы не уходят.
 */
export default function HomePage(): ReactElement {
  const { tenantId, audience, nav } = useShell();
  const start = audience === 'driver' ? defaultPage(buildNav(nav)) : 'home';
  if (start !== 'home') {
    return (
      <Navigate
        to="/t/$tenantId/$page"
        params={{ tenantId: tenantId ?? '', page: segmentOf(start) ?? start }}
        replace
      />
    );
  }
  return <OfficeHome />;
}

function OfficeHome(): ReactElement {
  const { me, tenant, tenantId: id, audience, nav, scope } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const navigate = useNavigate();
  const [now] = useState(() => new Date());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const owner = audience === 'owner';
  const caps = nav.capabilities;

  const moduleOn = (key: string): boolean => {
    const m = nav.modules.get(key);
    return !!m && (ON.has(m.state) || (m.state === 'read_only' && m.reason !== 'disabled'));
  };
  const fleetOn = moduleOn('fleet');
  const fleetView = fleetOn && can('fleet.trips.read');

  const decisions = useDecisionQueue(tenantId);
  const trips = useTripPlans(tenantId, fleetView);
  const vehicles = useVehicles(tenantId, fleetView && can('fleet.vehicles.read'));
  const events = useRecentEvents(tenantId);
  const staff = useHasStaff(tenantId, owner);
  const units =
    useOrgUnits(tenantId, owner || caps.some((c) => c.permission === 'org_units.read')).data ?? [];

  const go = (t: HomeTarget): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: segmentOf(t.page as never) ?? t.page },
      search: (t.search ?? {}) as never,
    });

  const queue = homeQueue(decisions.data ?? { items: [], total: 0 }, undefined, { timeZone });

  let scopeText: string;
  if (owner) {
    scopeText =
      scope === ALL_UNITS
        ? format(home.scopeAll, { tenant: tenant?.name ?? '' })
        : (unitLabel(units, scope) ?? '');
  } else {
    const unit = caps.find((c) => c.permission.startsWith('fleet.') && c.scope.kind === 'org_unit')
      ?.scope.resourceIds[0];
    scopeText = (unit ? unitLabel(units, unit) : undefined) ?? shell.header.noScope;
  }

  const setup = setupSteps({
    industryOn: fleetOn || moduleOn('repairs'),
    rolesAssigned:
      decisions.isSuccess &&
      !decisions.data.items.some((i) => i.kind === 'access.members_without_role'),
    invited: staff.data ?? true,
  });

  const work = fleetView
    ? logisticsWork(trips.data ?? [], vehicles.data ?? [], now, timeZone)
    : null;
  const off = owner
    ? offModules(
        ['fleet', 'spa', 'repairs'].map((k) => ({
          moduleKey: k,
          state: moduleOn(k) ? 'active' : 'uninstalled',
        })),
      )
    : [];
  const rows = fleetView ? tripsToday(trips.data ?? [], vehicles.data ?? [], now, timeZone) : [];
  const recent = events.data ?? [];

  return (
    <section aria-labelledby="h-home" className="ox-home">
      <div className="ox-home-head">
        <div className="ox-home-context">
          {dateLine(now, timeZone)} · {scopeText}
        </div>
        <h1 id="h-home" className="ox-home-title" tabIndex={-1}>
          {textOf(greeting(now, timeZone, me.displayName))}
        </h1>
        <p className="ox-home-summary">{textOf(summary(queue.total))}</p>
      </div>

      {owner && setup.show && decisions.isSuccess ? (
        <div className="ox-home-setup">
          <div className="ox-home-setup-head">
            <h2 className="ox-home-h2">{home.setup.title}</h2>
            <span className="ox-home-muted">{textOf(setup.progress)}</span>
          </div>
          <ol className="ox-home-steps">
            {setup.steps.map((s) => (
              <li
                key={s.id}
                className="ox-home-step"
                data-done={s.done ? '' : undefined}
                data-current={s.current ? '' : undefined}
              >
                <span className="ox-home-step-n">
                  {s.done ? <Glyph name="check" size={17} /> : s.n}
                </span>
                <div className="ox-home-step-body">
                  <div className="ox-home-step-title">{textOf(s.title)}</div>
                  <div className="ox-home-step-text">{textOf(s.text)}</div>
                </div>
                {s.done ? null : (
                  <button
                    type="button"
                    className="ox-home-step-action"
                    onClick={() => go(s.action.target)}
                  >
                    {textOf(s.action.label)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="ox-home-cols">
        <div className="ox-home-main">
          <DecisionQueue
            title={home.queue.title}
            empty={home.queue.empty}
            count={textOf(queue.count)}
            state={decisions.isPending ? 'loading' : decisions.isError ? 'error' : 'ready'}
            error={{
              text: decisions.isError ? problemText(decisions.error) : '',
              onRetry: () => void decisions.refetch(),
              retryLabel: home.queue.retry,
            }}
            items={queue.cards.map((c) => ({
              id: c.key,
              tone: c.tone,
              icon: c.icon,
              tag: textOf(c.tag),
              title: textOf(c.title),
              meta: textOf(c.text),
              ...(c.action
                ? {
                    action: {
                      label: textOf(c.action.label),
                      onPress: () => go((c.action as NonNullable<typeof c.action>).target),
                    },
                  }
                : {}),
            }))}
          />

          <h2 className="ox-home-h2 ox-home-work-title">{home.work.title}</h2>
          <div className="ox-home-grid">
            {work ? (
              <button type="button" className="ox-home-work" onClick={() => go(work.target)}>
                <span className="ox-home-work-head">
                  <Icon name={work.icon} size={20} />
                  <strong>{textOf(work.title)}</strong>
                </span>
                {work.lines.map((l) => (
                  <span key={l.label.key} className="ox-home-line">
                    <span className="ox-home-muted">{textOf(l.label)}</span>
                    <span className="ox-home-value">{textOf(l.value)}</span>
                  </span>
                ))}
              </button>
            ) : null}
            {off.map((o) => (
              <div key={o.moduleKey} className="ox-home-off">
                <span className="ox-home-off-head">
                  <Icon name={o.icon} size={20} />
                  <strong>{textOf(o.title)}</strong>
                </span>
                <span className="ox-home-off-text">{home.work.off}</span>
                <button
                  type="button"
                  className="ox-home-off-action"
                  onClick={() => go({ page: 'modules' })}
                >
                  {home.work.connect}
                </button>
              </div>
            ))}
          </div>
        </div>

        <aside className="ox-home-aside">
          {rows.length > 0 ? (
            <div className="ox-home-trips">
              <h2 className="ox-home-h2 ox-home-h2-sm">{home.trips.title}</h2>
              {rows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="ox-home-trip"
                  onClick={() => go(r.target)}
                >
                  <span className="ox-home-trip-time">{r.time}</span>
                  <span className="ox-home-trip-body">
                    <span className="ox-home-trip-title">{textOf(r.title)}</span>
                    <span className="ox-home-trip-sub">
                      {format(home.trips.sub, {
                        driver: textOf(r.sub.driver),
                        vehicle: textOf(r.sub.vehicle),
                      })}
                    </span>
                  </span>
                  <span className="ox-home-chip" data-tone={r.chip.tone}>
                    <Glyph name={r.chip.icon} size={14} />
                    {r.chip.label}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="ox-home-events">
            <h2 className="ox-home-h2 ox-home-h2-sm">{home.events.title}</h2>
            {recent.map((e) => (
              <div key={e.id} className="ox-home-event">
                <span className="ox-home-event-text">{e.title}</span>
                {/* ЧЧ:ММ, как `{{ e.at }}` эталона (api.js:13), в том же поясе, что дата и рейсы. */}
                <time className="ox-home-event-at" dateTime={e.createdAt}>
                  {hhmm(new Date(e.createdAt), timeZone)}
                </time>
              </div>
            ))}
            {recent.length === 0 ? (
              <span className="ox-home-muted ox-home-event-empty">{home.events.empty}</span>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
