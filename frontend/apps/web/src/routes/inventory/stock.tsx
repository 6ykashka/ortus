// W5.11 · Вкладки «Остатки» и «Резервы» страницы «Склад»: строки остатков с партиями в порядке FEFO (порядок задаёт сервер,
// D-20 комплекта), резервы со снятием. Партия со сроком раньше сегодняшнего дня (по Москве) помечена «Срок истёк»; первая
// годная партия при нескольких — «Спишется первой».
import { format } from '@ortus/texts';
import { ConfirmDialog, EmptyState } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useBusy, useRun } from '../../shell/run.tsx';
import { refreshInventory, releaseReservation } from './api.ts';
import {
  dateTimeRu,
  type Item,
  lotLabel,
  qty,
  type Reservation,
  sourceLabel,
  type StockLine,
  type Warehouse,
} from './model.ts';
import { INV_TEXT as T } from './texts.ts';

function Lots({ line, today }: { line: StockLine; today: string }): ReactElement {
  const { balance, item } = line;
  const firstUsable = balance.lots.findIndex((l) => !lotLabel(l.expiresOn, today).expired);
  return (
    <ul className="ox-inv-lots" aria-label={format(T.actions.lotsNamed, { name: item.name })}>
      {balance.lots.map((l, i) => {
        const label = lotLabel(l.expiresOn, today);
        return (
          <li key={l.lotId ?? 'none'} className="ox-inv-lot">
            <span>{label.text}</span>
            <strong>{qty(l.onHand, item.baseUnit)}</strong>
            {label.expired ? (
              <span className="ox-inv-tag" data-tone="danger">
                {T.stock.expired}
              </span>
            ) : i === firstUsable && balance.lots.length > 1 ? (
              <span className="ox-inv-tag" data-tone="info">
                {T.stock.firstLot}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StockRow({
  line,
  today,
  canEdit,
  onEdit,
}: {
  line: StockLine;
  today: string;
  canEdit: boolean;
  onEdit: (item: Item) => void;
}): ReactElement {
  const { balance: b, item, warehouse } = line;
  const [open, setOpen] = useState(false);
  const tracked = item.trackLots;
  return (
    <li className="ox-inv-row">
      <div className="ox-inv-main">
        <strong className="ox-inv-name">{item.name}</strong>
        <span className="ox-inv-where">
          {warehouse.name} · {format(T.stock.sku, { sku: item.sku })}
        </span>
        {b.belowMinimum ? (
          <span className="ox-inv-chip" data-tone="warn">
            {T.stock.below}
          </span>
        ) : null}
      </div>
      <dl className="ox-inv-qty">
        <div>
          <dt>{T.stock.onHand}</dt>
          <dd>{qty(b.onHand, item.baseUnit)}</dd>
        </div>
        <div>
          <dt>{T.stock.reserved}</dt>
          <dd>{qty(b.reserved, item.baseUnit)}</dd>
        </div>
        <div>
          <dt>{T.stock.available}</dt>
          <dd>{qty(b.available, item.baseUnit)}</dd>
        </div>
      </dl>
      <div className="ox-inv-sub">
        {b.minLevel == null
          ? T.stock.noMin
          : format(T.stock.min, { value: qty(b.minLevel, item.baseUnit) })}
      </div>
      <div className="ox-inv-acts">
        {tracked && b.lots.length > 0 ? (
          <button
            type="button"
            className="ox-inv-link"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? T.actions.hideLots : format(T.actions.lots, { n: b.lots.length })}
          </button>
        ) : !tracked ? (
          <span className="ox-inv-sub">{T.stock.noTracking}</span>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="ox-inv-link"
            aria-label={format(T.actions.editNamed, { name: item.name })}
            onClick={() => onEdit(item)}
          >
            {T.actions.edit}
          </button>
        ) : null}
      </div>
      {open ? <Lots line={line} today={today} /> : null}
    </li>
  );
}

export function StockList({
  lines,
  today,
  canEdit,
  onEdit,
  hasWarehouses,
  low,
}: {
  lines: readonly StockLine[];
  today: string;
  canEdit: boolean;
  onEdit: (item: Item) => void;
  hasWarehouses: boolean;
  low: boolean;
}): ReactElement {
  if (!hasWarehouses) {
    return (
      <EmptyState icon="warehouse" title={T.stock.noWarehouses} text={T.stock.noWarehousesText} />
    );
  }
  if (!lines.length) {
    return low ? (
      <EmptyState icon="task_alt" title={T.stock.emptyLow} text={T.stock.emptyLowText} />
    ) : (
      <EmptyState icon="inventory_2" title={T.stock.empty} text={T.stock.emptyText} />
    );
  }
  return (
    <ul className="ox-inv-list" aria-label={T.stock.listAria}>
      {lines.map((l) => (
        <StockRow key={l.key} line={l} today={today} canEdit={canEdit} onEdit={onEdit} />
      ))}
    </ul>
  );
}

const STATUS_TONE = { active: 'ok', consumed: 'neutral', released: 'neutral' } as const;

export function ReservationList({
  tenantId,
  reservations,
  items,
  warehouses,
  canRelease,
}: {
  tenantId: string;
  reservations: readonly Reservation[];
  items: readonly Item[];
  warehouses: readonly Warehouse[];
  canRelease: boolean;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('inv-release');
  const [confirm, setConfirm] = useState<Reservation | null>(null);

  const release = async (r: Reservation): Promise<void> => {
    try {
      await run(
        'inv-release',
        () => releaseReservation(api, tenantId, r.id),
        T.reservations.released,
      );
    } catch {
      // Тост показал `run`; резерв мог уже не действовать (409) — список перечитывается.
    } finally {
      setConfirm(null);
      await refreshInventory(qc, tenantId);
    }
  };

  if (!reservations.length) {
    return (
      <EmptyState icon="bookmark" title={T.reservations.empty} text={T.reservations.emptyText} />
    );
  }
  return (
    <>
      <p className="ox-inv-note">{T.reservations.modulesNote}</p>
      <ul className="ox-inv-list" aria-label={T.reservations.listAria}>
        {reservations.map((r) => {
          const wh = warehouses.find((w) => w.id === r.warehouseId);
          return (
            <li key={r.id} className="ox-inv-row">
              <div className="ox-inv-main">
                <strong className="ox-inv-name">{sourceLabel(r.source)}</strong>
                <span className="ox-inv-where">
                  {wh?.name ?? ''} · {format(T.reservations.at, { at: dateTimeRu(r.createdAt) })}
                </span>
                <span className="ox-inv-chip" data-tone={STATUS_TONE[r.status]}>
                  {T.reservations.status[r.status]}
                </span>
              </div>
              <div className="ox-inv-lines">
                {r.lines.map((l) => {
                  const item = items.find((i) => i.id === l.itemId);
                  return (
                    <div key={l.itemId} className="ox-inv-line">
                      <span>{item?.name ?? ''}</span>
                      <strong>{item ? qty(l.quantity, item.baseUnit) : l.quantity}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="ox-inv-acts">
                {canRelease && r.status === 'active' ? (
                  <button type="button" className="ox-inv-link" onClick={() => setConfirm(r)}>
                    {T.actions.release}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void release(confirm);
        }}
        icon="bookmark_remove"
        title={T.reservations.releaseTitle}
        text={T.reservations.releaseText}
        confirmLabel={T.reservations.releaseConfirm}
        busy={busy}
      />
    </>
  );
}
