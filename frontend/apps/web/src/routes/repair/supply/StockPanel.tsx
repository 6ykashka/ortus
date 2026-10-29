// W6.22 · Вкладка «Остатки» (эталон :793–815): остатки складов с фильтром «Все склады · …» (модуль «Склад», этап 5)
// и «Остатки на объектах» с «Вернуть на склад» и «Переместить на объект» (тег Repairs).
import { Banner } from '@ortus/ui';
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import type { Act } from './act.ts';
import { type Inventory, returnStock, transferStock } from './api.ts';
import { stockRows, type WarehouseChoice } from './inventory.ts';
import { moneyText, moveNote, qtyText, returnNote } from './model.ts';
import { SUPPLY_TEXT as T } from './texts.ts';
import { SegGroup } from './ui.tsx';

type S = components['schemas'];

type Action =
  { id: string; kind: 'return'; warehouse: string } | { id: string; kind: 'move'; project: string };

const keyOf = (s: S['ProjectStockItem']): string => `${s.projectId}:${s.priceItemId}`;

function OnObjectRow(p: {
  tenantId: string;
  item: S['ProjectStockItem'];
  warehouses: readonly WarehouseChoice[];
  targets: readonly { id: string; name: string; request?: S['SupplyRequest'] }[];
  locked: boolean;
  act: Act;
}): ReactElement {
  const api = useApi();
  const { item } = p;
  const [action, setAction] = useState<Action | null>(null);
  const start = (kind: 'return' | 'move'): void =>
    setAction(
      kind === 'return'
        ? { id: keyOf(item), kind, warehouse: p.warehouses[0]?.id ?? '' }
        : { id: keyOf(item), kind, project: p.targets[0]?.id ?? '' },
    );

  const confirm = (): void => {
    if (!action) return;
    if (action.kind === 'return') {
      const wh = p.warehouses.find((w) => w.id === action.warehouse);
      void p
        .act(
          `supply:return:${keyOf(item)}`,
          () => returnStock(api, p.tenantId, item, action.warehouse),
          () =>
            returnNote(
              item.name,
              item.quantity,
              item.unit,
              wh?.name ?? '',
              item.projectName,
              item.cost.amountMinor,
            ),
        )
        .then((ok) => ok && setAction(null));
    } else {
      const to = p.targets.find((x) => x.id === action.project);
      void p
        .act(
          `supply:move:${keyOf(item)}`,
          () => transferStock(api, p.tenantId, item, action.project),
          () => moveNote(item.name, item.quantity, item.unit, to?.name ?? '', to?.request),
        )
        .then((ok) => ok && setAction(null));
    }
  };

  return (
    <div className="ox-rps-row">
      <div className="ox-rps-row-body">
        <span className="ox-rps-cell-strong">
          {item.name} · {qtyText(item.quantity, item.unit)}
        </span>
        <span className="ox-rps-sub">
          {item.projectName} · {moneyText(item.cost)}
        </span>
      </div>
      {action === null ? (
        <div className="ox-rps-actions">
          <button
            type="button"
            className="ox-rps-btn"
            disabled={p.locked || p.warehouses.length === 0}
            title={p.warehouses.length === 0 ? T.stock.noWarehouses : undefined}
            onClick={() => start('return')}
          >
            {T.stock.back}
          </button>
          <button
            type="button"
            className="ox-rps-btn"
            disabled={p.locked || p.targets.length === 0}
            onClick={() => start('move')}
          >
            {T.stock.move}
          </button>
        </div>
      ) : (
        <div className="ox-rps-actions">
          {action.kind === 'return' ? (
            <select
              className="ox-rps-select"
              data-sm=""
              aria-label={T.stock.warehouseAria}
              value={action.warehouse}
              onChange={(e) => setAction({ ...action, warehouse: e.target.value })}
            >
              {p.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {format(T.stock.warehouseOption, { name: w.name })}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="ox-rps-select ox-rps-select-wide"
              data-sm=""
              aria-label={T.stock.objectAria}
              value={action.project}
              onChange={(e) => setAction({ ...action, project: e.target.value })}
            >
              {p.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.request
                    ? format(T.stock.requestOption, {
                        project: t.name,
                        number: t.request.number,
                        qty: qtyText(t.request.quantity, t.request.unit),
                      })
                    : t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="ox-rps-btn"
            data-variant="primary"
            disabled={p.locked}
            onClick={confirm}
          >
            {T.stock.confirm}
          </button>
          <button type="button" className="ox-rps-btn" onClick={() => setAction(null)}>
            {T.stock.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

export function StockPanel(p: {
  tenantId: string;
  stock: readonly S['ProjectStockItem'][];
  projects: readonly S['RepairProject'][];
  requests: readonly S['SupplyRequest'][];
  balances: Inventory<S['InventoryBalance']> | undefined;
  items: Inventory<S['InventoryItem']> | undefined;
  warehouses: Inventory<S['Warehouse']> | undefined;
  choices: readonly WarehouseChoice[];
  locked: boolean;
  act: Act;
  onRetry: () => void;
}): ReactElement {
  const [wh, setWh] = useState('all');
  const ready =
    p.balances?.status === 'ok' && p.items?.status === 'ok' && p.warehouses?.status === 'ok';
  const rows = ready
    ? stockRows(
        p.balances?.status === 'ok' ? p.balances.items : [],
        p.items?.status === 'ok' ? p.items.items : [],
        p.warehouses?.status === 'ok' ? p.warehouses.items : [],
        wh,
      )
    : [];
  const unavailable =
    p.balances?.status === 'unavailable' ||
    p.items?.status === 'unavailable' ||
    p.warehouses?.status === 'unavailable';
  const whItems = [
    { key: 'all', label: T.stock.allWarehouses },
    ...(p.warehouses?.status === 'ok'
      ? p.warehouses.items.filter((w) => !w.archived).map((w) => ({ key: w.id, label: w.name }))
      : []),
  ];

  const targetsFor = (s: S['ProjectStockItem']) =>
    p.projects
      .filter((x) => x.status === 'active' && x.id !== s.projectId)
      .map((x) => ({
        id: x.id,
        name: x.name,
        request: p.requests.find(
          (r) => r.projectId === x.id && r.priceItemId === s.priceItemId && r.state === 'request',
        ),
      }))
      .sort((a, b) => Number(!!b.request) - Number(!!a.request));

  return (
    <>
      {unavailable ? (
        <Banner
          tone="warn"
          role="status"
          title={T.stock.unavailable}
          text={T.stock.unavailableHint}
          action={{ label: T.retry, onPress: p.onRetry }}
        />
      ) : ready ? (
        <>
          {whItems.length > 1 ? (
            <SegGroup aria={T.stock.warehouseGroup} items={whItems} value={wh} onChange={setWh} />
          ) : null}
          <div className="ox-rps-card">
            <div className="ox-rps-scroll" tabIndex={0}>
              <table className="ox-rps-table ox-rps-w720">
                <thead>
                  <tr>
                    <th scope="col">{T.stock.cols.item}</th>
                    <th scope="col">{T.stock.cols.warehouse}</th>
                    <th scope="col" className="ox-rps-r">
                      {T.stock.cols.onHand}
                    </th>
                    <th scope="col" className="ox-rps-r">
                      {T.stock.cols.reserved}
                    </th>
                    <th scope="col" className="ox-rps-r">
                      {T.stock.cols.free}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.item}</td>
                      <td className="ox-rps-muted">{r.warehouse}</td>
                      <td className="ox-rps-r">{r.onHand}</td>
                      <td className="ox-rps-r ox-rps-warn">{r.reserved}</td>
                      <td className="ox-rps-r ox-rps-cell-strong">{r.free}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="ox-rps-empty">
                        {T.stock.empty}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <div className="ox-rps-card">
        <div className="ox-rps-card-head ox-rps-col">
          <h3 className="ox-rps-h3">{T.stock.onObjects}</h3>
          <span className="ox-rps-sub">{T.stock.onObjectsHint}</span>
        </div>
        <div className="ox-rps-rows">
          {p.stock.map((s) => (
            <OnObjectRow
              key={keyOf(s)}
              tenantId={p.tenantId}
              item={s}
              warehouses={p.choices}
              targets={targetsFor(s)}
              locked={p.locked}
              act={p.act}
            />
          ))}
          {p.stock.length === 0 ? <div className="ox-rps-empty">{T.stock.noOnObjects}</div> : null}
        </div>
      </div>
    </>
  );
}
