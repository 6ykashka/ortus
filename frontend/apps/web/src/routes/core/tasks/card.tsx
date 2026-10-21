// W4.12 · Карточка задачи (`tasks-card`, эталон «Задачи и проекты.dc.html» ЗП:143–193, :414–437, relVM :500–514,
// attach :523): номер и автор, статус и переходы (availableTransitions с причинами trCheck), комментарий к переходу,
// согласование и «Вернуть на доработку», исполнитель и приоритет (updateTask), срок, связи и подзадачи (setTaskParent,
// listTasks?parentTaskId), описание и метки, вложения (загрузка core.files, attachTaskFiles, removeTaskFile), чек-лист
// (updateTaskChecklistItem), история (listTaskHistory) и комментарий (commentTask, no-reference Q-W4.00-tasks-11).
// Команды — с If-Match последнего ответа по задаче.
import type { components } from '@ortus/api-client';
import { format, tasks as T } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { problemText } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import {
  attachFiles,
  commentTask,
  fetchTask,
  rejectApproval,
  removeFile,
  setChecklistItem,
  setParent,
  type TaskWithTag,
  tasksKey,
  transitionTask,
  updateTask,
  useHistory,
  useMembers,
  useTasks,
} from './api.ts';
import {
  childOptions,
  clockOf,
  dueLabel,
  fileIcon,
  fileReason,
  fileSize,
  initials,
  type Option,
  parentOptions,
} from './model.ts';
import { toastNext, useTasksRun } from './run.ts';
import { TASKS_TEXT } from './texts.ts';
import { uploadAttachment } from './upload.ts';
import { Sym } from './sym.tsx';

type S = components['schemas'];

const PRIORITIES: readonly S['TaskPriority'][] = ['urgent', 'high', 'normal', 'low'];

export interface CardProps {
  tenantId: string;
  data: TaskWithTag;
  project: S['Project'];
  allTasks: readonly S['Task'][];
  meName: string;
  now: number;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onSubtask: (t: S['Task']) => void;
  onDoc: () => void;
}

export function TaskCard(p: CardProps): ReactElement {
  const { task: t } = p.data;
  const api = useApi();
  const run = useTasksRun();
  const toast = useToast();
  const qc = useQueryClient();
  const ids = useId();
  const [cmt, setCmt] = useState('');
  const [note, setNote] = useState('');
  const history = useHistory(p.tenantId, t.id);
  const kids = useTasks(p.tenantId, { parentTaskId: t.id });
  const members = useMembers(p.tenantId, t.projectId);

  const actions = p.project.myAccess?.actions ?? [];
  const canEdit = actions.includes('tasks.update');
  const canSet = actions.includes('tasks.projects.manage');
  const ro = !canEdit;

  /** После команды: карточка — ответ сервера с новым ETag, списки, история и счётчики — перечитать. */
  const apply = async (next?: TaskWithTag): Promise<void> => {
    if (next) qc.setQueryData([...tasksKey(p.tenantId), 'task', next.task.id], next);
    await qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey;
        return (
          k[0] === 'tenant' &&
          k[1] === p.tenantId &&
          k[2] === 'tasks' &&
          !(k[3] === 'task' && k[4] === next?.task.id)
        );
      },
    });
  };

  const cmd = async (fn: () => Promise<TaskWithTag>, ok: string | null): Promise<boolean> => {
    try {
      const next = await run('tasks:card', fn, ok);
      await apply(next);
      return true;
    } catch {
      // Тост — у run; устаревшая версия и прочие отказы — показать актуальное состояние.
      await apply();
      return false;
    }
  };

  /** Команда над другой задачей (подзадача, кандидат в состав) — со свежим ETag этой задачи. */
  const onOther = async (
    id: string,
    fn: (x: TaskWithTag) => Promise<TaskWithTag>,
    ok: string,
  ): Promise<void> => {
    try {
      await run('tasks:card', async () => fn(await fetchTask(api, p.tenantId, id)), ok);
    } catch {
      // тост — у run
    }
    await apply();
  };

  const runTransition = async (o: S['TaskTransitionOption']): Promise<void> => {
    try {
      const next = await run(
        'tasks:card',
        () =>
          transitionTask(api, p.tenantId, p.data, {
            transitionKey: o.key,
            ...(cmt.trim() ? { comment: cmt } : {}),
          }),
        null,
      );
      const waiting =
        o.approval && next.task.status === t.status && next.task.approval
          ? next.task.approval.approvers.filter((a) => a.state === 'waiting')
          : [];
      if (o.approval && waiting.length) {
        toast(
          format(TASKS_TEXT.voteCounted, { names: waiting.map((a) => a.displayName).join(', ') }),
          'ok',
        );
      } else {
        toast(o.approval ? T.card.approved : format(T.card.done, { name: o.name }), 'ok');
      }
      setCmt('');
      await apply(next);
    } catch {
      await apply();
    }
  };

  const reject = async (key: string): Promise<void> => {
    if (await cmd(() => rejectApproval(api, p.tenantId, p.data, key, cmt), T.card.rejected)) {
      setCmt('');
    }
  };

  const attach = async (list: FileList | null): Promise<void> => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    const have = t.files?.length ?? 0;
    const checked = picked.map((f, i) => ({ f, reason: fileReason(f, have + i) }));
    const failed = checked
      .filter((x) => x.reason)
      .map((x) =>
        format(T.card.notAttachedItem, {
          name: x.f.name,
          reason: T.newTask.reasons[x.reason ?? 'type'],
        }),
      );
    const good = checked.filter((x) => !x.reason).map((x) => x.f);
    // Загрузка по одному: сбой файла не мешает остальным, прикрепляются все загруженные — без файлов-«сирот» в
    // core.files; не загрузившиеся — «Не прикреплено: {имя} — {причина}», как в диалоге «Новая задача».
    const ids: string[] = [];
    for (const f of good) {
      try {
        ids.push(await uploadAttachment(api, p.tenantId, t.id, f));
      } catch (e) {
        failed.push(format(T.card.notAttachedItem, { name: f.name, reason: problemText(e) }));
      }
    }
    const notAttached = failed.length
      ? format(T.card.notAttached, { list: failed.join('; ') })
      : null;
    if (!ids.length) {
      if (notAttached) toast(notAttached, 'error');
      return;
    }
    try {
      const next = await run(
        'tasks:card',
        () => attachFiles(api, p.tenantId, p.data, ids),
        format(T.card.attached, { n: ids.length }),
      );
      await apply(next);
      if (notAttached) toastNext(toast, notAttached);
    } catch {
      await apply();
    }
  };

  const onDrop = (e: DragEvent): void => {
    if (!canEdit) return;
    e.preventDefault();
    void attach(e.dataTransfer.files);
  };

  const sendComment = async (): Promise<void> => {
    const text = note.trim();
    if (!text) return;
    try {
      await run('tasks:card', () => commentTask(api, p.tenantId, t.id, text), null);
      setNote('');
    } catch {
      // тост — у run
    }
    await apply();
  };

  const trs = t.docRoute ? [] : (t.availableTransitions ?? []);
  const blocked = trs.filter((x) => !x.allowed);
  const appr = t.docRoute ? undefined : t.approval;
  const cat = t.statusCategory ?? 'progress';

  // Исполнители — активные участники, которые видят проект (Р-16); текущий — первым, если его нет в списке.
  const people = (members.data?.items ?? []).filter(
    (m) => m.memberStatus !== 'suspended' && m.actions.includes('tasks.read'),
  );
  const assigneeOpts: Option[] = [
    ...(t.assigneeMemberId && !people.some((m) => m.memberId === t.assigneeMemberId)
      ? [{ value: t.assigneeMemberId, label: t.assigneeDisplayName ?? '—' }]
      : []),
    ...people.map((m) => ({ value: m.memberId, label: m.displayName })),
  ];

  // Связи (relVM :500–514).
  const par = t.parent;
  const parentText =
    par?.state === 'visible'
      ? format(T.newTask.parentOption, { key: par.key ?? '', title: par.title ?? '' })
      : par?.state === 'hidden'
        ? T.card.parentHidden
        : par
          ? format(T.card.parentDeleted, { key: par.key ?? '' })
          : '';
  const children = t.children ?? { total: 0, done: 0, hidden: 0 };
  const visibleKids = kids.data ?? [];
  const pct = `${Math.round((100 * children.done) / Math.max(1, children.total))}%`;
  const parentOpts = parentOptions(p.allTasks, t);
  const childOpts = childOptions(p.allTasks, t);
  const keyOf = (id: string): string => p.allTasks.find((x) => x.id === id)?.key ?? '';

  const route = t.docRoute;
  return (
    <aside className="ox-tk-card">
      <div className="ox-tk-card-head">
        <button
          type="button"
          className="ox-tk-back-board ox-tk-hit"
          data-icon=""
          onClick={p.onClose}
        >
          <Icon name="arrow_back" size={18} />
          {TASKS_TEXT.backToBoard}
        </button>
        <div className="ox-tk-card-top">
          <span className="ox-tk-mono12">{t.key}</span>
          <span>{format(T.card.author, { name: t.authorDisplayName ?? '—' })}</span>
          <span className="ox-tk-spacer" />
          <button
            type="button"
            className="ox-tk-icon-btn ox-tk-close30 ox-tk-hit"
            aria-label={T.card.close}
            onClick={p.onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <h3 className="ox-tk-card-title">{t.title}</h3>
        <div className="ox-tk-trs">
          <span className="ox-tk-status" data-cat={cat}>
            {t.statusName ?? t.status}
          </span>
          {trs.map((o) => (
            <button
              key={o.key}
              type="button"
              className="ox-tk-tr ox-tk-hit"
              data-approval={o.approval ? '' : undefined}
              disabled={!o.allowed}
              title={o.reasonText ?? ''}
              onClick={() => void runTransition(o)}
            >
              <Icon name={o.approval ? 'how_to_reg' : 'arrow_forward'} size={16} />
              {o.name}
            </button>
          ))}
        </div>
        {blocked.length ? (
          <div className="ox-tk-blocked">
            {blocked.map((o) => (
              <span key={o.key} className="ox-tk-blocked-line">
                <Icon name="lock" size={15} />
                <span>{format(T.card.blocked, { name: o.name, why: o.reasonText ?? '' })}</span>
              </span>
            ))}
          </div>
        ) : null}
        {route ? (
          <div className="ox-tk-route">
            <span className="ox-tk-route-text">
              <Sym name="description" size={17} />
              <span>
                {[
                  format(T.card.route, {
                    title: route.title,
                    v: route.version,
                    n: route.step,
                    of: route.stepsTotal,
                    step: route.stepName,
                  }),
                  ...(route.waitingDisplayNames.length
                    ? [format(T.card.routeWaiting, { names: route.waitingDisplayNames.join(', ') })]
                    : []),
                ].join('. ')}
                {`. ${T.card.routeNote}`}
              </span>
            </span>
            <button type="button" className="ox-tk-route-btn" onClick={p.onDoc}>
              {T.card.openDoc}
            </button>
          </div>
        ) : null}
        <textarea
          className="ox-tk-cmt"
          rows={2}
          value={cmt}
          placeholder={T.card.comment}
          aria-label={T.card.commentAria}
          onChange={(e) => setCmt(e.target.value)}
        />
      </div>
      {appr ? (
        <div className="ox-tk-appr">
          <span className="ox-tk-appr-title">
            <Icon name="how_to_reg" size={18} />
            {format(T.card.approvalTitle, {
              name: appr.transitionName,
              mode: T.card.modes[appr.mode],
            })}
          </span>
          {appr.approvers.map((a) => (
            <div key={a.memberId} className="ox-tk-appr-row">
              <span className="ox-tk-appr-ini">{initials(a.displayName)}</span>
              <span className="ox-tk-appr-name">
                {a.displayName === p.meName
                  ? format(T.card.you, { name: a.displayName })
                  : a.displayName}
              </span>
              <span className="ox-tk-appr-state" data-state={a.state}>
                {a.state === 'approved'
                  ? format(T.card.votedAt, { at: a.decidedAt ? clockOf(a.decidedAt, p.now) : '' })
                  : T.card.waiting}
              </span>
            </div>
          ))}
          {appr.approvers.length === 0 ? (
            <span className="ox-tk-appr-none">{T.card.noApprovers}</span>
          ) : null}
          {appr.canReject ? (
            <button
              type="button"
              className="ox-tk-reject ox-tk-hit"
              onClick={() => void reject(appr.transitionKey)}
            >
              {T.card.reject}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="ox-tk-fields">
        <span id={`${ids}-who`} className="ox-tk-muted">
          {T.newTask.assignee}
        </span>
        <select
          className="ox-tk-fsel"
          aria-labelledby={`${ids}-who`}
          value={t.assigneeMemberId ?? ''}
          disabled={ro}
          onChange={(e) => {
            const v = e.target.value;
            if (v)
              void cmd(() => updateTask(api, p.tenantId, p.data, { assigneeMemberId: v }), null);
          }}
        >
          {/* Без исполнителя — пустой вариант, как [...new Set([t.assignee, ...people])] эталона (ЗП:428). */}
          {t.assigneeMemberId ? null : <option value="" />}
          {assigneeOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span id={`${ids}-prio`} className="ox-tk-muted">
          {T.newTask.priority}
        </span>
        <select
          className="ox-tk-fsel"
          aria-labelledby={`${ids}-prio`}
          value={t.priority ?? 'normal'}
          disabled={ro}
          onChange={(e) =>
            void cmd(
              () =>
                updateTask(api, p.tenantId, p.data, {
                  priority: e.target.value as S['TaskPriority'],
                }),
              null,
            )
          }
        >
          {PRIORITIES.map((k) => (
            <option key={k} value={k}>
              {T.priority[k]}
            </option>
          ))}
        </select>
        <span className="ox-tk-muted">{T.newTask.due}</span>
        <span>{dueLabel(t.dueAt) || '—'}</span>
      </div>
      <div className="ox-tk-sec">
        <span className="ox-tk-sec-label">{T.card.links}</span>
        {par ? (
          <div className="ox-tk-parent">
            <span className="ox-tk-muted">{T.card.parentOf}</span>
            <button
              type="button"
              className="ox-tk-parent-link"
              onClick={() => {
                if (par.state === 'visible' && par.taskId) p.onOpenTask(par.taskId);
              }}
            >
              {parentText}
            </button>
            {canEdit ? (
              <button
                type="button"
                className="ox-tk-icon-btn ox-tk-icon28 ox-tk-hit"
                aria-label={T.card.unparentAria}
                title={T.card.unparentTitle}
                onClick={() =>
                  void cmd(() => setParent(api, p.tenantId, p.data, null), T.card.unlinked)
                }
              >
                <Icon name="link_off" size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        {!par && canEdit ? (
          <select
            className="ox-tk-fsel ox-tk-fsel13"
            aria-label={T.newTask.parent}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                void cmd(
                  () => setParent(api, p.tenantId, p.data, v),
                  format(T.card.parentSet, { key: keyOf(v) }),
                );
              }
            }}
          >
            <option value="">{T.card.setParent}</option>
            {parentOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        <div className="ox-tk-kids-head">
          <span className="ox-tk-muted">{T.card.children}</span>
          {children.total > 0 ? (
            <>
              <span className="ox-tk-bar">
                <span className="ox-tk-bar-fill" style={{ width: pct }} />
              </span>
              <span className="ox-tk-muted12">
                {format(T.card.childrenCount, { done: children.done, total: children.total })}
              </span>
            </>
          ) : (
            <span className="ox-tk-faint">{T.card.noChildren}</span>
          )}
        </div>
        {visibleKids.map((x) => (
          <div key={x.id} className="ox-tk-kid">
            <button type="button" className="ox-tk-kid-open" onClick={() => p.onOpenTask(x.id)}>
              <span className="ox-tk-mono11">{x.key}</span>
              <span className="ox-tk-kid-title">{x.title}</span>
              <span className="ox-tk-kid-status" data-cat={x.statusCategory ?? 'progress'}>
                {x.statusName ?? x.status}
              </span>
            </button>
            {canEdit ? (
              <button
                type="button"
                className="ox-tk-icon-btn ox-tk-icon28 ox-tk-hit"
                aria-label={format(T.card.unlinkAria, { key: x.key ?? '' })}
                title={T.card.unlinkTitle}
                onClick={() =>
                  void onOther(
                    x.id,
                    (c) => setParent(api, p.tenantId, c, null),
                    format(T.card.unlinkedChild, { key: x.key ?? '' }),
                  )
                }
              >
                <Icon name="link_off" size={18} />
              </button>
            ) : null}
          </div>
        ))}
        {children.hidden > 0 ? (
          <span className="ox-tk-muted12">
            {format(T.card.hiddenChildren, { n: children.hidden })}
          </span>
        ) : null}
        {canEdit ? (
          <div className="ox-tk-kid-actions">
            <button
              type="button"
              className="ox-tk-sub-btn ox-tk-hit"
              data-icon=""
              onClick={() => p.onSubtask(t)}
            >
              <Sym name="add" size={17} />
              {T.card.subtask}
            </button>
            <select
              className="ox-tk-fsel ox-tk-fsel13 ox-tk-kid-add"
              aria-label={T.card.addExistingAria}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) {
                  void onOther(
                    v,
                    (c) => setParent(api, p.tenantId, c, t.id),
                    format(T.card.added, { key: keyOf(v) }),
                  );
                }
              }}
            >
              <option value="">{T.card.addExisting}</option>
              {childOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div
        className="ox-tk-sec"
        onDragOver={(e) => {
          if (canEdit) e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <span className="ox-tk-sec-label">{T.newTask.description}</span>
        {t.descriptionMarkdown ? (
          <span className="ox-tk-desc">{t.descriptionMarkdown}</span>
        ) : (
          <span className="ox-tk-faint">{T.card.noDescription}</span>
        )}
        {(t.labels ?? []).length ? (
          <span className="ox-tk-labels">
            {(t.labels ?? []).map((l) => (
              <span key={l} className="ox-tk-label">
                {l}
              </span>
            ))}
          </span>
        ) : null}
        <div className="ox-tk-files-head">
          <span className="ox-tk-sec-label">
            {format(T.card.files, { n: t.files?.length ?? 0 })}
          </span>
          <span className="ox-tk-spacer" />
          {canEdit ? (
            <label className="ox-tk-attach ox-tk-hit">
              <Icon name="attach_file" size={16} />
              {T.card.attach}
              <input
                type="file"
                multiple
                className="ox-tk-file-input"
                aria-label={T.card.attachAria}
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}
        </div>
        {(t.files ?? []).map((f) => (
          <div key={f.fileId} className="ox-tk-file">
            <span className="ox-tk-ficon36">
              <Icon name={fileIcon(f.contentType)} size={20} />
            </span>
            <span className="ox-tk-fname">
              <span className="ox-tk-fname-name">{f.name}</span>
              <span className="ox-tk-fname-meta ox-tk-muted12">
                {format(T.card.fileMeta, {
                  size: fileSize(f.sizeBytes),
                  by: f.uploadedByDisplayName,
                  at: clockOf(f.attachedAt, p.now),
                })}
              </span>
            </span>
            {(f.uploadedByDisplayName === p.meName && canEdit) || canSet ? (
              <button
                type="button"
                className="ox-tk-icon-btn ox-tk-icon28 ox-tk-danger ox-tk-hit"
                aria-label={format(T.card.removeFile, { name: f.name })}
                onClick={() =>
                  void cmd(() => removeFile(api, p.tenantId, p.data, f.fileId), T.card.fileRemoved)
                }
              >
                <Sym name="delete" size={17} />
              </button>
            ) : null}
          </div>
        ))}
        {canEdit ? <span className="ox-tk-muted12">{T.card.filesHint}</span> : null}
      </div>
      {(t.checklist ?? []).length ? (
        <div className="ox-tk-sec ox-tk-check">
          <span className="ox-tk-sec-label">{T.card.checklist}</span>
          {(t.checklist ?? []).map((c) => (
            <label key={c.id} className="ox-tk-check-item">
              <input
                type="checkbox"
                checked={c.done}
                disabled={ro}
                onChange={() =>
                  void cmd(() => setChecklistItem(api, p.tenantId, p.data, c.id, !c.done), null)
                }
              />
              {c.text}
            </label>
          ))}
        </div>
      ) : null}
      <div className="ox-tk-sec ox-tk-hist-sec">
        <span className="ox-tk-sec-label">{T.card.history}</span>
        <div className="ox-tk-hist">
          {(history.data ?? []).slice(0, 12).map((h) => (
            <span key={h.id} className="ox-tk-hist-row">
              <span className="ox-tk-hist-at">{clockOf(h.at, p.now)}</span>
              <span className="ox-tk-hist-text">
                <b>{h.actorDisplayName}</b> {h.text}
              </span>
            </span>
          ))}
        </div>
        <div className="ox-tk-note-row">
          <input
            className="ox-tk-cinput"
            value={note}
            placeholder={T.card.commentAria}
            aria-label={TASKS_TEXT.historyCommentAria}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendComment();
            }}
          />
          <button
            type="button"
            className="ox-tk-send ox-tk-hit"
            aria-label={T.list.send}
            disabled={!note.trim()}
            onClick={() => void sendComment()}
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
