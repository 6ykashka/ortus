// W6.22 · Вкладка «Закупки» (эталон :783–791): закупка с поставщиком, датой, числом позиций и объектов, суммой, чипом
// «Получено» или «Заказано» и таблицей строк по объектам. Приход — по чеку QR (Q-W4.00-repair-9: вместо кнопки
// «Демо: получено, чек по QR» — поле «Чек по QR» и «Получено»).
import type { components } from '@ortus/api-client';
import { useState, type ReactElement } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy } from '../../../shell/run.tsx';
import type { Act } from './act.ts';
import { receivePurchase } from './api.ts';
import { moneyText, purchaseMeta, qtyText, receiveNote } from './model.ts';
import { SUPPLY_TEXT as T } from './texts.ts';
import { Chip } from './ui.tsx';

type S = components['schemas'];

const RECEIVED = { label: T.purchases.received, tone: 'ok', icon: 'check_circle' } as const;
const ORDERED = { label: T.purchases.ordered, tone: 'info', icon: 'local_shipping' } as const;

function Receive(p: {
  tenantId: string;
  purchase: S['Purchase'];
  locked: boolean;
  act: Act;
}): ReactElement {
  const api = useApi();
  const [qr, setQr] = useState('');
  const busy = useBusy(`supply:receive:${p.purchase.id}`);
  return (
    <div className="ox-rps-actions">
      <label className="ox-rps-field ox-rps-qr">
        <span className="ox-rps-sr">{T.purchases.qrLabel}</span>
        <input
          className="ox-rps-input"
          data-sm=""
          value={qr}
          placeholder={T.purchases.qrPlaceholder}
          disabled={p.locked}
          onChange={(e) => setQr(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="ox-rps-btn"
        data-variant="accent"
        disabled={p.locked || busy || !qr.trim()}
        onClick={() =>
          void p.act(
            `supply:receive:${p.purchase.id}`,
            () => receivePurchase(api, p.tenantId, p.purchase, qr.trim()),
            () => receiveNote(p.purchase.number),
          )
        }
      >
        {T.purchases.receive}
      </button>
    </div>
  );
}

export function PurchasesPanel(p: {
  tenantId: string;
  purchases: readonly S['Purchase'][];
  requests: readonly S['SupplyRequest'][];
  locked: boolean;
  act: Act;
}): ReactElement {
  if (p.purchases.length === 0) return <div className="ox-rps-empty">{T.purchases.empty}</div>;
  return (
    <>
      {p.purchases.map((pur) => (
        <article key={pur.id} className="ox-rps-card" aria-label={pur.number}>
          <div className="ox-rps-card-head">
            <span className="ox-rps-mono">{pur.number}</span>
            <div className="ox-rps-row-body">
              <strong>{pur.supplier}</strong>
              <span className="ox-rps-sub">{purchaseMeta(pur)}</span>
            </div>
            <strong className="ox-rps-tnum">{moneyText(pur.total)}</strong>
            <Chip chip={pur.state === 'received' ? RECEIVED : ORDERED} />
            {pur.state === 'ordered' ? (
              <Receive tenantId={p.tenantId} purchase={pur} locked={p.locked} act={p.act} />
            ) : null}
          </div>
          <div className="ox-rps-scroll" tabIndex={0}>
            <table className="ox-rps-table ox-rps-w620 ox-rps-lines">
              <tbody>
                {pur.lines.map((l) => {
                  const r = p.requests.find((x) => x.id === l.supplyRequestId);
                  const sum = {
                    amountMinor: Math.round(Number(l.quantity) * l.price.amountMinor),
                    currency: l.price.currency,
                  };
                  return (
                    <tr key={l.supplyRequestId}>
                      <td>{r?.projectName ?? '—'}</td>
                      <td>{r?.name ?? '—'}</td>
                      <td className="ox-rps-r">{r ? qtyText(l.quantity, r.unit) : l.quantity}</td>
                      <td className="ox-rps-r ox-rps-muted">{moneyText(l.price)}</td>
                      <td className="ox-rps-r">{moneyText(sum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </>
  );
}
