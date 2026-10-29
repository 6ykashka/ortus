// W6.22 · Вкладка «Заявки» страницы «Снабжение» (эталон :732–781): «Ждут решения» с отметками для общей закупки и
// «Выдать со склада», форма «Новая закупка», «В работе» (резерв и закупка), строка «Выполнено: N заявок».
import { format } from '@ortus/texts';
import { type components } from '@ortus/api-client';
import { SUPPLY_CHIPS, SUPPLIERS } from '@ortus/domain/modules';
import { Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy } from '../../../shell/run.tsx';
import { type Act } from './act.ts';
import { issueRequest, orderPurchase, reserveRequest } from './api.ts';
import {
  availText,
  buyLabel,
  daysLeft,
  dmText,
  doneText,
  issueNote,
  issueTarget,
  isPriceInvalid,
  moneyText,
  needSub,
  objectsOf,
  purchaseGroups,
  purchaseLines,
  purchaseNote,
  qtyText,
  requestMeta,
  reserveNote,
  rubText,
  splitRequests,
  stateLabel,
} from './model.ts';
import { SUPPLY_TEXT as T } from './texts.ts';
import { Chip } from './ui.tsx';

type S = components['schemas'];
type Tab = 'requests' | 'purchases' | 'stock' | 'movements';

export interface RequestsPanelProps {
  tenantId: string;
  requests: readonly S['SupplyRequest'][];
  purchases: readonly S['Purchase'][];
  stock: readonly S['ProjectStockItem'][];
  /** Названия складов, которым выдан резерв в этой сессии (в SupplyRequest есть только warehouseId). */
  reservedAt: ReadonlyMap<string, string>;
  today: Date;
  locked: boolean;
  canIssue: boolean;
  act: Act;
  onReserved: (requestId: string, warehouse: string) => void;
  onTab: (tab: Tab) => void;
}

function PurchaseForm(p: {
  selected: readonly S['SupplyRequest'][];
  locked: boolean;
  onSave: (supplier: string, prices: Record<string, string>) => void;
  onCancel: () => void;
}): ReactElement {
  const [supplier, setSupplier] = useState(SUPPLIERS[0] ?? '');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const groups = purchaseGroups(p.selected, prices);
  const total = groups.reduce((a, g) => a + (g.sumMinor ?? 0), 0);
  const priced = groups.some((g) => g.sumMinor !== null);
  const busy = useBusy('supply:purchase');
  const hasInvalidPrice = Object.values(prices).some(isPriceInvalid);
  return (
    <div className="ox-rps-card-sel">
      <div className="ox-rps-form-head">
        <div className="ox-rps-cell">
          <h3 className="ox-rps-h3">{T.purchaseForm.title}</h3>
          <span className="ox-rps-sub">
            {format(T.purchaseForm.subtitle, { objects: String(objectsOf(p.selected)) })}
          </span>
        </div>
        <label className="ox-rps-field">
          {T.purchaseForm.supplier}
          <select
            className="ox-rps-select"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            {SUPPLIERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ox-rps-form-inner">
        <table className="ox-rps-table ox-rps-w640">
          <thead>
            <tr>
              <th scope="col">{T.purchaseForm.cols.material}</th>
              <th scope="col" className="ox-rps-r">
                {T.purchaseForm.cols.total}
              </th>
              <th scope="col" className="ox-rps-r">
                {T.purchaseForm.cols.price}
              </th>
              <th scope="col" className="ox-rps-r">
                {T.purchaseForm.cols.sum}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.priceItemId}>
                <td>
                  <span className="ox-rps-cell">
                    <span className="ox-rps-cell-strong">{g.name}</span>
                    <span className="ox-rps-sub">{g.dist}</span>
                  </span>
                </td>
                <td className="ox-rps-r">{g.qty}</td>
                <td className="ox-rps-r">
                  <input
                    className="ox-rps-input ox-rps-price"
                    data-num=""
                    data-sm=""
                    inputMode="decimal"
                    value={prices[g.priceItemId] ?? ''}
                    placeholder={T.purchaseForm.priceDefault}
                    disabled={p.locked}
                    aria-label={format(T.purchaseForm.priceAria, { name: g.name })}
                    aria-invalid={isPriceInvalid(prices[g.priceItemId] ?? '') || undefined}
                    aria-describedby={
                      isPriceInvalid(prices[g.priceItemId] ?? '')
                        ? `ox-rps-price-err-${g.priceItemId}`
                        : undefined
                    }
                    onChange={(e) => setPrices((x) => ({ ...x, [g.priceItemId]: e.target.value }))}
                  />
                  {isPriceInvalid(prices[g.priceItemId] ?? '') ? (
                    <span
                      id={`ox-rps-price-err-${g.priceItemId}`}
                      className="ox-rps-field-err"
                      role="alert"
                    >
                      {T.purchaseForm.priceError}
                    </span>
                  ) : null}
                </td>
                <td className="ox-rps-r">{g.sumMinor === null ? '—' : rubText(g.sumMinor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{T.purchaseForm.totalLabel}</td>
              <td className="ox-rps-r">{priced ? rubText(total) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="ox-rps-form-foot">
        <button
          type="button"
          className="ox-rps-btn"
          data-variant="primary"
          data-size="lg"
          disabled={p.locked || busy || hasInvalidPrice}
          onClick={() => p.onSave(supplier, prices)}
        >
          <Icon name="local_shipping" size={18} />
          {T.purchaseForm.save}
        </button>
        <button type="button" className="ox-rps-btn" data-size="lg" onClick={p.onCancel}>
          {T.purchaseForm.cancel}
        </button>
        <span className="ox-rps-sub">{T.purchaseForm.hint}</span>
      </div>
    </div>
  );
}

export function RequestsPanel(p: RequestsPanelProps): ReactElement {
  const api = useApi();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState(false);
  const { pending, work, done } = splitRequests(p.requests);
  const selected = pending.filter((r) => sel[r.id]);
  const purchaseNumber = (id: string | undefined): string | undefined =>
    p.purchases.find((x) => x.id === id)?.number;

  const reserve = (r: S['SupplyRequest'], warehouseId: string, warehouse: string): void => {
    void p
      .act(
        `supply:reserve:${r.id}`,
        () => reserveRequest(api, p.tenantId, r, warehouseId),
        () => reserveNote(r, warehouse),
      )
      .then((ok) => {
        if (ok) p.onReserved(r.id, warehouse);
      });
  };

  const issue = (r: S['SupplyRequest']): void => {
    void p.act(
      `supply:issue:${r.id}`,
      () => issueRequest(api, p.tenantId, r),
      (res) => issueNote(r, res.cost?.amountMinor ?? 0),
    );
  };

  const order = (supplier: string, prices: Record<string, string>): void => {
    const chosen = selected;
    void p
      .act(
        'supply:purchase',
        () => orderPurchase(api, p.tenantId, { supplier, lines: purchaseLines(chosen, prices) }),
        (res) => purchaseNote(res.number, res.supplier, res.lines.length, objectsOf(chosen)),
      )
      .then((ok) => {
        if (!ok) return;
        setSel({});
        setForm(false);
      });
  };

  return (
    <>
      <div className="ox-rps-card">
        <div className="ox-rps-card-head">
          <h3 className="ox-rps-h3">{T.requests.pending}</h3>
          <span className="ox-rps-count">{pending.length}</span>
          <span className="ox-rps-hint">{T.requests.pendingHint}</span>
          <button
            type="button"
            className="ox-rps-btn"
            data-variant="primary"
            data-size="lg"
            disabled={selected.length === 0 || p.locked}
            onClick={() => setForm(true)}
          >
            <Icon name="shopping_cart" size={18} />
            {buyLabel(selected.length)}
          </button>
        </div>
        <div className="ox-rps-scroll" tabIndex={0}>
          <table className="ox-rps-table ox-rps-w900">
            <thead>
              <tr>
                <th scope="col" className="ox-rps-th-check">
                  <span className="ox-rps-sr">{T.requests.cols.pick}</span>
                </th>
                <th scope="col">{T.requests.cols.request}</th>
                <th scope="col">{T.requests.cols.material}</th>
                <th scope="col">{T.requests.cols.need}</th>
                <th scope="col">{T.requests.cols.stock}</th>
                <th scope="col">{T.requests.cols.decision}</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const sub = needSub(daysLeft(r.needBy, p.today));
                const target = issueTarget(r);
                const left = p.stock.filter(
                  (x) => x.priceItemId === r.priceItemId && x.projectId !== r.projectId,
                );
                return (
                  <tr key={r.id}>
                    <td>
                      <label className="ox-rps-check">
                        <input
                          type="checkbox"
                          checked={!!sel[r.id]}
                          disabled={p.locked}
                          aria-label={format(T.requests.pickAria, { item: r.name })}
                          onChange={(e) => setSel((x) => ({ ...x, [r.id]: e.target.checked }))}
                        />
                      </label>
                    </td>
                    <td>
                      <span className="ox-rps-cell">
                        <span className="ox-rps-mono">{r.number}</span>
                        <span className="ox-rps-cell-strong">{r.projectName}</span>
                      </span>
                    </td>
                    <td>
                      <span className="ox-rps-cell">
                        <span>
                          {r.name} · {qtyText(r.quantity, r.unit)}
                        </span>
                        {r.cost ? (
                          <span className="ox-rps-sub">
                            {format(T.requests.estimate, { sum: moneyText(r.cost) })}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className="ox-rps-cell">
                        <span className="ox-rps-tnum">{dmText(r.needBy)}</span>
                        <span className={sub.warn ? 'ox-rps-sub ox-rps-warn' : 'ox-rps-sub'}>
                          {sub.text}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="ox-rps-cell">
                        <span className={target ? 'ox-rps-ok' : 'ox-rps-muted'}>
                          {availText(r)}
                        </span>
                        {left.length > 0 ? (
                          <span className="ox-rps-sub">
                            {left
                              .map((x) =>
                                format(T.requests.leftOn, {
                                  project: x.projectName,
                                  qty: qtyText(x.quantity, x.unit),
                                }),
                              )
                              .join(' · ')}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      {target ? (
                        <button
                          type="button"
                          className="ox-rps-btn"
                          data-variant="accent"
                          disabled={p.locked}
                          onClick={() => reserve(r, target.warehouseId, target.warehouseName)}
                        >
                          <Icon name="inventory_2" size={18} />
                          {format(T.requests.issueFrom, { warehouse: target.warehouseName })}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ox-rps-empty">
                    {T.requests.allDone}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {form && selected.length > 0 ? (
        <PurchaseForm
          selected={selected}
          locked={p.locked}
          onSave={order}
          onCancel={() => setForm(false)}
        />
      ) : null}

      {work.length > 0 ? (
        <div className="ox-rps-card">
          <h3 className="ox-rps-h3 ox-rps-pad">{T.requests.work}</h3>
          <div className="ox-rps-rows">
            {work.map((r) => {
              const chip = SUPPLY_CHIPS[r.state];
              const warehouse = p.reservedAt.get(r.id);
              const meta = requestMeta(r, { warehouse, purchase: purchaseNumber(r.purchaseId) });
              return (
                <div key={r.id} className="ox-rps-row">
                  <span className="ox-rps-mono">{r.number}</span>
                  <div className="ox-rps-row-body">
                    <span className="ox-rps-cell-strong">
                      {r.name} · {qtyText(r.quantity, r.unit)}
                    </span>
                    <span className="ox-rps-sub">
                      {r.projectName} · {meta}
                    </span>
                  </div>
                  <Chip
                    chip={chip}
                    label={stateLabel(chip.label, r.state, purchaseNumber(r.purchaseId))}
                  />
                  {r.state === 'reserved' && p.canIssue ? (
                    <button
                      type="button"
                      className="ox-rps-btn"
                      data-variant="accent"
                      disabled={p.locked}
                      onClick={() => issue(r)}
                    >
                      {T.requests.issueToForeman}
                    </button>
                  ) : null}
                  {r.state === 'ordered' ? (
                    <button
                      type="button"
                      className="ox-rps-btn"
                      onClick={() => p.onTab('purchases')}
                    >
                      {T.requests.openPurchase}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {done.length > 0 ? <span className="ox-rps-done">{doneText(done.length)}</span> : null}
    </>
  );
}
