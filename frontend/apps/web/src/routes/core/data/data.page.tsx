// W2.26 · Страница «Данные» (`core-data`, S2-16, AC-14; эталон design-stage-2 «Ортус CRM.dc.html» pg.data
// :1960–1979, dataVM :4179–4208; 06 §7). Наборы и колонки — listDatasets (права набора и полей на сервере: набор без
// права не приходит, «Начисление» без fleet.earnings.read — только подпись в hiddenFieldLabels), строки — queryDataset
// с поиском «По любому видимому полю», сортировкой и курсором. Набор — `?set=` (ADR-0001). Личные виды — в браузере
// участника, выгрузка — тост эталона (Q-W2.51-7). Строка открывает карточку модуля.
import type { components } from '@ortus/api-client';
import { data as T, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { LoadFailed, useRetryFocus } from '../../company/modules/ui.tsx';
import { tripIdByNumber, useCounts, useDatasets, useRows } from './api.ts';
import {
  columns,
  countLabel,
  emptyText,
  exportText,
  nextSort,
  noteText,
  openTarget,
  pickSet,
  rowCells,
  setIcon,
  type Sort,
  sourceText,
  type Target,
  viewName,
} from './model.ts';
import { DATA_TEXT } from './texts.ts';
import { browserStore, loadViews, type SavedView, saveView, viewsKey } from './views.ts';
import '../../company/modules/modules.css';
import './data.css';

type S = components['schemas'];

/** Задержка поиска после ввода (запрос — по паузе, а не на каждую букву). */
const SEARCH_DELAY = 300;

function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Skeleton({ lines }: { lines: number }): ReactElement {
  return (
    <div className="ox-dt-skel" role="status" aria-label={shell.a11y.loading}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ox-dt-skel-line" />
      ))}
    </div>
  );
}

/** Набор: панель фильтра и вида, таблица, «Показать ещё», подвал. Смена набора — новый экземпляр (сброс фильтра). */
function SetView(p: {
  tenantId: string;
  ds: S['Dataset'];
  views: SavedView[];
  onSaveView: (v: SavedView) => void;
  onOpen: (t: Target) => void;
}): ReactElement {
  const { tenantId, ds } = p;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [view, setView] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const search = useDebounced(q.trim(), SEARCH_DELAY);
  const rows = useRows(tenantId, ds, search, sort);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  /** Строка, которая получит фокус после «Показать ещё». */
  const focusRow = useRef<number | null>(null);
  const [moreDone, setMoreDone] = useState(0);
  const retry = useRetryFocus(rows.isSuccess, () => document.getElementById('h-data'));
  const views = p.views.filter((v) => v.set === ds.id);
  const list = (rows.data?.pages ?? []).flatMap((pg) => pg.rows);
  const cols = columns(ds, sort);
  const visible = rows.data?.pages[0]?.visibleCount ?? list.length;

  useEffect(() => {
    const from = focusRow.current;
    if (from === null) return;
    focusRow.current = null;
    if (rows.isFetchNextPageError) {
      moreRef.current?.focus();
      return;
    }
    const all = tbody.current?.querySelectorAll<HTMLElement>('tr');
    if (all?.length) (all[from] ?? all[all.length - 1])?.focus();
    // Только по завершению «Показать ещё».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreDone]);

  const more = (): void => {
    focusRow.current = list.length;
    void rows.fetchNextPage().finally(() => setMoreDone((n) => n + 1));
  };

  const save = (): void => {
    const name = viewName(ds.name, q);
    p.onSaveView({ name, set: ds.id, q });
    setView(name);
    toast(T.viewSaved, 'ok');
  };

  const pickView = (name: string): void => {
    setView(name);
    setQ(views.find((v) => v.name === name)?.q ?? '');
  };

  const open = (row: S['DatasetRow']): void => {
    const t = openTarget(ds, row);
    if (t) p.onOpen(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: S['DatasetRow']): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open(row);
  };

  let body: ReactElement | null = null;
  if (rows.isPending) body = <Skeleton lines={3} />;
  else if (rows.isError)
    body = <LoadFailed error={rows.error} onRetry={retry(() => rows.refetch())} />;
  else if (list.length === 0) body = <div className="ox-dt-empty">{emptyText(search)}</div>;

  return (
    <>
      <div className="ox-dt-bar">
        <label className="ox-dt-field" data-grow="">
          {T.filter}
          <input
            type="search"
            value={q}
            placeholder={T.filterPlaceholder}
            onChange={(e) => {
              setQ(e.target.value);
              setView('');
            }}
          />
        </label>
        <label className="ox-dt-field">
          {T.view}
          <select value={view} onChange={(e) => pickView(e.target.value)}>
            <option value="">{T.noView}</option>
            {views.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ox-dt-btn" disabled={!q.trim()} onClick={save}>
          {T.saveView}
        </button>
        <button
          type="button"
          className="ox-dt-btn"
          disabled={!ds.exportAllowed}
          onClick={() => toast(exportText(ds.name, visible), 'info')}
        >
          <Icon name="download" size={18} />
          {T.export}
        </button>
      </div>
      <div className="ox-dt-card">
        <table className="ox-dt-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col">
                  {c.sortable ? (
                    <button
                      type="button"
                      className="ox-dt-sort"
                      onClick={() => setSort((s) => nextSort(s, c.key))}
                    >
                      {c.label}
                      <Icon name={c.icon} size={16} className="ox-dt-sort-icon" />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={tbody}>
            {rows.isError
              ? null
              : list.map((r) => (
                  <tr
                    key={r.recordId}
                    className="ox-dt-row"
                    tabIndex={0}
                    onClick={() => open(r)}
                    onKeyDown={(e) => onKey(e, r)}
                  >
                    {rowCells(r, ds).map((x, i) => (
                      <td key={ds.fields[i]?.key ?? i}>{x}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {body}
      </div>
      {rows.hasNextPage && !rows.isError ? (
        <button
          ref={moreRef}
          type="button"
          className="ox-mod-btn ox-dt-more"
          data-variant="secondary"
          disabled={rows.isFetchingNextPage}
          onClick={more}
        >
          {DATA_TEXT.more}
        </button>
      ) : null}
      <div className="ox-dt-foot">
        <span>{sourceText(ds)}</span>
        <span>{T.updated}</span>
        <span>{noteText(ds)}</span>
      </div>
    </>
  );
}

export default function DataPage(): ReactElement {
  const { tenantId: id, tenant, me } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const run = useRun();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = (location.search as Record<string, unknown>).set;
  const datasets = useDatasets(tenantId);
  const sets = useMemo(() => datasets.data ?? [], [datasets.data]);
  const counts = useCounts(tenantId, sets);
  const ds = pickSet(sets, typeof raw === 'string' ? raw : undefined);
  const key = viewsKey(tenantId, tenant?.membershipId ?? me.userId);
  // Виды — свои у каждой пары «организация — участник»: смена организации без перемонтирования читает её виды.
  const [saved, setSaved] = useState<{ key: string; list: SavedView[] }>(() => ({
    key,
    list: loadViews(browserStore(), key),
  }));
  const views = saved.key === key ? saved.list : loadViews(browserStore(), key);
  const retry = useRetryFocus(datasets.isSuccess, () => document.getElementById('h-data'));

  const go = (page: 'fleet' | 'review', trip?: string): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page },
      search: (trip ? { trip } : {}) as never,
    });

  const onOpen = (t: Target): void => {
    if (!('tripNumber' in t)) {
      go(t.page, t.trip);
      return;
    }
    // Расход: рейс по номеру (listTripPlans); сбой — тост `run`, переход не выполняется.
    void run('data:open', () => tripIdByNumber(api, tenantId, t.tripNumber)).then(
      (trip) => go('review', trip),
      () => undefined,
    );
  };

  const selectSet = (setId: string): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'data' },
      search: { set: setId } as never,
    });

  let body: ReactElement;
  if (datasets.isPending) {
    body = <Skeleton lines={4} />;
  } else if (datasets.isError) {
    body = <LoadFailed error={datasets.error} onRetry={retry(() => datasets.refetch())} />;
  } else if (!ds) {
    body = (
      <div className="ox-dt-card">
        <div className="ox-dt-empty">{T.emptyScope}</div>
      </div>
    );
  } else {
    body = (
      <>
        <div role="tablist" aria-label={T.setsAria} className="ox-dt-tabs">
          {sets.map((d, i) => {
            const c = counts[i]?.data;
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === ds.id ? 'true' : 'false'}
                className="ox-dt-tab"
                onClick={() => selectSet(d.id)}
              >
                <Icon name={setIcon(d.id)} size={18} />
                {d.name}
                <span className="ox-dt-count">{countLabel(c?.n, c?.capped)}</span>
              </button>
            );
          })}
        </div>
        <SetView
          key={ds.id}
          tenantId={tenantId}
          ds={ds}
          views={views}
          onSaveView={(v) => setSaved({ key, list: saveView(browserStore(), key, v) })}
          onOpen={onOpen}
        />
      </>
    );
  }

  return (
    <section aria-labelledby="h-data" className="ox-dt">
      <div>
        <h1 id="h-data" className="ox-dt-title" tabIndex={-1}>
          {shell.nav.items.data}
        </h1>
        <p className="ox-dt-intro">{T.intro}</p>
      </div>
      {body}
    </section>
  );
}
