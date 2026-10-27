// W5.11 · Страница «Движения склада» (`inventoryMovements`; экран inventory-movements; no-reference — склада в эталоне нет,
// B-6, Q-W5.11-1): неизменяемый журнал движений от новых к старым, «Новое движение» (приход, расход, перемещение,
// корректировка) и «Сторно» с причиной. Страница вне меню (Q-W5.11-4): вход — вкладка-ссылка страницы «Склад».
import { format, shell } from '@ortus/texts';
import { Banner, Button, Skeleton } from '@ortus/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useCan, useShell } from '../../shell/context.tsx';
import { problemText } from '../../shell/run.tsx';
import { useCrumb } from '../logistics/manager/review/crumb.ts';
import { useItems, useMovements, useWarehouses } from './api.ts';
import type { Movement } from './model.ts';
import { MovementDialog, MovementList, ReversalDialog } from './movements.tsx';
import { INV_TEXT as T } from './texts.ts';
import './inventory.css';

const H1_ID = 'h-inventory-movements';

export default function InventoryMovementsPage(): ReactElement {
  const { tenantId: tid, audience, readOnly } = useShell();
  const tenantId = tid ?? '';
  const can = useCan();
  const navigate = useNavigate();
  const crumbText = useCrumb('inventory.movements.read');
  const owner = audience === 'owner';
  const canPost = !readOnly && (owner || can('inventory.movements.post'));
  const canStock = owner || can('inventory.items.read');
  const [dialog, setDialog] = useState<'new' | Movement | null>(null);

  const movements = useMovements(tenantId);
  const warehouses = useWarehouses(tenantId);
  const items = useItems(tenantId);
  const queries = [movements, warehouses, items];
  const failed = queries.find((q) => q.isError);

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
            for (const q of queries) void q.refetch();
          },
        }}
      />
    );
  } else if (queries.some((q) => q.isPending)) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else {
    body = (
      <MovementList
        movements={movements.data ?? []}
        items={items.data ?? []}
        warehouses={warehouses.data ?? []}
        canPost={canPost}
        onReverse={(m) => setDialog(m)}
      />
    );
  }

  return (
    <section aria-labelledby={H1_ID} className="ox-inv">
      <div className="ox-inv-top">
        <div className="ox-inv-crumb">{crumbText || T.crumbFallback}</div>
        <h1 id={H1_ID} className="ox-inv-title" tabIndex={-1}>
          {shell.nav.items.inventoryMovements}
        </h1>
        <p className="ox-inv-intro">{T.movementsIntro}</p>
      </div>
      <div className="ox-inv-bar">
        {canStock ? (
          <nav aria-label="Связанные разделы" className="ox-inv-links">
            <button
              type="button"
              className="ox-inv-pill"
              onClick={() =>
                void navigate({ to: '/t/$tenantId/$page', params: { tenantId, page: 'inventory' } })
              }
            >
              {T.links.stock}
            </button>
          </nav>
        ) : null}
        {canPost ? (
          <div className="ox-inv-actions">
            <Button icon="add" onPress={() => setDialog('new')}>
              {T.actions.newMovement}
            </Button>
          </div>
        ) : null}
      </div>
      {readOnly ? <p className="ox-inv-note">{T.readOnly}</p> : null}
      {body}
      {dialog === 'new' ? (
        <MovementDialog
          tenantId={tenantId}
          items={items.data ?? []}
          warehouses={warehouses.data ?? []}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog !== null && dialog !== 'new' ? (
        <ReversalDialog tenantId={tenantId} movement={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}
