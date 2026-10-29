// W6.22 · Вкладка «Снабжение» карточки объекта (`repair-supply-tab`; эталон «Ремонт и стройка.dc.html»
// `data-screen-label="Снабжение"` :532–545): заявки одного объекта со статусами `SUPX` и действиями («Решить в
// снабжении», «Открыть закупку», «Списать на объект»); для прораба своего объекта — форма «Новая заявка на материал»
// (`repair-supply-request`, no-reference). Карточку объекта и вкладку выбора встраивает W6.20: `<SupplyTab projectId>`.
import type { components } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import { useAct } from './act.ts';
import { consumeRequest, usePurchases, useSupplyRequests } from './api.ts';
import { qtyText, requestMeta, stateLabel } from './model.ts';
import { NewRequestForm } from './NewRequestForm.tsx';
import { SUPPLY_TEXT as T } from './texts.ts';
import { Chip } from './ui.tsx';
import { SUPPLY_CHIPS } from '@ortus/domain/modules';

type S = components['schemas'];

/** Материалы прежних заявок объекта: когда справочник прорабу не открыт, просят то, что уже просили (Q-W6.22-6). */
const knownMaterials = (list: readonly S['SupplyRequest'][]): { id: string; name: string }[] => [
  ...new Map(list.map((r) => [r.priceItemId, { id: r.priceItemId, name: r.name }])).values(),
];

export function SupplyTab(p: {
  projectId: string;
  /** Прораб этого объекта пишет заявки; по умолчанию — персонаж «прораб». */
  canRequest?: boolean;
}): ReactElement {
  const { tenantId: id, audience, readOnly } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const api = useApi();
  const navigate = useNavigate();
  const requests = useSupplyRequests(tenantId, p.projectId);
  const owner = audience === 'owner';
  const canManage = owner || can('repairs.supply.manage');
  const canConsume = owner || can('repairs.supply.request', 'repairs.work_logs.review');
  const canRequest = p.canRequest ?? audience === 'foreman';
  const purchases = usePurchases(tenantId, canManage);
  const act = useAct(tenantId, () => undefined);

  const go = (tab?: 'purchases'): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'repair-supply' },
      search: (tab ? { tab } : {}) as never,
    });

  const consume = (r: S['SupplyRequest']): void => {
    void act(
      `supply:consume:${r.id}`,
      () => consumeRequest(api, tenantId, r),
      () => '',
    );
  };

  const today = new Date().toISOString().slice(0, 10);
  // Порядок эталона: по номеру заявки, З-12 → З-15.
  const list = [...(requests.data ?? [])].sort((a, b) =>
    a.number.localeCompare(b.number, 'ru', { numeric: true }),
  );
  return (
    <section aria-labelledby="h-sup" className="ox-rps">
      <div className="ox-rps-head">
        <h2 id="h-sup" className="ox-rps-h2">
          {T.tab.title}
        </h2>
        <p className="ox-rps-intro">{T.tab.intro}</p>
      </div>
      {canRequest ? (
        <NewRequestForm
          tenantId={tenantId}
          projectId={p.projectId}
          locked={readOnly}
          minDate={today}
          known={requests.isSuccess ? knownMaterials(list) : undefined}
        />
      ) : null}
      {requests.isPending ? <Skeleton lines={4} label={shell.a11y.loading} /> : null}
      {requests.isError ? (
        <Banner
          tone="danger"
          role="alert"
          title={format(T.loadFailed, { error: problemText(requests.error) })}
          action={{ label: T.retry, onPress: () => void requests.refetch() }}
        />
      ) : null}
      {requests.isSuccess ? (
        <div className="ox-rps-card">
          <div className="ox-rps-rows">
            {list.map((r) => {
              const chip = SUPPLY_CHIPS[r.state];
              const purchase = purchases.data?.find((x) => x.id === r.purchaseId)?.number;
              return (
                <div key={r.id} className="ox-rps-row">
                  <span className="ox-rps-mono">{r.number}</span>
                  <div className="ox-rps-row-body">
                    <span className="ox-rps-cell-strong">
                      {r.name} · {qtyText(r.quantity, r.unit)}
                    </span>
                    <span className="ox-rps-sub">{requestMeta(r, { purchase })}</span>
                  </div>
                  <Chip chip={chip} label={stateLabel(chip.label, r.state, purchase)} />
                  {r.state === 'request' && canManage ? (
                    <button type="button" className="ox-rps-btn" onClick={() => go()}>
                      <Icon name="warehouse" size={16} />
                      {T.tab.decide}
                    </button>
                  ) : null}
                  {r.state === 'ordered' && canManage ? (
                    <button type="button" className="ox-rps-btn" onClick={() => go('purchases')}>
                      <Icon name="shopping_cart" size={16} />
                      {T.tab.openPurchase}
                    </button>
                  ) : null}
                  {(r.state === 'issued' || r.state === 'bought') && canConsume ? (
                    <button
                      type="button"
                      className="ox-rps-btn"
                      disabled={readOnly}
                      onClick={() => consume(r)}
                    >
                      <Icon name="check_circle" size={16} />
                      {T.tab.consume}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {list.length === 0 ? <div className="ox-rps-empty">{T.tab.empty}</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
