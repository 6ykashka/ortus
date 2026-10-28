// W7.13 · Окно чата (C-5…C-9): шапка, темы, закреплённое, лента с разделителями дней и поле ввода.
// Эталон `Чаты.dc.html` :63–200, `out.ch` :550–560.
import { Icon, Skeleton } from '@ortus/ui';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { problemCode } from '../../shell/run.tsx';
import { markRead, useMessages } from './api.ts';
import { Composer } from './composer.tsx';
import { type ChatCtx, unitName } from './ctx.ts';
import { Message, SystemCard } from './message.tsx';
import {
  avatarColor,
  type ChatMessage,
  chatIcon,
  chatSub,
  dayLabel,
  initials,
  KIND_TONE,
  topicOf,
} from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

export interface ThreadProps {
  ctx: ChatCtx;
  title: string;
  peerId: string | null;
  narrow: boolean;
  infoOpen: boolean;
  msgSel: string | null;
  onBack: () => void;
  onInfo: () => void;
  onMsgInfo: (id: string) => void;
}

export function Avatar({
  kind,
  record,
  title,
  peerId,
  size,
}: {
  kind: Parameters<typeof chatIcon>[0]['kind'];
  record?: Parameters<typeof chatIcon>[0]['record'];
  title: string;
  peerId: string | null;
  size: number;
}): ReactElement {
  const direct = kind === 'direct';
  return (
    <span
      className="ox-chat-chat-ava"
      data-tone={direct ? undefined : KIND_TONE[kind]}
      data-direct={direct || undefined}
      style={{
        width: size,
        height: size,
        ...(direct ? { background: avatarColor(peerId ?? title) } : {}),
      }}
      aria-hidden="true"
    >
      {direct ? (
        initials(title)
      ) : (
        <Icon name={chatIcon({ kind, record: record ?? null })} size={22} />
      )}
    </span>
  );
}

export function Thread(p: ThreadProps): ReactElement {
  const { ctx } = p;
  const chat = ctx.chat;
  const messages = useMessages(ctx.tenantId, ctx.chatId);
  const [topic, setTopic] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const forbidden = messages.isError && problemCode(messages.error) === 'forbidden_action';
  const items = messages.data?.items ?? [];
  const lastSeq = messages.data?.lastSeq ?? 0;
  const topics = chat.topics;
  const shown = items.filter((m) => !topics.length || !topic || topicOf(m, topics) === topic);

  // Прочитанное: открытие чата с непрочитанными отмечает ленту прочитанной (markChatRead).
  const unread = chat.my.unread;
  const marked = useRef('');
  useEffect(() => {
    if (!unread || !lastSeq || marked.current === `${ctx.chatId}:${lastSeq}`) return;
    marked.current = `${ctx.chatId}:${lastSeq}`;
    void markRead({ api: ctx.api, tenantId: ctx.tenantId, chatId: ctx.chatId }, lastSeq)
      .then(() => ctx.refresh())
      .catch(() => undefined);
  }, [unread, lastSeq, ctx]);

  // К последнему сообщению при смене чата, темы и новом сообщении.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ctx.chatId, topic, shown.length]);

  // Меню закрывается по Escape и клику вне пузыря.
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    const away = (e: MouseEvent): void => {
      if (!(e.target as Element).closest('.ox-chat-bhead, .ox-chat-menu')) setMenu(null);
    };
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', away);
    };
  }, [menu]);

  let lastDay = '';
  const rows: ReactElement[] = [];
  for (const m of shown) {
    const day = dayLabel(m.createdAt, ctx.now);
    if (day !== lastDay) {
      rows.push(
        <span key={`d-${m.id}`} className="ox-chat-day">
          {day}
        </span>,
      );
      lastDay = day;
    }
    rows.push(
      m.kind === 'system' ? (
        <SystemCard key={m.id} m={m} ctx={ctx} />
      ) : (
        <Message
          key={m.id}
          m={m}
          ctx={ctx}
          topics={topics}
          showTopic={topics.length > 0 && !topic}
          menuOpen={menu === m.id}
          selected={p.msgSel === m.id && p.infoOpen}
          onMenu={setMenu}
          onInfo={p.onMsgInfo}
          onEdit={(x) => setEditing(x)}
        />
      ),
    );
  }
  const pinned = chat.pinned;

  return (
    <section className="ox-chat-main" role="region" aria-label={`${T.chat.aria} · ${p.title}`}>
      <div className="ox-chat-head">
        {p.narrow ? (
          <button
            type="button"
            className="ox-chat-back"
            aria-label={T.chat.back}
            onClick={p.onBack}
          >
            <Icon name="arrow_back" size={22} />
          </button>
        ) : null}
        <Avatar kind={chat.kind} record={chat.record} title={p.title} peerId={p.peerId} size={38} />
        <span className="ox-chat-head-text">
          <strong className="ox-chat-head-title">{p.title}</strong>
          <span className="ox-chat-head-sub">
            {chat.kind === 'direct' && chat.peer?.status && chat.peer.status !== 'active'
              ? `${T.kind.direct.one} · ${T.chat.peerGone}`
              : chatSub(chat, unitName(ctx.dir, chat.orgUnitId))}
          </span>
        </span>
        {chat.record?.nav ? (
          <button
            type="button"
            className="ox-chat-btn"
            onClick={() => ctx.nav(chat.record?.nav ?? '')}
          >
            <Icon name="open_in_new" size={18} />
            {chat.record.label || T.chat.record}
          </button>
        ) : null}
        <button
          type="button"
          className="ox-chat-info-btn"
          aria-label={T.chat.info}
          aria-pressed={p.infoOpen}
          onClick={p.onInfo}
        >
          <Icon name="info" size={20} />
        </button>
      </div>
      {topics.length ? (
        <div className="ox-chat-topics" role="tablist" aria-label={T.chat.topicsAria}>
          {[null, ...topics].map((t) => (
            <button
              key={t ?? 'all'}
              type="button"
              role="tab"
              aria-selected={topic === t}
              className="ox-chat-topic-tab"
              onClick={() => setTopic(t)}
            >
              {t ?? T.chat.allTopics}
            </button>
          ))}
        </div>
      ) : null}
      {pinned ? (
        <div className="ox-chat-pin" role="note" aria-label={T.chat.pinned}>
          <Icon name="push_pin" size={18} />
          <span>
            {pinned.authorDisplayName}: {pinned.text || pinned.poll?.question || T.chat.attachment}
          </span>
        </div>
      ) : null}
      <div ref={list} className="ox-chat-feed" aria-live="polite" aria-busy={messages.isPending}>
        {messages.isPending ? <Skeleton lines={4} label={T.chat.loading} /> : null}
        {messages.isError ? (
          <div role="alert" className="ox-chat-feed-note">
            <Icon name={forbidden ? 'lock' : 'error'} size={20} />
            <span>{forbidden ? T.chat.msgsForbidden : T.chat.msgsFailed}</span>
            {forbidden ? null : (
              <button
                type="button"
                className="ox-chat-link"
                onClick={() => void messages.refetch()}
              >
                {T.retry}
              </button>
            )}
          </div>
        ) : (
          rows
        )}
        {messages.isSuccess && !shown.length ? (
          <span className="ox-chat-empty">{T.chat.noMessages}</span>
        ) : null}
      </div>
      <Composer
        ctx={ctx}
        topic={topic}
        editing={editing}
        onEditDone={() => setEditing(null)}
        onAlert={ctx.alert}
      />
    </section>
  );
}
