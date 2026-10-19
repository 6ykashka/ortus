// W1.20 · Экран маршрутов оболочки (ADR-0001): `/t/:tenantId/:page`, `/platform/:page`, `/` (редирект).
// До ответа /me/context — шапка загрузки и скелетон; 401 — «Нужен вход»; сбой — ошибка загрузки; чужая или
// неизвестная организация — «Страница не найдена» (тем же ответом, что неизвестный маршрут).
import { type MeContext, ProblemError } from '@ortus/api-client';
import { type Area, buildNav, defaultPage, navContext, pageBySegment } from '@ortus/domain/nav';
import { Navigate } from '@tanstack/react-router';
import { type ReactElement, useEffect, useRef, useSyncExternalStore } from 'react';

import { T } from '../app/texts.ts';
import { AppShell, BootFrame } from './AppShell.tsx';
import { startTenant, useMe } from './me.ts';
import { pageTarget, type ShellTarget } from './paths.ts';
import { problemText } from './run.tsx';
import { GlobalNotFound, SignInNeeded } from './states.tsx';

/** Путь старта: оператор — «Организации», иначе стартовая страница организации по умолчанию (S1-07). */
export function startTarget(me: MeContext): ShellTarget | null {
  const tenant = me.platformOperator && me.tenants.length === 0 ? undefined : startTenant(me);
  if (!tenant) return me.platformOperator ? pageTarget('platform', null, 'tenants') : null;
  return pageTarget('tenant', tenant.tenantId, defaultPage(buildNav(navContext(tenant, false))));
}

/** Связь (`navigator.onLine`) без тоста useOnline — тост «Нет связи» показывает оболочка (AppShell). */
const onLine = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);
function subscribeOnline(fn: () => void): () => void {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

/**
 * W2.24 (возврат 2): перезапуск без связи — /me/context не приходит (запрос ждёт связи или упал сетевым сбоем):
 * кадр загрузки с «Нет связи.» вместо вечного скелетона или ошибки загрузки; связь появилась — запрос снова.
 */
function useMeState(tenantId: string | null = null): { me?: MeContext; screen?: ReactElement } {
  const q = useMe();
  const online = useSyncExternalStore(subscribeOnline, onLine, () => true);
  const { isError, refetch } = q;
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current && isError) void refetch();
    wasOffline.current = false;
  }, [online, isError, refetch]);
  const offline = !online || q.fetchStatus === 'paused';
  if (q.isPending) return { screen: <BootFrame offline={offline} tenantId={tenantId} /> };
  if (q.isError) {
    if (q.error instanceof ProblemError && q.error.status === 401) {
      return { screen: <SignInNeeded /> };
    }
    if (offline) return { screen: <BootFrame offline tenantId={tenantId} /> };
    return { screen: <BootFrame error={problemText(q.error)} /> };
  }
  return { me: q.data };
}

export function IndexScreen(): ReactElement {
  const { me, screen } = useMeState();
  if (!me) return screen as ReactElement;
  const target = startTarget(me);
  if (!target) return <p role="status">{T.noTenants}</p>;
  return <Navigate {...target} replace />;
}

export function ShellScreen({
  area,
  tenantId,
  segment,
}: {
  area: Area;
  tenantId?: string;
  segment?: string;
}): ReactElement {
  const { me, screen } = useMeState(tenantId ?? null);
  if (!me) return screen as ReactElement;
  const tenant =
    area === 'tenant'
      ? me.tenants.find((t) => t.tenantId === tenantId && t.membershipStatus === 'active')
      : undefined;
  if ((area === 'tenant' && !tenant) || (area === 'platform' && !me.platformOperator)) {
    return <GlobalNotFound />;
  }
  if (segment === undefined) {
    const page = defaultPage(buildNav(navContext(tenant ?? null, me.platformOperator)));
    return <Navigate {...pageTarget(area, tenantId ?? null, page)} replace />;
  }
  const entry = pageBySegment(area, segment);
  return <AppShell me={me} area={area} tenant={tenant ?? null} page={entry?.key ?? null} />;
}
