// W4.32 · Диалог «Доступ · {страница}» (М:327–365, dlgVM М:628–672): цепочка «Организация → Пространство → узлы со
// своим доступом → страница», режим, список «Кого добавить» (кандидаты с охватом), записи с предупреждениями и
// «Добавить в пространство читателем», «Что изменится» (setKnowledgeNodeAccess с dryRun), «Применить и к подстраницам
// со своим доступом», запросы доступа («Одобрить» / «Отклонить»), «Сохранить · N страниц» (If-Match — ETag доступа).
// Не руководителю — только чтение и «Закрыть» (Q-W4.00-knowledge-9).
import type { components } from '@ortus/api-client';
import { format, knowledge as K } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { commands, useAccessImpact, useCandidates, useNodeAccess } from './api.ts';
import { useKb } from './ctx.tsx';
import { Frame, ImpactRow, RadioCard } from './dialogs.tsx';
import {
  accessImpactLines,
  entryInput,
  entryWarning,
  KIND_ICON,
  momentOf,
  quickReader,
  sameEntry,
  type Space,
  type TreeIndex,
} from './model.ts';
import { Failed, Glyph, Pending } from './parts.tsx';
import { KB_TEXT } from './texts.ts';

type S = components['schemas'];
type Mode = S['KnowledgeNodeAccess']['accessMode'];

interface Row {
  entry: S['KnowledgeAccessEntryInput'];
  label: string;
  reach?: S['KnowledgeAccessReach'];
}

const MODES: readonly Mode[] = ['inherit', 'edit_listed', 'listed'];
const modeText = (m: Mode) => (m === 'edit_listed' ? K.modes.editListed : K.modes[m]);
const WHO_ICON: Readonly<Record<S['KnowledgeAccessEntryInput']['who'], string>> = {
  member: 'person',
  group: 'groups',
  relation: 'engineering',
  role: 'badge',
};

/** Охват кандидата в виде охвата записи (без имён — их кандидаты не отдают). */
const reachOfCandidate = (c: S['KnowledgeAccessCandidate']): S['KnowledgeAccessReach'] => ({
  members: c.reach.members,
  total: c.reach.total,
  blocked:
    c.reach.reason && c.reach.members < c.reach.total
      ? [{ displayName: '', reason: c.reach.reason }]
      : [],
});

function Body(p: {
  space: Space;
  tree: TreeIndex;
  access: S['KnowledgeNodeAccess'];
  etag: string | null;
}): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy, closeDialog, setDialogErr } = useKb();
  const { access: a, space: sp } = p;
  const ro = !a.canManage;
  const node = p.tree.byId.get(a.nodeId);
  const initial: Row[] = a.entries.map((e) => ({
    entry: entryInput(e),
    label: e.label,
    ...(e.reach ? { reach: e.reach } : {}),
  }));
  const [mode, setMode] = useState<Mode>(a.accessMode);
  const [list, setList] = useState<Row[]>(initial);
  const [applyOwn, setApplyOwn] = useState(false);
  const [who, setWho] = useState('');
  const [can, setCan] = useState<'view' | 'edit'>('view');
  const cands = useCandidates(tenantId, a.nodeId, !ro);
  const options = cands.data ?? [];
  const entries = mode === 'inherit' ? [] : list.map((r) => entryInput(r.entry));
  const dirty =
    mode !== a.accessMode ||
    JSON.stringify(entries) !==
      JSON.stringify(a.accessMode === 'inherit' ? [] : initial.map((r) => r.entry)) ||
    applyOwn;
  const change: S['KnowledgeAccessChange'] | null =
    dirty && !ro ? { mode, entries, ...(applyOwn ? { applyToOwn: true } : {}) } : null;
  const imp = useAccessImpact(tenantId, a.nodeId, p.etag, change);
  const impact = dirty ? imp.data : undefined;
  // «Что изменится» — свой запрос (dryRun): пока он идёт — «Загрузка», ошибка — текст и «Повторить» вместо строк.
  const impState =
    !change || !p.etag ? null : imp.isError ? 'failed' : imp.isPending ? 'pending' : null;
  // Охват записей — по ответу сервера (после «Добавить в пространство читателем» он обновится).
  const reachOf = (r: Row): S['KnowledgeAccessReach'] | undefined =>
    a.entries.find((e) => sameEntry(entryInput(e), r.entry))?.reach ?? r.reach;
  const dead = (mode === 'inherit' ? [] : list)
    .filter((r) => {
      const rc = reachOf(r);
      return rc !== undefined && rc.members === 0;
    })
    .map((r) => r.label);
  const lines = accessImpactLines(dirty, impact, dead);
  const pages = impact?.pages ?? a.descendantCount + 1;
  const own = impact?.own ?? a.ownSubnodes;
  const leads = a.leadNames.length ? a.leadNames.join(', ') : K.card.leadOwner;

  const chain = a.chain.map((c, i, arr) => ({
    ...c,
    icon:
      i === 0
        ? 'apartment'
        : i === 1
          ? sp.icon
          : i === arr.length - 1
            ? node
              ? KIND_ICON[node.kind]
              : 'description'
            : 'lock',
    cur: i === arr.length - 1,
  }));

  const pickMode = (m: Mode): void => {
    setMode(m);
    if (m === 'inherit') return;
    if (list.length) return;
    // По умолчанию — «Редактор» пространства правит (М:665).
    const editor = options.find(
      (c) => c.entry.who === 'role' && / в пространстве$/.test(c.label) && /Редактор/.test(c.label),
    );
    if (editor)
      setList([
        {
          entry: { ...editor.entry, can: 'edit' },
          label: editor.label,
          reach: reachOfCandidate(editor),
        },
      ]);
  };
  const add = (): void => {
    const c = options[Number(who)];
    if (!c) return;
    const entry = { ...c.entry, can };
    if (list.some((r) => sameEntry(r.entry, entry))) {
      setDialogErr(K.dialogs.access.duplicate);
      return;
    }
    setList([...list, { entry, label: c.label, reach: reachOfCandidate(c) }]);
    setWho('');
  };
  const quick = (memberId: string): void => {
    void cmd(
      { op: 'reader', space: sp.id, memberId },
      (key) => commands.setMember(api, tenantId, sp.id, memberId, 'kb_space_reader', key),
      K.toast.readerAdded,
      { dialog: true },
    );
  };
  const save = async (): Promise<void> => {
    const body: S['KnowledgeAccessChange'] = {
      mode,
      entries,
      ...(applyOwn ? { applyToOwn: true } : {}),
    };
    const r = await cmd(
      { op: 'access', node: a.nodeId, body },
      (key) => commands.setAccess(api, tenantId, a.nodeId, p.etag ?? '', body, key),
      K.toast.accessSaved,
      { dialog: true },
    );
    if (r.ok) closeDialog();
  };
  const decide = (id: string, approve: boolean): void => {
    void cmd(
      { op: 'decide', id, approve },
      (key) => commands.decide(api, tenantId, id, approve ? 'approve' : 'deny', key),
      approve ? K.toast.requestApproved : K.toast.requestDenied,
      { dialog: true },
    );
  };
  const D = K.dialogs.access;
  const path = [sp.name, ...(node ? p.tree.path(node.id).map((x) => x.title) : [])].join(' › ');

  return (
    <Frame
      title={format(D.title, { title: a.title })}
      sub={format(D.sub, { path, n: a.descendantCount })}
      width="1060px"
      closeLabel={ro ? K.dialogs.close : K.dialogs.cancel}
      {...(ro
        ? {}
        : {
            ok: {
              label: format(D.save, { n: pages }),
              off: busy || !dirty,
              onOk: () => void save(),
            },
          })}
    >
      <div className="ox-kb-chain-row-wrap">
        <div className="ox-kb-chain-row">
          {chain.map((c, i) => (
            <span key={i} className="ox-kb-chain-cell">
              {i > 0 ? (
                <Glyph name="arrow_forward" size={18} className="ox-kb-chain-arrow" />
              ) : null}
              <span className="ox-kb-chain-card" data-cur={c.cur ? '' : undefined}>
                <Glyph name={c.icon} size={19} />
                <span>
                  <strong>{c.title}</strong>
                  <span>{c.detail}</span>
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="ox-kb-acc-cols">
        <div className="ox-kb-acc-main">
          {ro ? (
            <span className="ox-kb-ro">
              <Glyph name="info" size={18} />
              <span>{format(D.readonly, { leads })}</span>
            </span>
          ) : null}
          <div className="ox-kb-radios" data-min="170">
            {MODES.map((m) => (
              <RadioCard
                key={m}
                sel={mode === m}
                title={m === 'inherit' && !node?.parentId ? D.asSpace : modeText(m).label}
                text={modeText(m).d}
                disabled={ro}
                onClick={() => pickMode(m)}
              />
            ))}
          </div>
          {/* «Кого добавить» — свой запрос кандидатов: загрузка и ошибка с «Повторить» вместо пустого списка. */}
          {!ro && mode !== 'inherit' && cands.isError ? <Failed q={cands} /> : null}
          {!ro && mode !== 'inherit' && cands.isPending && !cands.isError ? (
            <Pending rows={1} />
          ) : null}
          {!ro && mode !== 'inherit' && cands.data ? (
            <div className="ox-kb-acc-add">
              <select value={who} aria-label={D.whoAria} onChange={(e) => setWho(e.target.value)}>
                <option value="">{D.whoPlaceholder}</option>
                {options.map((c, i) => (
                  <option key={i} value={String(i)}>
                    {c.reachLabel ? `${c.label} ${c.reachLabel}` : c.label}
                  </option>
                ))}
              </select>
              <select
                value={can}
                aria-label={D.canAria}
                onChange={(e) => setCan(e.target.value as 'view' | 'edit')}
              >
                <option value="view">{K.people.cells.view}</option>
                <option value="edit">{K.people.cells.edit}</option>
              </select>
              <button
                type="button"
                className="ox-kb-btn"
                data-variant="outline"
                disabled={!who}
                onClick={add}
              >
                {D.add}
              </button>
            </div>
          ) : null}
          <div className="ox-kb-entries-list">
            <div className="ox-kb-entry-row">
              <span className="ox-kb-entry-icon">
                <Glyph name="shield_person" size={18} />
              </span>
              <span className="ox-kb-entry-text">
                <strong>{D.fixed}</strong>
                <span>{format(D.fixedSub, { leads })}</span>
              </span>
              <span className="ox-kb-entry-can">{D.all}</span>
            </div>
            {(mode === 'inherit' ? [] : list).map((r, i) => {
              const rc = reachOf(r);
              const w = entryWarning(rc);
              const sub =
                r.entry.who === 'member'
                  ? D.member
                  : rc
                    ? rc.total
                      ? format(KB_TEXT.people, { n: rc.total })
                      : D.nobody
                    : '';
              return (
                <div key={i} className="ox-kb-entry-row">
                  <span className="ox-kb-entry-icon">
                    <Glyph name={WHO_ICON[r.entry.who]} size={18} />
                  </span>
                  <span className="ox-kb-entry-text">
                    <strong>{r.label}</strong>
                    <span>{sub}</span>
                    {w && (w.kind === 'one' || w.names) ? (
                      <span className="ox-kb-entry-warn">
                        <Glyph name="warning" size={15} />
                        <span>
                          {w.kind === 'one'
                            ? format(D.warnOne, { why: w.why })
                            : format(D.warnSome, { names: w.names, why: w.why })}
                        </span>
                        {!ro && quickReader(r.entry, rc) && r.entry.refId ? (
                          <button
                            type="button"
                            className="ox-kb-quick"
                            disabled={busy}
                            onClick={() => quick(r.entry.refId ?? '')}
                          >
                            {D.quick}
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {ro ? (
                    <span className="ox-kb-entry-can">
                      {r.entry.can === 'edit' ? K.people.cells.edit : K.people.cells.view}
                    </span>
                  ) : (
                    <>
                      <select
                        className="ox-kb-entry-select"
                        value={r.entry.can}
                        aria-label={D.canAria}
                        onChange={(e) =>
                          setList(
                            list.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    entry: { ...x.entry, can: e.target.value as 'view' | 'edit' },
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="view">{K.people.cells.view}</option>
                        <option value="edit">{K.people.cells.edit}</option>
                      </select>
                      <button
                        type="button"
                        className="ox-kb-entry-x"
                        aria-label={D.removeAria}
                        onClick={() => setList(list.filter((_, j) => j !== i))}
                      >
                        <Glyph name="close" size={18} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <span className="ox-kb-footnote">{D.footnote}</span>
        </div>
        <aside className="ox-kb-acc-side">
          <strong className="ox-kb-acc-side-title">{D.changes}</strong>
          <span className="ox-kb-acc-branch">
            {format(D.branch, {
              title: a.title,
              n: pages,
              own: own.length ? 'true' : 'false',
              names: own.map((x) => x.title).join(', '),
            })}
          </span>
          {impState === 'failed' ? <Failed q={imp} /> : null}
          {impState === 'pending' ? <Pending rows={2} /> : null}
          {(impState ? [] : lines).map((l, i) => (
            <ImpactRow
              key={i}
              k={l.key}
              text={
                l.key === 'pick'
                  ? D.pick
                  : l.key === 'noChange'
                    ? D.noChange
                    : l.key === 'dead'
                      ? format(D.dead, { names: l.names })
                      : format(K.dialogs.impact[l.key], { names: l.names })
              }
            />
          ))}
          {a.ownSubnodes.length ? (
            <label className="ox-kb-check" data-size="sm">
              <input
                type="checkbox"
                checked={applyOwn}
                disabled={ro}
                onChange={(e) => setApplyOwn(e.target.checked)}
              />
              <span>{format(D.applyOwn, { n: a.ownSubnodes.length })}</span>
            </label>
          ) : null}
          {a.requests?.length ? (
            <>
              <strong className="ox-kb-reqs-title">
                <Glyph name="front_hand" size={18} />
                {D.requests}
              </strong>
              {a.requests.map((q) => (
                <div key={q.id} className="ox-kb-req">
                  <span>
                    <strong>{q.memberDisplayName}</strong>{' '}
                    {format(D.request, { can: q.can, at: momentOf(q.requestedAt) })}
                  </span>
                  {!ro ? (
                    <span className="ox-kb-req-actions">
                      <button
                        type="button"
                        className="ox-kb-btn"
                        data-variant="primary"
                        data-size="xs"
                        disabled={busy}
                        onClick={() => decide(q.id, true)}
                      >
                        {D.approve}
                      </button>
                      <button
                        type="button"
                        className="ox-kb-btn"
                        data-size="xs"
                        disabled={busy}
                        onClick={() => decide(q.id, false)}
                      >
                        {D.deny}
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </aside>
      </div>
    </Frame>
  );
}

export function AccessDialog(p: {
  space: Space;
  tree: TreeIndex;
  nodeId: string;
}): ReactElement | null {
  const { tenantId } = useKb();
  const read = useNodeAccess(tenantId, p.nodeId);
  if (!read.data) {
    // Доступ узла ещё грузится или не загрузился — диалог открыт сразу: «Загрузка» или ошибка с «Повторить».
    const node = p.tree.byId.get(p.nodeId);
    const path = [p.space.name, ...(node ? p.tree.path(node.id).map((x) => x.title) : [])].join(
      ' › ',
    );
    return (
      <Frame
        title={format(K.dialogs.access.title, { title: node?.title ?? '' })}
        sub={path}
        width="1060px"
        closeLabel={K.dialogs.close}
      >
        <div className="ox-kb-dialog-body ox-kb-acc-state">
          {read.isError ? <Failed q={read} /> : <Pending rows={4} />}
        </div>
      </Frame>
    );
  }
  return (
    <Body
      key={`${read.data.access.revision}`}
      space={p.space}
      tree={p.tree}
      access={read.data.access}
      etag={read.data.etag}
    />
  );
}
