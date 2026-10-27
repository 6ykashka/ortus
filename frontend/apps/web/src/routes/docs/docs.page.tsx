// @stub Owner: W7.25
// W7.26 · Заглушка страницы «Документы» для проверки блока «Маршрут документа» (`docs-route`): список документов и
// карточка `?doc=<id>` с блоком маршрута. Владелец W7.25 заменяет файл целиком своей страницей и вставляет
// `<DocRoutePanel tenantId docId />` (routes/docs/route/panel.tsx) в карточку — одной строкой.
import { unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement } from 'react';

import { useApi } from '../../app/api.tsx';
import { useShell } from '../../shell/context.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import { docsKey, useRouteDoc } from './route/api.ts';
import { DocRoutePanel } from './route/panel.tsx';

function useDocs(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'stub-list'],
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/docs', {
            params: { path: { tenantId }, query: { limit: 200 } },
          }),
        )
      ).items,
  });
}

function Card({ tenantId, id }: { tenantId: string; id: string }): ReactElement {
  const navigate = useNavigate();
  const doc = useRouteDoc(tenantId, id);
  return (
    <section aria-labelledby="h-docs" className="ox-rt-host">
      <button
        type="button"
        className="ox-rt-link"
        onClick={() =>
          void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'docs' } })
        }
      >
        К списку документов
      </button>
      <h1 id="h-docs" tabIndex={-1}>
        {doc.data?.title ?? 'Документ'}
      </h1>
      <DocRoutePanel tenantId={tenantId} docId={id} />
    </section>
  );
}

export default function DocsPage(): ReactElement {
  const { tenantId: id } = useShell();
  const tenantId = id ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const raw = (location.search as Record<string, unknown>).doc;
  const docId = typeof raw === 'string' && raw ? raw : '';
  const list = useDocs(tenantId);
  if (docId) return <Card tenantId={tenantId} id={docId} />;
  return (
    <section aria-labelledby="h-docs" className="ox-rt-host">
      <h1 id="h-docs" tabIndex={-1}>
        Документы
      </h1>
      {list.isError ? (
        <LoadFailed error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul>
          {(list.data ?? []).map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="ox-rt-link"
                onClick={() =>
                  void navigate({
                    to: '/t/$tenantId/$page',
                    params: { tenantId, page: 'docs' },
                    search: { doc: d.id } as never,
                  })
                }
              >
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
