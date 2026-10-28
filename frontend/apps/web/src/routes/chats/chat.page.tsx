// W7.13 · Страница «Чаты» (ключи chats, chats-policies, modal-chat-new; маршрут `/t/:tenantId/chat`; эталон design-2026-10-19
// «Чаты.dc.html»). Раскладка — по ширине контейнера, не окна: < 760 одна колонка (список → чат → сведения), ≥ 760 список
// 290 px + чат, «Сведения» заменяют чат, ≥ 1100 три колонки. Состояние в URL: `?chat=<id>&side=info|msg|rights|store&msg=<id>`
// и `?tab=policy`. Права и итоги считает сервер (`my.can`); backend чатов — W7.11, страница живёт на MSW W7.00.
import { ProblemError } from '@ortus/api-client';
import { Button, EmptyState, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { AccessGate } from '../../shell/AccessGate.tsx';
import { useCan, useShell } from '../../shell/context.tsx';
import { problemCode, problemText } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { chatKey, useChat, useChats, useDirectory, useMessages } from './api.ts';
import type { ChatCtx, ChatsCtx } from './ctx.ts';
import { ChatList } from './list.tsx';
import { type Folder, layoutOf, pageSub } from './model.ts';
import { NewChat } from './new-chat.tsx';
import { Policies } from './policies.tsx';
import { SIDES, type Side, SidePanel } from './side.tsx';
import { CHAT_TEXT as T } from './texts.ts';
import { Thread } from './thread.tsx';
import './chats.css';

const NO_PERMISSION = {
  kind: 'deny',
  reason: 'no_permission',
  branch: 'A',
  chip: 'noPermission',
  title: 'noRole',
  domainModule: 'chat',
  label: null,
  owner: false,
} as const;

interface ChatSearch {
  chat?: string;
  side?: Side;
  msg?: string;
  tab?: 'policy';
}

const searchOf = (raw: Record<string, unknown>): ChatSearch => ({
  ...(typeof raw.chat === 'string' && raw.chat ? { chat: raw.chat } : {}),
  ...(SIDES.includes(raw.side as Side) ? { side: raw.side as Side } : {}),
  ...(typeof raw.msg === 'string' && raw.msg ? { msg: raw.msg } : {}),
  ...(raw.tab === 'policy' ? { tab: 'policy' as const } : {}),
});

const NAV: Record<string, string> = { fleet: 'fleet', repair: 'repair', docs: 'docs' };

export default function ChatPage(): ReactElement {
  const { tenantId: id, audience, tenant, me } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const search = searchOf(location.search as Record<string, unknown>);
  const [folder, setFolder] = useState<Folder>('all');
  const [q, setQ] = useState('');
  const [width, setWidth] = useState(1200);
  const [now, setNow] = useState(() => Date.now());
  const [alertText, setAlertText] = useState('');
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const rootRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => {
      const w = Math.round(es[0]?.contentRect.width ?? 0);
      if (w) setWidth((cur) => (Math.abs(cur - w) > 8 ? w : cur));
    });
    ro.observe(el);
  }, []);

  const layout = layoutOf(width);
  const owner = can('chat.policy.manage');
  const canCreate = can('chat.create', 'chat.direct');
  const all = useChats(tenantId, 'all', '');
  const list = useChats(tenantId, folder, q.trim());
  const dir = useDirectory(tenantId, {
    units: can('org_units.read'),
    members: can('members.read'),
    roles: can('roles.read'),
  });
  const items = list.data?.items ?? [];
  const selId = search.chat ?? (layout !== 'narrow' ? (items[0]?.id ?? null) : null);
  const selValid = selId !== null && (all.data?.items ?? items).some((c) => c.id === selId);
  const chatId = selValid ? selId : null;
  const chat = useChat(tenantId, chatId);
  const messages = useMessages(tenantId, chatId);

  const go = useCallback(
    (patch: Partial<Record<keyof ChatSearch, string | undefined>>, replace = false): void => {
      const next = { ...search, ...patch };
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'chat' },
        search: clean as never,
        replace,
      });
    },
    [navigate, search, tenantId],
  );

  const refresh = useCallback(
    (): Promise<unknown> => qc.invalidateQueries({ queryKey: [...chatKey(tenantId)] }),
    [qc, tenantId],
  );
  const exec = useCallback(
    async <R,>(fn: () => Promise<R>, ok?: string): Promise<R | null> => {
      setBusy(true);
      setAlertText('');
      try {
        const r = await fn();
        if (ok) toast(ok, 'ok');
        await refresh();
        return r;
      } catch (e) {
        const detail = e instanceof ProblemError ? e.problem?.detail : undefined;
        setAlertText(detail || problemText(e));
        if (['not_found', 'revision_mismatch', 'invalid_transition'].includes(problemCode(e))) {
          void refresh();
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  const ctx: ChatsCtx = useMemo(
    () => ({
      api,
      tenantId,
      meName: me.displayName,
      memberId: tenant?.membershipId ?? null,
      userId: me.userId,
      now,
      dir: dir.data ?? { units: [], members: [], groups: [], roles: [] },
      owner,
      canCreate,
      exec,
      refresh,
      alert: setAlertText,
      busy,
      toast,
      nav: (target) => {
        const seg = NAV[target] ?? target;
        void navigate({
          to: '/t/$tenantId/$page',
          params: { tenantId, page: seg === 'fleet' && audience === 'driver' ? 'today' : seg },
        });
      },
    }),
    [
      api,
      tenantId,
      me.displayName,
      me.userId,
      tenant,
      now,
      dir.data,
      owner,
      canCreate,
      exec,
      refresh,
      busy,
      toast,
      navigate,
      audience,
    ],
  );

  if (all.isError && problemCode(all.error) === 'forbidden_action') {
    return <AccessGate access={NO_PERMISSION} />;
  }

  const sideOpen = Boolean(search.side) && chatId !== null && search.tab !== 'policy';
  const showSide = sideOpen;
  const showChat = chatId !== null && !(showSide && layout !== 'three');
  const showList = layout !== 'narrow' || chatId === null;
  const showNoChat = layout !== 'narrow' && chatId === null && !list.isPending;
  const cols =
    layout === 'narrow'
      ? '1fr'
      : showSide && layout === 'three'
        ? '290px minmax(0,1fr) 330px'
        : '290px minmax(0,1fr)';

  const modulesOff = (['fleet', 'repairs'] as const).some(
    (k) => !tenant?.modules.some((m) => m.moduleKey === k && m.state === 'active'),
  );
  const counts = {
    direct: 0,
    group: 0,
    area: 0,
    record: 0,
    announce: 0,
    ...Object.fromEntries(
      ['direct', 'group', 'area', 'record', 'announce'].map((k) => [
        k,
        (all.data?.items ?? []).filter((c) => c.kind === k).length,
      ]),
    ),
  } as Record<'direct' | 'group' | 'area' | 'record' | 'announce', number>;

  const chatCtx: ChatCtx | null = chat.data && chatId ? { ...ctx, chat: chat.data, chatId } : null;
  const sideMsg = messages.data?.items.find((m) => m.id === search.msg) ?? null;
  const title =
    (all.data?.items ?? items).find((c) => c.id === chatId)?.title ?? chat.data?.title ?? '';
  const peerId = chat.data?.peer?.memberId ?? null;

  const open = (cid: string): void => {
    setNewOpen(false);
    go({
      chat: cid,
      side: layout === 'narrow' ? undefined : search.side,
      msg: undefined,
      tab: undefined,
    });
  };

  const messagesBody = (
    <div className="ox-chat-grid" style={{ gridTemplateColumns: cols }} data-layout={layout}>
      {showList ? (
        <ChatList
          items={items}
          counts={list.data?.counts ?? all.data?.counts ?? null}
          status={list.status}
          total={all.data?.items.length ?? 0}
          folder={folder}
          q={q}
          selected={chatId}
          meName={me.displayName}
          now={now}
          hiddenNote={owner && modulesOff}
          onFolder={setFolder}
          onQ={setQ}
          onOpen={open}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {showNoChat ? <div className="ox-chat-none">{T.chat.select}</div> : null}
      {chatId !== null && chat.isPending && showChat ? (
        <div className="ox-chat-main">
          <Skeleton lines={6} label={T.chat.loading} />
        </div>
      ) : null}
      {chatId !== null && chat.isError && showChat ? (
        <div className="ox-chat-main">
          {problemCode(chat.error) === 'forbidden_action' ? (
            <div role="alert" className="ox-chat-feed-note">
              <EmptyState icon="lock" title={T.chat.chatForbidden} />
            </div>
          ) : (
            <EmptyState
              icon="forum"
              title={T.loadFailed}
              action={{ label: T.retry, onPress: () => void chat.refetch() }}
            />
          )}
        </div>
      ) : null}
      {chatCtx && showChat ? (
        <Thread
          ctx={chatCtx}
          title={title}
          peerId={peerId}
          narrow={layout === 'narrow'}
          infoOpen={showSide}
          msgSel={search.msg ?? null}
          onBack={() => go({ chat: undefined, side: undefined, msg: undefined })}
          onInfo={() => go({ side: search.side ? undefined : 'info', msg: undefined })}
          onMsgInfo={(mid) => go({ side: 'msg', msg: mid })}
        />
      ) : null}
      {chatCtx && showSide ? (
        <SidePanel
          ctx={chatCtx}
          side={search.side ?? 'info'}
          message={sideMsg}
          onSide={(s) => go({ side: s })}
          onClose={() => go({ side: undefined, msg: undefined })}
        />
      ) : null}
    </div>
  );

  return (
    <section aria-labelledby="h-chat" className="ox-chat" ref={rootRef} data-layout={layout}>
      <div className="ox-chat-top">
        <div className="ox-chat-top-text">
          <h1 id="h-chat" className="ox-chat-title" tabIndex={-1}>
            {T.title}
          </h1>
          <span className="ox-chat-sub">{pageSub(all.data?.items ?? [])}</span>
        </div>
        <div className="ox-chat-top-actions">
          {owner
            ? (['chats', 'policy'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="ox-chat-tabbtn"
                  aria-pressed={(search.tab === 'policy') === (id === 'policy')}
                  onClick={() =>
                    go({
                      tab: id === 'policy' ? 'policy' : undefined,
                      side: undefined,
                      msg: undefined,
                    })
                  }
                >
                  {T.tabs[id]}
                </button>
              ))
            : null}
          {canCreate ? (
            <Button icon="add_comment" onPress={() => setNewOpen(true)}>
              {T.newChat}
            </Button>
          ) : null}
        </div>
      </div>
      {alertText ? (
        <div role="alert" className="ox-chat-alert">
          <Icon name="error" size={18} />
          <span className="ox-chat-grow">{alertText}</span>
          <button type="button" aria-label="Закрыть" onClick={() => setAlertText('')}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}
      {owner && search.tab === 'policy' ? <Policies ctx={ctx} counts={counts} /> : messagesBody}
      <NewChat
        ctx={ctx}
        open={newOpen}
        ownUnit={owner ? null : (tenant?.orgUnitIds[0] ?? null)}
        onClose={() => setNewOpen(false)}
        onCreated={(cid) => {
          setNewOpen(false);
          go({ chat: cid, side: undefined, msg: undefined, tab: undefined });
        }}
      />
    </section>
  );
}
