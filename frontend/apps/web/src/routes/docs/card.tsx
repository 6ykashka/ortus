// W7.25 · Карточка документа (docs-doc; Д:110–553, docVM Д:921–961): назад, вид, крошки, переименование на месте,
// «Сохранено на сервере · vN», «Поделиться · N», чип статуса, меню «…», баннеры состояний, окно документа и подвал
// движка. Правку ведёт движок (D-32): без него «Редактор подключается», просмотр и поля CRM (Q-W4.00-documents-1).
// Права кнопок — только `my.can` сервера. Панель справа (≥ 900) или снизу: «Обсуждение», «Версии», «Данные», PDF.
import { ProblemError } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { Button, EmptyState, Icon, Skeleton, Tabs } from '@ortus/ui';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useRun } from '../../shell/run.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import { commands, idemKeys, useDocument, useSession } from './api.ts';
import { reasonOf } from './cmd.ts';
import type { DocsCtx, DocsSearch } from './ctx.ts';
import { MoveDialog } from './dialogs.tsx';
import { useWidth } from './list.tsx';
import { bytesText, fill, kindOf, levelName, statusChip, whenOf } from './model.ts';
import { DataTab, ToolsTab, TalkTab, VersionsTab } from './panel.tsx';
import { DocRoutePanel } from './route/panel.tsx';
import { ShareDialog } from './share.tsx';
import { DOCS_TEXT as T } from './texts.ts';

type Tab = NonNullable<DocsSearch['tab']>;

export function DocCard(p: { ctx: DocsCtx; id: string; tab: DocsSearch['tab'] }): ReactElement {
  const { ctx, id } = p;
  const api = useApi();
  const run = useRun();
  const [keys] = useState(idemKeys);
  const [ref, cw] = useWidth();
  const q = useDocument(ctx.tenantId, id);
  const d = q.data?.doc;
  const session = useSession(ctx.tenantId, id, !!d);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameErr, setRenameErr] = useState<string | undefined>();
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [move, setMove] = useState(false);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const renameInput = useRef<HTMLInputElement | null>(null);
  const isRenaming = renaming !== null;

  useEffect(() => {
    if (isRenaming) renameInput.current?.focus();
  }, [isRenaming]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenu(false);
        menuBtn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (q.isError) {
    const code = q.error instanceof ProblemError ? q.error.status : 0;
    if (code === 404 || code === 403) {
      return (
        <section className="ox-docs-section" aria-labelledby="h-doc-gone">
          <EmptyState
            icon="lock"
            title={T.notFound}
            text={
              q.error instanceof ProblemError
                ? (q.error.problem?.detail ?? T.notFoundText)
                : T.notFoundText
            }
            action={{ label: T.toList, onPress: () => ctx.go({ doc: undefined }) }}
          />
          <h1 id="h-doc-gone" className="ox-docs-sr">
            {T.notFound}
          </h1>
        </section>
      );
    }
    return (
      <section className="ox-docs-section">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
      </section>
    );
  }
  if (!d) {
    return (
      <section className="ox-docs-section" role="status" aria-label={shell.a11y.loading}>
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </section>
    );
  }

  const can = d.my.can;
  const edit = can.edit && ctx.online;
  const k = kindOf(d.kind);
  const chip = statusChip(
    { status: d.status, ocr: d.ocr, pdfaCopy: d.pdfaCopy },
    d.route ? { route: d.route } : {},
  );
  const phone = cw < 640;
  const wide = cw >= 900;
  const cfg = session.data;
  const perm = cfg?.permissions;
  const archived = d.status === 'archived';

  const tabs: { id: Tab; label: string; badge?: number }[] =
    d.kind === 'sheet'
      ? [
          { id: 'data', label: T.tabs.data },
          { id: 'talk', label: T.tabs.talk, badge: d.openCommentCount },
          { id: 'versions', label: T.tabs.versions },
        ]
      : d.kind === 'pdf'
        ? [
            { id: 'tools', label: d.scan ? T.tabs.ocr : T.tabs.tools },
            { id: 'talk', label: T.tabs.talk, badge: d.openCommentCount },
            { id: 'versions', label: T.tabs.versions },
          ]
        : [
            { id: 'talk', label: T.tabs.talk, badge: d.openCommentCount },
            { id: 'versions', label: T.tabs.versions },
          ];
  const tab = tabs.find((t) => t.id === p.tab)?.id ?? (tabs[0]?.id as Tab);

  const rename = async (): Promise<void> => {
    const title = (renaming ?? '').trim();
    if (title === d.title) {
      setRenaming(null);
      return;
    }
    if (title.length < 2) {
      setRenameErr(T.create.errTitle);
      return;
    }
    const body = { title };
    try {
      await run(
        'docs.rename',
        () =>
          commands.renameDoc(
            api,
            ctx.tenantId,
            { id: d.id, revision: d.revision },
            body,
            keys.key(body),
          ),
        T.rename.done,
        { quiet: ['validation_failed'] },
      );
      keys.settle(body);
      setRenaming(null);
      setRenameErr(undefined);
      await ctx.refresh();
    } catch (e) {
      setRenameErr(reasonOf(e));
    }
  };

  const archive = async (): Promise<void> => {
    setMenu(false);
    try {
      if (archived) {
        await run(
          'docs.archive',
          () => commands.unarchive(api, ctx.tenantId, d.id),
          T.archive.restored,
        );
      } else {
        await run('docs.archive', () => commands.archive(api, ctx.tenantId, d.id), T.archive.done);
      }
    } catch {
      // тост показал `run`
    }
    await ctx.refresh();
  };

  const exportPdf = async (): Promise<void> => {
    setMenu(false);
    const body = { op: 'to_pdf' as const, docIds: [d.id] };
    try {
      await run(
        'docs.job',
        () => commands.createJob(api, ctx.tenantId, body, keys.key(body)),
        T.pdf.started,
      );
      keys.settle(body);
      ctx.go({ tab: 'versions' }, true);
    } catch {
      // тост показал `run`
    }
    await ctx.refresh();
  };

  const menuItems: { icon: string; label: string; on: boolean; tip: string; fn: () => void }[] = [
    {
      icon: 'edit',
      label: T.menu.rename,
      on: edit,
      tip: T.menu.needEdit,
      fn: () => {
        setRenaming(d.title);
        setMenu(false);
      },
    },
    {
      icon: 'drive_file_move',
      label: T.menu.move,
      on: edit,
      tip: T.menu.needEdit,
      fn: () => {
        setMove(true);
        setMenu(false);
      },
    },
    {
      icon: 'history',
      label: T.menu.versions,
      on: true,
      tip: '',
      fn: () => {
        ctx.go({ tab: 'versions' }, true);
        setMenu(false);
      },
    },
    {
      icon: 'shield_person',
      label: T.menu.access,
      on: true,
      tip: '',
      fn: () => {
        setShare(true);
        setMenu(false);
      },
    },
    ...(d.kind !== 'pdf'
      ? [
          {
            icon: 'picture_as_pdf',
            label: T.menu.exportPdf,
            on: can.convert && ctx.online && !archived,
            tip: T.menu.needEdit,
            fn: () => void exportPdf(),
          },
          {
            icon: 'download',
            label: d.kind === 'sheet' ? T.menu.downloadSheet : T.menu.downloadText,
            on: can.export && !!cfg?.fileUrl && !!perm?.download,
            tip: T.menu.needExport,
            fn: () => {
              setMenu(false);
              if (!cfg?.fileUrl) return;
              const a = document.createElement('a');
              a.href = cfg.fileUrl;
              a.download = '';
              a.click();
            },
          },
        ]
      : []),
    {
      icon: archived ? 'unarchive' : 'inventory_2',
      label: archived ? T.menu.restore : T.menu.archive,
      on:
        (d.my.level === 'edit' || d.my.level === 'manage') && ctx.online && d.status !== 'in_route',
      tip: T.menu.needEdit,
      fn: () => void archive(),
    },
  ];

  const banners: { icon: string; text: string; tone: 'info' | 'neutral' | 'warn' }[] = [];
  if (!ctx.online) banners.push({ icon: 'cloud_off', tone: 'neutral', text: T.offlineBanner });
  if (d.my.onlyVersion) {
    banners.push({
      icon: 'visibility',
      tone: 'info',
      text: fill(T.banners.onlyVersion, { v: d.my.onlyVersion }),
    });
  }
  if (d.pdfaCopy) banners.push({ icon: 'inventory_2', tone: 'neutral', text: T.banners.pdfa });
  else if (can.locked && !archived) {
    banners.push({
      icon: 'lock',
      tone: 'neutral',
      text: fill(T.banners.locked, { v: d.route?.version ?? d.version }),
    });
  }
  if (archived) banners.push({ icon: 'inventory_2', tone: 'neutral', text: T.banners.archived });
  if (d.sensitivity === 'pdn') banners.push({ icon: 'shield', tone: 'warn', text: T.banners.pdn });
  if (!can.edit && !can.locked && !archived && !d.pdfaCopy && !d.my.onlyVersion && ctx.online) {
    banners.push({
      icon: 'visibility',
      tone: 'info',
      text: fill(T.banners.readOnly, { level: levelName(d.my.level) }),
    });
  }

  const sizeLine = d.file
    ? fill(T.engine.fileInfo, { name: d.file.fileName, size: bytesText(d.file.sizeBytes) })
    : '';
  const yn = (v: boolean | undefined): string => (v ? T.engine.yes : T.engine.no);
  const shareCount = d.shares.length + 1;

  const panel = (
    <aside className="ox-docs-panel" aria-label={T.panelAria} data-side={wide ? '' : undefined}>
      <Tabs
        aria-label={T.panelAria}
        value={tab}
        onChange={(v) => ctx.go({ tab: v }, true)}
        items={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          ...(t.badge ? { badge: t.badge } : {}),
        }))}
      >
        <div className="ox-docs-panel-body">
          {tab === 'talk' ? <TalkTab ctx={ctx} doc={d} /> : null}
          {tab === 'versions' ? <VersionsTab ctx={ctx} doc={d} /> : null}
          {tab === 'data' ? <DataTab ctx={ctx} doc={d} /> : null}
          {tab === 'tools' ? <ToolsTab ctx={ctx} doc={d} /> : null}
        </div>
      </Tabs>
    </aside>
  );

  return (
    <div ref={ref} className="ox-docs" data-w={phone ? 'phone' : cw < 900 ? 'tablet' : 'wide'}>
      <section aria-label={d.title} className="ox-docs-doc">
        <div className="ox-docs-doc-head">
          <button
            type="button"
            className="ox-docs-back"
            onClick={() => ctx.go({ doc: undefined, tab: undefined })}
          >
            <Icon name="arrow_back" size={18} />
            <span className="ox-docs-sr">{T.back}</span>
          </button>
          <span className="ox-docs-kind" data-kind={d.kind} aria-hidden="true">
            <Icon name={k.icon} size={20} />
          </span>
          <span className="ox-docs-doc-title">
            <span className="ox-docs-crumb">{[T.crumb, ...d.path].join(' › ')}</span>
            {renaming !== null ? (
              <span className="ox-docs-rename">
                <input
                  className="ox-docs-rename-input"
                  value={renaming}
                  aria-label={T.rename.aria}
                  ref={renameInput}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename();
                    if (e.key === 'Escape') {
                      setRenaming(null);
                      setRenameErr(undefined);
                    }
                  }}
                />
                <Button variant="primary" size="compact" onPress={() => void rename()}>
                  {T.rename.save}
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setRenaming(null);
                    setRenameErr(undefined);
                  }}
                >
                  {T.rename.cancel}
                </Button>
                {renameErr ? (
                  <span role="alert" className="ox-docs-field-err">
                    {renameErr}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="ox-docs-doc-line">
                <h1 className="ox-docs-doc-h" id="h-doc" tabIndex={-1}>
                  {d.title}
                </h1>
                {d.sensitivity === 'finance' ? (
                  <span className="ox-docs-fin" title={T.banners.finance}>
                    <Icon name="payments" size={16} />
                    <span className="ox-docs-sr">{T.finance}</span>
                  </span>
                ) : null}
                <span className="ox-docs-saved">
                  <Icon name={ctx.online ? 'cloud_done' : 'cloud_off'} size={16} />
                  {ctx.online
                    ? fill(T.saved, { v: d.version, time: whenOf(d.updatedAt, ctx.now) })
                    : T.offline}
                </span>
              </span>
            )}
          </span>
          <button type="button" className="ox-docs-btn" onClick={() => setShare(true)}>
            <Icon name="group" size={18} />
            {fill(can.share ? T.shareBtn : T.shareBtnView, { n: shareCount })}
          </button>
          <span className="ox-docs-chip" data-tone={chip.tone}>
            <Icon name={chip.icon} size={15} />
            {chip.label}
          </span>
          <span className="ox-docs-menu-wrap" ref={menuRef}>
            <button
              ref={menuBtn}
              type="button"
              className="ox-docs-icon-btn"
              aria-label={T.menuAria}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="more_horiz" size={18} />
            </button>
            {menu ? (
              <div role="menu" className="ox-docs-menu" aria-label={T.menuAria}>
                {menuItems.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    role="menuitem"
                    className="ox-docs-menu-item"
                    disabled={!m.on}
                    title={m.on ? undefined : m.tip}
                    onClick={m.fn}
                  >
                    <Icon name={m.icon} size={18} />
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        </div>

        {banners.map((b) => (
          <div key={b.text} className="ox-docs-banner" data-tone={b.tone} role="status">
            <Icon name={b.icon} size={18} />
            <span>{b.text}</span>
          </div>
        ))}

        <DocRoutePanel tenantId={ctx.tenantId} docId={d.id} />

        <div className="ox-docs-doc-body" data-wide={wide ? '' : undefined}>
          <div className="ox-docs-paper">
            <div className="ox-docs-engine" role="region" aria-label={T.engine.title}>
              <span className="ox-docs-kind" data-kind={d.kind} aria-hidden="true">
                <Icon name={k.icon} size={28} />
              </span>
              <h2 className="ox-docs-engine-title">
                {cfg && !cfg.editorAvailable ? T.engine.title : d.title}
              </h2>
              <p>{T.engine.text}</p>
              <p className="ox-docs-hint">
                {T.engine.modeView} · {fill(T.engine.version, { v: d.version })}
                {sizeLine ? ` · ${sizeLine}` : ''}
              </p>
              {cfg?.fileUrl && perm?.download ? (
                <a className="ox-docs-link" href={cfg.fileUrl} download>
                  {T.engine.download}
                </a>
              ) : null}
            </div>
            {d.kind === 'text' ? (
              <section
                className="ox-docs-fields"
                aria-label={fill(T.fieldsTitle, { n: d.fields.length })}
              >
                <strong>{fill(T.fieldsTitle, { n: d.fields.length })}</strong>
                {d.fields.length ? (
                  <ul>
                    {d.fields.map((f) => (
                      <li key={f.key}>
                        <span className="ox-docs-field-key">{f.key}</span>
                        <span className="ox-docs-hint">{f.from ?? f.src ?? ''}</span>
                        <span className="ox-docs-field-val">{f.value ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ox-docs-hint">{T.fieldsEmpty}</p>
                )}
                <p className="ox-docs-hint">
                  {d.frozen ? fill(T.fieldsFrozen, { v: d.version }) : T.fieldsNote}
                </p>
              </section>
            ) : null}
            {d.links.length ? (
              <section className="ox-docs-fields" aria-label={T.links}>
                <strong>{T.links}</strong>
                <ul>
                  {d.links.map((l) => (
                    <li key={l.object.entityId}>
                      <Icon name="link" size={16} />
                      <span>{l.label ?? l.object.entityType}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          {panel}
        </div>

        <p className="ox-docs-engine-foot">
          {fill(T.engine.footer, {
            edit: yn(perm?.edit),
            review: yn(perm?.review),
            comment: yn(perm?.comment),
            download: yn(perm?.download),
            print: yn(perm?.print),
            level: levelName(d.my.level),
          })}
        </p>
      </section>

      {share ? <ShareDialog ctx={ctx} doc={d} onClose={() => setShare(false)} /> : null}
      {move ? (
        <MoveDialog
          ctx={ctx}
          doc={{ id: d.id, title: d.title, folderId: d.folderId }}
          onClose={() => setMove(false)}
        />
      ) : null}
    </div>
  );
}
