// W5.11 · Страница «Склад» (`inventory`; экран inventory-stock; no-reference — склада в эталоне нет, B-6, Q-W5.11-1):
// вкладки «Остатки» (позиции по складам, партии в порядке FEFO, «Ниже минимума») и «Резервы» (список, снятие), правка
// и создание позиции, новый склад. Адрес: `?view=reservations&warehouse=<id>&low=1`. Страница вне меню (Q-W5.11-4):
// вход — прямой URL и «Связанные разделы» страниц-потребителей; «Движения склада» — вторая страница модуля.
import { format, shell } from '@ortus/texts';
import { Banner, Button, Checkbox, Select, Skeleton, Tabs } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { unitLabel, useOrgUnits } from '../../shell/scope.ts';
import { useCrumb } from '../logistics/manager/review/crumb.ts';
import { useBalances, useItems, useReservations, useWarehouses } from './api.ts';
import { EditItemDialog, NewItemDialog, type UnitOption, WarehouseDialog } from './dialogs.tsx';
import { type Item, stockRows, todayMsk } from './model.ts';
import { ReservationList, StockList } from './stock.tsx';
import { INV_TEXT as T } from './texts.ts';
import './inventory.css';

const H1_ID = 'h-inventory';

type View = 'stock' | 'reservations';

interface Search {
  view?: 'reservations';
  warehouse?: string;
  low?: 1;
}

const searchOf = (raw: Record<string, unknown>): Search => ({
  ...(raw.view === 'reservations' ? { view: 'reservations' as const } : {}),
  ...(typeof raw.warehouse === 'string' && raw.warehouse ? { warehouse: raw.warehouse } : {}),
  ...(raw.low === '1' || raw.low === 1 ? { low: 1 as const } : {}),
});

type Dialog = { kind: 'item' } | { kind: 'warehouse' } | { kind: 'edit'; item: Item } | null;

export default function InventoryPage(): ReactElement {
  const { tenantId: tid, audience, readOnly } = useShell();
  const tenantId = tid ?? '';
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const search = searchOf(location.search as Record<string, unknown>);
  const view: View = search.view ?? 'stock';
  const crumbText = useCrumb('inventory.items.read');
  const owner = audience === 'owner';
  const canItems = !readOnly && (owner || can('inventory.items.manage'));
  const canWarehouses = !readOnly && (owner || can('inventory.warehouses.manage'));
  const canPost = !readOnly && (owner || can('inventory.movements.post'));
  const canMovements = owner || can('inventory.movements.read');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [today] = useState(() => todayMsk(Date.now()));

  const warehouses = useWarehouses(tenantId);
  const items = useItems(tenantId);
  const balances = useBalances(tenantId, {
    ...(search.warehouse ? { warehouseId: search.warehouse } : {}),
    ...(search.low ? { belowMinimum: true } : {}),
  });
  const reservations = useReservations(tenantId, view === 'reservations');
  const orgUnits = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];

  const go = (patch: Partial<Search>): void => {
    const next = { ...search, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'inventory' },
      search: clean as never,
    });
  };

  const whList = (warehouses.data ?? []).filter((w) => !w.archived);
  const unitOpts: UnitOption[] = orgUnits.length
    ? orgUnits
        .filter((u) => u.status === 'active')
        .map((u) => ({ value: u.id, label: unitLabel(orgUnits, u.id) ?? u.name }))
    : [...new Set(whList.map((w) => w.orgUnitId))].map((id) => ({
        value: id,
        label: whList.find((w) => w.orgUnitId === id)?.name ?? id,
      }));

  const lines = stockRows(balances.data ?? [], items.data ?? [], warehouses.data ?? []);
  const active =
    view === 'stock' ? [warehouses, items, balances] : [warehouses, items, reservations];
  const failed = active.find((q) => q.isError);
  const pending = active.some((q) => q.isPending);

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
            for (const q of active) void q.refetch();
          },
        }}
      />
    );
  } else if (pending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (view === 'reservations') {
    body = (
      <ReservationList
        tenantId={tenantId}
        reservations={reservations.data ?? []}
        items={items.data ?? []}
        warehouses={warehouses.data ?? []}
        canRelease={canPost}
      />
    );
  } else {
    body = (
      <>
        <div className="ox-inv-filters" role="group" aria-label={T.filters.aria}>
          <div className="ox-inv-filter">
            <Select
              aria-label={T.filters.warehouse}
              value={search.warehouse ?? ''}
              onChange={(v) => go({ warehouse: v || undefined })}
              options={[
                { value: '', label: T.filters.allWarehouses },
                ...whList.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
          </div>
          <Checkbox
            checked={search.low === 1}
            onChange={(v) => go({ low: v ? 1 : undefined })}
            label={T.filters.low}
          />
        </div>
        <StockList
          lines={lines}
          today={today}
          canEdit={canItems}
          onEdit={(item) => setDialog({ kind: 'edit', item })}
          hasWarehouses={whList.length > 0}
          low={search.low === 1}
        />
      </>
    );
  }

  return (
    <section aria-labelledby={H1_ID} className="ox-inv">
      <div className="ox-inv-top">
        <div className="ox-inv-crumb">{crumbText || T.crumbFallback}</div>
        <h1 id={H1_ID} className="ox-inv-title" tabIndex={-1}>
          {shell.nav.items.inventory}
        </h1>
        <p className="ox-inv-intro">{T.intro}</p>
      </div>
      <div className="ox-inv-bar">
        {canMovements ? (
          <nav aria-label="Связанные разделы" className="ox-inv-links">
            <button
              type="button"
              className="ox-inv-pill"
              onClick={() =>
                void navigate({
                  to: '/t/$tenantId/$page',
                  params: { tenantId, page: 'inventory-movements' },
                })
              }
            >
              {T.links.movements}
            </button>
          </nav>
        ) : null}
        {canItems || canWarehouses ? (
          <div className="ox-inv-actions">
            {canWarehouses ? (
              <Button
                variant="secondary"
                icon="warehouse"
                onPress={() => setDialog({ kind: 'warehouse' })}
              >
                {T.actions.newWarehouse}
              </Button>
            ) : null}
            {canItems ? (
              <Button icon="add" onPress={() => setDialog({ kind: 'item' })}>
                {T.actions.newItem}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {readOnly ? <p className="ox-inv-note">{T.readOnly}</p> : null}
      <Tabs
        aria-label={T.tabs.aria}
        value={view}
        onChange={(id) => go({ view: id === 'reservations' ? 'reservations' : undefined })}
        items={[
          { id: 'stock', label: T.tabs.stock },
          { id: 'reservations', label: T.tabs.reservations },
        ]}
      >
        {body}
      </Tabs>
      {dialog?.kind === 'item' ? (
        <NewItemDialog tenantId={tenantId} units={unitOpts} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'warehouse' ? (
        <WarehouseDialog tenantId={tenantId} units={unitOpts} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditItemDialog
          tenantId={tenantId}
          item={(items.data ?? []).find((i) => i.id === dialog.item.id) ?? dialog.item}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
