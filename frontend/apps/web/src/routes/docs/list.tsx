// W7.25 · Список «Документы» (Д:30–108, listVM Д:868–896): заголовок и подзаголовок, «Загрузить», пять плиток
// создания, «Ждут меня · N», поиск, папка, отборы с числами, таблица (≥ 900) и карточки (< 900), пустые состояния,
// пояснение. Права плиток — по `my.create` папок; доступ и статусы — по данным сервера. Диалоги — dialogs.tsx.
import type { components } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Button, Icon, Skeleton } from '@ortus/ui';
import { type ChangeEvent, type ReactElement, useEffect, useState } from 'react';

import { useToast } from '../../shell/toast.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import { useDocList } from './api.ts';
import type { DocsCtx, DocsSearch } from './ctx.ts';
import { CreateDialog, type CreateInitial, FolderDialog } from './dialogs.tsx';
import {
  accessOf,
  type CreateKind,
  folderOptions,
  kindOf,
  shortName,
  statusChip,
  waitCards,
  whenOf,
} from './model.ts';
import { DOCS_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Filter = NonNullable<DocsSearch['filter']> | 'all';

const FILTERS: readonly Filter[] = ['all', 'mine', 'shared', 'route'];

/** Ширина контейнера: пороги эталона 640 / 900 (ResizeObserver, Д:775). */
export function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(1100);
  // Колбэк-реф: элемент может смонтироваться позже первого рендера (скелет загрузки выше).
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => {
      const next = Math.round(es[0]?.contentRect.width ?? 0);
      if (next) setW((cur) => (Math.abs(cur - next) > 8 ? next : cur));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TILES: readonly CreateKind[] = ['text', 'sheet', 'pdf', 'tpl', 'scan'];
const ext = (f: File): string => (f.name.split('.').pop() ?? '').toLowerCase();
const stem = (f: File): string => f.name.replace(/\.[^.]+$/, '');

function Row(p: {
  doc: S['DocSummary'];
  now: number;
  wide: boolean;
  onOpen: (d: S['DocSummary']) => void;
}): ReactElement {
  const { doc: d } = p;
  const k = kindOf(d.kind);
  const st = statusChip(d);
  const acc = accessOf(d.my);
  const waits = d.my.wait.length > 0;
  const upd = `${d.updatedBy ? shortName(d.updatedBy.displayName) : shortName(d.owner.displayName)} · ${whenOf(d.updatedAt, p.now)}`;
  const link = d.links[0]?.label === d.folderName ? undefined : d.links[0]?.label;
  const sub = `${d.folderName}${link ? ` · ${link}` : ''}`;
  return (
    <button
      type="button"
      className="ox-docs-row"
      data-wide={p.wide ? '' : undefined}
      data-wait={waits ? '' : undefined}
      onClick={() => p.onOpen(d)}
    >
      <span className="ox-docs-row-main">
        <span className="ox-docs-kind" data-kind={d.kind} aria-hidden="true">
          <Icon name={k.icon} size={p.wide ? 18 : 20} />
        </span>
        <span className="ox-docs-row-text">
          <span className="ox-docs-row-title">
            <strong>{d.title}</strong>
            {d.sensitivity === 'finance' ? (
              <span className="ox-docs-fin" title={T.finance}>
                <Icon name="payments" size={16} />
                <span className="ox-docs-sr">{T.finance}</span>
              </span>
            ) : null}
            {waits ? (
              <span className="ox-docs-dot" title={T.waitDot}>
                <span className="ox-docs-sr">{T.waitDot}</span>
              </span>
            ) : null}
          </span>
          <span className="ox-docs-row-sub">
            <Icon name="folder" size={15} />
            <span>{sub}</span>
          </span>
          {!p.wide ? (
            <>
              <span className="ox-docs-chip" data-tone={st.tone}>
                <Icon name={st.icon} size={15} />
                {st.label}
              </span>
              <span className="ox-docs-row-sub">
                {acc.label} · {upd}
              </span>
            </>
          ) : null}
        </span>
      </span>
      {p.wide ? (
        <>
          <span className="ox-docs-chip" data-tone={st.tone}>
            <Icon name={st.icon} size={15} />
            <span className="ox-docs-chip-text">{st.label}</span>
          </span>
          <span className="ox-docs-acc">
            <Icon name={acc.icon} size={16} />
            <span>{acc.label}</span>
          </span>
          <span className="ox-docs-upd">{upd}</span>
        </>
      ) : null}
    </button>
  );
}

export function DocList(p: { ctx: DocsCtx; search: DocsSearch }): ReactElement {
  const { ctx, search } = p;
  const toast = useToast();
  const [ref, cw] = useWidth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const filter: Filter = search.filter ?? 'all';
  const folderId = search.folder ?? '';
  const base = useDocList(ctx.tenantId, { q: '', filter: 'all', folderId: '' });
  const list = useDocList(ctx.tenantId, { q: dq, filter, folderId });
  const [create, setCreate] = useState<CreateInitial | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const wide = cw >= 900;

  const canCreate = ctx.folders.some((f) => f.my.create) && ctx.online;
  const canFolder = ctx.folders.some((f) => f.my.manage) && ctx.online;
  const items = base.data?.items ?? [];
  const counts = base.data?.counts;
  const waits = waitCards(items);
  const open = (d: S['DocSummary']): void => ctx.go({ doc: d.id });

  const onUpload = (e: ChangeEvent<HTMLInputElement>): void => {
    const fs = [...(e.target.files ?? [])];
    e.target.value = '';
    const first = fs[0];
    if (!first) return;
    const one = fs.length === 1;
    if (one && ext(first) === 'csv') {
      void first
        .text()
        .then((csv) => setCreate({ kind: 'sheet', csv, csvName: first.name, title: stem(first) }));
      return;
    }
    if (one && ['docx', 'doc', 'odt', 'rtf'].includes(ext(first))) {
      setCreate({ kind: 'text', title: stem(first) });
      toast(T.uploadTextToast, 'info');
      return;
    }
    if (one && ['xlsx', 'xls', 'ods'].includes(ext(first))) {
      setCreate({ kind: 'sheet', title: stem(first) });
      toast(T.uploadSheetToast, 'info');
      return;
    }
    setCreate({
      kind: fs.every((f) => f.type.startsWith('image/')) ? 'scan' : 'pdf',
      files: fs,
      title: stem(first),
    });
  };

  const chipCount = (f: Filter): number | undefined =>
    counts ? (f === 'all' ? counts.all : counts[f as 'mine' | 'shared' | 'route']) : undefined;

  const empty = !items.length && !dq && !folderId && filter === 'all';
  const rows = list.data?.items ?? [];

  let body: ReactElement;
  if (list.isError) {
    body = <LoadFailed error={list.error} onRetry={() => void list.refetch()} />;
  } else if (!list.data) {
    body = (
      <div role="status" aria-label={shell.a11y.loading} className="ox-docs-skel">
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </div>
    );
  } else if (!rows.length) {
    const text = empty ? T.emptyNone : filter === 'archive' ? T.emptyArchive : T.emptyFiltered;
    body = <p className="ox-docs-empty">{text}</p>;
  } else {
    body = (
      <ul className="ox-docs-rows" data-wide={wide ? '' : undefined}>
        {wide ? (
          <li className="ox-docs-cols" aria-hidden="true">
            <span>{T.cols.title}</span>
            <span>{T.cols.status}</span>
            <span>{T.cols.access}</span>
            <span>{T.cols.changed}</span>
          </li>
        ) : null}
        {rows.map((d) => (
          <li key={d.id}>
            <Row doc={d} now={ctx.now} wide={wide} onOpen={open} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div ref={ref} className="ox-docs" data-w={cw < 640 ? 'phone' : cw < 900 ? 'tablet' : 'wide'}>
      <section aria-labelledby="h-docs" className="ox-docs-section">
        <div className="ox-docs-head">
          <span className="ox-docs-head-text">
            <h1 id="h-docs" className="ox-docs-title" tabIndex={-1}>
              {T.title}
            </h1>
            <span className="ox-docs-sub">
              {items.length || base.isPending ? T.subFilled : T.subEmpty}
            </span>
          </span>
          <span className="ox-docs-grow" />
          {canFolder ? (
            <Button
              variant="secondary"
              icon="create_new_folder"
              onPress={() => setFolderOpen(true)}
            >
              {T.folder.open}
            </Button>
          ) : null}
          {canCreate ? (
            <label className="ox-docs-upload">
              <Icon name="upload" size={18} />
              {T.upload}
              <input
                type="file"
                multiple
                accept={T.uploadAccept}
                aria-label={T.uploadAria}
                onChange={onUpload}
              />
            </label>
          ) : null}
        </div>

        {canCreate ? (
          <div className="ox-docs-tiles" role="group" aria-label={T.tilesAria}>
            {TILES.map((k) => (
              <button
                key={k}
                type="button"
                className="ox-docs-tile"
                onClick={() => setCreate({ kind: k })}
              >
                <span
                  className="ox-docs-kind"
                  data-kind={
                    k === 'text' || k === 'sheet' || k === 'pdf'
                      ? k
                      : k === 'scan'
                        ? 'pdf'
                        : 'neutral'
                  }
                  aria-hidden="true"
                >
                  <Icon name={T.kinds[k].icon} size={20} />
                </span>
                <span className="ox-docs-tile-text">
                  <strong>{T.kinds[k].label}</strong>
                  <span>{T.kinds[k].hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {waits.length ? (
          <section className="ox-docs-waits" aria-labelledby="h-docs-waits">
            <div className="ox-docs-waits-head">
              <strong id="h-docs-waits">{`${T.waitsTitle} · ${waits.length}`}</strong>
              <span>{T.waitsNote}</span>
            </div>
            <ul className="ox-docs-waits-grid">
              {waits.map((w) => (
                <li key={w.key} className="ox-docs-wait">
                  <span className="ox-docs-chip" data-tone={w.tone}>
                    <Icon name={w.icon} size={15} />
                    {w.label}
                  </span>
                  <span className="ox-docs-wait-text">
                    <strong>{w.doc.title}</strong>
                    <span>{w.text}</span>
                  </span>
                  <button type="button" className="ox-docs-wait-btn" onClick={() => open(w.doc)}>
                    {w.button}
                    <span className="ox-docs-sr">{` · ${w.doc.title}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="ox-docs-bar">
          <label className="ox-docs-search">
            <Icon name="search" size={18} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={T.searchAria}
              placeholder={T.searchPlaceholder}
            />
          </label>
          <select
            className="ox-docs-select"
            value={folderId}
            onChange={(e) => ctx.go({ folder: e.target.value || undefined }, true)}
            aria-label={T.folderAria}
          >
            <option value="">{T.allFolders}</option>
            {folderOptions(ctx.folders).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div role="group" aria-label={T.filterAria} className="ox-docs-chips">
            {FILTERS.map((f) => {
              const n = chipCount(f);
              return (
                <button
                  key={f}
                  type="button"
                  className="ox-docs-filter"
                  aria-pressed={filter === f}
                  onClick={() => ctx.go({ filter: f === 'all' ? undefined : f }, true)}
                >
                  {n === undefined ? T.filters[f] : `${T.filters[f]} · ${n}`}
                </button>
              );
            })}
            <button
              type="button"
              className="ox-docs-filter"
              aria-pressed={filter === 'archive'}
              onClick={() => ctx.go({ filter: filter === 'archive' ? undefined : 'archive' }, true)}
            >
              {T.filters.archive}
            </button>
          </div>
        </div>

        {body}

        <div className="ox-docs-note">
          <Icon name="info" size={18} />
          <span>{T.note}</span>
        </div>
      </section>

      {create ? (
        <CreateDialog
          ctx={ctx}
          initial={create}
          onClose={() => setCreate(null)}
          onCreated={(id) => {
            setCreate(null);
            ctx.go({ doc: id });
          }}
        />
      ) : null}
      {folderOpen ? <FolderDialog ctx={ctx} onClose={() => setFolderOpen(false)} /> : null}
    </div>
  );
}
