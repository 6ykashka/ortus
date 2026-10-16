// W1.22 · Панель входящих в слоте шапки (S1-26; контракт C-7 W1.20 — `export default`, оболочка подхватывает файл
// сама). Вид — поповер «Уведомления» эталона («Ортус CRM.dc.html» :124–135): заголовок, «Прочитать все», строки с
// точкой непрочитанного и временем (только `title`: `body` события в поповере эталона нет), «Новых событий нет».
// Сверх эталона (no-reference, B-6 №4): переход к записи по `link` (путь внутри организации; цель авторизуется заново
// при открытии) с отметкой события прочитанным, страницы по курсору («Показать ещё»), ошибка и нет связи с
// «Повторить». Ключ ленты — под префиксом NOTIFICATIONS_KEY: подсказка канала notifications.changed (W1.49)
// перечитывает её вместе со счётчиком.
import './inbox.css';

import { type components, unwrap } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { MouseEvent, ReactElement } from 'react';

import { useApi } from '../../app/api.tsx';
import { type InboxPanelProps, notificationsKey } from '../../shell/inbox.tsx';
import { NOTIFICATION_SUMMARY_KEY } from '../../shell/me.ts';
import { problemText, useBusy, useRun } from '../../shell/run.tsx';
import { INBOX_TEXT as T } from './texts.ts';

type Notification = components['schemas']['Notification'];

/** Размер страницы — 12 последних событий, как поповер эталона (:3044). */
export const PAGE_SIZE = 12;

/** Время события — ЧЧ:ММ, как `{{ n.at }}` поповера эталона (`hhmm()`, ortus/api.js:18); дата — в `datetime`. */
const AT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

const feedKey = (tenantId: string) => [...notificationsKey(tenantId), 'feed'] as const;

function Row({
  n,
  href,
  onOpen,
}: {
  n: Notification;
  href: string | null;
  onOpen: (n: Notification, href: string) => void;
}): ReactElement {
  const unread = n.readAt === null;
  const body = (
    <>
      <span className="ox-inbox-dot" aria-hidden="true" />
      <div className="ox-inbox-body">
        <div className="ox-inbox-text">{n.title}</div>
        <div className="ox-inbox-at">
          <time dateTime={n.createdAt}>{AT.format(new Date(n.createdAt))}</time>
        </div>
      </div>
    </>
  );
  if (href === null) {
    return (
      <div className="ox-inbox-item" data-unread={unread || undefined}>
        {body}
      </div>
    );
  }
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(n, href);
  };
  return (
    <a
      className="ox-inbox-item"
      data-unread={unread || undefined}
      href={href}
      aria-label={unread ? format(T.unread, { title: n.title }) : n.title}
      onClick={open}
    >
      {body}
    </a>
  );
}

export default function InboxPanel({
  tenantId,
  unreadCount,
  onClose,
}: InboxPanelProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const router = useRouter();
  const busy = useBusy('readAllNotifications');

  const feed = useInfiniteQuery({
    queryKey: feedKey(tenantId),
    retry: false,
    initialPageParam: null as string | null,
    getNextPageParam: (last: components['schemas']['NotificationPage']) => last.nextCursor,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/me/notifications', {
          params: {
            query: { tenantId, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const latest = items[0]?.createdAt;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY }),
      qc.invalidateQueries({ queryKey: notificationsKey(tenantId) }),
    ]);

  const markRead = (key: string, body: { notificationIds: string[] } | { upTo: string }) =>
    run(key, async () =>
      unwrap(
        await api.POST('/api/v1/me/notifications/read', {
          params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
          body: { tenantId, ...body },
        }),
      ),
    )
      .then(refresh)
      .catch(() => null);

  // Кнопка всегда активна, как в эталоне (:126); без непрочитанных или во время отметки — ничего не делает.
  const readAll = () => {
    if (busy || unreadCount === 0 || !latest) return;
    void markRead('readAllNotifications', { upTo: latest });
  };

  const open = (n: Notification, href: string) => {
    if (n.readAt === null) void markRead('readNotification', { notificationIds: [n.id] });
    onClose();
    void router.navigate({ href });
  };

  // Сбой ленты: без событий — вместо списка; при догрузке («Показать ещё») или перечитывании — под событиями,
  // «Повторить» повторяет то, что не удалось.
  const failure = (
    <div className="ox-inbox-state" role="alert">
      <span>
        {T.loadError} {problemText(feed.error)}
      </span>
      <button
        type="button"
        className="ox-inbox-retry"
        onClick={() => void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())}
      >
        {T.retry}
      </button>
    </div>
  );

  return (
    <>
      <div className="ox-popover-head">
        <strong className="ox-popover-title">{shell.a11y.notifications}</strong>
        <button type="button" className="ox-link-button ox-inbox-read" onClick={readAll}>
          {shell.popovers.readAll}
        </button>
      </div>
      {feed.isPending ? (
        <div className="ox-inbox-state" role="status">
          {T.loading}
        </div>
      ) : null}
      {feed.isError && items.length === 0 ? failure : null}
      {feed.isSuccess && items.length === 0 ? (
        <div className="ox-popover-empty">{shell.popovers.empty}</div>
      ) : null}
      {items.map((n) => (
        <Row key={n.id} n={n} href={n.link ? `/t/${tenantId}${n.link}` : null} onOpen={open} />
      ))}
      {feed.isError && items.length > 0 ? failure : null}
      {feed.hasNextPage && !feed.isFetchNextPageError ? (
        <button
          type="button"
          className="ox-inbox-more"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? T.moreLoading : T.more}
        </button>
      ) : null}
    </>
  );
}
