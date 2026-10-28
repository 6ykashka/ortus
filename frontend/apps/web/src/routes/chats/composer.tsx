// W7.13 · Поле ввода чата (C-9): сообщение, правка, файл, документ, опрос, «важное», временное, спойлер, одноразовый
// файл; «только чтение» вместо поля. Эталон `Чаты.dc.html` :170–200, composerVM :627–654. Демо-файлы эталона не
// переносятся — файл грузится через `files` (`purpose: chat_attachment`). Права и пределы — серверные (`my.can`, политика).
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { type ReactElement, useRef, useState } from 'react';

import { editMessage, postMessage, uploadAttachment, useDocuments } from './api.ts';
import type { ChatCtx } from './ctx.ts';
import {
  type ChatMessage,
  composerHint,
  importantDue,
  nextTtl,
  readOnlyReason,
  sizeLabel,
} from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];

interface Attached {
  fileId: string;
  name: string;
  bytes: number;
  kind: string;
}

const KIND_ICON: Record<string, string> = {
  photo: 'photo',
  video: 'videocam',
  voice: 'mic',
  doc: 'description',
};

const kindOf = (type: string): string =>
  type.startsWith('image/')
    ? 'photo'
    : type.startsWith('video/')
      ? 'video'
      : type.startsWith('audio/')
        ? 'voice'
        : 'doc';

export interface ComposerProps {
  ctx: ChatCtx;
  topic: string | null;
  editing: ChatMessage | null;
  onEditDone: () => void;
  onAlert: (text: string) => void;
}

export function Composer({
  ctx,
  topic,
  editing,
  onEditDone,
  onAlert,
}: ComposerProps): ReactElement {
  const chat = ctx.chat;
  const can = chat.my.can;
  const P = chat.policy;
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [files, setFiles] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [doc, setDoc] = useState<{ id: string; title: string } | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pq, setPq] = useState('');
  const [popts, setPopts] = useState(['', '']);
  const [panon, setPanon] = useState(false);
  const [pmulti, setPmulti] = useState(false);
  const [phours, setPhours] = useState<3 | 24 | 72>(24);
  const [imp, setImp] = useState(false);
  const [ttl, setTtl] = useState(0);
  const [spoilOn, setSpoilOn] = useState(false);
  const [spoil, setSpoil] = useState('');
  const [vonce, setVonce] = useState(false);
  const [fileEl, setFileEl] = useState<HTMLInputElement | null>(null);
  const docs = useDocuments(ctx.tenantId, docOpen);
  const key = useRef<string>(crypto.randomUUID());

  // Правка: текст сообщения попадает в поле один раз при выборе «Править».
  if (editing && editing.id !== editId) {
    setEditId(editing.id);
    setDraft(editing.text);
  }
  if (!editing && editId) {
    setEditId(null);
    setDraft('');
  }

  if (!can?.write) {
    return (
      <div className="ox-chat-readonly">
        <Icon name="visibility" size={18} />
        <span>{readOnlyReason(chat)}</span>
      </div>
    );
  }

  const reset = (): void => {
    setDraft('');
    setFiles([]);
    setDoc(null);
    setImp(false);
    setTtl(0);
    setSpoilOn(false);
    setSpoil('');
    setVonce(false);
    setPollOpen(false);
    setPq('');
    setPopts(['', '']);
    setDocOpen(false);
    key.current = crypto.randomUUID();
  };

  const send = async (): Promise<void> => {
    const c = { api: ctx.api, tenantId: ctx.tenantId, chatId: ctx.chatId };
    if (editing) {
      const r = await ctx.exec(() => editMessage(c, editing.id, draft));
      if (r) {
        setDraft('');
        onEditDone();
      }
      return;
    }
    const body: S['ChatMessageCreate'] = {
      ...(draft.trim() ? { text: draft } : {}),
      ...(topic ? { topic } : {}),
      ...(files.length ? { fileIds: files.map((f) => f.fileId) } : {}),
      ...(doc ? { document: { kind: 'doc', refId: doc.id } } : {}),
      ...(imp ? { important: { dueDate: importantDue(ctx.now) } } : {}),
      ...(ttl ? { ephemeral: { ttlHours: ttl } } : {}),
      ...(vonce ? { viewOnce: true } : {}),
      ...(spoilOn && spoil.trim() ? { spoiler: spoil } : {}),
      ...(pollOpen
        ? {
            poll: {
              question: pq,
              options: popts.map((o) => o.trim()).filter(Boolean),
              anonymous: panon,
              multiple: pmulti,
              closesInHours: phours,
            },
          }
        : {}),
    };
    const r = await ctx.exec(() => postMessage(c, body, key.current));
    if (r) reset();
  };

  const attach = async (list: FileList | null): Promise<void> => {
    const file = list?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileId = await ctx.exec(() =>
        uploadAttachment(ctx.api, ctx.tenantId, ctx.chatId, file),
      );
      if (fileId) {
        setFiles((x) => [
          ...x,
          { fileId, name: file.name, bytes: file.size, kind: kindOf(file.type) },
        ]);
      }
    } finally {
      setUploading(false);
      if (fileEl) fileEl.value = '';
    }
  };

  const kindLabel = T.kind[chat.kind].label;
  const tools: {
    icon: string;
    tip: string;
    label: string;
    on: boolean;
    enabled: boolean;
    run: () => void;
  }[] = [
    {
      icon: 'attach_file',
      tip: T.composer.tools.file,
      label: '',
      on: files.length > 0,
      enabled: can.files,
      run: () => (can.files ? fileEl?.click() : onAlert(T.composer.errors.files)),
    },
    {
      icon: 'description',
      tip: T.composer.tools.doc,
      label: '',
      on: docOpen || doc !== null,
      enabled: true,
      run: () => setDocOpen((v) => !v),
    },
    {
      icon: 'ballot',
      tip: T.composer.tools.poll,
      label: '',
      on: pollOpen,
      enabled: can.polls,
      run: () => setPollOpen((v) => !v),
    },
    {
      icon: 'flag',
      tip: can.announce ? T.composer.tools.important : T.composer.tools.importantOff,
      label: '',
      on: imp,
      enabled: can.announce,
      run: () => (can.announce ? setImp((v) => !v) : onAlert(T.composer.errors.important)),
    },
    {
      icon: 'timer',
      tip: can.ephemeral ? T.composer.tools.temp : `${T.composer.tools.tempOff}${kindLabel}»`,
      label: ttl ? (ttl >= 24 ? `${ttl / 24} дн` : `${ttl} ч`) : '',
      on: ttl > 0,
      enabled: can.ephemeral,
      run: () =>
        can.ephemeral ? setTtl(nextTtl(ttl)) : onAlert(`${T.composer.errors.temp}${kindLabel}»`),
    },
    {
      icon: 'visibility_off',
      tip: T.composer.tools.spoiler,
      label: '',
      on: spoilOn,
      enabled: true,
      run: () => setSpoilOn((v) => !v),
    },
    {
      icon: 'lock_clock',
      tip: can.viewOnce ? T.composer.tools.once : T.composer.tools.onceOff,
      label: '',
      on: vonce,
      enabled: can.viewOnce,
      run: () => {
        if (can.viewOnce) {
          setVonce((v) => !v);
          fileEl?.click();
        } else onAlert(T.composer.errors.once);
      },
    },
  ];

  const ph = editing
    ? T.composer.editPlaceholder
    : chat.topics.length
      ? `${T.composer.placeholderTopic}${topic ?? chat.topics[0]}${T.composer.placeholderTail}`
      : T.composer.placeholder;

  return (
    <div className="ox-chat-composer">
      {editing ? (
        <span className="ox-chat-edit-note">
          <Icon name="edit" size={16} />
          {T.composer.editNote}
          {T.edit[P.edit]}
          {T.composer.editTail}
          <span className="ox-chat-grow" />
          <button
            type="button"
            className="ox-chat-link"
            onClick={() => {
              setDraft('');
              onEditDone();
            }}
          >
            {T.composer.cancelEdit}
          </button>
        </span>
      ) : null}
      {files.length || uploading ? (
        <div className="ox-chat-att">
          {files.map((f, i) => (
            <span key={f.fileId} className="ox-chat-att-chip">
              <Icon name={KIND_ICON[f.kind] ?? 'description'} size={16} />
              {f.name} · {sizeLabel(f.bytes)}
              {vonce ? ' · одноразовый' : ''}
              <button
                type="button"
                aria-label={T.composer.removeFile}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          ))}
          {uploading ? <span className="ox-chat-file-meta">{T.composer.uploading}</span> : null}
        </div>
      ) : null}
      <input
        ref={setFileEl}
        type="file"
        hidden
        aria-label={T.composer.pickFile}
        onChange={(e) => void attach(e.target.files)}
      />
      {docOpen ? (
        <div className="ox-chat-pick">
          <span className="ox-chat-file-meta">{T.composer.docHint}</span>
          {(docs.data ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              className="ox-chat-pick-item"
              data-on={doc?.id === d.id || undefined}
              onClick={() => {
                setDoc({ id: d.id, title: d.title });
                setDocOpen(false);
              }}
            >
              <Icon name="description" size={18} />
              {d.title}
            </button>
          ))}
          {docs.isSuccess && !docs.data.length ? (
            <span className="ox-chat-file-meta">{T.composer.noDocs}</span>
          ) : null}
        </div>
      ) : null}
      {pollOpen ? (
        <div className="ox-chat-pollform">
          <input
            className="ox-chat-input"
            value={pq}
            placeholder={T.composer.pollQuestion}
            aria-label={T.composer.pollQuestionAria}
            onChange={(e) => setPq(e.target.value)}
          />
          {popts.map((v, i) => (
            <input
              key={i}
              className="ox-chat-input"
              value={v}
              placeholder={`${T.composer.pollOption}${i + 1}`}
              aria-label={`${T.composer.pollOption}${i + 1}`}
              onChange={(e) => setPopts(popts.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <div className="ox-chat-pollform-row">
            <button
              type="button"
              className="ox-chat-btn ox-chat-btn-sm"
              onClick={() => popts.length < 10 && setPopts([...popts, ''])}
            >
              {T.composer.pollAdd}
            </button>
            <button
              type="button"
              className="ox-chat-toggle"
              aria-pressed={panon}
              onClick={() => setPanon(!panon)}
            >
              <Icon name="visibility_off" size={15} />
              {T.composer.pollAnon}
            </button>
            <button
              type="button"
              className="ox-chat-toggle"
              aria-pressed={pmulti}
              onClick={() => setPmulti(!pmulti)}
            >
              <Icon name="checklist" size={15} />
              {T.composer.pollMulti}
            </button>
            <span className="ox-chat-file-meta">{T.composer.pollTerm}</span>
            {([3, 24, 72] as const).map((h) => (
              <button
                key={h}
                type="button"
                className="ox-chat-toggle"
                aria-pressed={phours === h}
                onClick={() => setPhours(h)}
              >
                {T.composer.pollHours[h]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {spoilOn ? (
        <input
          className="ox-chat-input"
          value={spoil}
          placeholder={T.composer.spoilerPlaceholder}
          aria-label={T.composer.spoilerAria}
          onChange={(e) => setSpoil(e.target.value)}
        />
      ) : null}
      <div className="ox-chat-tools">
        {tools.map((t) => (
          <button
            key={t.icon}
            type="button"
            className="ox-chat-tool"
            title={t.tip}
            aria-label={t.tip}
            aria-pressed={t.on}
            data-off={!t.enabled || undefined}
            onClick={t.run}
          >
            <Icon name={t.icon} size={20} />
            {t.label}
          </button>
        ))}
        <span className="ox-chat-grow" />
        <span className="ox-chat-hint">
          {composerHint({
            important: imp,
            ttlHours: ttl,
            viewOnce: vonce,
            docTitle: doc?.title ?? null,
            maxFileMb: P.maxFileMb,
          })}
        </span>
      </div>
      <div className="ox-chat-send">
        <textarea
          className="ox-chat-textarea"
          rows={2}
          maxLength={4000}
          value={draft}
          placeholder={ph}
          aria-label={T.composer.aria}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="ox-chat-send-btn"
          aria-label={editing ? T.composer.save : T.composer.send}
          disabled={ctx.busy || uploading}
          onClick={() => void send()}
        >
          <Icon name={editing ? 'check' : 'send'} size={22} />
        </button>
      </div>
    </div>
  );
}
