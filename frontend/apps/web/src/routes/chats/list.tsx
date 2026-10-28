// W7.13 · Список чатов (C-3): поиск, папки со счётчиками, строки с последним сообщением, «Подтвердить» и непрочитанные.
// Эталон `Чаты.dc.html` :40–56, rows :516–518.
import type { components } from '@ortus/api-client';
import { Icon, Skeleton } from '@ortus/ui';
import type { ReactElement } from 'react';

import { Avatar } from './thread.tsx';
import { FOLDERS, type Folder, lastLine, listTime } from './model.ts';
import { CHAT_TEXT as T } from './texts.ts';

type S = components['schemas'];

export interface ListProps {
  items: readonly S['ChatSummary'][] | null;
  counts: S['ChatFolderCounts'] | null;
  status: 'pending' | 'error' | 'success';
  total: number;
  folder: Folder;
  q: string;
  selected: string | null;
  meName: string;
  now: number;
  hiddenNote: boolean;
  onFolder: (f: Folder) => void;
  onQ: (q: string) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}

export function ChatList(p: ListProps): ReactElement {
  return (
    <aside className="ox-chat-list" aria-label={T.list.aria}>
      <label className="ox-chat-search">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={p.q}
          placeholder={T.list.search}
          aria-label={T.list.searchAria}
          onChange={(e) => p.onQ(e.target.value)}
        />
      </label>
      <div className="ox-chat-folders" role="group" aria-label={T.list.foldersAria}>
        {FOLDERS.map((f) => (
          <button
            key={f}
            type="button"
            className="ox-chat-folder"
            aria-pressed={p.folder === f}
            onClick={() => p.onFolder(f)}
          >
            {T.folders[f]}
            {p.counts ? <span className="ox-chat-folder-n">{p.counts[f]}</span> : null}
          </button>
        ))}
      </div>
      <ul className="ox-chat-rows">
        {p.status === 'pending' ? (
          <li>
            <Skeleton lines={5} label={T.loading} />
          </li>
        ) : null}
        {p.status === 'error' ? (
          <li className="ox-chat-list-note" role="alert">
            {T.loadFailed}{' '}
            <button type="button" className="ox-chat-link" onClick={p.onRetry}>
              {T.retry}
            </button>
          </li>
        ) : null}
        {(p.items ?? []).map((c) => {
          const peerName = c.kind === 'direct' ? c.title : '';
          return (
            <li key={c.id}>
              <button
                type="button"
                className="ox-chat-row-btn"
                aria-current={p.selected === c.id ? 'true' : undefined}
                onClick={() => p.onOpen(c.id)}
              >
                <Avatar
                  kind={c.kind}
                  record={c.record}
                  title={peerName || c.title}
                  peerId={c.peer?.memberId ?? null}
                  size={40}
                />
                <span className="ox-chat-row-text">
                  <strong className="ox-chat-row-title">{c.title}</strong>
                  <span className="ox-chat-row-last">{lastLine(c, p.meName)}</span>
                </span>
                <span className="ox-chat-row-side">
                  <span className="ox-chat-row-time">
                    {c.lastMessage ? listTime(c.lastMessage.at, p.now) : ''}
                  </span>
                  {c.my.ackWaitCount > 0 ? (
                    <span className="ox-chat-badge ox-chat-badge-ack">{T.list.ack}</span>
                  ) : null}
                  {c.my.unread > 0 ? (
                    <span className="ox-chat-badge" aria-label={`${c.my.unread}`}>
                      {c.my.unread}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.status === 'success' && !(p.items ?? []).length ? (
        <span className="ox-chat-list-note">{p.total ? T.list.empty : T.list.emptyAll}</span>
      ) : null}
      {p.hiddenNote ? (
        <span className="ox-chat-hidden-note">
          <Icon name="info" size={16} />
          <span>{T.list.hidden}</span>
        </span>
      ) : null}
    </aside>
  );
}
