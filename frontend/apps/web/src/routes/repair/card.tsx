// W6.20 · Карточка объекта («Ортус CRM.dc.html» :1982–2126, repairCardVM :4356): крошка, шапка с чипами и готовностью
// «по объёмам», кнопки «Отметить работу» и «Кабинет заказчика», вкладки по правам, панель вкладки. Данные — обзор
// объекта (`getRepairProjectOverview`) и отметки; суммы приходят только с правом финансов.
import { ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { type KeyboardEvent, type ReactElement, useId, useRef, useState } from 'react';

import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { AssignForemanDialog } from './assign.tsx';
import { useOverview, useWorkLogs } from './api.ts';
import { cardChips, cardSubtitle, type TabId, tabsOf } from './model.ts';
import { ChipView, Meter, useRepairNav } from './parts.tsx';
import { Overview } from './overview.tsx';
import { StubTab, TAB_PANELS } from './tabs.tsx';
import { REPAIR_TEXT as T } from './texts.ts';
import { useAccept, WorksTab } from './works.tsx';
import './repair.css';

const supplyCount = (texts: readonly string[]): number => {
  const m = /(\d+)$/.exec(texts.find((t) => /снабжения: \d+$/.test(t)) ?? '');
  return m ? Number(m[1]) : 0;
};

export function RepairCard(p: {
  tenantId: string;
  projectId: string;
  tab: string | undefined;
  canBack: boolean;
}): ReactElement {
  const { tenantId, projectId } = p;
  const { audience, readOnly, go } = useShell();
  const can = useCan();
  const owner = audience === 'owner';
  const foreman = audience === 'foreman';
  const canFin = owner || can('repairs.finance.read');
  const canReview = owner || can('repairs.work_logs.review');
  const canManage = owner || can('repairs.projects.manage');
  const canSupply = owner || can('repairs.supply.manage');
  const canEstimate = canFin && (owner || can('repairs.estimates.edit'));
  const navTo = useRepairNav(tenantId);
  const overview = useOverview(tenantId, projectId);
  const logs = useWorkLogs(tenantId, projectId);
  const accept = useAccept(tenantId);
  const [assign, setAssign] = useState(false);
  const ids = useId();
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const back = (): void => navTo({});

  if (overview.isPending) {
    return (
      <section className="ox-rp" aria-labelledby="h-rep">
        <h1 id="h-rep" className="ox-rp-title" tabIndex={-1}>
          {T.listLabel}
        </h1>
        <Skeleton lines={6} label={shell.a11y.loading} />
      </section>
    );
  }
  if (overview.isError) {
    const gone = overview.error instanceof ProblemError && overview.error.status === 404;
    return (
      <section className="ox-rp" aria-labelledby="h-rep">
        <h1 id="h-rep" className="ox-rp-title" tabIndex={-1}>
          {gone ? T.card.notFound : T.listLabel}
        </h1>
        {gone ? (
          <div className="ox-rp-empty">
            <Icon name="search_off" size={32} />
            <span>{T.card.notFoundText}</span>
            <button type="button" className="ox-rp-btn" onClick={back}>
              {T.card.toList}
            </button>
          </div>
        ) : (
          <Banner
            tone="danger"
            role="alert"
            title={format(T.loadFailed, { error: problemText(overview.error) })}
            action={{ label: T.retry, onPress: () => void overview.refetch() }}
          />
        )}
      </section>
    );
  }

  const ov = overview.data;
  const project = ov.project;
  const draft = project.status === 'draft';
  const done = project.status === 'handed_over';
  const logList = logs.data ?? [];
  const pending = logList.filter((l) => l.status === 'submitted').length;
  const kinds = ov.decisions.map((d) => d.kind);
  const tabs = tabsOf(project, {
    canFin,
    pending,
    changesNew: kinds.filter((k) => k === 'change_order_new').length,
    docs: kinds.filter((k) => k === 'document_wait_signature' || k === 'document_ready').length,
    supply: supplyCount(ov.decisions.filter((d) => d.kind === 'supply_pending').map((d) => d.text)),
    estimateMissing: kinds.includes('estimate_missing'),
  });
  const tab: TabId = tabs.find((t) => t.id === p.tab)?.id ?? 'overview';
  const estimateKind = kinds.find((k) => k.startsWith('estimate_'));
  const chips = cardChips(project, pending, estimateKind);
  const accepted = Math.min(100, project.readiness.acceptedPct);
  const pend = Math.min(100 - accepted, project.readiness.pendingPct);
  const canLog =
    foreman && !done && !draft && ov.works.some((w) => Number(w.fact) < Number(w.plan));

  const goTab = (id: string): void =>
    navTo({ obj: projectId, ...(id !== 'overview' ? { tab: id } : {}) });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, cur: TabId): void => {
    const i = tabs.findIndex((t) => t.id === cur);
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft'
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    tabRefs.current[next.id]?.focus();
    if (next.id !== tab) goTab(next.id);
  };

  const Panel = TAB_PANELS[tab];
  let body: ReactElement;
  if (tab === 'overview') {
    body = (
      <Overview
        ov={ov}
        logs={logList}
        foreman={foreman}
        canFin={canFin}
        readOnly={readOnly}
        accept={accept}
        onTab={goTab}
        onSupply={() => go('repairSupply')}
        onAssign={() => setAssign(true)}
      />
    );
  } else if (tab === 'works') {
    body = (
      <WorksTab
        tenantId={tenantId}
        ov={ov}
        logs={logList}
        foreman={foreman}
        canReview={canReview}
        canEstimate={canEstimate}
        canSupply={canSupply}
        readOnly={readOnly}
        accept={accept}
        onTab={goTab}
      />
    );
  } else if (Panel) {
    body = <Panel tenantId={tenantId} ov={ov} canFin={canFin} readOnly={readOnly} onTab={goTab} />;
  } else {
    body = <StubTab tab={tab} ov={ov} />;
  }

  return (
    <section aria-labelledby="h-rep" className="ox-rp">
      <div className="ox-rp-crumbs">
        <span>{T.crumb}</span>
        <Icon name="chevron_right" size={16} />
        {p.canBack ? (
          <button type="button" className="ox-rp-link" onClick={back}>
            {T.card.crumbObjects}
          </button>
        ) : (
          <span style={{ color: 'var(--ox-accent)', fontWeight: 500 }}>{T.card.crumbObjects}</span>
        )}
        <Icon name="chevron_right" size={16} />
        <span className="ox-rp-crumb-cur">{project.name}</span>
      </div>
      <div className="ox-rp-hero">
        <div className="ox-rp-hero-main">
          <span className="ox-rp-hero-icon" aria-hidden="true">
            <Icon name="apartment" size={28} />
          </span>
          <div className="ox-rp-hero-text">
            <div className="ox-rp-chips">
              {chips.map((c) => (
                <ChipView key={c.label} chip={c} />
              ))}
            </div>
            <h1 id="h-rep" className="ox-rp-title" tabIndex={-1}>
              {project.name}
            </h1>
            <span className="ox-rp-sub">{cardSubtitle(project)}</span>
          </div>
          {!draft ? (
            <div className="ox-rp-prog">
              <div className="ox-rp-prog-head">
                <span className="ox-rp-muted" style={{ fontSize: 'var(--ox-fs-sm)' }}>
                  {T.card.readiness}
                </span>
                <span>
                  <strong>{accepted}%</strong>{' '}
                  <span className="ox-rp-muted" style={{ fontSize: 'var(--ox-fs-sm)' }}>
                    {T.card.accepted}
                  </span>
                </span>
              </div>
              <Meter accepted={accepted} pending={pend} size="lg" />
              <div className="ox-rp-legend">
                <span>
                  <span className="ox-rp-sw" />
                  {T.card.legendAccepted.replace('{pct}', `${String(accepted)}%`)}
                </span>
                <span>
                  <span className="ox-rp-sw" data-pend="" />
                  {T.card.legendPending.replace(
                    '{pct}',
                    `${String(project.readiness.pendingPct)}%`,
                  )}
                </span>
                <span className="ox-rp-muted" style={{ fontSize: 'inherit' }}>
                  {T.card.clientNote}
                </span>
              </div>
            </div>
          ) : null}
          <div className="ox-rp-hero-acts">
            {canLog ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="primary"
                onClick={() => goTab('works')}
              >
                <Icon name="add_task" size={18} />
                {T.logWork}
              </button>
            ) : null}
            {canFin && !draft ? (
              <button type="button" className="ox-rp-btn" onClick={() => goTab('client')}>
                <Icon name="person" size={18} />
                {T.card.clientCabinet}
              </button>
            ) : null}
          </div>
        </div>
        <div role="tablist" aria-label={T.card.tabsAria} className="ox-rp-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              id={`${ids}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id ? 'true' : 'false'}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              className="ox-rp-tab"
              onClick={() => goTab(t.id)}
              onKeyDown={(e) => onTabKey(e, t.id)}
            >
              {t.label}
              {t.badge ? <span className="ox-rp-badge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div
        id={`${ids}-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-tab-${tab}`}
        className="ox-rp"
      >
        {body}
      </div>
      {assign && canManage ? (
        <AssignForemanDialog
          tenantId={tenantId}
          project={project}
          onClose={() => setAssign(false)}
        />
      ) : null}
    </section>
  );
}
