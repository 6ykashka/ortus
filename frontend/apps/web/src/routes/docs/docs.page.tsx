// W7.25 · Страница «Документы» (ключи `docs-list`, `docs-doc`, `modal-doc-share`, `docs-folders`; маршрут
// `/t/:tenantId/docs`; эталон design-2026-10-19 «Документы.dc.html»). Список — по умолчанию, карточка — `?doc=<id>`,
// вкладка панели — `?tab=`, отбор и папка списка — `?filter=` и `?folder=`. Права и видимость — на сервере
// (недоступный документ неотличим от отсутствующего: «Документ недоступен»).
import { ProblemError } from '@ortus/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useEffect, useState } from 'react';

import { AccessGate } from '../../shell/AccessGate.tsx';
import { useShell } from '../../shell/context.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import { docsKey, useFolders } from './api.ts';
import { DocCard } from './card.tsx';
import type { DocsCtx, DocsSearch } from './ctx.ts';
import { DocList } from './list.tsx';
import './docs.css';

const NO_PERMISSION = {
  kind: 'deny',
  reason: 'no_permission',
  branch: 'A',
  chip: 'noPermission',
  title: 'noRole',
  domainModule: 'docs',
  label: null,
  owner: false,
} as const;

const FILTERS = new Set(['mine', 'shared', 'route', 'archive']);
const TABS = new Set(['talk', 'versions', 'data', 'tools']);

const searchOf = (raw: Record<string, unknown>): DocsSearch => ({
  ...(typeof raw.doc === 'string' && raw.doc ? { doc: raw.doc } : {}),
  ...(typeof raw.filter === 'string' && FILTERS.has(raw.filter)
    ? { filter: raw.filter as NonNullable<DocsSearch['filter']> }
    : {}),
  ...(typeof raw.folder === 'string' && raw.folder ? { folder: raw.folder } : {}),
  ...(typeof raw.tab === 'string' && TABS.has(raw.tab)
    ? { tab: raw.tab as NonNullable<DocsSearch['tab']> }
    : {}),
});

function useOnlineState(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const sync = (): void => setOn(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return on;
}

export default function DocsPage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const online = useOnlineState();
  const search = searchOf(location.search as Record<string, unknown>);
  const [now] = useState(() => Date.now());
  const folders = useFolders(tenantId);

  const go: DocsCtx['go'] = (patch, replace = false) => {
    const next: Record<string, string | undefined> = { ...search, ...patch };
    const clean = Object.fromEntries(
      Object.entries(next).filter(([, v]) => v !== undefined && v !== ''),
    );
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'docs' },
      search: clean as never,
      replace,
    });
  };

  const ctx: DocsCtx = {
    tenantId,
    now,
    online,
    folders: folders.data ?? [],
    refresh: () => qc.invalidateQueries({ queryKey: [...docsKey(tenantId)] }),
    go,
  };

  if (folders.isError) {
    const status = folders.error instanceof ProblemError ? folders.error.status : 0;
    if (status === 403) return <AccessGate access={NO_PERMISSION} />;
    return (
      <section className="ox-docs-section">
        <LoadFailed error={folders.error} onRetry={() => void folders.refetch()} />
      </section>
    );
  }

  return search.doc ? (
    <DocCard ctx={ctx} id={search.doc} tab={search.tab} />
  ) : (
    <DocList ctx={ctx} search={search} />
  );
}
