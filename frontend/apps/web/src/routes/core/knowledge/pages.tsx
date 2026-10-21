// W4.32 · Вкладка «Страницы» (М:76–197, pagesVM/pageVM/editVM М:486–561): дерево с поиском «Найти в пространстве»
// (от двух символов — searchKnowledge внутри пространства), панель страницы (путь, «Доступ», «Править», «Запросить
// право правки», меню «Действия со страницей»), просмотр (статус и мета, абзацы, схема, файл, запись CRM, таблицы,
// записи форм D-26, ознакомление, подстраницы), «Доступ» и «Версии» справа, старая версия и «Восстановить как новую»,
// редактор с публикацией по If-Match. Узкий вид (< 860 px) — дерево или страница с кнопкой «Дерево».
import { format, knowledge as K } from '@ortus/texts';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { problemCode } from '../../../shell/run.tsx';
import { commands, useNode, useNodes, useSearch, useVersion } from './api.ts';
import { errorText, useKb } from './ctx.tsx';
import {
  ackOf,
  canCreateIn,
  dayOf,
  diagramOuts,
  draftOf,
  excerpt,
  homeOf,
  KIND_ICON,
  kidsOf,
  type KbNode,
  menuOf,
  type MenuKey,
  metaParts,
  ownAccessOf,
  paragraphs,
  publishBody,
  type Space,
  STATUS_LOOK,
  tablesOf,
  titleMatches,
  type TreeIndex,
  treeRows,
} from './model.ts';
import { Failed, Glyph, Pending } from './parts.tsx';
import { KB_TEXT } from './texts.ts';

const MENU_ICON: Readonly<Record<MenuKey, string>> = {
  child: 'note_add',
  move: 'drive_file_move',
  approve: 'verified',
  archive: 'archive',
};

/** Дерево пространства (М:79–101). */
function TreeNav(p: {
  space: Space;
  tree: TreeIndex;
  selected: string | undefined;
  open: ReadonlySet<string>;
  toggle: (id: string) => void;
  onPick: (id: string) => void;
  onCreate: () => void;
}): ReactElement {
  const { tenantId } = useKb();
  const [tq, setTq] = useState('');
  const term = tq.trim();
  const found = useSearch(tenantId, term, p.space.id);
  // Поиск по тексту не ответил — ошибка с «Повторить» и пометка: ниже только совпадения по названию.
  const failed = term.length >= 2 && found.isError;
  const matches = !term
    ? null
    : term.length >= 2 && found.data
      ? found.data.map((h) => h.nodeId).filter((id) => p.tree.byId.has(id))
      : titleMatches(p.tree, term);
  const rows = treeRows(p.tree, {
    open: p.open,
    selected: p.selected,
    statusLabel: (s) => K.status[s],
    matches,
  });
  return (
    <nav aria-label={K.tree.aria} className="ox-kb-tree">
      <div className="ox-kb-tree-top">
        <label className="ox-kb-tree-search">
          <Glyph name="search" size={18} />
          <input
            type="search"
            value={tq}
            onChange={(e) => setTq(e.target.value)}
            aria-label={K.tree.search}
            placeholder={K.tree.search}
          />
        </label>
        {canCreateIn(p.space, p.tree) ? (
          <button
            type="button"
            className="ox-kb-plus"
            title={K.tree.createTitle}
            aria-label={K.tree.create}
            onClick={p.onCreate}
          >
            <Glyph name="add" size={20} />
          </button>
        ) : null}
      </div>
      {failed ? (
        <div className="ox-kb-tree-failed">
          <Failed q={found} />
          <span className="ox-kb-tree-partial">{KB_TEXT.treePartial}</span>
        </div>
      ) : null}
      {/* Пустой результат поиска — не дерево: role=tree без treeitem — axe aria-required-children (М:84/97). */}
      <div role={rows.length ? 'tree' : undefined} className="ox-kb-rows">
        {rows.map((r) => (
          <div
            key={r.id}
            role="treeitem"
            aria-selected={r.selected ? 'true' : 'false'}
            className="ox-kb-row"
            data-selected={r.selected ? '' : undefined}
            style={{ paddingLeft: `${4 + r.depth * 16}px` }}
          >
            <button
              type="button"
              className="ox-kb-chev"
              {...(r.hasKids
                ? { 'aria-label': r.open ? K.tree.collapse : K.tree.expand }
                : // Шеврон без детей неактивен и пуст (М:87, chevLabel ''): скрыт от AT, как пустая подпись.
                  { 'aria-hidden': true, tabIndex: -1 })}
              disabled={!r.hasKids}
              onClick={() => p.toggle(r.id)}
            >
              <Glyph name={r.hasKids ? (r.open ? 'expand_more' : 'chevron_right') : ''} size={18} />
            </button>
            <button type="button" className="ox-kb-node" onClick={() => p.onPick(r.id)}>
              <Glyph name={r.icon} size={18} className="ox-kb-node-icon" />{' '}
              <span className="ox-kb-node-text">
                <span className="ox-kb-node-title">{r.title}</span>
                {r.where ? <span className="ox-kb-node-where">{r.where}</span> : null}
              </span>{' '}
              {r.chip ? (
                <span className="ox-kb-st" data-tone={r.chip.tone}>
                  {r.chip.label}
                </span>
              ) : null}{' '}
              {r.fin ? (
                <Glyph name="payments" size={16} title={K.tree.finance} className="ox-kb-fin" />
              ) : null}{' '}
              {r.lock ? (
                <Glyph name="lock" size={16} title={K.tree.own} className="ox-kb-lock" />
              ) : null}
            </button>
          </div>
        ))}
        {!rows.length ? <span className="ox-kb-tree-empty">{K.tree.empty}</span> : null}
      </div>
      <span className="ox-kb-fill" />
      <div className="ox-kb-tree-hint">
        <Glyph name="account_tree" size={18} />
        <span>{K.tree.hint}</span>
      </div>
    </nav>
  );
}

/** Редактор (М:127–135): название, шаги схемы, текст, «Попросить ознакомиться», публикация с If-Match. */
function Editor({ node, etag }: { node: KbNode; etag: string | null }): ReactElement | null {
  const api = useApi();
  const { tenantId, draft, setDraft, cmd, busy } = useKb();
  if (!draft || draft.id !== node.id) return null;
  const set = (patch: Partial<typeof draft>): void => setDraft({ ...draft, ...patch });
  const save = async (): Promise<void> => {
    const body = publishBody(draft, node);
    const ifMatch = draft.etag ?? etag ?? '';
    const r = await cmd(
      { op: 'publish', node: node.id, base: draft.base, body },
      (key) => commands.publish(api, tenantId, node.id, ifMatch, body, key),
      format(K.toast.published, { v: draft.base + 1 }),
    );
    if (r.ok) setDraft(null);
  };
  return (
    <div className="ox-kb-editor">
      <input
        className="ox-kb-editor-title"
        value={draft.title}
        onChange={(e) => set({ title: e.target.value })}
        aria-label={K.editor.title}
      />
      {node.kind === 'diagram' ? (
        <label className="ox-kb-field">
          {K.editor.steps}
          <textarea rows={5} value={draft.steps} onChange={(e) => set({ steps: e.target.value })} />
        </label>
      ) : null}
      <label className="ox-kb-field">
        {K.editor.body}
        <textarea
          rows={12}
          data-body=""
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </label>
      {node.ack ? (
        <label className="ox-kb-check">
          <input
            type="checkbox"
            checked={draft.ack}
            onChange={(e) => set({ ack: e.target.checked })}
          />
          <span>{format(K.editor.ack, { audience: node.ack.audienceLabel })}</span>
        </label>
      ) : null}
      <div className="ox-kb-editor-actions">
        <button
          type="button"
          className="ox-kb-btn"
          data-variant="primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {format(K.editor.publish, { v: draft.base + 1 })}
        </button>
        <button type="button" className="ox-kb-btn" onClick={() => setDraft(null)}>
          {K.editor.cancel}
        </button>
        <span className="ox-kb-editor-base">{format(K.editor.base, { v: draft.base })}</span>
      </div>
    </div>
  );
}

/** Подстраницы (М:170–176): выдержка текста — из узлов детей. */
function Kids(p: {
  space: Space;
  node: KbNode;
  tree: TreeIndex;
  onPick: (id: string) => void;
}): ReactElement | null {
  const { tenantId, openDialog } = useKb();
  const kids = kidsOf(p.tree, p.node);
  const reads = useNodes(
    tenantId,
    kids.map((k) => k.id),
  );
  const canKid = p.node.my.create && p.node.kind !== 'file' && p.node.kind !== 'link';
  if (p.node.kind === 'file' || p.node.kind === 'link' || (!kids.length && !p.node.my.create))
    return null;
  return (
    <section aria-label={K.page.kids} className="ox-kb-kids">
      <span className="ox-kb-kids-head">
        <Glyph name="account_tree" size={18} />
        <strong>{K.page.kids}</strong>
        <span>{K.page.kidsNote}</span>
      </span>
      <div className="ox-kb-kids-grid">
        {kids.map((k, i) => {
          const body = reads[i]?.data?.node.current.body;
          return (
            <button key={k.id} type="button" className="ox-kb-kid" onClick={() => p.onPick(k.id)}>
              <span className="ox-kb-kid-title">
                <Glyph name={KIND_ICON[k.kind]} size={17} />
                {k.title}
                {k.accessMode !== 'inherit' ? (
                  <Glyph name="lock" size={15} title={K.tree.own} className="ox-kb-lock" />
                ) : null}
              </span>
              <span className="ox-kb-kid-text">{excerpt(body, 90) || K.kinds[k.kind]}</span>
            </button>
          );
        })}
        {canKid ? (
          <button
            type="button"
            className="ox-kb-kid-new"
            onClick={() => openDialog({ kind: 'node', parent: p.node.id })}
          >
            <Glyph name="add" size={18} />
            {K.page.menu.child}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Страница: панель, просмотр или редактор, «Доступ» и «Версии» (М:104–193). */
function PageView(p: {
  space: Space;
  tree: TreeIndex;
  node: KbNode;
  etag: string | null;
  onPick: (id: string) => void;
  onTree: () => void;
}): ReactElement {
  const api = useApi();
  const { tenantId, narrow, cmd, busy, draft, setDraft, openDialog, go, now } = useKb();
  const { node: G, space: sp } = p;
  const [menu, setMenu] = useState(false);
  const [ver, setVer] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const wantOld = ver !== null && ver !== G.version;
  const old = useVersion(tenantId, G.id, wantOld ? ver : null);
  const oldOn = wantOld && !!old.data;
  // Старая версия ещё грузится или не загрузилась — «Загрузка» или ошибка с «Повторить» над текущей (бриф §1.3, §1.8).
  const oldState = wantOld && !old.data ? (old.isError ? 'failed' : 'pending') : null;
  const editing = !!draft && draft.id === G.id;
  const shownBody = oldOn ? (old.data?.body ?? '') : G.current.body;
  const own = ownAccessOf(p.tree, G);
  const meta = metaParts(G);
  const st = STATUS_LOOK[G.status];
  const ack = ackOf(G, oldOn);
  const tables = tablesOf(G, [K.page.emptyCols.at, K.page.emptyCols.what, K.page.emptyCols.who]);
  const items = menuOf(sp, G);
  const crumbs = [
    { id: null as string | null, t: sp.name },
    ...G.path.map((x) => ({ id: x.id, t: x.title })),
    { id: G.id, t: G.title },
  ];
  const canReq = !G.my.edit && G.kind !== 'folder' && G.kind !== 'link';

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  const fp = (op: string, extra: Record<string, unknown> = {}) => ({ op, node: G.id, ...extra });
  const onMenu = async (k: MenuKey): Promise<void> => {
    setMenu(false);
    if (k === 'child') openDialog({ kind: 'node', parent: G.id });
    if (k === 'move') openDialog({ kind: 'move', nodeId: G.id });
    if (k === 'approve') {
      await cmd(
        fp('approve'),
        (key) => commands.setStatus(api, tenantId, G.id, 'active', key),
        K.toast.approved,
      );
    }
    if (k === 'archive') {
      const r = await cmd(
        fp('archive'),
        (key) => commands.archive(api, tenantId, G.id, key),
        K.toast.archived,
      );
      // Эталон меняет только выбор (М:520). Адрес — на момент ответа: пока шёл запрос, участник мог открыть
      // другую вкладку (она остаётся) или другую страницу (её выбор не перезаписывается).
      const cur = now();
      if (r.ok && cur.space === sp.id && cur.page === G.id)
        go({ ...cur, page: G.parentId ?? '' }, true);
    }
  };
  const onReq = async (): Promise<void> => {
    const r = await cmd(
      fp('request'),
      (key) => commands.requestEdit(api, tenantId, G.id, key),
      K.toast.requestSent,
    );
    if (r.ok || r.code === 'request_pending') setSent(true);
  };
  const onAck = (): void => {
    const v = G.ack?.version ?? G.version;
    void cmd(fp('ack', { v }), (key) => commands.ack(api, tenantId, G.id, v, key), K.toast.acked);
  };
  const onRestore = async (): Promise<void> => {
    if (!old.data) return;
    const body = { title: G.title, body: old.data.body };
    const r = await cmd(
      fp('restore', { from: old.data.version, base: G.version }),
      (key) => commands.publish(api, tenantId, G.id, p.etag ?? '', body, key),
      format(K.toast.restored, { v: old.data.version }),
    );
    if (r.ok) setVer(null);
  };

  return (
    <div className="ox-kb-pagecol">
      <div className="ox-kb-bar">
        {narrow ? (
          <button type="button" className="ox-kb-btn" data-size="sm" onClick={p.onTree}>
            <Glyph name="account_tree" size={18} />
            {K.page.tree}
          </button>
        ) : null}
        <nav aria-label={K.page.pathAria} className="ox-kb-path">
          {crumbs.map((b, i) => (
            <span
              key={`${b.id ?? 'space'}-${i}`}
              className="ox-kb-crumb"
              data-last={i === crumbs.length - 1 ? '' : undefined}
            >
              {i > 0 ? <Glyph name="chevron_right" size={16} /> : null}
              <button type="button" onClick={() => (b.id ? p.onPick(b.id) : p.onPick(''))}>
                {b.t}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          className="ox-kb-btn"
          data-size="sm"
          onClick={() => openDialog({ kind: 'access', nodeId: G.id })}
        >
          <Glyph name={own ? 'lock' : 'lock_open'} size={17} />
          {K.page.access}
        </button>
        {G.my.edit && G.kind !== 'link' && !editing ? (
          <button
            type="button"
            className="ox-kb-btn"
            data-variant="primary"
            data-size="sm"
            onClick={() => {
              setMenu(false);
              setVer(null);
              setDraft({ ...draftOf(G), etag: p.etag });
            }}
          >
            <Glyph name="edit" size={17} />
            {K.page.edit}
          </button>
        ) : null}
        {canReq ? (
          <button
            type="button"
            className="ox-kb-btn"
            data-size="sm"
            disabled={sent || busy}
            onClick={() => void onReq()}
          >
            <Glyph name="front_hand" size={17} />
            {sent ? K.page.requested : K.page.request}
          </button>
        ) : null}
        {items.length ? (
          <span className="ox-kb-menu-wrap">
            <button
              type="button"
              className="ox-kb-btn"
              data-size="sq"
              aria-label={K.page.menuAria}
              aria-expanded={menu ? 'true' : 'false'}
              onClick={() => setMenu((m) => !m)}
            >
              <Glyph name="more_horiz" size={18} />
            </button>
            {menu ? (
              <div role="menu" className="ox-kb-menu">
                {items.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    data-danger={k === 'archive' ? '' : undefined}
                    disabled={busy && (k === 'approve' || k === 'archive')}
                    onClick={() => void onMenu(k)}
                  >
                    <Glyph name={MENU_ICON[k]} size={18} />
                    {K.page.menu[k]}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="ox-kb-content">
        <article className="ox-kb-article">
          {editing ? (
            <Editor node={G} etag={p.etag} />
          ) : (
            <>
              {oldOn && old.data ? (
                <div className="ox-kb-old">
                  <Glyph name="history" size={18} />
                  <span className="ox-kb-old-text">
                    {format(K.page.oldVersion, {
                      v: old.data.version,
                      date: dayOf(old.data.publishedAt),
                      cur: G.version,
                    })}
                  </span>
                  <button type="button" className="ox-kb-old-cur" onClick={() => setVer(null)}>
                    {K.page.toCurrent}
                  </button>
                  {G.my.edit ? (
                    <button
                      type="button"
                      className="ox-kb-old-restore"
                      disabled={busy}
                      onClick={() => void onRestore()}
                    >
                      {K.page.restore}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {oldState === 'failed' ? <Failed q={old} /> : null}
              {oldState === 'pending' ? <Pending rows={1} /> : null}
              <h2 className="ox-kb-h2">{G.title}</h2>
              <div className="ox-kb-status">
                <span className="ox-kb-chip" data-tone={st.tone}>
                  <Glyph name={st.icon} size={14} />
                  {G.kind === 'folder'
                    ? K.status[G.status]
                    : format(K.page.status, { label: K.status[G.status], v: G.version })}
                </span>
                <span>
                  {[
                    K.kinds[meta.kind],
                    format(K.page.metaOwner, { name: meta.owner }),
                    ...(meta.updated ? [format(K.page.metaUpdated, meta.updated)] : []),
                    ...(meta.review ? [format(K.page.metaReview, { date: meta.review })] : []),
                  ].join(' · ')}
                </span>
              </div>
              {paragraphs(shownBody).map((t, i) => (
                <p key={i} className="ox-kb-p">
                  {t}
                </p>
              ))}
              {G.kind === 'diagram' ? (
                <figure className="ox-kb-diagram">
                  <div className="ox-kb-diagram-canvas">
                    {(G.diagram?.steps ?? []).map((t, i) => (
                      <span key={i} className="ox-kb-step-wrap">
                        {i > 0 ? <Glyph name="arrow_forward" size={18} /> : null}
                        <span className="ox-kb-step">{t}</span>
                      </span>
                    ))}
                    {diagramOuts(G.diagram).length ? (
                      <span className="ox-kb-outs">
                        {diagramOuts(G.diagram).map((o, i) => (
                          <span key={i} className="ox-kb-out">
                            <Glyph name={o.arrow} size={18} />
                            <span className="ox-kb-out-box" data-tone={o.tone}>
                              {o.t}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </figure>
              ) : null}
              {G.kind === 'file' ? (
                <div className="ox-kb-file">
                  <span aria-hidden="true" className="ox-kb-file-thumb" />
                  <span className="ox-kb-file-text">
                    <strong>{G.title}</strong>
                    <span>
                      {G.file
                        ? format(K.page.fileMeta, {
                            size: G.file.sizeLabel,
                            pages: G.file.pages || 1,
                          })
                        : K.kinds.file}
                    </span>
                    <span className="ox-kb-file-note">{K.page.fileNote}</span>
                  </span>
                </div>
              ) : null}
              {G.kind === 'link' ? (
                <div className="ox-kb-link">
                  <span className="ox-kb-link-icon">
                    <Glyph name={G.link?.icon ?? 'link'} size={22} />
                  </span>
                  <span className="ox-kb-link-text">
                    <strong>{G.link?.label ?? G.title}</strong>
                    <span>{K.page.linkNote}</span>
                  </span>
                  <LinkButton moduleKey={G.link?.moduleKey} />
                </div>
              ) : null}
              {tables.map((tb) => (
                <div key={tb.id} className="ox-kb-table">
                  <strong className="ox-kb-table-title">
                    <Glyph name="table_view" size={19} />
                    {tb.title}
                  </strong>
                  <div className="ox-kb-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {tb.cols.map((h, i) => (
                            <th key={i}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tb.rows.map((row, i) => (
                          <tr key={i}>
                            {row.map((cell, j) => (
                              <td key={j}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <span className="ox-kb-table-note">
                    {tb.note.kind === 'form'
                      ? K.page.tableForm
                      : tb.note.kind === 'count'
                        ? format(K.page.tableRows, { n: tb.note.n })
                        : K.page.tableEmpty}
                  </span>
                </div>
              ))}
              {G.entries.length ? (
                <section aria-label={KB_TEXT.entries} className="ox-kb-entries">
                  <strong className="ox-kb-table-title">
                    <Glyph name="list_alt" size={19} />
                    {KB_TEXT.entries}
                  </strong>
                  {G.entries.map((e) => (
                    <div key={e.id} className="ox-kb-entry">
                      <strong>{e.head}</strong>
                      {e.lines.map((l, i) => (
                        <span key={i}>
                          {l.name}: {l.value}
                        </span>
                      ))}
                      <span className="ox-kb-table-note">
                        {format(KB_TEXT.entrySource, {
                          resp: e.source.responseNumber,
                          date: dayOf(e.addedAt),
                        })}
                      </span>
                    </div>
                  ))}
                </section>
              ) : null}
              {ack ? (
                <div className="ox-kb-ack" data-highlight={ack.highlight ? '' : undefined}>
                  <span className="ox-kb-ack-title">
                    <Glyph name="task_alt" size={19} />
                    {format(K.page.ackTitle, ack.title)}
                  </span>
                  {ack.stats ? (
                    <>
                      <div className="ox-kb-ack-bar">
                        <div style={{ width: ack.stats.pct }} />
                      </div>
                      <span className="ox-kb-ack-line">
                        {format(K.page.ackLine, {
                          done: ack.stats.done,
                          total: ack.stats.total,
                          wait: ack.stats.names ? 'true' : 'false',
                          names: ack.stats.names,
                          more: ack.stats.more > 0 ? 'true' : 'false',
                          n: ack.stats.more,
                        })}
                      </span>
                    </>
                  ) : null}
                  {ack.ask ? (
                    <div className="ox-kb-ack-ask">
                      <span>{K.page.ackAsk}</span>
                      <button
                        type="button"
                        className="ox-kb-btn"
                        data-variant="primary"
                        disabled={busy}
                        onClick={onAck}
                      >
                        {K.page.ack}
                      </button>
                    </div>
                  ) : null}
                  {ack.done ? <span className="ox-kb-ack-done">{K.page.ackDone}</span> : null}
                </div>
              ) : null}
              <Kids space={sp} node={G} tree={p.tree} onPick={p.onPick} />
            </>
          )}
        </article>
        <aside aria-label={K.page.aside} className="ox-kb-aside">
          <div className="ox-kb-acc">
            <span className="ox-kb-acc-title">
              <Glyph name={own ? 'lock' : 'lock_open'} size={18} />
              {K.page.access}
            </span>
            <span>
              {own
                ? own.self
                  ? format(K.page.accessOwn, {
                      mode: K.modes[modeKey(own.mode)].label.toLowerCase(),
                    })
                  : format(K.page.accessAs, {
                      title: own.title,
                      mode: K.modes[modeKey(own.mode)].label.toLowerCase(),
                    })
                : format(K.page.accessSpace, { d: K.levels[sp.access].d.toLowerCase() })}
            </span>
            <span>{G.my.edit ? K.page.canEdit : K.page.canRead}</span>
            <button
              type="button"
              className="ox-kb-acc-btn"
              onClick={() => openDialog({ kind: 'access', nodeId: G.id })}
            >
              {sp.my.lead ? K.page.setup : K.page.why}
            </button>
          </div>
          {G.kind !== 'folder' ? (
            <div className="ox-kb-vers">
              <span className="ox-kb-vers-title">{K.page.versions}</span>
              {G.versions.map((v) => {
                // Выбранная версия — та, что нажата (и пока она грузится или не загрузилась).
                const sel = (wantOld ? ver : G.version) === v.version;
                return (
                  <button
                    key={v.version}
                    type="button"
                    className="ox-kb-ver"
                    aria-pressed={sel ? 'true' : 'false'}
                    onClick={() => {
                      setDraft(null);
                      setVer(v.version === G.version ? null : v.version);
                    }}
                  >
                    <strong>{format(K.page.versionTag, { v: v.version })}</strong>
                    <span>
                      {format(K.page.versionLine, {
                        date: dayOf(v.publishedAt),
                        by: v.authorDisplayName,
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Режим контракта → ключ словаря (`edit_listed` → `editListed`). */
const modeKey = (m: KbNode['accessMode']): 'inherit' | 'editListed' | 'listed' =>
  m === 'edit_listed' ? 'editListed' : m;

/** «Открыть» записи CRM — модуль записи (доступ к записи проверяет он сам, Q-W4.00-knowledge-18). */
function LinkButton({ moduleKey }: { moduleKey: string | undefined }): ReactElement {
  const { tenantId } = useKb();
  const navigate = useNavigate();
  const open = (): void => {
    if (!moduleKey) return;
    void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: moduleKey } });
  };
  return (
    <button type="button" className="ox-kb-btn" data-size="md" onClick={open}>
      {K.page.open}
    </button>
  );
}

/** Прокрутить к началу все прокручиваемые контейнеры над `el` и окно (начало раздела — вверху экрана). */
function toTop(el: HTMLElement | null): void {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (p.scrollTop > 0 && p.scrollHeight > p.clientHeight) p.scrollTop = 0;
  }
  if (typeof window.scrollTo === 'function' && window.scrollY > 0) window.scrollTo(0, 0);
}

export function PagesTab({ space, tree }: { space: Space; tree: TreeIndex }): ReactElement {
  const { tenantId, search, go, narrow, setErr, openDialog, setDraft } = useKb();
  const home = homeOf(space, tree);
  const selected = search.page ?? home?.id;
  const read = useNode(tenantId, selected);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(selected ? tree.path(selected).map((x) => x.id) : []),
  );
  const [treeOpen, setTreeOpen] = useState(false);
  const missing = read.isError && problemCode(read.error) === 'not_found';

  useEffect(() => {
    if (!missing) return;
    setErr(errorText(read.error));
    go({ space: space.id }, true);
    // Только по ответу узла.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  // Выбор узла внутри свёрнутой ветки (ссылка, поиск, подстраница) — раскрыть путь к нему (select М:426).
  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    // Узкий вид: новая страница (создание, подстраница, путь) — показать её вместо дерева (select М:426).
    setTreeOpen(false);
    const path = selected ? tree.path(selected).map((x) => x.id) : [];
    if (path.some((id) => !open.has(id))) setOpen(new Set([...open, ...path]));
  }

  // Узкий вид: выбранная страница открывается сверху — шапка пространства и путь видны (эталон М:487 перерисовывает
  // модуль; прокрутка длинного дерева не переносится на страницу).
  const box = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (narrow) toTop(box.current);
  }, [selected, narrow]);

  const pick = (id: string): void => {
    setTreeOpen(false);
    setDraft(null);
    go({ space: space.id, ...(id ? { page: id } : {}) });
  };
  const toggle = (id: string): void =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sel = selected && tree.byId.has(selected) ? selected : read.data?.node.id;
  const G = read.data?.node;
  // Область страницы: сама страница, её загрузка или ошибка с «Повторить» (бриф §1.8). 404 — баннер и «Обзор» (выше).
  const state: 'page' | 'pending' | 'failed' | null = G
    ? 'page'
    : !selected || missing
      ? null
      : read.isError
        ? 'failed'
        : read.isPending
          ? 'pending'
          : null;
  const showTree = !narrow || treeOpen || !state;
  const showPage = !!state && (!narrow || !treeOpen);
  const onCreate = (): void => {
    const g = G && tree.byId.get(G.id);
    openDialog({ kind: 'node', parent: g && g.my.create && g.kind === 'folder' ? g.id : '' });
  };

  return (
    <div ref={box} className="ox-kb-pages" data-narrow={narrow ? '' : undefined}>
      {showTree ? (
        <TreeNav
          space={space}
          tree={tree}
          selected={sel}
          open={open}
          toggle={toggle}
          onPick={pick}
          onCreate={onCreate}
        />
      ) : null}
      {showPage && G && read.data ? (
        <PageView
          key={G.id}
          space={space}
          tree={tree}
          node={G}
          etag={read.data.etag}
          onPick={(id) => pick(id || (home?.id ?? ''))}
          onTree={() => setTreeOpen(true)}
        />
      ) : null}
      {showPage && !G ? (
        <div className="ox-kb-pagecol">
          {narrow ? (
            <div className="ox-kb-bar">
              <button
                type="button"
                className="ox-kb-btn"
                data-size="sm"
                onClick={() => setTreeOpen(true)}
              >
                <Glyph name="account_tree" size={18} />
                {K.page.tree}
              </button>
            </div>
          ) : null}
          <div className="ox-kb-page-state">
            {state === 'failed' ? <Failed q={read} /> : <Pending rows={4} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
