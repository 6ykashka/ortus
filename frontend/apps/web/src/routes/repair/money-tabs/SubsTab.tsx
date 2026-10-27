// W6.24 · Вкладка «Подрядчики» (`repair-subs`, эталон «Ремонт и стройка.dc.html» :577–588): временный доступ подрядчика
// только к своему объекту, договор и оплата, «Закрыть доступ» / «Открыть доступ до …» (setSubcontractorAccess).
// Срок при открытии — прежний, если не в прошлом, иначе сегодня + 14 дней (Q-W6.24-5). Только с `repairs.finance.read`.
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { afterChange, setAccess, useSubcontractors } from './api.ts';
import { type SubRowView, subRows } from './model.ts';
import { Denied, Head, Loaded, Section, type TabProps, useCaps, useMay } from './shared.tsx';
import { MONEY_TEXT } from './texts.ts';

const T = MONEY_TEXT.subs;

/** Сегодня по часам браузера: `YYYY-MM-DD` (в e2e часы подменяет харнесс). */
function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function SubCard(p: {
  row: SubRowView;
  canToggle: boolean;
  onToggle: (row: SubRowView) => Promise<void>;
}): ReactElement {
  const { row } = p;
  const busy = useBusy(`sub:${row.id}`);
  return (
    <li className="ox-mt-sub-card">
      <div className="ox-mt-sub-main">
        <strong>{row.name}</strong>
        <span className="ox-mt-sub-scope">{row.scope}</span>
        <span className="ox-mt-sub-access" data-closed={row.closed}>
          {row.access}
        </span>
      </div>
      <div className="ox-mt-sub-money">
        <span>
          {T.contract} <strong>{row.contract}</strong>
        </span>
        <span className="ox-mt-sub-paid">
          {T.paid} {row.paid}
        </span>
      </div>
      {p.canToggle ? (
        <button
          type="button"
          className="ox-mt-sub-btn"
          data-tone={row.toggle.open ? 'neutral' : 'danger'}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => void p.onToggle(row)}
        >
          {row.toggle.label}
        </button>
      ) : null}
    </li>
  );
}

export default function SubsTab({ tenantId, projectId }: TabProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const { finance } = useCaps();
  const subs = useSubcontractors(tenantId, projectId, finance);
  const may = useMay('repairs.subcontractors.manage');
  if (!finance) return <Denied />;

  const toggle = async (row: SubRowView): Promise<void> => {
    const body = row.toggle.open
      ? { active: true, ...(row.toggle.until ? { until: row.toggle.until } : {}) }
      : { active: false };
    try {
      await run(
        `sub:${row.id}`,
        () => setAccess(api, tenantId, projectId, row.id, body),
        row.toggle.open ? T.opened : T.closedDone,
      );
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await afterChange(qc, tenantId, projectId);
    }
  };

  return (
    <Section id="h-subs" label="Подрядчики">
      <Head id="h-subs" title={T.title} intro={T.intro} />
      <Loaded query={subs}>
        {(list) =>
          list.length === 0 ? (
            <div className="ox-mt-card ox-mt-empty">{T.empty}</div>
          ) : (
            <ul className="ox-mt-list ox-mt-stack" aria-label={T.listAria}>
              {subRows(list, today()).map((r) => (
                <SubCard key={r.id} row={r} canToggle={may} onToggle={toggle} />
              ))}
            </ul>
          )
        }
      </Loaded>
    </Section>
  );
}
