// W4.12 · Диалог «Новая задача» (`modal-new-task`, эталон «Задачи и проекты.dc.html» ЗП:97–126, :393–410, pickFiles
// :517–521): проект (с правом «Создавать»), статус — первый «К выполнению», «Входит в задачу», тема, описание со
// счётчиком и вставкой скриншота, вложения (перетаскивание и выбор, причины «Не прикрепится»), исполнитель (видят
// проект) и «Назначить меня», приоритет, срок, метки, «Создать ещё одну». Создание — createTask, затем загрузка
// каждого файла и attachTaskFiles (Q-W4.02-10). Модальный контейнер оболочки, Escape и фокус — как у диалогов W1.24.
import type { components } from '@ortus/api-client';
import { format, shell, tasks as T } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useApi } from '../../../app/api.tsx';
import { problemText } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { useDialogKeys } from '../../company/modules/dialog.tsx';
import { attachFiles, createTask, type TaskWithTag, useMembers, useWorkflow } from './api.ts';
import {
  dueAtOf,
  fileIcon,
  fileReason,
  type FileReason,
  fileSize,
  firstTodo,
  labelsOf,
  type Option,
} from './model.ts';
import { detailOf, toastNext, useTasksRun } from './run.ts';
import { uploadAttachment } from './upload.ts';
import { Sym } from './sym.tsx';

type S = components['schemas'];

/** Что заполнено при открытии: проект, родитель и исполнитель («Подзадача», :513). */
export interface NewTaskPrefill {
  projectId: string;
  parentId?: string;
  assigneeId?: string;
  priority?: S['TaskPriority'];
}

interface Picked {
  id: number;
  file: File;
  reason: FileReason | null;
  url: string | null;
}

/** «Я» в списке исполнителей: участник с моим именем или пустое значение — сервер назначит автора. */
const ME = '';
const PRIORITIES: readonly S['TaskPriority'][] = ['urgent', 'high', 'normal', 'low'];

const thumb = (f: File): string | null =>
  /^image\//.test(f.type) && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(f)
    : null;

let seq = 0;

export function NewTaskDialog(p: {
  tenantId: string;
  prefill: NewTaskPrefill;
  projects: readonly S['Project'][];
  parentOptions: readonly Option[];
  meName: string;
  onClose: () => void;
  onCreated: (t: TaskWithTag, more: boolean) => void;
}): ReactElement {
  const api = useApi();
  const run = useTasksRun();
  const toast = useToast();
  const dialog = useRef<HTMLDivElement>(null);
  const [projectId, setProjectId] = useState(p.prefill.projectId);
  const [parent, setParent] = useState(p.prefill.parentId ?? '');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const [assignee, setAssignee] = useState(p.prefill.assigneeId ?? ME);
  const [priority, setPriority] = useState<S['TaskPriority']>(p.prefill.priority ?? 'normal');
  const [due, setDue] = useState('');
  const [labels, setLabels] = useState('');
  const [more, setMore] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const members = useMembers(p.tenantId, projectId);
  const workflow = useWorkflow(p.tenantId, projectId, true);
  const status = firstTodo(workflow.data?.statuses ?? [])?.name ?? '';

  // Исполнители — активные участники, которые видят проект; «я» — первым, как в эталоне (:395).
  const people = (members.data?.items ?? []).filter(
    (m) => m.memberStatus !== 'suspended' && m.actions.includes('tasks.read'),
  );
  const mine = people.find((m) => m.displayName === p.meName);
  const others = people.filter((m) => m !== mine);
  const meValue = mine?.memberId ?? ME;
  const value = assignee === ME || others.some((m) => m.memberId === assignee) ? assignee : ME;
  const effective = value === ME ? meValue : value;

  // Фокус в диалог при открытии; при закрытии — на открыватель (PD-29).
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useDialogKeys(dialog, busy ? null : p.onClose);

  // Миниатюры выбранных фото освобождаются при закрытии.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (list: FileList | readonly File[] | null): void => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setFiles((cur) => [
      ...cur,
      ...picked.map((f, i) => {
        const file = f.name ? f : new File([f], T.newTask.screenshot, { type: f.type });
        const url = thumb(file);
        if (url) urls.current.push(url);
        return { id: ++seq, file, reason: fileReason(file, cur.length + i), url };
      }),
    ]);
    setErr(null);
    setDrag(false);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const fs = e.clipboardData?.files;
    if (fs && fs.length) {
      e.preventDefault();
      add(fs);
    }
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    add(e.dataTransfer.files);
  };

  const titleBad = !!err && title.trim().length < 3;

  const save = async (): Promise<void> => {
    if (busy) return;
    const tl = title.trim();
    const bad = files.filter((f) => f.reason);
    if (tl.length < 3) {
      setErr(T.newTask.titleShort);
      return;
    }
    if (bad.length) {
      setErr(format(T.newTask.removeBad, { names: bad.map((f) => f.file.name).join(', ') }));
      return;
    }
    setBusy(true);
    const body: S['TaskCreate'] = {
      projectId,
      title: tl,
      priority,
      ...(desc ? { descriptionMarkdown: desc } : {}),
      ...(effective ? { assigneeMemberId: effective } : {}),
      ...(parent ? { parentTaskId: parent } : {}),
      ...(labelsOf(labels).length ? { labels: labelsOf(labels) } : {}),
      ...(dueAtOf(due) ? { dueAt: dueAtOf(due) } : {}),
    };
    let created: TaskWithTag;
    try {
      created = await run('tasks:create', () => createTask(api, p.tenantId, body), null, {
        inline: true,
      });
    } catch (e) {
      setBusy(false);
      setErr(detailOf(e));
      return;
    }
    // Вложения — после создания задачи (владелец загрузки — эта задача): сбой файла не отменяет задачу.
    const ids: string[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        ids.push(await uploadAttachment(api, p.tenantId, created.task.id, f.file));
      } catch (e) {
        failed.push(format(T.card.notAttachedItem, { name: f.file.name, reason: problemText(e) }));
      }
    }
    if (ids.length) {
      try {
        created = await attachFiles(api, p.tenantId, created, ids);
      } catch (e) {
        failed.push(detailOf(e));
      }
    }
    toast(format(T.newTask.created, { key: created.task.key ?? '' }), 'ok');
    // Тост оболочки один: «Не прикреплено» — после «создана», а не вместо него (Q-W4.12-6).
    if (failed.length) toastNext(toast, format(T.card.notAttached, { list: failed.join('; ') }));
    setBusy(false);
    if (more) {
      setTitle('');
      setDesc('');
      setFiles([]);
      setLabels('');
      setErr(null);
    }
    p.onCreated(created, more);
  };

  const host = document.querySelector('.ox-frame') ?? document.body;
  return createPortal(
    <div
      className="ox-tk-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) p.onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nt-h"
        tabIndex={-1}
        className="ox-tk-nf"
        onDragOver={(e) => {
          e.preventDefault();
          if (!drag) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <div className="ox-tk-nf-head">
          <h3 id="nt-h" className="ox-tk-nf-title">
            {T.newTask.title}
          </h3>
          <span className="ox-tk-muted12">{T.newTask.required}</span>
          <span className="ox-tk-spacer" />
          <button
            type="button"
            className="ox-tk-icon-btn ox-tk-nf-close ox-tk-hit"
            aria-label={shell.modal.close}
            onClick={p.onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="ox-tk-nf-body">
          <div className="ox-tk-nf-row">
            <label className="ox-tk-field ox-tk-nf-project">
              {T.newTask.project}
              <select
                className="ox-tk-nf-select"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setErr(null);
                }}
              >
                {p.projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {`${x.key} · ${x.name}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="ox-tk-field ox-tk-nf-statusbox">
              {T.newTask.status}
              <span className="ox-tk-nf-status">{status}</span>
            </div>
          </div>
          <label className="ox-tk-field">
            {T.newTask.parent}
            <select
              className="ox-tk-nf-select"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">{T.newTask.noParent}</option>
              {p.parentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ox-tk-field">
            {T.newTask.subject}
            <input
              className="ox-tk-nf-subject"
              value={title}
              placeholder={T.newTask.subjectPlaceholder}
              aria-invalid={titleBad ? 'true' : 'false'}
              data-bad={titleBad ? '' : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                setErr(null);
              }}
            />
          </label>
          <label className="ox-tk-field">
            {T.newTask.description}
            <textarea
              className="ox-tk-nf-desc"
              rows={5}
              value={desc}
              placeholder={T.newTask.descriptionPlaceholder}
              onChange={(e) => setDesc(e.target.value)}
              onPaste={onPaste}
            />
            <span className="ox-tk-field-hint">
              {/* Без разрядов, как String(n) эталона (ЗП:399): «5001 / 5000». */}
              {format(T.newTask.descriptionCount, { n: String(desc.length) })}
            </span>
          </label>
          <div className="ox-tk-nf-files">
            <span className="ox-tk-field-label">{T.newTask.attachments}</span>
            <label className="ox-tk-drop" data-drag={drag ? '' : undefined}>
              <Sym name="upload_file" size={26} />
              <span className="ox-tk-drop-text">
                {T.newTask.drop} <span className="ox-tk-drop-link">{T.newTask.dropLink}</span>
              </span>
              <span className="ox-tk-muted12">{T.newTask.dropNote}</span>
              <input
                type="file"
                multiple
                className="ox-tk-file-input"
                aria-label={T.newTask.pick}
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {files.map((f) => (
              <div key={f.id} className="ox-tk-nf-file" data-bad={f.reason ? '' : undefined}>
                {f.url ? (
                  <img src={f.url} alt="" className="ox-tk-thumb40" />
                ) : (
                  <span className="ox-tk-ficon40">
                    <Icon name={fileIcon(f.file.type)} size={22} />
                  </span>
                )}
                <span className="ox-tk-fname">
                  <span className="ox-tk-fname-name">{f.file.name}</span>
                  <span className="ox-tk-fname-meta">
                    {f.reason
                      ? format(T.newTask.wontAttach, { reason: T.newTask.reasons[f.reason] })
                      : fileSize(f.file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="ox-tk-icon-btn ox-tk-danger ox-tk-hit"
                  aria-label={format(T.newTask.remove, { name: f.file.name })}
                  onClick={() => {
                    setFiles((cur) => cur.filter((x) => x.id !== f.id));
                    setErr(null);
                  }}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            ))}
          </div>
          <div className="ox-tk-nf-row ox-tk-nf-row-end">
            <label className="ox-tk-field ox-tk-nf-who">
              {T.newTask.assignee}
              <select
                className="ox-tk-nf-select"
                value={value}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value={ME}>{p.meName}</option>
                {others.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ox-tk-link-btn ox-tk-hit"
              onClick={() => setAssignee(ME)}
            >
              {T.newTask.assignMe}
            </button>
            <label className="ox-tk-field ox-tk-nf-half">
              {T.newTask.priority}
              <select
                className="ox-tk-nf-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as S['TaskPriority'])}
              >
                {PRIORITIES.map((k) => (
                  <option key={k} value={k}>
                    {T.priority[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="ox-tk-field ox-tk-nf-half">
              {T.newTask.due}
              <input
                type="date"
                className="ox-tk-nf-select"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          <label className="ox-tk-field">
            {T.newTask.labels}
            <input
              className="ox-tk-nf-select"
              value={labels}
              placeholder={T.newTask.labelsPlaceholder}
              onChange={(e) => setLabels(e.target.value)}
            />
          </label>
          {err ? (
            <span role="alert" className="ox-tk-err">
              {err}
            </span>
          ) : null}
        </div>
        <div className="ox-tk-nf-foot">
          <label className="ox-tk-more ox-tk-hit">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
            {T.newTask.more}
          </label>
          <span className="ox-tk-spacer" />
          <button type="button" className="ox-tk-btn ox-tk-hit" onClick={p.onClose}>
            {shell.modal.cancel}
          </button>
          <button
            type="button"
            className="ox-tk-primary ox-tk-nf-save ox-tk-hit"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? T.newTask.creating : T.newTask.create}
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
