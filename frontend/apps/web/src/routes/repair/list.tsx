// W6.20 · Список объектов («Ортус CRM.dc.html» :1921–1981, repairListVM :4325): фильтры со счётчиками, поиск, таблица
// (владелец, контент ≥ 880 px) или карточки (прораб всегда), «Сначала то, что ждёт решения», пустые состояния.
import { pageAccess } from '@ortus/domain/nav';
import { format, shell } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { useMembers, useProjects } from './api.ts';
import { type ListRow, listModel } from './model.ts';
import { ChipView, Meter, todayIso, useRepairNav, useRepairSearch } from './parts.tsx';
import { REPAIR_TEXT as T } from './texts.ts';
import './repair.css';

const WIDE = 880;

/** Ширина контента: порог таблицы эталона (`cw ≥ 880`); без ResizeObserver (тесты) — карточки. */
function useWide(): [(el: HTMLElement | null) => void, boolean] {
  const [wide, setWide] = useState(false);
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => () => ro.current?.disconnect(), []);
  const ref = (el: HTMLElement | null): void => {
    ro.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (w: number): void => setWide(w >= WIDE);
    measure(el.clientWidth);
    ro.current = new ResizeObserver((e) => measure(e[0]?.contentRect.width ?? el.clientWidth));
    ro.current.observe(el);
  };
  return [ref, wide];
}

function TodoCell({ row }: { row: ListRow }): ReactElement {
  if (row.top) {
    return (
      <div className="ox-rp-todo-cell">
        <Icon name={row.top.icon} size={18} />
        <div className="ox-rp-todo-text">
          <span>
            <span className="ox-rp-tag ox-rp-tone" data-tone={row.top.tone}>
              {row.top.tag}
            </span>{' '}
            · {row.top.title}
          </span>
          {row.more ? <span className="ox-rp-muted">{row.more}</span> : null}
        </div>
      </div>
    );
  }
  if (row.quiet) {
    return (
      <span className="ox-rp-quiet">
        <Icon name="check_circle" size={18} />
        {T.noQuestions}
      </span>
    );
  }
  return <></>;
}

function ProgressCell({ row }: { row: ListRow }): ReactElement {
  return (
    <div className="ox-rp-stack">
      <ChipView chip={row.stage} />
      {row.showBar ? (
        <div className="ox-rp-meter-row">
          <Meter accepted={row.acceptedPct} pending={row.pendingPct} />
          <span className="ox-rp-pct">{row.acceptedPct}%</span>
        </div>
      ) : null}
      {row.isDraft && row.estText ? <span className="ox-rp-est">{row.estText}</span> : null}
      {row.hasPending ? <span className="ox-rp-pend">{row.pendingText}</span> : null}
    </div>
  );
}

function Table(p: { rows: ListRow[]; onOpen: (id: string, tab?: string) => void }): ReactElement {
  return (
    <div className="ox-rp-tablebox">
      <table className="ox-rp-table">
        <thead>
          <tr>
            <th scope="col">{T.columns.object}</th>
            <th scope="col" style={{ width: 180 }}>
              {T.columns.stage}
            </th>
            <th scope="col">{T.columns.due}</th>
            <th scope="col">{T.columns.foreman}</th>
            <th scope="col" style={{ width: '34%' }}>
              {T.columns.todo}
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.id} onClick={() => p.onOpen(r.id)}>
              <td>
                <button
                  type="button"
                  className="ox-rp-open"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onOpen(r.id);
                  }}
                >
                  <span className="ox-rp-open-name">{r.name}</span>
                  <span className="ox-rp-open-addr">{r.address}</span>
                </button>
              </td>
              <td>
                <ProgressCell row={r} />
              </td>
              <td>
                <div className="ox-rp-due">
                  <span className="ox-rp-due-date" data-slip={r.slip ? '' : undefined}>
                    {r.due}
                  </span>
                  <span className="ox-rp-muted">{r.dueSub}</span>
                </div>
              </td>
              <td>
                <span
                  className="ox-rp-fm"
                  data-muted={r.foremanMuted && !r.isDraft ? '' : undefined}
                  data-draft={r.isDraft ? '' : undefined}
                >
                  {r.foreman}
                </span>
              </td>
              <td>
                <TodoCell row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards(p: { rows: ListRow[]; onOpen: (id: string, tab?: string) => void }): ReactElement {
  return (
    <div className="ox-rp-cards">
      {p.rows.map((r) => (
        <div key={r.id} className="ox-rp-obj">
          <button type="button" className="ox-rp-obj-open" onClick={() => p.onOpen(r.id)}>
            <ChipView chip={r.stage} />
            <span className="ox-rp-stack" style={{ gap: 2 }}>
              <strong className="ox-rp-obj-name">{r.name}</strong>
              <span className="ox-rp-obj-addr">{r.address}</span>
            </span>
            {r.showBar ? (
              <span className="ox-rp-stack" style={{ gap: 6 }}>
                <span className="ox-rp-obj-pct">
                  <span>
                    <strong style={{ fontWeight: 600 }}>{r.acceptedPct}%</strong>{' '}
                    <span className="ox-rp-muted" style={{ fontSize: 'inherit' }}>
                      {T.accepted}
                    </span>
                  </span>
                  {r.hasPending ? <span className="ox-rp-pend">{r.pendingText}</span> : null}
                </span>
                <Meter accepted={r.acceptedPct} pending={r.pendingPct} />
              </span>
            ) : null}
            {r.isDraft && r.estText ? (
              <span className="ox-rp-quiet" style={{ color: 'var(--ox-text-label)' }}>
                <Icon name="request_quote" size={18} />
                {r.estText}
              </span>
            ) : null}
            <span className="ox-rp-obj-line">
              <span>
                {r.dueLabel}{' '}
                <span className="ox-rp-due-date" data-slip={r.slip ? '' : undefined}>
                  {r.due}
                </span>
                {r.dueSub ? <span className="ox-rp-muted"> · {r.dueSub}</span> : null}
              </span>
              {r.showForeman ? (
                <span className="ox-rp-muted" style={{ fontSize: 'inherit' }}>
                  {T.foremanLabel}{' '}
                  <span
                    className="ox-rp-fm"
                    data-muted={r.foremanMuted && !r.isDraft ? '' : undefined}
                    data-draft={r.isDraft ? '' : undefined}
                  >
                    {r.foreman}
                  </span>
                </span>
              ) : null}
            </span>
            {r.top ? (
              <span className="ox-rp-obj-top" data-tone={r.top.tone}>
                <Icon name={r.top.icon} size={18} />
                <span>
                  <span className="ox-rp-tag ox-rp-tone" data-tone={r.top.tone}>
                    {r.top.tag}
                  </span>{' '}
                  · {r.top.title}
                  {r.more ? <span className="ox-rp-muted"> · {r.more}</span> : null}
                </span>
              </span>
            ) : null}
          </button>
          {r.canLog ? (
            <div className="ox-rp-obj-act">
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="primary"
                onClick={() => p.onOpen(r.id, 'works')}
              >
                <Icon name="add_task" size={20} />
                {T.logWork}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RepairList({ tenantId }: { tenantId: string }): ReactElement {
  const { audience, nav, go } = useShell();
  const can = useCan();
  const foreman = audience === 'foreman';
  const search = useRepairSearch();
  const navTo = useRepairNav(tenantId);
  const projects = useProjects(tenantId);
  const members = useMembers(tenantId, !foreman && (audience === 'owner' || can('members.read')));
  const [sizeRef, wide] = useWide();
  const [q, setQ] = useState(search.q);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.displayName]));
  const model = listModel(projects.data ?? [], {
    foreman,
    filter: search.filter,
    q: search.q,
    today: todayIso(),
    foremanName: (id) => (id ? names.get(id) : undefined),
    wide,
  });
  const leads = !foreman && pageAccess(nav, 'leads').kind === 'allow';
  const open = (id: string, tab?: string): void => navTo({ obj: id, ...(tab ? { tab } : {}) });
  const setFilter = (key: string): void =>
    navTo({ ...(key !== 'active' ? { filter: key } : {}), ...(q ? { q } : {}) }, true);
  const onQ = (value: string): void => {
    setQ(value);
    navTo(
      {
        ...(search.filter ? { filter: search.filter } : {}),
        ...(value.trim() ? { q: value } : {}),
      },
      true,
    );
  };

  let body: ReactElement;
  if (projects.isPending) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (projects.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(projects.error) })}
        action={{ label: T.retry, onPress: () => void projects.refetch() }}
      />
    );
  } else if (model.empty) {
    body = (
      <div className="ox-rp-empty">
        <Icon name={model.empty.icon} size={32} />
        <strong>{model.empty.title}</strong>
        <span style={{ maxWidth: 440 }}>{model.empty.text}</span>
      </div>
    );
  } else {
    body =
      model.view === 'table' ? (
        <Table rows={model.rows} onOpen={open} />
      ) : (
        <Cards rows={model.rows} onOpen={open} />
      );
  }

  return (
    <section aria-labelledby="h-rep" className="ox-rp" ref={sizeRef}>
      <div className="ox-rp-top">
        <div className="ox-rp-top-text">
          <span className="ox-rp-crumb">{T.crumb}</span>
          <h1 id="h-rep" className="ox-rp-title" tabIndex={-1}>
            {T.listLabel}
          </h1>
          {foreman ? <span className="ox-rp-sub">{T.foremanSub}</span> : null}
        </div>
        {leads ? (
          <div className="ox-rp-leads">
            <span>{T.leadsHint}</span>
            <button type="button" className="ox-rp-btn" onClick={() => go('leads')}>
              <Icon name="filter_alt" size={18} />
              {T.leadsButton}
            </button>
          </div>
        ) : null}
      </div>
      <div className="ox-rp-bar">
        <div role="group" aria-label={T.filtersAria} className="ox-rp-filters">
          {model.filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="ox-rp-filter"
              aria-pressed={f.selected ? 'true' : 'false'}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="ox-rp-filter-n">{projects.isSuccess ? f.count : 0}</span>
            </button>
          ))}
        </div>
        {!foreman ? (
          <label className="ox-rp-search">
            <Icon name="search" size={18} />
            <input
              type="search"
              value={q}
              placeholder={T.searchPlaceholder}
              aria-label={T.searchAria}
              onChange={(e) => onQ(e.target.value)}
            />
          </label>
        ) : null}
        <span className="ox-rp-sort">{T.sortNote}</span>
      </div>
      {body}
    </section>
  );
}
