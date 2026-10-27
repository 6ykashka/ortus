// W6.23 · Страница «График» объекта вне карточки: `/t/:tenantId/repair/:projectId/schedule` (ADR-0001; вкладка «График»
// карточки объекта — W6.20 — встраивает `ScheduleTab` без этого маршрута). Крошка эталона «Ремонт и стройка › Объекты ›
// {имя}», доступ — как у страницы «Объекты» (модуль подключён, роль с правом `repairs.schedule.read`).
import { ProblemError } from '@ortus/api-client';
import { canAny, navContext, pageAccess } from '@ortus/domain/nav';
import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { useMe } from '../../../../shell/me.ts';
import { ToastHost } from '../../../../shell/toast.tsx';
import { problemText } from '../../../../shell/run.tsx';
import {
  BootSkeleton,
  GlobalNotFound,
  LoadError,
  SignInNeeded,
} from '../../../../shell/states.tsx';
import { useProject } from './api.ts';
import { ScheduleTab } from './ScheduleTab.tsx';
import { GANTT_TEXT as T } from './texts.ts';
import './gantt.css';

export default function ScheduleScreen(): ReactElement {
  const { tenantId = '', projectId = '' } = useParams({ strict: false }) as {
    tenantId?: string;
    projectId?: string;
  };
  const me = useMe();
  const project = useProject(tenantId, projectId);
  if (me.isPending) return <BootSkeleton />;
  if (me.isError) {
    if (me.error instanceof ProblemError && me.error.status === 401) return <SignInNeeded />;
    return <LoadError text={problemText(me.error)} />;
  }
  const tenant = me.data.tenants.find(
    (t) => t.tenantId === tenantId && t.membershipStatus === 'active',
  );
  if (!tenant) return <GlobalNotFound />;
  const ctx = navContext(tenant, false);
  const access = pageAccess(ctx, 'repair');
  const can = (...p: string[]): boolean => canAny(ctx, p);
  if (access.kind !== 'allow' || !can('repairs.schedule.read')) {
    return (
      <main className="ox-gt-screen">
        <p role="alert">{T.noAccess}</p>
      </main>
    );
  }
  return (
    <main className="ox-gt-screen">
      <nav aria-label="Крошка" className="ox-gt-crumb">
        <span>{T.crumb.module}</span>
        <span aria-hidden="true">›</span>
        <Link to="/t/$tenantId/$page" params={{ tenantId, page: 'repair' }}>
          {T.crumb.objects}
        </Link>
        {project.data ? (
          <>
            <span aria-hidden="true">›</span>
            <span>{project.data.name}</span>
          </>
        ) : null}
      </nav>
      <ScheduleTab
        tenantId={tenantId}
        projectId={projectId}
        can={can}
        readOnly={access.readOnly}
        headingLevel={1}
      />
      <ToastHost />
    </main>
  );
}
