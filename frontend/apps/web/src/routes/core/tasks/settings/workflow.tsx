// W4.13 · Вкладка проекта «Процесс» (`tasks-workflow`; эталон design-2026-10-19 «Задачи и проекты.dc.html» :233–275,
// логика :456–477): версия и черновик (getTaskWorkflow), статусы и переходы, панель перехода. Каждая правка
// сохраняет черновик целиком (saveTaskWorkflowDraft, If-Match — ETag последнего ответа; правки идут по очереди),
// «Сбросить черновик» (discardTaskWorkflowDraft), «Опубликовать v{N+1}» (publishTaskWorkflow; нарушения — тост
// текстом сервера). Ошибки формы («Статус «X» уже есть», «Назовите переход», «Переход должен вести в другой
// статус») — тост без тона, как flash эталона без тона (ЗП:464, :469). Правка — tasks.workflow.manage в проекте;
// без него — только чтение.
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { format } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { LoadFailed } from '../../../company/modules/ui.tsx';
import {
  discardDraft,
  idemKeys,
  publishDraft,
  refreshAfter,
  saveDraft,
  type Tagged,
  useMembers,
  useProject,
  useWorkflow,
  workflowKey,
} from './api.ts';
import {
  addStatus,
  addTransition,
  approvalPatch,
  approverNames,
  CATEGORIES,
  type Category,
  categoryColors,
  categoryLabel,
  type Draft,
  draftOf,
  FLAGS,
  hasStatus,
  pathOf,
  patchTransition,
  removeStatus,
  removeTransition,
  rulesOf,
  type Transition,
  toggleWho,
  versionChip,
  WHO,
  whoLabel,
  whoOf,
} from './model.ts';
import { TS } from './texts.ts';
import { Skeleton, useCommand } from './ui.tsx';

type S = components['schemas'];
const W = TS.workflow;
const rid = () => Math.random().toString(36).slice(2, 6);

export function WorkflowTab({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const command = useCommand();
  const [keys] = useState(idemKeys);
  const project = useProject(tenantId, projectId);
  const wf = useWorkflow(tenantId, projectId);
  const members = useMembers(tenantId, projectId);
  const [newS, setNewS] = useState('');
  const [newCat, setNewCat] = useState<Category>('progress');
  const [nt, setNt] = useState({ name: '', from: '*', to: '' });
  const [sel, setSel] = useState<string | null>(null);
  // Правки черновика — по очереди: следующая берёт ETag и черновик из ответа предыдущей.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  if (wf.isError || project.isError) {
    return (
      <div className="ox-tset">
        <LoadFailed
          error={wf.isError ? wf.error : project.error}
          onRetry={() => {
            void wf.refetch();
            void project.refetch();
          }}
        />
      </div>
    );
  }
  if (!wf.data || !project.data) {
    return (
      <div className="ox-tset">
        <Skeleton />
      </div>
    );
  }

  const canEdit = (project.data.data.myAccess?.actions ?? []).includes('tasks.workflow.manage');
  const ro = !canEdit;
  const cur = wf.data.data;
  const d = draftOf(cur);
  const chip = versionChip(cur);
  const key = workflowKey(tenantId, projectId);
  const latest = () => qc.getQueryData<Tagged<S['TaskWorkflow']>>(key) ?? wf.data;
  const afterChange = async (next: Tagged<S['TaskWorkflow']> | undefined) => {
    if (next) qc.setQueryData(key, next);
    else await qc.invalidateQueries({ queryKey: key });
  };

  /** Правка черновика: черновик последнего ответа → fn → PUT целиком. */
  const edit = (fn: (x: Draft) => Draft) => {
    queue.current = queue.current.then(async () => {
      const base = latest();
      const body = fn(draftOf(base.data));
      const next = await command(
        'tasks-workflow',
        () => saveDraft(api, tenantId, projectId, base.etag, body, keys.key(body)),
        null,
        { settle: () => keys.settle(body) },
      );
      await afterChange(next);
    });
  };
  const editT = (t: Transition, patch: Partial<Transition>) =>
    edit((x) => patchTransition(x, t.key, patch));

  const onDiscard = () => {
    queue.current = queue.current.then(async () => {
      const base = latest();
      const body = { discard: base.etag };
      const next = await command(
        'tasks-workflow',
        () => discardDraft(api, tenantId, projectId, base.etag, keys.key(body)),
        W.discarded,
        { settle: () => keys.settle(body) },
      );
      // Эталон (onDiscard ЗП:461) выбранный переход не сбрасывает: панель остаётся, если переход есть в версии.
      await afterChange(next);
    });
  };
  const onPublish = () => {
    queue.current = queue.current.then(async () => {
      const base = latest();
      const body = { publish: base.etag };
      const next = await command(
        'tasks-workflow',
        () => publishDraft(api, tenantId, projectId, base.etag, keys.key(body)),
        W.published,
        { settle: () => keys.settle(body) },
      );
      await afterChange(next);
      // Новая версия у хоста W4.12: шапка проекта, список («… · процесс vN»), колонки доски (свой ключ процесса).
      if (next) await refreshAfter(qc, tenantId, projectId, [key]);
    });
  };
  const onAddS = () => {
    const n = newS.trim();
    if (!n) return;
    if (hasStatus(d, n)) {
      toast(format(W.duplicate, { name: n }));
      return;
    }
    edit((x) => addStatus(x, n, newCat, `s-${rid()}`));
    setNewS('');
  };
  const to = nt.to || d.statuses[0]?.id || '';
  const onAddT = () => {
    const n = nt.name.trim();
    if (!n) {
      toast(W.noName);
      return;
    }
    if (nt.from === to) {
      toast(W.same);
      return;
    }
    const k = `t-${rid()}`;
    edit((x) => addTransition(x, { name: n, from: nt.from, to }, k));
    setNt({ name: '', from: '*', to: '' });
    setSel(k);
  };

  const t = d.transitions.find((x) => x.key === sel);
  const sOpts = d.statuses.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="ox-tset">
      <div className="ox-tset-main">
        <div className="ox-tset-bar">
          <span className="ox-tset-ver" data-draft={chip.draft ? '' : undefined}>
            {chip.text}
          </span>
          <span className="ox-tset-fill" />
          {chip.draft ? (
            <>
              <button
                type="button"
                className="ox-tset-secondary"
                data-size="sm"
                onClick={onDiscard}
              >
                {W.discard}
              </button>
              <button type="button" className="ox-tset-primary" data-size="sm" onClick={onPublish}>
                {format(W.publish, { v: cur.version + 1 })}
              </button>
            </>
          ) : null}
        </div>
        <div className="ox-tset-box" data-gap="10">
          <h3 className="ox-tset-h3">{W.statuses}</h3>
          <div className="ox-tset-chips">
            {d.statuses.map((s) => {
              const c = categoryColors(s.category);
              return (
                <span
                  key={s.id}
                  className="ox-tset-status"
                  style={{ background: c.bg, borderColor: c.bd, color: c.fg }}
                >
                  {s.name}
                  <span className="ox-tset-scat">{categoryLabel(s.category)}</span>
                  {canEdit && d.statuses.length > 2 ? (
                    <button
                      type="button"
                      className="ox-tset-sdel"
                      aria-label={format(W.removeStatus, { name: s.name })}
                      onClick={() => edit((x) => removeStatus(x, s.id))}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
          {canEdit ? (
            <div className="ox-tset-inline">
              <input
                className="ox-tset-input"
                data-grow="status"
                value={newS}
                placeholder={W.newStatus}
                aria-label={W.statusAria}
                onChange={(e) => setNewS(e.target.value)}
              />
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={W.category}
                value={newCat}
                onChange={(e) => setNewCat(e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
              <button type="button" className="ox-tset-outline" onClick={onAddS}>
                {W.addStatus}
              </button>
            </div>
          ) : null}
        </div>
        <div className="ox-tset-box" data-gap="6">
          <h3 className="ox-tset-h3">{format(W.transitions, { n: d.transitions.length })}</h3>
          {d.transitions.map((x) => (
            <button
              key={x.key}
              type="button"
              className="ox-tset-tr"
              aria-pressed={x.key === sel ? 'true' : 'false'}
              onClick={() => setSel(x.key)}
            >
              <span className="ox-tset-trname">
                <strong>{x.name}</strong>
                <span>{pathOf(d, x)}</span>
              </span>
              <span className="ox-tset-trwho">{whoOf(x)}</span>
              <span className="ox-tset-rules">
                {rulesOf(x).map((r) => (
                  <span key={r} className="ox-tset-rule-chip">
                    {r}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {canEdit ? (
            <div className="ox-tset-inline" data-gap="top">
              <input
                className="ox-tset-input"
                data-grow="transition"
                value={nt.name}
                placeholder={W.trName}
                aria-label={W.trName}
                onChange={(e) => setNt({ ...nt, name: e.target.value })}
              />
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={W.from}
                value={nt.from}
                onChange={(e) => setNt({ ...nt, from: e.target.value })}
              >
                <option value="*">{W.fromAny}</option>
                {sOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="ox-tset-select"
                data-size="sm"
                aria-label={W.to}
                value={to}
                onChange={(e) => setNt({ ...nt, to: e.target.value })}
              >
                {sOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" className="ox-tset-outline" onClick={onAddT}>
                {W.addTransition}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {t ? (
        <TransitionPanel
          t={t}
          d={d}
          ro={ro}
          approvers={approverNames(members.data?.items ?? [])}
          onPatch={(patch) => editT(t, patch)}
          onRemove={() => {
            edit((x) => removeTransition(x, t.key));
            setSel(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TransitionPanel(p: {
  t: Transition;
  d: Draft;
  ro: boolean;
  approvers: string;
  onPatch: (patch: Partial<Transition>) => void;
  onRemove: () => void;
}): ReactElement {
  const { t, d, ro } = p;
  const P = W.panel;
  return (
    <aside className="ox-tset-trpanel">
      <div className="ox-tset-trp-head">
        <h3>{format(P.title, { name: t.name })}</h3>
        <span>{pathOf(d, t)}</span>
      </div>
      <div className="ox-tset-trp-sec">
        <span className="ox-tset-cap-title">{P.who}</span>
        <div className="ox-tset-chips" data-gap="6">
          {WHO.map((w) => (
            <button
              key={w}
              type="button"
              className="ox-tset-who-chip"
              aria-pressed={t.who.includes(w) ? 'true' : 'false'}
              disabled={ro}
              onClick={() => p.onPatch(toggleWho(t, w))}
            >
              {whoLabel(w)}
            </button>
          ))}
        </div>
        <span className="ox-tset-hint">{P.whoNote}</span>
      </div>
      <div className="ox-tset-trp-sec">
        <span className="ox-tset-cap-title">{P.approval}</span>
        <label className="ox-tset-check-row">
          <input
            type="checkbox"
            checked={!!t.approval}
            disabled={ro}
            onChange={(e) => p.onPatch(approvalPatch(d, t, e.target.checked))}
          />
          {P.approvalOn}
        </label>
        {t.approval ? (
          <>
            <div role="group" aria-label={P.mode} className="ox-tset-seg" data-wide="">
              {(['any', 'all'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={t.approval?.mode === m ? 'true' : 'false'}
                  disabled={ro}
                  onClick={() =>
                    p.onPatch({ approval: { mode: m, rejectTo: t.approval?.rejectTo ?? '' } })
                  }
                >
                  {m === 'any' ? P.modeAny : P.modeAll}
                </button>
              ))}
            </div>
            <label className="ox-tset-field">
              {P.rejectTo}
              <select
                className="ox-tset-select"
                data-size="xs"
                value={t.approval.rejectTo}
                disabled={ro}
                onChange={(e) =>
                  p.onPatch({
                    approval: { mode: t.approval?.mode ?? 'any', rejectTo: e.target.value },
                  })
                }
              >
                {d.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="ox-tset-hint">{format(P.approvers, { names: p.approvers })}</span>
          </>
        ) : null}
      </div>
      <div className="ox-tset-trp-sec">
        <span className="ox-tset-cap-title">{P.checks}</span>
        {FLAGS.map(([k, label]) => (
          <label key={k} className="ox-tset-check-row">
            <input
              type="checkbox"
              checked={t[k]}
              disabled={ro}
              onChange={(e) => p.onPatch({ [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="ox-tset-trp-foot">
        {ro ? null : (
          <button type="button" className="ox-tset-danger" onClick={p.onRemove}>
            {P.remove}
          </button>
        )}
        <span className="ox-tset-fill" />
        <span className="ox-tset-hint">{P.note}</span>
      </div>
    </aside>
  );
}
