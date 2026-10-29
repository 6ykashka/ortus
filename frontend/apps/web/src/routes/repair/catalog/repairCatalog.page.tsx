// W6.22 · Страница «Шаблоны и расценки» (`repair-catalog`; эталон design-2026-10-19: CRM :1903–1908 и «Ремонт и стройка.dc.html»
// `data-screen-label="Шаблоны и расценки"` :614–721). Вкладки «Шаблоны · N» и «Справочник расценок · N» — в `?tab=`
// (ADR-0001). Права страницы — манифест W1.20 (`repairs.catalog.manage`); правка и команды закрыты в режиме «только чтение».
import { format, shell } from '@ortus/texts';
import { Banner, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useState } from 'react';

import { useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import { refreshSupply, useRepairProjects } from '../supply/api.ts';
import { Note, panelId, SegTabs, tabId } from '../supply/ui.tsx';
import { usePriceItems, useTemplates } from './api.ts';
import type { DraftLine } from './model.ts';
import { PricePanel } from './PricePanel.tsx';
import { TemplatesPanel } from './TemplatesPanel.tsx';
import { CATALOG_TEXT as T } from './texts.ts';
import './catalog.css';

type Tab = 'templates' | 'price';
const BASE = 'repair-catalog';

const tabOf = (search: unknown): Tab =>
  (search as Record<string, unknown>).tab === 'price' ? 'price' : 'templates';

export default function RepairCatalogPage(): ReactElement {
  const { tenantId: id, readOnly } = useShell();
  const tenantId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const tab = tabOf(location.search);
  const [note, setNote] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  const templates = useTemplates(tenantId);
  const prices = usePriceItems(tenantId);
  const projects = useRepairProjects(tenantId, templates.isSuccess);

  const go = useCallback(
    (next: Tab): void => {
      setNote(null);
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: BASE },
        search: (next === 'templates' ? {} : { tab: next }) as never,
      });
    },
    [navigate, tenantId],
  );
  const changed = useCallback(() => refreshSupply(qc, tenantId), [qc, tenantId]);

  const failed = templates.isError ? templates : prices.isError ? prices : null;
  const loading = templates.isPending || prices.isPending;
  let body: ReactElement;
  if (failed) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(failed.error) })}
        action={{
          label: T.retry,
          onPress: () => {
            void templates.refetch();
            void prices.refetch();
          },
        }}
      />
    );
  } else if (loading || !templates.data || !prices.data) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (tab === 'templates') {
    body = (
      <TemplatesPanel
        view={{ selId, setSelId, draft, setDraft }}
        tenantId={tenantId}
        templates={templates.data}
        prices={prices.data}
        projects={projects.data ?? []}
        locked={readOnly}
        onNote={setNote}
        onChanged={changed}
      />
    );
  } else {
    body = (
      <PricePanel
        tenantId={tenantId}
        prices={prices.data}
        locked={readOnly}
        onNote={setNote}
        onChanged={changed}
      />
    );
  }

  const items: { key: Tab; label: string }[] = [
    {
      key: 'templates',
      label: templates.isSuccess
        ? `${T.tabs.templates} · ${templates.data.length}`
        : T.tabs.templates,
    },
    {
      key: 'price',
      label: prices.isSuccess ? `${T.tabs.price} · ${prices.data.length}` : T.tabs.price,
    },
  ];

  return (
    <section aria-labelledby="h-rep" className="ox-rps">
      <div className="ox-rps-head">
        <span className="ox-rps-crumb">{T.crumb}</span>
        <h1 id="h-rep" className="ox-rps-title" tabIndex={-1}>
          {T.title}
        </h1>
        <span className="ox-rps-intro">{T.intro}</span>
      </div>
      <SegTabs base={BASE} aria={T.tabsAria} items={items} value={tab} onChange={go} />
      {note ? <Note text={note} closeLabel={T.dismissNote} onClose={() => setNote(null)} /> : null}
      <div
        id={panelId(BASE, tab)}
        role="tabpanel"
        aria-labelledby={tabId(BASE, tab)}
        className="ox-rps-panel"
      >
        {body}
      </div>
    </section>
  );
}
