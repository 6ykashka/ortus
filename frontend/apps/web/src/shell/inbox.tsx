// W1.20 · Слот входящих в шапке (S1-26, контракт C-7 брифа): кнопка «Уведомления[: N новых]» (:117–120) со
// счётчиком непрочитанных текущей организации (getMyNotificationSummary) и поповер «Уведомления» (:124–135).
// Панель — W1.22: файл `src/features/inbox/InboxPanel.tsx` с `export default` подхватывается без правок
// оболочки. До него — поповер эталона: события организации (listMyNotifications, точка непрочитанного),
// «Прочитать все» (markMyNotificationsRead до последнего события), «Новых событий нет» без событий.
// Ошибки счётчика «тихие» (стенд до W1.10 отвечает 501).
import { unwrap } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ComponentType, lazy, type ReactElement, Suspense } from 'react';

import { useApi } from '../app/api.tsx';
import { NOTIFICATION_SUMMARY_KEY } from './me.ts';
import { useBusy, useRun } from './run.tsx';

export interface InboxPanelProps {
  tenantId: string;
  unreadCount: number;
  onClose: () => void;
}

const panels = import.meta.glob<{ default: ComponentType<InboxPanelProps> }>(
  '../features/inbox/InboxPanel.tsx',
);
const load = Object.values(panels)[0];
const Panel = load ? lazy(load) : null;

/** Ключ списка входящих организации (поповер оболочки до панели W1.22). */
export const notificationsKey = (tenantId: string) => ['me', 'notifications', tenantId] as const;

export function useUnreadCount(tenantId: string | null): number {
  const api = useApi();
  const q = useQuery({
    queryKey: NOTIFICATION_SUMMARY_KEY,
    enabled: tenantId !== null,
    retry: false,
    queryFn: async () => unwrap(await api.GET('/api/v1/me/notifications/summary')),
  });
  return q.data?.tenants.find((t) => t.tenantId === tenantId)?.unreadCount ?? 0;
}

export function InboxButton(p: {
  count: number;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="ox-bell"
      aria-label={format(shell.header.bell, { count: p.count })}
      aria-expanded={p.open}
      onClick={p.onToggle}
    >
      <Icon name="notifications" size={22} />
      {p.count > 0 ? <span className="ox-bell-count">{p.count}</span> : null}
    </button>
  );
}

const AT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Поповер эталона до панели W1.22: последние 12 событий (:3044), «Прочитать все». */
function DefaultPanel({ tenantId, unreadCount }: InboxPanelProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('readAllNotifications');
  const list = useQuery({
    queryKey: notificationsKey(tenantId),
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/me/notifications', {
          params: { query: { tenantId, limit: 12 } },
        }),
      ),
  });
  const items = list.data?.items ?? [];
  const latest = items[0]?.createdAt;

  // Кнопка всегда активна, как в эталоне (:126); без непрочитанных или во время отметки — ничего не делает.
  const readAll = () => {
    if (busy || unreadCount === 0 || !latest) return;
    void run('readAllNotifications', async () =>
      unwrap(
        await api.POST('/api/v1/me/notifications/read', {
          params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
          body: { tenantId, upTo: latest },
        }),
      ),
    )
      .then(() =>
        Promise.all([
          qc.invalidateQueries({ queryKey: NOTIFICATION_SUMMARY_KEY }),
          qc.invalidateQueries({ queryKey: notificationsKey(tenantId) }),
        ]),
      )
      .catch(() => null);
  };

  return (
    <>
      <div className="ox-popover-head">
        <strong className="ox-popover-title">{shell.a11y.notifications}</strong>
        <button type="button" className="ox-link-button" onClick={readAll}>
          {shell.popovers.readAll}
        </button>
      </div>
      {list.isSuccess && items.length === 0 ? (
        <div className="ox-popover-empty">{shell.popovers.empty}</div>
      ) : null}
      {items.map((n) => (
        <div key={n.id} className="ox-inbox-item" data-unread={n.readAt === null || undefined}>
          <span className="ox-inbox-dot" aria-hidden="true" />
          <div className="ox-inbox-body">
            <div className="ox-inbox-text">{n.title}</div>
            <div className="ox-inbox-at">{AT.format(new Date(n.createdAt))}</div>
          </div>
        </div>
      ))}
    </>
  );
}

export function InboxPopover(props: InboxPanelProps): ReactElement {
  return (
    <div
      className="ox-popover"
      data-kind="notifications"
      role="dialog"
      aria-label={shell.a11y.notifications}
    >
      {Panel ? (
        <Suspense fallback={<DefaultPanel {...props} />}>
          <Panel {...props} />
        </Suspense>
      ) : (
        <DefaultPanel {...props} />
      )}
    </div>
  );
}
