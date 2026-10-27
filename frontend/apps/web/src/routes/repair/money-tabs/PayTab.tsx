// W6.24 · Вкладка «Оплата бригады» (`repair-pay`, эталон «Ремонт и стройка.dc.html» :560–575): сдельные начисления по
// закрытым актам, «Начислить по акту № N», «Провести выплату через кассу». Выплата — предложение операции в кассу
// (W5.31): начисление встаёт в «Ждёт проведения в кассе» (Q-W6.24-4). Только с `repairs.finance.read`.
import { format } from '@ortus/texts';
import { Button } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { accrueByAct, afterChange, payout, useAccruals, useDocuments } from './api.ts';
import { payPlan, payRows } from './model.ts';
import {
  Denied,
  Head,
  Loaded,
  Section,
  StatusChip,
  type TabProps,
  useCaps,
  useMay,
} from './shared.tsx';
import { MONEY_TEXT } from './texts.ts';

const T = MONEY_TEXT.pay;

export default function PayTab({ tenantId, projectId }: TabProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const { finance } = useCaps();
  const accruals = useAccruals(tenantId, projectId, finance);
  const docs = useDocuments(tenantId, projectId);
  const mayAccrue = useMay('repairs.crew.accrue');
  const mayPay = useMay('repairs.crew.pay');
  const accruing = useBusy('accrue');
  const paying = useBusy('payout');
  if (!finance) return <Denied />;

  const after = (): Promise<void> => afterChange(qc, tenantId, projectId);

  const accrue = async (actId: string, no: number): Promise<void> => {
    try {
      await run('accrue', () => accrueByAct(api, tenantId, actId), format(T.accrued, { no }));
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await after();
    }
  };

  const pay = async (ids: string[]): Promise<void> => {
    try {
      await run('payout', () => payout(api, tenantId, ids), T.payoutDone);
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await after();
    }
  };

  return (
    <Section id="h-pay" label="Оплата бригад">
      <Head id="h-pay" title={T.title} intro={T.intro} />
      <Loaded query={accruals}>
        {(list) => {
          const rows = payRows(list);
          const plan = payPlan(list, docs.data ?? []);
          return (
            <>
              {rows.length === 0 ? (
                <div className="ox-mt-card ox-mt-empty">{T.empty}</div>
              ) : (
                <div
                  className="ox-mt-card ox-mt-scroll"
                  role="region"
                  tabIndex={0}
                  aria-label={T.tableAria}
                >
                  <table className="ox-mt-table" aria-label={T.tableAria}>
                    <thead>
                      <tr>
                        <th scope="col">{T.columns.who}</th>
                        <th scope="col">{T.columns.work}</th>
                        <th scope="col" className="ox-mt-num">
                          {T.columns.sum}
                        </th>
                        <th scope="col">{T.columns.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <span className="ox-mt-who">
                              <span className="ox-mt-name">{r.name}</span>
                              <span className="ox-mt-meta">
                                {r.selfEmployed ? `${r.role} · ${T.selfEmployed}` : r.role}
                              </span>
                            </span>
                          </td>
                          <td className="ox-mt-work">{r.work}</td>
                          <td className="ox-mt-num">{r.sum}</td>
                          <td>
                            <StatusChip chip={r.chip} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ox-mt-actions">
                {plan.accrue && mayAccrue ? (
                  <Button
                    loading={accruing}
                    onPress={() => plan.accrue && void accrue(plan.accrue.id, plan.accrue.no)}
                  >
                    {format(T.accrue, { no: plan.accrue.no })}
                  </Button>
                ) : null}
                {plan.payoutIds.length > 0 && mayPay ? (
                  <Button
                    variant="secondary"
                    loading={paying}
                    onPress={() => void pay(plan.payoutIds)}
                  >
                    {T.payout}
                  </Button>
                ) : null}
                {plan.hint ? <span className="ox-mt-note">{plan.hint}</span> : null}
              </div>
            </>
          );
        }}
      </Loaded>
    </Section>
  );
}
