// W4.32 · Страница «База знаний» (`knowledge`, KB-01…KB-08; эталон design-2026-10-19 «База знаний.dc.html» М:21–375,
// в CRM — pg.knowledge :1825–1827). Список пространств с поиском и карточками (М:29–59) или пространство (М:61–292)
// по `?space=` (ADR-0001), страница — `&page=`, вкладка — `&tab=`; диалоги — состояние страницы. Ширина
// контейнера < 860 px — узкий вид (дерево или страница, М:487). Данные — тег Knowledge (W4.04, backend W4.31).
import { format, knowledge as K, shell } from '@ortus/texts';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCan, useShell } from '../../../shell/context.tsx';
import { LoadFailed, useRetryFocus } from '../../company/modules/ui.tsx';
import { useSearch, useSpaces } from './api.ts';
import { KbProvider, type KbSearch, searchOf, useKb } from './ctx.tsx';
import { SpaceDialog } from './dialogs.tsx';
import { dayOf, KIND_ICON, LEVEL_ICON, type Space } from './model.ts';
import { Failed, Glyph, Skeleton } from './parts.tsx';
import { SpaceView } from './space.tsx';
import '../../company/modules/modules.css';
import './knowledge.css';

/** Порог узкого вида по ширине контейнера (narrow М:487). */
const NARROW = 860;

/**
 * Баннер ошибки команды (М:25–27). Команда могла начаться ниже первого экрана (телефон: правила «Автоматизации»,
 * «Участники и доступ») — новый текст прокручивается в видимую область.
 */
function ErrBanner(): ReactElement | null {
  const { err, setErr } = useKb();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (err && el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'nearest' });
  }, [err]);
  if (!err) return null;
  return (
    <div ref={box} role="alert" className="ox-kb-err">
      <Glyph name="error" size={18} />
      <span className="ox-kb-err-text">{err}</span>
      <button type="button" aria-label={K.error.hide} onClick={() => setErr('')}>
        <Glyph name="close" size={18} />
      </button>
    </div>
  );
}

function SpaceCard({ sp, onOpen }: { sp: Space; onOpen: () => void }): ReactElement {
  const lv = LEVEL_ICON[sp.access];
  const lead = sp.leadNames.length ? sp.leadNames.join(', ') : K.card.leadOwner;
  return (
    <button type="button" className="ox-kb-card" onClick={onOpen}>
      <span className="ox-kb-card-top">
        <span className="ox-kb-card-icon" style={{ background: sp.color }}>
          <Glyph name={sp.icon} size={22} />
        </span>
        <span className="ox-kb-card-names">
          <strong>{sp.name}</strong>
          <span>{sp.areaLabel}</span>
        </span>{' '}
        <span className="ox-kb-chip ox-kb-card-level" data-tone={lv.tone}>
          <Glyph name={lv.icon} size={15} />
          {K.levels[sp.access].label}
        </span>
      </span>{' '}
      <span className="ox-kb-card-stats">
        <span>{format(K.card.pages, { n: sp.pageCount })}</span>
        <span>{format(K.card.lead, { names: lead })}</span>
      </span>{' '}
      <span className="ox-kb-card-tags">
        <span className="ox-kb-card-role">
          {format(K.card.role, { role: (sp.my.role || K.card.roleLink).toLowerCase() })}
        </span>
        {sp.my.lead && sp.openRequestCount ? (
          <span className="ox-kb-card-reqs">
            {format(K.card.requests, { n: sp.openRequestCount })}
          </span>
        ) : null}
      </span>{' '}
      {/* Пробелы между блоками — как переносы строк разметки эталона (подписи кнопки, М:46–53). */}
      {sp.lastUpdate ? (
        <span className="ox-kb-card-upd">
          <Glyph name="history" size={16} />
          <span>
            {format(K.card.updated, { title: sp.lastUpdate.title, date: dayOf(sp.lastUpdate.at) })}
          </span>
        </span>
      ) : null}
    </button>
  );
}

/** Список пространств (М:29–59): поиск по доступным страницам и карточки. */
function SpacesList(): ReactElement {
  const { tenantId, go, openDialog, dialog } = useKb();
  const can = useCan();
  const spaces = useSpaces(tenantId);
  const [q, setQ] = useState('');
  const term = q.trim();
  const searching = term.length >= 2;
  const hits = useSearch(tenantId, term);
  const retry = useRetryFocus(spaces.isSuccess, () => document.getElementById('kb-h'));
  const canNew = can('knowledge.spaces.manage');

  if (spaces.isPending) return <Skeleton />;
  return (
    <section aria-labelledby="kb-h" className="ox-kb-list">
      <div className="ox-kb-list-head">
        <span className="ox-kb-titles">
          <h1 id="kb-h" className="ox-kb-h1" tabIndex={-1}>
            {shell.nav.items.knowledge}
          </h1>
          <span className="ox-kb-sub">{K.list.subtitle}</span>
        </span>
        <span className="ox-kb-fill" />
        {canNew ? (
          <button type="button" className="ox-kb-new" onClick={() => openDialog({ kind: 'space' })}>
            <Glyph name="add" size={18} />
            {K.list.newSpace}
          </button>
        ) : null}
      </div>
      <label className="ox-kb-search">
        <Glyph name="search" size={18} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={K.list.searchAria}
          placeholder={K.list.searchPlaceholder}
        />
      </label>
      {searching && hits.isError ? (
        <div className="ox-kb-hits" data-state="error">
          <Failed q={hits} />
        </div>
      ) : searching && hits.data ? (
        <div className="ox-kb-hits">
          {hits.data.map((h) => (
            <button
              key={h.nodeId}
              type="button"
              className="ox-kb-hit"
              onClick={() => go({ space: h.spaceId, page: h.nodeId })}
            >
              <Glyph name={KIND_ICON[h.kind]} size={19} />
              <span className="ox-kb-hit-body">
                <strong>{h.title}</strong>
                <span className="ox-kb-hit-where">{h.path.join(' › ')}</span>
                <span className="ox-kb-hit-text">{h.excerpt}</span>
              </span>
            </button>
          ))}
          {!hits.data.length ? <span className="ox-kb-hits-empty">{K.list.noResults}</span> : null}
        </div>
      ) : null}
      {spaces.isError ? (
        <LoadFailed error={spaces.error} onRetry={retry(() => spaces.refetch())} />
      ) : (
        <div className="ox-kb-cards">
          {spaces.data.map((sp) => (
            <SpaceCard key={sp.id} sp={sp} onOpen={() => go({ space: sp.id })} />
          ))}
        </div>
      )}
      <div className="ox-kb-hint">
        <Glyph name="info" size={18} />
        <span>{K.list.hint}</span>
      </div>
      {dialog?.kind === 'space' ? <SpaceDialog /> : null}
    </section>
  );
}

/** Пространство по `?space=`: нет такого (скрыто, нет доступа) — баннер текстом сервера и список. */
function Body(): ReactElement {
  const { search } = useKb();
  if (!search.space) return <SpacesList />;
  return <SpaceView key={search.space} spaceId={search.space} />;
}

/** Ширина контейнера страницы (ResizeObserver, М:393–396); без наблюдателя — широкий вид. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(1100);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver((es) => {
      const next = Math.round(es[0]?.contentRect.width ?? 1100);
      setW((cur) => (Math.abs(next - cur) > 8 ? next : cur));
    });
    ro.current.observe(el);
    setW(Math.round(el.getBoundingClientRect().width) || 1100);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}

export default function KnowledgePage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const raw = location.search as Record<string, unknown>;
  const search = useMemo(() => searchOf(raw), [raw]);
  const now = useCallback(
    () => searchOf(router.state.location.search as Record<string, unknown>),
    [router],
  );
  const [ref, width] = useWidth();

  const go = useCallback(
    (next: KbSearch, replace = false) => {
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'knowledge' },
        search: clean as never,
        replace,
      });
    },
    [navigate, tenantId],
  );

  return (
    <KbProvider tenantId={tenantId} search={search} now={now} go={go} narrow={width < NARROW}>
      <div ref={ref} className="ox-kb">
        <ErrBanner />
        <Body />
      </div>
    </KbProvider>
  );
}
