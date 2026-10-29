// W6.22 · Страница «Снабжение» (`repair-supply`; эталон design-2026-10-19: CRM :1910–1915 и «Ремонт и стройка.dc.html»
// `data-screen-label="Снабжение и склады"` :724–829). Вкладки «Заявки · N», «Закупки · N», «Остатки», «Движения» — в
// `?tab=` (ADR-0001). Права страницы — манифест W1.20 (`repairs.supply.manage`); выдача прорабу — `inventory.movements.post`
// в области склада. Команды закрыты в режиме «только чтение». Остатки и движения складов читает модуль «Склад»
// (этап 5): без него вкладки показывают пояснение, остатки на объектах работают на теге Repairs.
import { format, shell } from '@ortus/texts';
import { Banner, Skeleton } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useCallback, useMemo, useState } from 'react';

import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import { useAct } from './act.ts';
import {
  useBalances,
  useInventoryItems,
  useMovements,
  useProjectStock,
  usePurchases,
  useRepairProjects,
  useSupplyRequests,
  useWarehouses,
} from './api.ts';
import { warehouseChoices } from './inventory.ts';
import { MovementsPanel } from './MovementsPanel.tsx';
import { PurchasesPanel } from './PurchasesPanel.tsx';
import { RequestsPanel } from './RequestsPanel.tsx';
import { StockPanel } from './StockPanel.tsx';
import { SUPPLY_TEXT as T } from './texts.ts';
import { Note, panelId, SegTabs } from './ui.tsx';

type Tab = 'requests' | 'purchases' | 'stock' | 'movements';
const TABS: readonly Tab[] = ['requests', 'purchases', 'stock', 'movements'];
const BASE = 'repair-supply';

const tabOf = (search: unknown): Tab => {
  const v = (search as Record<string, unknown>).tab;
  return TABS.find((t) => t === v) ?? 'requests';
};

export default function RepairSupplyPage(): ReactElement {
  const { tenantId: id, audience, readOnly } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = tabOf(location.search);
  const today = useMemo(() => new Date(), []);
  const [note, setNote] = useState<string | null>(null);
  const [reservedAt, setReservedAt] = useState<ReadonlyMap<string, string>>(new Map());
  const act = useAct(tenantId, setNote);

  const requests = useSupplyRequests(tenantId);
  const purchases = usePurchases(tenantId);
  const stock = useProjectStock(tenantId);
  const projects = useRepairProjects(tenantId, tab === 'stock');
  const inventoryTab = tab === 'stock' || tab === 'movements';
  const warehouses = useWarehouses(tenantId, inventoryTab);
  const items = useInventoryItems(tenantId, inventoryTab);
  const balances = useBalances(tenantId, tab === 'stock');
  const movements = useMovements(tenantId, tab === 'movements');

  const go = useCallback(
    (next: Tab): void => {
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: BASE },
        search: (next === 'requests' ? {} : { tab: next }) as never,
      });
    },
    [navigate, tenantId],
  );

  const onReserved = useCallback(
    (requestId: string, warehouse: string): void =>
      setReservedAt((m) => new Map(m).set(requestId, warehouse)),
    [],
  );

  const canIssue = audience === 'owner' || can('inventory.movements.post');
  // Порядок эталона (:724–829): по номеру заявки, З-14 → З-25; сервер отдаёт по сроку.
  const all = useMemo(
    () =>
      [...(requests.data ?? [])].sort((a, b) =>
        a.number.localeCompare(b.number, 'ru', { numeric: true }),
      ),
    [requests.data],
  );
  const pendingCount = all.filter((r) => r.state === 'request').length;
  const seen = new Map<string, string>(
    all.flatMap((r) => (r.available ?? []).map((a) => [a.warehouseId, a.warehouseName] as const)),
  );
  const retryInventory = (): void => {
    void warehouses.refetch();
    void items.refetch();
    void balances.refetch();
    void movements.refetch();
  };

  let body: ReactElement;
  if (requests.isPending) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (requests.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(requests.error) })}
        action={{ label: T.retry, onPress: () => void requests.refetch() }}
      />
    );
  } else if (tab === 'requests') {
    body = (
      <RequestsPanel
        tenantId={tenantId}
        requests={all}
        purchases={purchases.data ?? []}
        stock={stock.data ?? []}
        reservedAt={reservedAt}
        today={today}
        locked={readOnly}
        canIssue={canIssue}
        act={act}
        onReserved={onReserved}
        onTab={go}
      />
    );
  } else if (tab === 'purchases') {
    body = purchases.isError ? (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(purchases.error) })}
        action={{ label: T.retry, onPress: () => void purchases.refetch() }}
      />
    ) : purchases.isPending ? (
      <Skeleton lines={4} label={shell.a11y.loading} />
    ) : (
      <PurchasesPanel
        tenantId={tenantId}
        purchases={purchases.data}
        requests={all}
        locked={readOnly}
        act={act}
      />
    );
  } else if (tab === 'stock') {
    body = (
      <StockPanel
        tenantId={tenantId}
        stock={stock.data ?? []}
        projects={projects.data ?? []}
        requests={all}
        balances={balances.data}
        items={items.data}
        warehouses={warehouses.data}
        choices={warehouseChoices(warehouses.data, seen)}
        locked={readOnly}
        act={act}
        onRetry={retryInventory}
      />
    );
  } else {
    body = (
      <MovementsPanel
        movements={movements.data}
        items={items.data}
        warehouses={warehouses.data}
        onRetry={retryInventory}
      />
    );
  }

  const label = (t: Tab): string =>
    t === 'requests'
      ? requests.isSuccess
        ? `${T.tabs.requests} · ${pendingCount}`
        : T.tabs.requests
      : t === 'purchases'
        ? purchases.isSuccess
          ? `${T.tabs.purchases} · ${purchases.data.length}`
          : T.tabs.purchases
        : T.tabs[t];

  return (
    <section aria-labelledby="h-rep" className="ox-rps">
      <div className="ox-rps-head">
        <span className="ox-rps-crumb">{T.crumb}</span>
        <h1 id="h-rep" className="ox-rps-title" tabIndex={-1}>
          {T.title}
        </h1>
        <span className="ox-rps-intro">{T.intro}</span>
      </div>
      <SegTabs
        base={BASE}
        aria={T.tabsAria}
        items={TABS.map((t) => ({ key: t, label: label(t) }))}
        value={tab}
        onChange={go}
      />
      {note ? <Note text={note} closeLabel={T.dismissNote} onClose={() => setNote(null)} /> : null}
      <div
        id={panelId(BASE, tab)}
        role="tabpanel"
        aria-labelledby={`${BASE}-tab-${tab}`}
        className="ox-rps-panel"
      >
        {body}
      </div>
    </section>
  );
}
