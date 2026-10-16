// W1.20 · Экран маршрутов оболочки (ADR-0001): `/t/:tenantId/:page`, `/platform/:page`, `/` (редирект).
// До ответа /me/context — шапка загрузки и скелетон; 401 — «Нужен вход»; сбой — ошибка загрузки; чужая или
// неизвестная организация — «Страница не найдена» (тем же ответом, что неизвестный маршрут).
import { type MeContext, ProblemError } from '@ortus/api-client';
import { type Area, buildNav, defaultPage, navContext, pageBySegment } from '@ortus/domain/nav';
import { Navigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';

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

function useMeState(): { me?: MeContext; screen?: ReactElement } {
  const q = useMe();
  if (q.isPending) return { screen: <BootFrame /> };
  if (q.isError) {
    if (q.error instanceof ProblemError && q.error.status === 401) {
      return { screen: <SignInNeeded /> };
    }
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
  const { me, screen } = useMeState();
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
