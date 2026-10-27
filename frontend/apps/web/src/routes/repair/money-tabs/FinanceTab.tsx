// W6.24 · Вкладка «Финансы» (`repair-finance`, эталон «Ремонт и стройка.dc.html» :547–558): четыре карточки (договор,
// получено от заказчика, расходы, маржа план) и «Движение денег». Только с `repairs.finance.read`: без права
// сервер отвечает 403, а страница не запрашивает данные и показывает отказ.
import type { ReactElement } from 'react';

import { useFinance } from './api.ts';
import { financeCards, movementRows } from './model.ts';
import { Denied, Head, Loaded, Section, type TabProps, useCaps } from './shared.tsx';
import { MONEY_TEXT } from './texts.ts';

const T = MONEY_TEXT.finance;

export default function FinanceTab({ tenantId, projectId }: TabProps): ReactElement {
  const { finance } = useCaps();
  const data = useFinance(tenantId, projectId, finance);
  if (!finance) return <Denied />;
  return (
    <Section id="h-fin" label="Финансы объекта">
      <Head id="h-fin" title={T.title} intro={T.intro} />
      <Loaded query={data}>
        {(f) => {
          const rows = movementRows(f);
          return (
            <>
              <ul className="ox-mt-cards" aria-label={T.cardsAria}>
                {financeCards(f).map((k) => (
                  <li key={k.label} className="ox-mt-kpi">
                    <span className="ox-mt-kpi-label">{k.label}</span>
                    <strong className="ox-mt-kpi-value">{k.value}</strong>
                    <span className="ox-mt-sub">{k.sub}</span>
                  </li>
                ))}
              </ul>
              <div className="ox-mt-card">
                <div className="ox-mt-card-title">{T.movements}</div>
                {rows.length === 0 ? (
                  <div className="ox-mt-empty">{T.noMovements}</div>
                ) : (
                  <ul className="ox-mt-list" aria-label={T.movementsAria}>
                    {rows.map((r) => (
                      <li key={r.key} className="ox-mt-move">
                        <span className="ox-mt-move-at">{r.at}</span>
                        <span className="ox-mt-move-text">{r.text}</span>
                        <span className="ox-mt-move-sum" data-income={r.income}>
                          {r.sum}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          );
        }}
      </Loaded>
    </Section>
  );
}
