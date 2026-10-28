// W7.13 · Сообщение ленты (C-8): служебная карточка модуля, пузырь с текстом, файлами, документом, маской ПДн, спойлером,
// опросом, «важным», историей правок и отметкой прочтения. Эталон `Чаты.dc.html` :78–169, msgVM :578–625.
import { Button, Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import {
  ackMessage,
  closePoll,
  createTask,
  deleteMessage,
  openOnce,
  pin,
  revealPdn,
  saveToRecord,
  useMembers,
  useVersions,
  votePoll,
} from './api.ts';
import type { ChatCtx } from './ctx.ts';
import {
  avatarColor,
  type ChatMessage,
  importantNote,
  initials,
  menuOf,
  pollView,
  sizeLabel,
  tickOf,
  timeOf,
} from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

const FILE_ICON: Record<string, [string, string]> = {
  photo: ['photo', 'ok'],
  video: ['videocam', 'info'],
  voice: ['mic', 'purple'],
  doc: ['description', 'neutral'],
};

export interface MessageProps {
  m: ChatMessage;
  ctx: ChatCtx;
  topics: readonly string[];
  showTopic: boolean;
  menuOpen: boolean;
  selected: boolean;
  onMenu: (id: string | null) => void;
  onInfo: (id: string) => void;
  onEdit: (m: ChatMessage) => void;
}

export function SystemCard({ m, ctx }: { m: ChatMessage; ctx: ChatCtx }): ReactElement | null {
  const s = m.system;
  if (!s) return null;
  return (
    <div className="ox-chat-sys" role="group" aria-label={s.title}>
      <span className="ox-chat-sys-icon" data-tone={s.tone}>
        <Icon name={s.icon} size={20} />
      </span>
      <span className="ox-chat-sys-body">
        <span className="ox-chat-sys-mod">
          {s.module}
          {T.msg.sysAt}
          {timeOf(m.createdAt)}
          {m.topic && ctx.chat.topics.length ? ` · ${m.topic}` : ''}
        </span>
        <strong className="ox-chat-sys-title">{s.title}</strong>
        <span className="ox-chat-sys-text">{s.text}</span>
      </span>
      {s.nav ? (
        <button type="button" className="ox-chat-btn" onClick={() => ctx.nav(s.nav ?? '')}>
          {s.label ?? T.msg.open}
        </button>
      ) : null}
    </div>
  );
}

export function Message(p: MessageProps): ReactElement {
  const { m, ctx } = p;
  const c = { api: ctx.api, tenantId: ctx.tenantId, chatId: ctx.chatId };
  const can = ctx.chat.my.can;
  const policy = ctx.chat.policy;
  const mine =
    (ctx.memberId !== null && m.authorMemberId === ctx.memberId) ||
    m.authorDisplayName === ctx.meName;
  const moderator = can?.moderate ?? false;
  const [spoilerShown, setSpoilerShown] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [editsOpen, setEditsOpen] = useState(false);
  const versions = useVersions(ctx.tenantId, ctx.chatId, editsOpen ? m.id : null);
  // «Не проголосовали» — автору и модератору в открытом неанонимном опросе (Ч:138).
  const askLeft = Boolean(m.poll && !m.poll.closed && !m.poll.anonymous && (mine || moderator));
  const members = useMembers(ctx.tenantId, ctx.chatId, askLeft);

  const menu = can
    ? menuOf({
        m,
        mine,
        can,
        policy,
        now: ctx.now,
        pinnedId: ctx.chat.pinned?.id ?? null,
        recordKind: ctx.chat.record?.object.entityType ?? null,
      })
    : [];
  const imp = importantNote(m, mine, moderator);
  const poll = pollView(m, mine, moderator, ctx.chat.memberCount);
  const tick = mine ? tickOf(m, policy.receipts) : null;
  const voted = new Set((m.poll?.options ?? []).flatMap((o) => o.voters ?? []));
  const notVoted = (members.data?.items ?? [])
    .filter((x) => x.state === 'in' && !voted.has(x.member.displayName))
    .map((x) => x.member.displayName);
  const hoursLeft = m.ephemeral
    ? Math.max(1, Math.round((Date.parse(m.ephemeral.expiresAt) - ctx.now) / 3600_000))
    : 0;

  const run = (a: string): void => {
    p.onMenu(null);
    if (a === 'info') p.onInfo(m.id);
    else if (a === 'edit') p.onEdit(m);
    else if (a === 'delete') void ctx.exec(() => deleteMessage(c, m.id, null), T.msg.toast.deleted);
    else if (a === 'deleteMod') {
      setReason('');
      setDelOpen(true);
    } else if (a === 'pin' || a === 'unpin') void ctx.exec(() => pin(c, a === 'pin' ? m.id : null));
    else if (a === 'save') void ctx.exec(() => saveToRecord(c, m.id), T.msg.toast.saved);
    else if (a === 'task') {
      void ctx
        .exec(() => createTask(c, m.id, (m.text || T.chat.attachment).slice(0, 120)))
        .then((r) => {
          if (r) ctx.toast(`${T.msg.taskChip}${r.key} ${T.msg.toast.taskCreated}`, 'ok');
        });
    }
  };

  return (
    <div className="ox-chat-row" data-mine={mine || undefined}>
      <span
        className="ox-chat-ava"
        style={{ background: avatarColor(m.authorMemberId ?? m.authorDisplayName) }}
        aria-hidden="true"
      >
        {initials(m.authorDisplayName)}
      </span>
      <article
        className="ox-chat-bubble"
        data-mine={mine || undefined}
        data-important={m.important ? true : undefined}
        data-selected={p.selected || undefined}
        aria-label={`${T.msg.aria} · ${mine ? T.msg.you : m.authorDisplayName}`}
      >
        <header className="ox-chat-bhead">
          <strong className="ox-chat-who" data-mine={mine || undefined}>
            {mine ? T.msg.you : m.authorDisplayName}
          </strong>
          {p.showTopic ? <span className="ox-chat-topic">{m.topic ?? p.topics[0]}</span> : null}
          <span className="ox-chat-grow" />
          <button
            type="button"
            className="ox-chat-menu-btn"
            aria-label={T.msg.actions}
            aria-haspopup="menu"
            aria-expanded={p.menuOpen}
            onClick={() => p.onMenu(p.menuOpen ? null : m.id)}
          >
            <Icon name="more_horiz" size={18} />
          </button>
        </header>
        {p.menuOpen ? (
          <div className="ox-chat-menu" role="menu" aria-label={T.msg.actions}>
            {menu.map((i) => (
              <button
                key={i.action}
                type="button"
                role="menuitem"
                className="ox-chat-menu-item"
                onClick={() => run(i.action)}
              >
                <Icon name={i.icon} size={18} />
                {i.label}
              </button>
            ))}
          </div>
        ) : null}
        {m.deleted ? (
          <span className="ox-chat-deleted">
            <Icon name="delete" size={16} />
            {m.deleted.moderator
              ? `${T.msg.deletedByModerator}${m.deleted.reason ?? T.msg.noReason}`
              : T.msg.deletedByAuthor}
            {` · ${timeOf(m.deleted.at)}`}
          </span>
        ) : null}
        {!m.deleted && m.important ? (
          <span className="ox-chat-imp-head">
            <Icon name="flag" size={16} />
            {T.msg.important}
            {m.important.dueDate.slice(8, 10)}.{m.important.dueDate.slice(5, 7)}
          </span>
        ) : null}
        {!m.deleted && m.attachments.length ? (
          <div className="ox-chat-files">
            {m.attachments.map((f) => {
              const once = f.viewOnce;
              const [icon, tone] = once
                ? ['lock_clock', 'danger']
                : (FILE_ICON[f.kind] ?? FILE_ICON.doc ?? ['description', 'neutral']);
              const meta = f.gone
                ? T.msg.gone
                : once
                  ? mine
                    ? `${T.msg.onceMine}${f.openedByMe ? 1 : 0}`
                    : f.openedByMe
                      ? T.msg.onceOpened
                      : `${T.msg.onceWatermark}${ctx.meName}»`
                  : sizeLabel(f.sizeBytes) + (f.savedTo ? T.msg.savedTo : '');
              return (
                <div key={f.id} className="ox-chat-file" data-once={once || undefined}>
                  <span className="ox-chat-file-icon" data-tone={tone}>
                    <Icon name={icon ?? 'description'} size={18} />
                  </span>
                  <span className="ox-chat-file-body">
                    <span className="ox-chat-file-name">{f.fileName}</span>
                    <span className="ox-chat-file-meta">{meta}</span>
                  </span>
                  {once && !mine && !f.openedByMe && !f.gone ? (
                    <button
                      type="button"
                      className="ox-chat-btn"
                      onClick={() =>
                        void ctx
                          .exec(() => openOnce(c, f.id))
                          .then(
                            (r) =>
                              r &&
                              ctx.toast(
                                `«${f.fileName}» ${T.msg.toast.onceOpened}${ctx.meName}»`,
                                'ok',
                              ),
                          )
                      }
                    >
                      {T.msg.openOnce}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {!m.deleted && m.document ? (
          <div className="ox-chat-doc">
            <span className="ox-chat-file-icon" data-tone="info">
              <Icon name="description" size={18} />
            </span>
            <span className="ox-chat-file-body">
              <strong className="ox-chat-file-name">{m.document.title}</strong>
              <span className="ox-chat-file-meta">
                {m.document.sub}
                {T.msg.docLive}
              </span>
            </span>
            <button type="button" className="ox-chat-btn" onClick={() => ctx.nav('docs')}>
              {T.msg.open}
            </button>
          </div>
        ) : null}
        {!m.deleted && m.text ? <span className="ox-chat-text">{m.text}</span> : null}
        {!m.deleted && m.masked && !can?.pdn ? (
          <span className="ox-chat-pdn">
            <Icon name="lock" size={15} />
            {T.msg.hiddenPdn}
          </span>
        ) : null}
        {!m.deleted && m.masked && can?.pdn ? (
          <button
            type="button"
            className="ox-chat-btn ox-chat-btn-sm"
            onClick={() => void ctx.exec(() => revealPdn(c, m.id), T.msg.toast.revealed)}
          >
            <Icon name="visibility" size={15} />
            {T.msg.reveal}
          </button>
        ) : null}
        {!m.deleted && m.spoiler ? (
          spoilerShown ? (
            <span className="ox-chat-spoiler-text">{m.spoiler}</span>
          ) : (
            <button type="button" className="ox-chat-spoiler" onClick={() => setSpoilerShown(true)}>
              <Icon name="visibility_off" size={16} />
              {T.msg.spoiler}
            </button>
          )
        ) : null}
        {poll && m.poll ? (
          <div className="ox-chat-poll">
            <span className="ox-chat-poll-tag">
              <Icon name="ballot" size={16} />
              {T.msg.poll}
            </span>
            <strong className="ox-chat-poll-q">{m.poll.question}</strong>
            {poll.options.map((o) => {
              const closed = m.poll?.closed ?? false;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="ox-chat-poll-opt"
                  data-mine={o.mine || undefined}
                  aria-pressed={o.mine}
                  disabled={closed}
                  onClick={() => {
                    const pl = m.poll;
                    if (!pl) return;
                    const mineIds = pl.options.filter((x) => x.mine).map((x) => x.id);
                    const next = pl.multiple
                      ? o.mine
                        ? mineIds.filter((id) => id !== o.id)
                        : [...mineIds, o.id]
                      : [o.id];
                    if (next.length) void ctx.exec(() => votePoll(c, pl.id, next));
                  }}
                >
                  <span className="ox-chat-poll-fill" style={{ width: `${o.pct}%` }} />
                  <Icon
                    name={
                      o.mine
                        ? 'check_circle'
                        : m.poll?.multiple
                          ? 'check_box_outline_blank'
                          : 'radio_button_unchecked'
                    }
                    size={20}
                  />
                  <span className="ox-chat-poll-label">
                    <span className="ox-chat-poll-text">{o.text}</span>
                    {o.voters ? <span className="ox-chat-file-meta">{o.voters}</span> : null}
                  </span>
                  <span className="ox-chat-poll-val">{o.value}</span>
                </button>
              );
            })}
            <span className="ox-chat-file-meta">{poll.meta}</span>
            {askLeft && notVoted.length ? (
              <span className="ox-chat-file-meta">{`${T.msg.notVoted}${notVoted.join(', ')}`}</span>
            ) : null}
            {poll.canClose ? (
              <button
                type="button"
                className="ox-chat-btn ox-chat-btn-sm"
                onClick={() => {
                  const pl = m.poll;
                  if (pl) void ctx.exec(() => closePoll(c, pl.id), T.msg.toast.pollClosed);
                }}
              >
                {T.msg.closePoll}
              </button>
            ) : null}
          </div>
        ) : null}
        {!m.deleted && imp ? (
          <div className="ox-chat-imp">
            <span className="ox-chat-imp-text">{imp.text}</span>
            {imp.canAck ? (
              <button
                type="button"
                className="ox-chat-ack"
                onClick={() => void ctx.exec(() => ackMessage(c, m.id), T.msg.toast.acked)}
              >
                <Icon name="task_alt" size={20} />
                {T.msg.ack}
              </button>
            ) : null}
          </div>
        ) : null}
        {delOpen ? (
          <div className="ox-chat-del">
            <span className="ox-chat-del-title">{T.msg.delReasonTitle}</span>
            <input
              className="ox-chat-input"
              value={reason}
              aria-label={T.msg.delReasonAria}
              placeholder={T.msg.delReasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="ox-chat-del-actions">
              <button type="button" className="ox-chat-btn" onClick={() => setDelOpen(false)}>
                {T.msg.cancel}
              </button>
              <Button
                variant="danger"
                size="compact"
                onPress={() =>
                  void ctx
                    .exec(() => deleteMessage(c, m.id, reason.trim()), T.msg.toast.deletedMod)
                    .then((r) => r && setDelOpen(false))
                }
              >
                {T.msg.deleteAll}
              </Button>
            </span>
          </div>
        ) : null}
        {editsOpen && versions.data ? (
          <div className="ox-chat-edits">
            <span className="ox-chat-edits-title">{T.msg.editHistory}</span>
            {versions.data.items.map((v) => (
              <span key={v.editedAt + v.text}>
                {timeOf(v.editedAt)} — {v.text}
              </span>
            ))}
          </div>
        ) : null}
        <footer className="ox-chat-bfoot">
          {m.ephemeral ? (
            <span className="ox-chat-temp">
              <Icon name="timer" size={15} />
              {T.msg.expires}
              {hoursLeft}
              {T.msg.hoursShort}
            </span>
          ) : null}
          {m.attachments.some((f) => f.savedTo) ? (
            <span className="ox-chat-chip">
              <Icon name="inventory_2" size={15} />
              {T.msg.savedChip}
            </span>
          ) : null}
          {m.tasks.map((t) => (
            <span key={t.taskId} className="ox-chat-chip">
              <Icon name="task_alt" size={15} />
              {T.msg.taskChip}
              {t.key}
            </span>
          ))}
          {m.visibleOnlyToMe ? (
            <span className="ox-chat-file-meta">{T.msg.visibleOnlyToMe}</span>
          ) : null}
          {m.editedAt && !m.deleted ? (
            <button type="button" className="ox-chat-link" onClick={() => setEditsOpen((v) => !v)}>
              {T.msg.edited}
            </button>
          ) : null}
          <span className="ox-chat-grow" />
          <span>{timeOf(m.createdAt)}</span>
          {tick ? (
            <button
              type="button"
              className="ox-chat-tick"
              data-read={tick.icon === 'done_all' || undefined}
              onClick={() => p.onInfo(m.id)}
            >
              <Icon name={tick.icon} size={15} />
              {tick.text}
            </button>
          ) : null}
        </footer>
      </article>
    </div>
  );
}
