// W6.22 · Вкладка «Движения» (эталон :817–826): журнал движений «Склада» — № и дата, операция, материал, «откуда → куда».
// Суммы движения в контракте «Склада» нет (Q-W6.22-1). Движения не редактируются: ошибка исправляется обратным.
import type { components } from '@ortus/api-client';
import { Banner } from '@ortus/ui';
import type { ReactElement } from 'react';

import type { Inventory } from './api.ts';
import { movementRows } from './inventory.ts';
import { SUPPLY_TEXT as T } from './texts.ts';
import { Chip } from './ui.tsx';

type S = components['schemas'];

export function MovementsPanel(p: {
  movements: Inventory<S['InventoryMovement']> | undefined;
  items: Inventory<S['InventoryItem']> | undefined;
  warehouses: Inventory<S['Warehouse']> | undefined;
  onRetry: () => void;
}): ReactElement {
  const ready =
    p.movements?.status === 'ok' && p.items?.status === 'ok' && p.warehouses?.status === 'ok';
  const unavailable =
    p.movements?.status === 'unavailable' ||
    p.items?.status === 'unavailable' ||
    p.warehouses?.status === 'unavailable';
  const rows = ready
    ? movementRows(
        p.movements?.status === 'ok' ? p.movements.items : [],
        p.items?.status === 'ok' ? p.items.items : [],
        p.warehouses?.status === 'ok' ? p.warehouses.items : [],
      )
    : [];
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
        <div className="ox-rps-card">
          <div className="ox-rps-scroll" tabIndex={0}>
            <table className="ox-rps-table ox-rps-w860">
              <thead>
                <tr>
                  <th scope="col">{T.movements.cols.id}</th>
                  <th scope="col">{T.movements.cols.kind}</th>
                  <th scope="col">{T.movements.cols.item}</th>
                  <th scope="col">{T.movements.cols.route}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.key}>
                    <td>
                      <span className="ox-rps-cell">
                        <span className="ox-rps-mono">{m.id.slice(0, 8)}</span>
                        <span>{m.at}</span>
                      </span>
                    </td>
                    <td>
                      <Chip chip={m.kind} />
                    </td>
                    <td>{m.item}</td>
                    <td>{m.route}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="ox-rps-empty">
                      {T.movements.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <span className="ox-rps-done">{T.movements.footnote}</span>
    </>
  );
}
