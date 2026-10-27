// W6.21 · «Допработы от прораба»: оценка в черновике допсоглашения, открыть черновик, отклонение с причиной
// (эталон design-2026-10-19 «Ремонт и стройка.dc.html» :152–183, estVM :1456–1472).
import type { components } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId } from 'react';

import { ChipView } from './ChipView.tsx';
import { ESTIMATE_TEXT as T } from './texts.ts';
import { type OrdersView, REJECT_REASONS } from './vm.ts';

type Reason = components['schemas']['RepairRejectReason'];

interface Props {
  view: OrdersView;
  rejecting: string | null;
  reason: Reason;
  busy: boolean;
  onPrice: (id: string) => void;
  onOpen: () => void;
  onRejectStart: (id: string) => void;
  onReason: (reason: Reason) => void;
  onReject: (id: string) => void;
  onRejectCancel: () => void;
}

export function OrdersBlock(p: Props): ReactElement | null {
  const selectId = useId();
  if (!p.view.visible) return null;
  return (
    <div className="ox-rp-orders">
      <div className="ox-rp-orders-head">
        <h3 className="ox-rp-h3">{T.orders}</h3>
        <span>{T.ordersIntro}</span>
      </div>
      {p.view.items.map((c) => {
        const rej = p.rejecting === c.id;
        return (
          <div key={c.id} className="ox-rp-order">
            <span className="ox-rp-order-id">{c.number}</span>
            <div className="ox-rp-order-main">
              <strong>{c.title}</strong>
              <span className="ox-rp-meta">{c.meta}</span>
              {c.note ? <span className="ox-rp-order-note">{c.note}</span> : null}
              <div className="ox-rp-photos">
                {c.photos.map((ph) => (
                  <span key={ph} role="img" aria-label={ph} className="ox-rp-photo" />
                ))}
              </div>
            </div>
            <div className="ox-rp-order-side">
              <ChipView chip={c.chip} />
              {c.canPrice && !rej ? (
                <button
                  type="button"
                  className="ox-rp-btn"
                  disabled={p.busy}
                  onClick={() => p.onPrice(c.id)}
                >
                  <Icon name="request_quote" size={18} />
                  {T.price}
                </button>
              ) : null}
              {c.hint ? <span className="ox-rp-order-hint">{c.hint}</span> : null}
              {c.canOpen ? (
                <button
                  type="button"
                  className="ox-rp-btn"
                  data-variant="secondary"
                  data-size="sm"
                  onClick={p.onOpen}
                >
                  {T.openDraft}
                </button>
              ) : null}
              {c.canReject && !rej ? (
                <button
                  type="button"
                  className="ox-rp-btn"
                  data-variant="text"
                  data-tone="danger"
                  onClick={() => p.onRejectStart(c.id)}
                >
                  {T.reject}
                </button>
              ) : null}
              {rej ? (
                <div className="ox-rp-reject">
                  <div className="ox-rp-field">
                    <span id={`${selectId}-${c.id}`}>{T.rejectWhy}</span>
                    <select
                      aria-labelledby={`${selectId}-${c.id}`}
                      className="ox-rp-select"
                      value={p.reason}
                      onChange={(e) => p.onReason(e.target.value as Reason)}
                    >
                      {REJECT_REASONS.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ox-rp-reject-btns">
                    <button
                      type="button"
                      className="ox-rp-btn"
                      data-variant="danger"
                      data-size="sm"
                      disabled={p.busy}
                      onClick={() => p.onReject(c.id)}
                    >
                      {T.rejectDo}
                    </button>
                    <button
                      type="button"
                      className="ox-rp-btn"
                      data-variant="secondary"
                      data-size="sm"
                      onClick={p.onRejectCancel}
                    >
                      {T.cancel}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {p.view.noActive ? <div className="ox-rp-orders-foot">{T.noActiveOrders}</div> : null}
      {p.view.done ? (
        <div className="ox-rp-orders-foot" data-s="xs">
          {p.view.done}
        </div>
      ) : null}
    </div>
  );
}
